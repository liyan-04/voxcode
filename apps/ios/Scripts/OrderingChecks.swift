import Foundation

@main struct OrderingChecks {
    @MainActor static func main() async throws {
        var snapshots = SnapshotOwnership()
        let old = snapshots.begin(), newer = snapshots.begin()
        precondition(!snapshots.allows(old) && snapshots.allows(newer))
        snapshots.invalidate(); precondition(!snapshots.allows(newer))
        let duringMutation = snapshots.begin(); snapshots.invalidate()
        precondition(!snapshots.allows(duringMutation))
        let decoder = JSONDecoder()
        func task(_ version: Int, _ updatedAt: String) throws -> TaskSnapshot {
            try decoder.decode(TaskSnapshot.self, from: Data("{\"id\":\"a\",\"title\":\"Fixture\",\"prompt\":\"Synthetic\",\"status\":\"completed\",\"acceptance\":\"pending\",\"version\":\(version),\"createdAt\":\"2026-10-23T00:00:00Z\",\"updatedAt\":\"\(updatedAt)\",\"summary\":\"\",\"evidence\":[]}".utf8))
        }
        let current = try task(3, "2026-10-23T00:00:03Z")
        let older = try task(2, "2026-10-23T00:00:02Z"), oldSameVersion = try task(3, "2026-10-23T00:00:02Z"), next = try task(4, "2026-10-23T00:00:04Z")
        precondition(!SnapshotOwnership.prefer(older, over: current))
        precondition(!SnapshotOwnership.prefer(oldSameVersion, over: current))
        precondition(SnapshotOwnership.prefer(next, over: current))
        precondition(SnapshotOwnership.prefer(current, over: current))
        let malformed = try task(3, "invalid")
        precondition(!SnapshotOwnership.prefer(malformed, over: current))
        precondition(!SnapshotOwnership.prefer(current, over: malformed))
        let barrier = VoiceCleanupBarrier(), probe = CleanupProbe()
        barrier.schedule { await probe.closeOldSession() }
        let create = Task { await barrier.wait(); await probe.createNewSession() }
        while !(await probe.closing) { await Task.yield() }
        for _ in 0..<100 { await Task.yield() }
        let early = await probe.created; precondition(!early, "Create must not overtake old DELETE")
        await probe.release(); await create.value
        let finished = await probe.created; precondition(finished)
        print("PASS: refresh/mutation ownership, older replay rejection and DELETE-before-create cleanup barrier")
    }
}
private actor CleanupProbe {
    private var releaseClose: CheckedContinuation<Void, Never>?
    private(set) var closing = false, created = false
    func closeOldSession() async { closing = true; await withCheckedContinuation { releaseClose = $0 } }
    func createNewSession() { created = true }
    func release() { releaseClose?.resume(); releaseClose = nil }
}
