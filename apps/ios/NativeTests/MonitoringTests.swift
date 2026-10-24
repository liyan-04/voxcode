import XCTest
import VoxCodeCore
@testable import VoxCode

@MainActor final class NativeMonitoringTests: XCTestCase {
    func testFailurePreservesLastSampleAndTaskConnectionWithoutRawError() async throws {
        let transport = MonitorResponses()
        let session = try session(transport)
        session.connected = true
        await session.refreshMonitor()
        XCTAssertEqual(session.monitor.snapshot?.activeExecutions, 2)
        await transport.setFailure(true)
        await session.refreshMonitor()
        XCTAssertTrue(session.connected)
        XCTAssertEqual(session.monitor.snapshot?.activeExecutions, 2)
        XCTAssertNotNil(session.monitor.error)
        XCTAssertFalse(session.monitor.error?.contains("private") ?? true)
        XCTAssertNil(session.error)
        XCTAssertEqual(session.monitor.freshness(connected: true), .stale)
    }
    func testConcurrentReadDoesNotOverlapAndUnpairRejectsLateSnapshot() async throws {
        let transport = DelayedMonitor()
        let session = Session(binding: try binding(), transport: { request in await transport.send(request) })
        let first = Task { await session.refreshMonitor() }
        await wait(transport)
        await session.refreshMonitor()
        let count = await transport.count
        XCTAssertEqual(count, 1)
        session.forgetLocally()
        await transport.finish()
        await first.value
        XCTAssertNil(session.monitor.snapshot)
        XCTAssertNil(session.monitor.error)
        XCTAssertFalse(session.monitor.isLoading)
    }
    func testSimulationTransitionRejectsOldIdentityAndShowsExplicitFixtureReadiness() async throws {
        let transport = DelayedMonitor()
        let session = Session(binding: try binding(), transport: { request in await transport.send(request) })
        let old = Task { await session.refreshMonitor() }
        await wait(transport)
        await session.setSimulation(true)
        XCTAssertNil(session.monitor.snapshot)
        await session.refreshMonitor()
        XCTAssertNil(session.monitor.snapshot, "Identity changes must not overlap a still-pending monitor read")
        await transport.finish()
        await old.value
        XCTAssertNil(session.monitor.snapshot)
        await session.refreshMonitor()
        XCTAssertTrue(session.simulation)
        XCTAssertEqual(session.monitor.snapshot?.readiness?.voiceConfigured, false)
        XCTAssertEqual(session.monitor.snapshot?.readiness?.codexAvailable, false)
        XCTAssertNil(session.monitor.snapshot?.relay)
        await session.setSimulation(false)
        XCTAssertNil(session.monitor.snapshot)
    }
    private func binding() throws -> PairedBridge { try PairedBridge(origin: URL(string: "https://fixture.invalid")!, token: "synthetic-monitor") }
    private func session(_ transport: MonitorResponses) throws -> Session { Session(binding: try binding(), transport: { request in await transport.send(request) }) }
    private func wait(_ transport: DelayedMonitor) async {
        let deadline = Date().addingTimeInterval(2)
        while await transport.count < 1 && Date() < deadline { await Task.yield() }
        let count = await transport.count
        XCTAssertEqual(count, 1)
    }
}
private let monitorJSON = """
{"generatedAt":"2026-10-24T16:00:00Z","uptimeSeconds":5,"executionLimit":4,"maxTasks":32,"activeExecutions":2,"recoveryRequired":false,"counts":{"queued":1,"running":2,"waiting_approval":0,"waiting_input":0,"stopping":0,"interrupted":0,"failed":0,"completed":0,"accepted":0},"memory":{"rssBytes":1024,"heapUsedBytes":512}}
"""
private actor MonitorResponses {
    private var failure = false
    func setFailure(_ value: Bool) { failure = value }
    func send(_ request: URLRequest) -> (Data, URLResponse) {
        let json = failure ? #"{"error":{"message":"private path and credential detail","code":"offline"}}"# : monitorJSON
        return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: failure ? 503 : 200, httpVersion: nil, headerFields: nil)!)
    }
}
private actor DelayedMonitor {
    private var pending: CheckedContinuation<(Data, URLResponse), Never>?
    private var url: URL?
    private(set) var count = 0
    func send(_ request: URLRequest) async -> (Data, URLResponse) {
        if request.url!.path != "/api/monitor" { return (Data("{}".utf8), HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!) }
        count += 1; url = request.url
        return await withCheckedContinuation { pending = $0 }
    }
    func finish() { pending?.resume(returning: (Data(monitorJSON.utf8), HTTPURLResponse(url: url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)); pending = nil }
}
