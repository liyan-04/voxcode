import SwiftUI
import Security
import CryptoKit
import VoxCodeCore

enum TokenVault {
    static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "VoxCode", kSecAttrAccount as String: "bridge"]
    static func read() -> PairedBridge? { var q = query; q[kSecReturnData as String] = true; var result: CFTypeRef?; guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data, let decoded = try? JSONDecoder().decode(PairedBridge.self, from: data) else { return nil }; return try? PairedBridge(origin: decoded.origin, token: decoded.token) }
    static func save(_ binding: PairedBridge) throws { let data = try JSONEncoder().encode(binding); var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly; let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary); if status == errSecItemNotFound { guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw APIError(message: "Could not save pairing credential in Keychain") } } else if status != errSecSuccess { throw APIError(message: "Could not update pairing credential in Keychain") } }
    static func clear() { SecItemDelete(query as CFDictionary) }
}
struct TaskEnvelope: Decodable { var task: TaskSnapshot }
struct TasksEnvelope: Decodable { var tasks: [TaskSnapshot] }
struct EventsEnvelope: Decodable { var events: [TaskEvent]; var cursor: Int }
@MainActor @Observable final class Session {
    private var paired: PairedBridge?
    private let transport: BridgeAPI.Transport?
    private let preferences: UserDefaults
    var address: String { paired?.origin.absoluteString ?? "https://" }
    var token: String { paired?.token ?? "" }
    var tasks: [TaskSnapshot] = []; var error: String?; var connected = false; var health = ConnectionHealth()
    var settings = BridgeSettings(); var pendingSettings: SettingsMutation?
    private(set) var pendingSubmission: PendingSubmission?
    private(set) var simulation = false
    private let fixture = SimulationBridge()
    private var revision = UUID()
    private var snapshots = SnapshotOwnership()
    init(binding: PairedBridge? = TokenVault.read(), transport: BridgeAPI.Transport? = nil, preferences: UserDefaults = .standard) { paired = binding; self.transport = transport; self.preferences = preferences; restoreSubmission() }
    private var submissionKey: String? {
        guard !simulation, let paired else { return nil }
        let digest = SHA256.hash(data: Data((paired.origin.absoluteString + "\n" + paired.token).utf8)).map { String(format: "%02x", $0) }.joined()
        return "voxcode.pending.\(digest)"
    }
    private func restoreSubmission() { pendingSubmission = submissionKey.flatMap { preferences.data(forKey: $0) }.flatMap { try? JSONDecoder().decode(PendingSubmission.self, from: $0) } }
    func retainSubmission(_ pending: PendingSubmission?) {
        pendingSubmission = pending
        guard let key = submissionKey else { return }
        if let pending, let data = try? JSONEncoder().encode(pending) { preferences.set(data, forKey: key) } else { preferences.removeObject(forKey: key) }
    }
    var api: BridgeAPI { get throws {
        if simulation { return BridgeAPI(base: URL(string: "https://simulation.invalid")!, token: "simulation", transport: { [fixture] in try await fixture.send($0) }) }
        guard let paired else { throw APIError(message: "请先配对服务器") }
        if let transport { return BridgeAPI(base: paired.origin, token: paired.token, transport: transport) }
        return try BridgeTransport.api(origin: paired.origin, token: paired.token)
    } }
    func setSimulation(_ enabled: Bool) async { guard simulation != enabled else { return }; simulation = enabled; revision = UUID(); tasks = []; pendingSettings = nil; restoreSubmission(); connected = false; health = ConnectionHealth(); settings = BridgeSettings(); if enabled || paired != nil { await refresh() } }
    func pair(address draftAddress: String, code: String) async -> Bool {
        do { guard let url = URL(string: draftAddress) else { throw APIError(message: "请输入有效的 HTTPS 地址") }; let origin = try BridgeAPI.validateOrigin(url); let client = try BridgeTransport.api(origin: origin, token: ""); let data = try JSONSerialization.data(withJSONObject: ["code": code]); struct Pair: Decodable { var sessionToken: String }; let result = try JSONDecoder().decode(Pair.self, from: await client.request("/api/pair", method: "POST", body: data)); let binding = try PairedBridge(origin: origin, token: result.sessionToken); try TokenVault.save(binding); paired = binding; revision = UUID(); simulation = false; tasks = []; connected = false; pendingSettings = nil; restoreSubmission(); health = ConnectionHealth(); await refresh(); return true } catch { self.error = error.localizedDescription; return false }
    }
    func refresh() async {
        let current = revision
        let request = snapshots.begin()
        do {
            let client = try api
            async let snapshot = client.json(TasksEnvelope.self, "/api/tasks")
            async let configuration = client.json(BridgeSettings.self, "/api/settings")
            let (result, updatedSettings) = try await (snapshot, configuration)
            guard revision == current, snapshots.allows(request) else { return }
            tasks = result.tasks.map { incoming in guard let previous = tasks.first(where: { $0.id == incoming.id }) else { return incoming }; return SnapshotOwnership.prefer(incoming, over: previous) ? incoming : previous }; settings = updatedSettings; connected = true; health.succeeded()
        } catch { guard revision == current, snapshots.allows(request) else { return }; connected = false; health.failed(error.localizedDescription) }
    }
    func saveSettings(limit: Int) async -> Bool {
        let current = revision
        let request = snapshots.begin()
        do {
            if pendingSettings == nil { pendingSettings = try SettingsMutation(executionLimit: limit) }
            let body = try JSONEncoder().encode(pendingSettings!)
            let result = try JSONDecoder().decode(BridgeSettings.self, from: await api.request("/api/settings", method: "POST", body: body))
            guard revision == current else { return false }; if snapshots.allows(request) { settings = result }; snapshots.invalidate(); pendingSettings = nil; return true
        } catch { guard revision == current else { return false }; snapshots.invalidate(); if !MutationOutcome.failure(error).retainsPending { pendingSettings = nil }; self.error = error.localizedDescription; return false }
    }
    func mutate(_ path: String, _ mutation: Mutation) async -> MutationOutcome {
        let current = revision
        let request = snapshots.begin()
        let outcome: MutationOutcome
        do {
            let result = try await api.json(TaskEnvelope.self, path, method: "POST", mutation: mutation)
            guard revision == current else { return .uncertain }
            if snapshots.allows(request) {
                if let index = tasks.firstIndex(where: { $0.id == result.task.id }) { if SnapshotOwnership.prefer(result.task, over: tasks[index], allowEqualTimestamp: false) { tasks[index] = result.task } }
                else { tasks.append(result.task) }
            }
            error = nil; outcome = .succeeded
        }
        catch { guard revision == current else { return .uncertain }; self.error = error.localizedDescription; outcome = .failure(error) }
        snapshots.invalidate()
        if !outcome.retainsPending, pendingSubmission?.path == path, pendingSubmission?.mutation.requestId == mutation.requestId { retainSubmission(nil) }
        return outcome
    }
    func unpair() async -> Bool { let binding = paired; do { _ = try await api.request("/api/unpair", method: "POST"); guard paired == binding else { return false }; forgetLocally(); return true } catch { self.error = "Could not revoke pairing: \(error.localizedDescription). Local forgetting leaves the server credential active."; return false } }
    func forgetLocally() { retainSubmission(nil); TokenVault.clear(); paired = nil; revision = UUID(); tasks = []; settings = BridgeSettings(); pendingSettings = nil; connected = false; health = ConnectionHealth() }
}
