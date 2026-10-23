import SwiftUI
import Security
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
    private var paired = TokenVault.read()
    var address: String { paired?.origin.absoluteString ?? "https://" }
    var token: String { paired?.token ?? "" }
    var tasks: [TaskSnapshot] = []; var error: String?; var connected = false; var health = ConnectionHealth()
    var api: BridgeAPI { get throws { guard let paired else { throw APIError(message: "Pair with your Mac first") }; return BridgeAPI(base: paired.origin, token: paired.token) } }
    func pair(address draftAddress: String, code: String) async -> Bool {
        do { guard let url = URL(string: draftAddress) else { throw APIError(message: "Invalid HTTPS bridge URL") }; let origin = try BridgeAPI.validateOrigin(url); let client = BridgeAPI(base: origin, token: ""); let data = try JSONSerialization.data(withJSONObject: ["code": code]); struct Pair: Decodable { var sessionToken: String }; let result = try JSONDecoder().decode(Pair.self, from: await client.request("/api/pair", method: "POST", body: data)); let binding = try PairedBridge(origin: origin, token: result.sessionToken); try TokenVault.save(binding); paired = binding; tasks = []; connected = false; health = ConnectionHealth(); await refresh(); return true } catch { self.error = error.localizedDescription; return false }
    }
    func refresh() async { let binding = paired; do { let result = try await api.json(TasksEnvelope.self, "/api/tasks").tasks; guard paired == binding else { return }; tasks = result; connected = true; health.succeeded() } catch { guard paired == binding else { return }; connected = false; health.failed(error.localizedDescription) } }
    func mutate(_ path: String, _ mutation: Mutation) async -> Bool {
        let binding = paired
        do { let result = try await api.json(TaskEnvelope.self, path, method: "POST", mutation: mutation); guard paired == binding else { return false }; if let index = tasks.firstIndex(where: { $0.id == result.task.id }) { tasks[index] = result.task } else { tasks.append(result.task) }; return true } catch { self.error = error.localizedDescription; return false }
    }
    func unpair() async -> Bool { let binding = paired; do { _ = try await api.request("/api/unpair", method: "POST"); guard paired == binding else { return false }; forgetLocally(); return true } catch { self.error = "Could not revoke pairing: \(error.localizedDescription). Local forgetting leaves the Mac credential active."; return false } }
    func forgetLocally() { TokenVault.clear(); paired = nil; tasks = []; connected = false; health = ConnectionHealth() }
}
