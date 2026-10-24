import XCTest
@testable import VoxCodeCore

final class MonitoringTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_792_857_600)
    private func snapshot(_ additions: String = "", generatedAt: String = "2026-10-24T16:00:00Z") throws -> MonitorSnapshot {
        try JSONDecoder().decode(MonitorSnapshot.self, from: Data("""
        {"generatedAt":"\(generatedAt)","uptimeSeconds":45.5,"executionLimit":4,"maxTasks":32,"activeExecutions":2,"recoveryRequired":true,
        "counts":{"queued":3,"running":1,"waiting_approval":1,"waiting_input":2,"stopping":0,"interrupted":1,"failed":2,"completed":7,"accepted":4},
        "memory":{"rssBytes":1048576,"heapUsedBytes":524288}\(additions)}
        """.utf8))
    }
    func testOlderMacSnapshotDecodesWithoutOptionalExtensions() throws {
        let value = try snapshot()
        XCTAssertEqual(value.activeExecutions, 2)
        XCTAssertEqual(value.counts.waitingApproval, 1)
        XCTAssertEqual(value.counts.waitingInput, 2)
        XCTAssertEqual(value.counts.completed, 7)
        XCTAssertEqual(value.counts.accepted, 4)
        XCTAssertEqual(value.memory.heapUsedBytes, 524288)
        XCTAssertNil(value.readiness)
        XCTAssertNil(value.relay)
    }
    func testReadinessAndRelayDecodeNullAndMeasuredPercentiles() throws {
        let value = try snapshot(#", "readiness":{"codexAvailable":true,"voiceConfigured":false},"relay":{"connected":true,"uptimeSeconds":12,"inFlight":1,"requestsTotal":9,"responsesTotal":7,"errorsTotal":2,"timeoutsTotal":1,"latencySamples":0,"latencyP50Ms":null,"latencyP95Ms":null}"#)
        XCTAssertEqual(value.readiness?.codexAvailable, true)
        XCTAssertEqual(value.readiness?.voiceConfigured, false)
        XCTAssertEqual(value.relay?.timeoutsTotal, 1)
        XCTAssertNil(value.relay?.latencyP50Ms)
        XCTAssertNil(value.relay?.latencyP95Ms)
        let measured = try snapshot(#", "relay":{"connected":true,"uptimeSeconds":12,"inFlight":0,"requestsTotal":9,"responsesTotal":9,"errorsTotal":0,"timeoutsTotal":0,"latencySamples":9,"latencyP50Ms":5.2,"latencyP95Ms":15.1}"#)
        XCTAssertEqual(measured.relay?.latencyP50Ms, 5.2)
        XCTAssertEqual(measured.relay?.latencyP95Ms, 15.1)
    }
    func testFreshnessExpiresAndFailureKeepsSampleButMarksItStale() throws {
        var state = MonitorState()
        XCTAssertEqual(state.freshness(at: now, connected: true), .unknown)
        let request = try XCTUnwrap(state.begin())
        state.succeed(try snapshot(), request: request, receivedAt: now, roundtripMilliseconds: 42)
        XCTAssertEqual(state.freshness(at: now.addingTimeInterval(15), connected: true), .current)
        XCTAssertEqual(state.freshness(at: now.addingTimeInterval(15.01), connected: true), .stale)
        XCTAssertEqual(state.freshness(at: now, connected: false), .stale)
        let failed = try XCTUnwrap(state.begin())
        state.fail(request: failed)
        XCTAssertEqual(state.snapshot?.counts.completed, 7)
        XCTAssertEqual(state.roundtripMilliseconds, 42)
        XCTAssertNotNil(state.error)
        XCTAssertEqual(state.freshness(at: now, connected: true), .stale)
        let retry = try XCTUnwrap(state.begin())
        state.succeed(try snapshot(), request: retry, receivedAt: now, roundtripMilliseconds: 9)
        XCTAssertNil(state.error)
        XCTAssertEqual(state.freshness(at: now, connected: true), .current)
    }
    func testInvalidOldAndFutureServerTimestampsNeverLookCurrent() throws {
        for timestamp in ["invalid", "2026-10-24T15:59:44Z", "2026-10-24T16:01:00Z"] {
            var state = MonitorState()
            let request = try XCTUnwrap(state.begin())
            state.succeed(try snapshot(generatedAt: timestamp), request: request, receivedAt: now, roundtripMilliseconds: 1)
            XCTAssertEqual(state.freshness(at: now, connected: true), .stale)
        }
    }
    func testNoOverlappingReadsAndResetRejectsOldIdentityAndRequest() throws {
        var state = MonitorState()
        let old = try XCTUnwrap(state.begin())
        XCTAssertNil(state.begin())
        state.reset()
        XCTAssertNil(state.snapshot)
        XCTAssertNil(state.lastSuccess)
        XCTAssertNil(state.roundtripMilliseconds)
        XCTAssertNil(state.error)
        let current = try XCTUnwrap(state.begin())
        state.succeed(try snapshot(), request: old, receivedAt: now, roundtripMilliseconds: 100)
        state.fail(request: old)
        XCTAssertTrue(state.isLoading)
        XCTAssertNil(state.snapshot)
        state.succeed(try snapshot(), request: current, receivedAt: now, roundtripMilliseconds: 4)
        state.fail(request: current)
        XCTAssertFalse(state.isLoading)
        XCTAssertNil(state.error)
        XCTAssertEqual(state.roundtripMilliseconds, 4)
    }
    func testAutomaticReadsRespectFiveSecondsAfterAnyRefreshButManualIsAllowed() throws {
        var state = MonitorState()
        let first = try XCTUnwrap(state.begin(at: now, automatic: true))
        state.fail(request: first)
        XCTAssertNil(state.begin(at: now.addingTimeInterval(4.99), automatic: true))
        let manual = try XCTUnwrap(state.begin(at: now.addingTimeInterval(1)))
        state.fail(request: manual)
        XCTAssertNil(state.begin(at: now.addingTimeInterval(5), automatic: true))
        XCTAssertNotNil(state.begin(at: now.addingTimeInterval(6), automatic: true))
    }
}
