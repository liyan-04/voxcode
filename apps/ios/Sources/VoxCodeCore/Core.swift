import Foundation

public struct Evidence: Codable, Sendable, Identifiable {
    public var kind: String; public var label: String; public var value: String; public var version: Int
    private var stableID: String?
    public var status: String?; public var command: String?; public var exitCode: Int?; public var artifactId: String?
    enum CodingKeys: String, CodingKey { case kind, label, value, version, status, command, exitCode, artifactId; case stableID = "id" }
    public var id: String { stableID ?? "\(kind):\(label):\(version):\(value)" }
}
public struct CriterionInput: Codable, Equatable, Sendable {
    public var text: String; public var required: Bool
    public init(text: String, required: Bool = true) { self.text = text; self.required = required }
}
public struct Criterion: Codable, Sendable, Identifiable {
    public var id: String; public var text: String; public var required: Bool; public var verification: String; public var status: String; public var evidenceIds: [String]; public var version: Int
}
public struct AcceptanceSnapshot: Codable, Sendable {
    public var version: Int; public var acceptedAt: String; public var criteria: [Criterion]
    public init(version: Int, acceptedAt: String, criteria: [Criterion]) { self.version = version; self.acceptedAt = acceptedAt; self.criteria = criteria }
}
public struct TaskPreview: Codable, Sendable { public var artifactId: String; public var version: Int; public var path: String }
public struct Approval: Codable, Sendable { public var id: String; public var command: String; public var cwd: String; public var description: String; public var version: Int }
public struct TaskSnapshot: Codable, Sendable, Identifiable {
    public var id: String; public var title: String; public var prompt: String; public var status: String; public var acceptance: String; public var version: Int
    public var createdAt: String; public var updatedAt: String; public var summary: String; public var previewUrl: String?; public var evidence: [Evidence]; public var approval: Approval?
    public var criteria: [Criterion]?; public var acceptanceSnapshot: AcceptanceSnapshot?; public var preview: TaskPreview?; public var waitingReason: String?
    public var shortID: String { String(id.prefix(8)) }
    public var canAccept: Bool {
        guard status == "completed", acceptance != "accepted", let criteria, !criteria.isEmpty else { return false }
        return criteria.allSatisfy { $0.version == version && (!$0.required || $0.status == "passed") }
    }
    public var statusLabel: String { ["queued": "排队", "running": "执行中", "waiting_input": "等待输入", "waiting_approval": "等待授权", "stopping": "停止中", "interrupted": "需在 Mac 恢复", "failed": "失败", "completed": "执行完成"][status] ?? status }
}
public enum TaskFilter: String, CaseIterable, Sendable {
    case all = "全部", active = "执行中", queued = "排队", attention = "待处理"
    public func apply(_ tasks: [TaskSnapshot]) -> [TaskSnapshot] {
        tasks.filter { task in switch self {
        case .all: true
        case .active: ["running", "waiting_approval", "stopping"].contains(task.status)
        case .queued: task.status == "queued"
        case .attention: ["waiting_input", "waiting_approval", "interrupted", "failed"].contains(task.status)
        } }
    }
}
public struct BridgeSettings: Codable, Sendable {
    public var executionLimit: Int; public var maxExecutionLimit: Int; public var maxTasks: Int; public var activeExecutions: Int; public var queuedTasks: Int; public var recoveryRequired: Bool
    public init() { executionLimit = 4; maxExecutionLimit = 8; maxTasks = 32; activeExecutions = 0; queuedTasks = 0; recoveryRequired = false }
}
public struct SettingsMutation: Encodable, Sendable {
    public let requestId: String; public let executionLimit: Int
    public init(requestId: String = UUID().uuidString, executionLimit: Int) throws {
        guard (1...8).contains(executionLimit) else { throw APIError(message: "执行名额必须为 1–8") }
        self.requestId = requestId; self.executionLimit = executionLimit
    }
}
public struct TaskEvent: Codable, Sendable, Identifiable { public var seq: Int; public var taskId: String; public var type: String; public var message: String; public var createdAt: String; public var id: Int { seq } }
public struct FrozenRecording: Codable, Equatable, Sendable {
    public let taskId: String?; public let version: Int?; public let requestId: String
    public init(taskId: String?, version: Int?, requestId: String = UUID().uuidString) { self.taskId = taskId; self.version = version; self.requestId = requestId }
    public func matches(taskId: String?, version: Int?) -> Bool { self.taskId == taskId && self.version == version }
}
public struct Mutation: Codable, Sendable {
    public var requestId: String; public var version: Int?; public var prompt: String?; public var title: String?; public var decision: String?; public var taskId: String?; public var criteria: [CriterionInput]?; public var note: String?
    public init(requestId: String = UUID().uuidString, version: Int? = nil, prompt: String? = nil, title: String? = nil, decision: String? = nil, taskId: String? = nil, criteria: [CriterionInput]? = nil, note: String? = nil) { self.requestId = requestId; self.version = version; self.prompt = prompt; self.title = title; self.decision = decision; self.taskId = taskId; self.criteria = criteria; self.note = note }
}
public struct VoiceDraft: Codable, Sendable, Identifiable {
    public var id: String; public var taskId: String?; public var version: Int?; public var title: String; public var prompt: String; public var criteria: [CriterionInput]; public var expiresAt: String
    public init(id: String, taskId: String?, version: Int?, title: String, prompt: String, criteria: [CriterionInput], expiresAt: String) { self.id = id; self.taskId = taskId; self.version = version; self.title = title; self.prompt = prompt; self.criteria = criteria; self.expiresAt = expiresAt }
    public func isValid(for target: FrozenRecording, now: Date = Date()) -> Bool {
        target.matches(taskId: taskId, version: version) && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (1...12).contains(criteria.count) && criteria.allSatisfy { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.text.utf16.count <= 500 } && (WireDate.parse(expiresAt).map { $0 > now } ?? false)
    }
}
public struct VoiceOutputFormat: Codable, Equatable, Sendable {
    public let format: String; public let sample_rate: Int; public let channels: Int
    public init(format: String, sample_rate: Int, channels: Int) { self.format = format; self.sample_rate = sample_rate; self.channels = channels }
    public var supported: Bool { format == "pcm" && [16000, 24000].contains(sample_rate) && channels == 1 }
}
public struct VoiceCreated: Decodable, Sendable { public let id: String; public let outputFormat: VoiceOutputFormat?; public let outputSupported: Bool? }
public struct VoiceEvent: Decodable, Sendable { public let seq: Int; public let type: String; public let text: String?; public let message: String?; public let data: String?; public let state: String?; public let is_aborted: Bool?; public let draft: VoiceDraft?; public let taskId: String? }
public struct VoiceEvents: Decodable, Sendable { public let events: [VoiceEvent]; public let cursor: Int }
public struct PCMFrame: Sendable {
    public let samples: [Float]
    public let sampleRate: Int
    public init(base64: String, format: VoiceOutputFormat) throws {
        guard format.supported, base64.count <= 128000, let data = Data(base64Encoded: base64), !data.isEmpty, data.count <= 96000, data.count.isMultiple(of: 2) else { throw APIError(message: "语音音频格式或帧长度无效") }
        let bytes = Array(data); sampleRate = format.sample_rate
        samples = stride(from: 0, to: bytes.count, by: 2).map { index in Float(Int16(bitPattern: UInt16(bytes[index]) | UInt16(bytes[index + 1]) << 8)) / 32768 }
    }
}
public struct VoiceCursor: Sendable {
    public private(set) var value = 0
    public init() {}
    public mutating func advance(sequences: [Int], cursor: Int) throws {
        guard sequences.count <= 256, cursor >= value else { throw APIError(message: "语音事件顺序无效", code: "cursor_expired") }
        var next = value
        for seq in sequences { guard next < Int.max, seq == next + 1 else { throw APIError(message: "语音事件缺失，请重新录音", code: "cursor_expired") }; next = seq }
        guard next == cursor else { throw APIError(message: "语音事件已过期，请重新录音", code: "cursor_expired") }
        value = next
    }
}
public struct PlaybackEpoch: Sendable {
    public private(set) var id = UUID()
    public private(set) var suppressed = false
    public init() {}
    public func allows(_ candidate: UUID) -> Bool { candidate == id && !suppressed }
    public mutating func clear() { id = UUID() }
    public mutating func suppress() { clear(); suppressed = true }
    public mutating func reset() { clear(); suppressed = false }
}
public enum WireDate {
    public static func parse(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: text)
    }
}
public struct PreviewScope: Sendable {
    public let origin: URL; public let path: String
    public init(origin: URL, path: String) throws {
        self.origin = try BridgeAPI.validateOrigin(origin)
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 4, parts[0].isEmpty, parts[1] == "preview", !parts[2].isEmpty, parts[3].isEmpty, parts[2].utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 95 }) else { throw APIError(message: "预览路径无效") }
        self.path = path
    }
    public var url: URL { URL(string: path, relativeTo: origin)!.absoluteURL }
    public func allows(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", url.host?.lowercased() == origin.host?.lowercased(), (url.port ?? 443) == (origin.port ?? 443), url.user == nil, url.password == nil, let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        let encoded = components.percentEncodedPath.lowercased()
        guard !["%2e", "%2f", "%5c", "%25"].contains(where: encoded.contains), !url.path.contains("\\"), !url.path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else { return false }
        return components.percentEncodedPath.hasPrefix(path)
    }
}
public struct APIError: Error, LocalizedError, Sendable { public var message: String; public var code: String?; public init(message: String, code: String? = nil) { self.message = message; self.code = code }; public var errorDescription: String? { message } }
public struct VoiceStart: Encodable, Sendable {
    public let recording: FrozenRecording
    public init(recording: FrozenRecording) { self.recording = recording }
    enum CodingKeys: String, CodingKey { case taskId, version, requestId }
    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(recording.taskId, forKey: .taskId)
        try values.encode(recording.version, forKey: .version)
        try values.encode(recording.requestId, forKey: .requestId)
    }
}
public struct PairedBridge: Codable, Equatable, Sendable {
    public let origin: URL; public let token: String
    public init(origin: URL, token: String) throws { self.origin = try BridgeAPI.validateOrigin(origin); guard !token.isEmpty else { throw APIError(message: "Empty pairing credential") }; self.token = token }
}
public struct PendingSubmission: Codable, Sendable {
    public let path: String; public let mutation: Mutation; public let target: FrozenRecording?
    public init(path: String, mutation: Mutation, target: FrozenRecording? = nil) { self.path = path; self.mutation = mutation; self.target = target }
}
public struct RecordingEpoch: Sendable {
    public private(set) var id = UUID()
    public init() {}
    public func allows(_ candidate: UUID) -> Bool { candidate == id }
    public mutating func invalidate() { id = UUID() }
}
public struct RecordingLifecycle: Sendable {
    public private(set) var epoch = RecordingEpoch()
    public private(set) var frozen: FrozenRecording?
    public var busy = false
    public var error: String?
    public init() {}
    public func allows(_ candidate: UUID) -> Bool { epoch.allows(candidate) }
    public mutating func begin(_ target: FrozenRecording) -> UUID? {
        guard frozen == nil else { return nil }
        frozen = target; busy = true; error = nil
        return epoch.id
    }
    public mutating func finishStart(_ candidate: UUID) { if allows(candidate) { busy = false } }
    public mutating func failStart(_ candidate: UUID, message: String) -> Bool {
        guard allows(candidate) else { return false }
        error = message; busy = false; return true
    }
    public mutating func invalidate() { epoch.invalidate() }
    public mutating func discard() { invalidate(); frozen = nil; busy = false }
}
public struct ConnectionHealth: Sendable {
    public private(set) var issue: String?
    public private(set) var lastSuccess: Date?
    public init() {}
    public mutating func succeeded(at date: Date = Date()) { issue = nil; lastSuccess = date }
    public mutating func failed(_ message: String) { issue = message }
}
public struct BridgeAPI: Sendable {
    public let base: URL; public let token: String
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, URLResponse)
    private let transport: Transport
    public init(base: URL, token: String, transport: @escaping Transport = { try await URLSession.shared.data(for: $0) }) { self.base = base; self.token = token; self.transport = transport }
    public static func validateOrigin(_ url: URL) throws -> URL {
        guard url.scheme?.lowercased() == "https", let host = url.host, !host.isEmpty, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/" else { throw APIError(message: "Enter an HTTPS root URL without a path, query, or credentials") }
        return url
    }
    public func makeRequest(_ path: String, method: String = "GET", body: Data? = nil, binary: Bool = false) throws -> URLRequest {
        let origin = try Self.validateOrigin(base)
        guard path.hasPrefix("/api/"), !path.hasPrefix("//"), let url = URL(string: path, relativeTo: origin)?.absoluteURL, url.host == origin.host, url.port == origin.port, url.scheme == origin.scheme else { throw APIError(message: "Invalid bridge route") }
        var request = URLRequest(url: url); request.httpMethod = method; request.httpBody = body; request.timeoutInterval = 20
        if !token.isEmpty && path != "/api/pair" && path != "/api/health" { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if body != nil || method == "POST" { request.setValue(binary ? "application/octet-stream" : "application/json", forHTTPHeaderField: "Content-Type") }
        return request
    }
    public func request(_ path: String, method: String = "GET", body: Data? = nil, binary: Bool = false) async throws -> Data {
        let request = try makeRequest(path, method: method, body: body, binary: binary)
        let (data, response) = try await transport(request)
        guard let response = response as? HTTPURLResponse else { throw APIError(message: "Invalid bridge response") }
        guard (200..<300).contains(response.statusCode) else {
            struct Failure: Decodable { struct Detail: Decodable { var message: String; var code: String? }; var error: Detail }
            let failure = try? JSONDecoder().decode(Failure.self, from: data).error
            throw APIError(message: failure?.message ?? "HTTP \(response.statusCode)", code: failure?.code)
        }
        return data
    }
    public func json<T: Decodable>(_ type: T.Type, _ path: String, method: String = "GET", mutation: Mutation? = nil) async throws -> T {
        try JSONDecoder().decode(type, from: await request(path, method: method, body: mutation.map { try JSONEncoder().encode($0) }))
    }
}
