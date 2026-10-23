import Foundation

public struct Evidence: Codable, Sendable, Identifiable {
    public var kind: String; public var label: String; public var value: String; public var version: Int
    public var id: String { "\(kind):\(label):\(version):\(value)" }
}
public struct Approval: Codable, Sendable { public var id: String; public var command: String; public var cwd: String; public var description: String; public var version: Int }
public struct TaskSnapshot: Codable, Sendable, Identifiable {
    public var id: String; public var title: String; public var prompt: String; public var status: String; public var acceptance: String; public var version: Int
    public var createdAt: String; public var updatedAt: String; public var summary: String; public var previewUrl: String?; public var evidence: [Evidence]; public var approval: Approval?
}
public struct TaskEvent: Codable, Sendable, Identifiable { public var seq: Int; public var taskId: String; public var type: String; public var message: String; public var createdAt: String; public var id: Int { seq } }
public struct FrozenRecording: Equatable, Sendable {
    public let taskId: String?; public let version: Int?; public let requestId: String
    public init(taskId: String?, version: Int?, requestId: String = UUID().uuidString) { self.taskId = taskId; self.version = version; self.requestId = requestId }
    public func matches(taskId: String?, version: Int?) -> Bool { self.taskId == taskId && self.version == version }
}
public struct Mutation: Codable, Sendable {
    public var requestId: String; public var version: Int?; public var prompt: String?; public var title: String?; public var decision: String?; public var taskId: String?
    public init(requestId: String = UUID().uuidString, version: Int? = nil, prompt: String? = nil, title: String? = nil, decision: String? = nil, taskId: String? = nil) { self.requestId = requestId; self.version = version; self.prompt = prompt; self.title = title; self.decision = decision; self.taskId = taskId }
}
public struct APIError: Error, LocalizedError, Sendable { public var message: String; public init(message: String) { self.message = message }; public var errorDescription: String? { message } }
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
public struct PendingSubmission: Sendable {
    public let path: String; public let mutation: Mutation
    public init(path: String, mutation: Mutation) { self.path = path; self.mutation = mutation }
}
public struct RecordingEpoch: Sendable {
    public private(set) var id = UUID()
    public init() {}
    public func allows(_ candidate: UUID) -> Bool { candidate == id }
    public mutating func invalidate() { id = UUID() }
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
    public init(base: URL, token: String) { self.base = base; self.token = token }
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
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw APIError(message: "Invalid bridge response") }
        guard (200..<300).contains(response.statusCode) else {
            struct Failure: Decodable { struct Detail: Decodable { var message: String }; var error: Detail }
            throw APIError(message: (try? JSONDecoder().decode(Failure.self, from: data).error.message) ?? "HTTP \(response.statusCode)")
        }
        return data
    }
    public func json<T: Decodable>(_ type: T.Type, _ path: String, method: String = "GET", mutation: Mutation? = nil) async throws -> T {
        try JSONDecoder().decode(type, from: await request(path, method: method, body: mutation.map { try JSONEncoder().encode($0) }))
    }
}
