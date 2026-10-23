import XCTest
@testable import VoxCodeCore

final class SnapshotOrderingTests: XCTestCase {
    func testOnlyLatestReadSurvivesMutationBoundary() {
        var ownership = SnapshotOwnership()
        let first = ownership.begin(), second = ownership.begin()
        XCTAssertFalse(ownership.allows(first)); XCTAssertTrue(ownership.allows(second))
        ownership.invalidate(); XCTAssertFalse(ownership.allows(second))
        let during = ownership.begin(); ownership.invalidate(); XCTAssertFalse(ownership.allows(during))
    }
    func testOldReplayVersionAndTimestampCannotReplaceCurrentTask() throws {
        let current = try task(version: 3, date: "2026-10-23T00:00:03Z")
        XCTAssertFalse(SnapshotOwnership.prefer(try task(version: 2, date: "2026-10-23T00:00:04Z"), over: current))
        XCTAssertTrue(SnapshotOwnership.prefer(try task(version: 4, date: "2026-10-23T00:00:02Z"), over: current))
        XCTAssertFalse(SnapshotOwnership.prefer(try task(version: 3, date: "2026-10-23T00:00:02Z"), over: current))
        XCTAssertTrue(SnapshotOwnership.prefer(try task(version: 3, date: "2026-10-23T00:00:04Z"), over: current))
        XCTAssertTrue(SnapshotOwnership.prefer(current, over: current))
        XCTAssertFalse(SnapshotOwnership.prefer(current, over: current, allowEqualTimestamp: false))
        XCTAssertTrue(SnapshotOwnership.prefer(try task(version: 3, date: "2026-10-23T00:00:04Z"), over: current, allowEqualTimestamp: false))
        XCTAssertTrue(SnapshotOwnership.prefer(try task(version: 4, date: "2026-10-23T00:00:03Z"), over: current, allowEqualTimestamp: false))
        XCTAssertFalse(SnapshotOwnership.prefer(try task(version: 3, date: "invalid"), over: current))
        XCTAssertFalse(SnapshotOwnership.prefer(current, over: try task(version: 3, date: "invalid")))
    }
    @MainActor func testNextCreateWaitsForQueuedRemoteCleanup() async {
        let barrier = VoiceCleanupBarrier(), gate = CleanupGate()
        barrier.schedule { await gate.waitForDeletion() }
        let create = Task { await barrier.wait(); await gate.create() }
        while !(await gate.deleting) { await Task.yield() }
        for _ in 0..<100 { await Task.yield() }
        let premature = await gate.created; XCTAssertFalse(premature)
        await gate.finishDeletion(); await create.value
        let created = await gate.created; XCTAssertTrue(created)
    }
    private func task(version: Int, date: String) throws -> TaskSnapshot {
        try JSONDecoder().decode(TaskSnapshot.self, from: Data("{\"id\":\"a\",\"title\":\"Fixture\",\"prompt\":\"Synthetic\",\"status\":\"completed\",\"acceptance\":\"pending\",\"version\":\(version),\"createdAt\":\"2026-10-23T00:00:00Z\",\"updatedAt\":\"\(date)\",\"summary\":\"\",\"evidence\":[]}".utf8))
    }
}
private actor CleanupGate {
    private var release: CheckedContinuation<Void, Never>?
    private(set) var deleting = false, created = false
    func waitForDeletion() async { deleting = true; await withCheckedContinuation { release = $0 } }
    func finishDeletion() { release?.resume(); release = nil }
    func create() { created = true }
}
