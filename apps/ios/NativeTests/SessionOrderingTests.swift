import XCTest
import VoxCodeCore
@testable import VoxCode

@MainActor final class SessionOrderingTests: XCTestCase {
    func testOlderRefreshCannotReplaceNewerRefresh() async throws {
        let transport = OrderedSnapshots()
        let session = try session(transport)
        let old = Task { await session.refresh() }; await wait(transport, count: 2)
        let newer = Task { await session.refresh() }; await wait(transport, count: 4)
        await transport.refresh(start: 2, version: 3, status: "completed", limit: 7)
        await newer.value
        await transport.refresh(start: 0, version: 1, status: "running", limit: 1)
        await old.value
        XCTAssertEqual(session.tasks.first?.version, 3)
        XCTAssertEqual(session.tasks.first?.status, "completed")
        XCTAssertEqual(session.settings.executionLimit, 7)
    }
    func testMutationInvalidatesRefreshThatStartedBeforeIt() async throws {
        let transport = OrderedSnapshots()
        let session = try session(transport)
        let old = Task { await session.refresh() }; await wait(transport, count: 2)
        let change = Task { await session.mutate("/api/tasks/task-a/messages", Mutation(version: 1, prompt: "New instruction")) }
        await wait(transport, count: 3)
        await transport.mutation(index: 2, version: 2, status: "queued")
        let outcome = await change.value
        XCTAssertEqual(outcome, .succeeded)
        await transport.refresh(start: 0, version: 1, status: "completed", limit: 1)
        await old.value
        XCTAssertEqual(session.tasks.first?.version, 2)
        XCTAssertEqual(session.tasks.first?.status, "queued")
    }
    func testOldReplayCompletingAfterFreshSnapshotCannotRegressTask() async throws {
        let transport = OrderedSnapshots()
        let session = try session(transport)
        let replay = Task { await session.mutate("/api/tasks/task-a/messages", Mutation(requestId: "original", version: 1, prompt: "Confirmed instruction")) }
        await wait(transport, count: 1)
        let newer = Task { await session.refresh() }; await wait(transport, count: 3)
        await transport.refresh(start: 1, version: 4, status: "completed", limit: 4)
        await newer.value
        await transport.mutation(index: 0, version: 2, status: "queued")
        let outcome = await replay.value
        XCTAssertEqual(outcome, .succeeded)
        XCTAssertEqual(session.tasks.first?.version, 4)
        XCTAssertEqual(session.tasks.first?.status, "completed")
    }
    private func session(_ transport: OrderedSnapshots) throws -> Session {
        Session(binding: try PairedBridge(origin: URL(string: "https://fixture.invalid")!, token: "synthetic-token"), transport: { request in await transport.send(request) })
    }
    private func wait(_ transport: OrderedSnapshots, count: Int) async {
        let deadline = Date().addingTimeInterval(2)
        while await transport.count < count && Date() < deadline { await Task.yield() }
        let observed = await transport.count
        XCTAssertEqual(observed, count)
    }
}
private actor OrderedSnapshots {
    private var entries: [(URLRequest, CheckedContinuation<(Data, URLResponse), Never>)] = []
    var count: Int { entries.count }
    func send(_ request: URLRequest) async -> (Data, URLResponse) { await withCheckedContinuation { entries.append((request, $0)) } }
    func refresh(start: Int, version: Int, status: String, limit: Int) {
        for index in start..<(start + 2) {
            let path = entries[index].0.url!.path
            if path == "/api/tasks" { respond(index, "{\"tasks\":[\(task(version, status))]}") }
            else { respond(index, "{\"executionLimit\":\(limit),\"maxExecutionLimit\":8,\"maxTasks\":32,\"activeExecutions\":0,\"queuedTasks\":0,\"recoveryRequired\":false}") }
        }
    }
    func mutation(index: Int, version: Int, status: String) { respond(index, "{\"task\":\(task(version, status))}") }
    private func task(_ version: Int, _ status: String) -> String {
        "{\"id\":\"task-a\",\"title\":\"Synthetic task\",\"prompt\":\"Instruction\",\"status\":\"\(status)\",\"acceptance\":\"pending\",\"version\":\(version),\"createdAt\":\"2026-10-23T00:00:00Z\",\"updatedAt\":\"2026-10-23T00:00:0\(version)Z\",\"summary\":\"\",\"evidence\":[],\"criteria\":[]}"
    }
    private func respond(_ index: Int, _ json: String) { entries[index].1.resume(returning: (Data(json.utf8), HTTPURLResponse(url: entries[index].0.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)) }
}
