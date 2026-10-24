import Foundation

public struct MonitorSnapshot: Decodable, Sendable {
    public let generatedAt: String
    public let uptimeSeconds: Double
    public let executionLimit: Int
    public let maxTasks: Int
    public let activeExecutions: Int
    public let recoveryRequired: Bool
    public let counts: MonitorCounts
    public let memory: MonitorMemory
    public let readiness: MonitorReadiness?
    public let relay: RelayMonitor?
}
public struct MonitorCounts: Decodable, Sendable {
    public let queued, running, waitingApproval, waitingInput, stopping, interrupted, failed, completed, accepted: Int
    enum CodingKeys: String, CodingKey {
        case queued, running, stopping, interrupted, failed, completed, accepted
        case waitingApproval = "waiting_approval", waitingInput = "waiting_input"
    }
}
public struct MonitorMemory: Decodable, Sendable { public let rssBytes, heapUsedBytes: Int }
public struct MonitorReadiness: Decodable, Sendable { public let codexAvailable, voiceConfigured: Bool }
public struct RelayMonitor: Decodable, Sendable {
    public let connected: Bool
    public let uptimeSeconds: Double
    public let inFlight, requestsTotal, responsesTotal, errorsTotal, timeoutsTotal, latencySamples: Int
    public let latencyP50Ms, latencyP95Ms: Double?
}
public enum MonitorFreshness: Sendable { case unknown, current, stale }

/// Independent monitor ownership; task refreshes and mutations never invalidate this state.
public struct MonitorState: Sendable {
    public private(set) var snapshot: MonitorSnapshot?
    public private(set) var lastSuccess: Date?
    public private(set) var roundtripMilliseconds: Double?
    public private(set) var error: String?
    private var request: UUID?
    private var lastAttempt: Date?
    public var isLoading: Bool { request != nil }
    public init() {}
    public mutating func begin(at now: Date = Date(), automatic: Bool = false) -> UUID? {
        guard request == nil else { return nil }
        if automatic, let lastAttempt, now.timeIntervalSince(lastAttempt) < 5 { return nil }
        let id = UUID(); request = id; lastAttempt = now; return id
    }
    public mutating func reset() { self = MonitorState() }
    public mutating func succeed(_ snapshot: MonitorSnapshot, request candidate: UUID, receivedAt: Date, roundtripMilliseconds: Double) {
        guard request == candidate else { return }
        self.snapshot = snapshot; lastSuccess = receivedAt
        self.roundtripMilliseconds = roundtripMilliseconds; error = nil; request = nil
    }
    public mutating func fail(request candidate: UUID) {
        guard request == candidate else { return }
        error = "暂时无法读取监控，请稍后重试"; request = nil
    }
    public func freshness(at now: Date = Date(), connected: Bool) -> MonitorFreshness {
        guard let snapshot, let lastSuccess else { return .unknown }
        guard error == nil, connected, snapshot.relay?.connected != false,
              let generated = WireDate.parse(snapshot.generatedAt) else { return .stale }
        let receivedAge = now.timeIntervalSince(lastSuccess), generatedAge = now.timeIntervalSince(generated)
        return (0...15).contains(receivedAge) && (-5...15).contains(generatedAge) ? .current : .stale
    }
}
