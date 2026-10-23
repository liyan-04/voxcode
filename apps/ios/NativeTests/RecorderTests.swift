import XCTest
import VoxCodeCore
@testable import VoxCode

@MainActor final class RecorderTests: XCTestCase {
    func testFailedPermissionFromAIsIgnoredAfterBStarts() async {
        var permissions: [CheckedContinuation<Bool, Never>] = []
        let recorder = Recorder(permission: { await withCheckedContinuation { permissions.append($0) } }, capture: { _, _ in })
        let api = BridgeAPI(base: URL(string: "https://fixture.invalid")!, token: "fixture")
        let first = Task { await recorder.start(api: api, target: FrozenRecording(taskId: "A", version: 1)) }
        while permissions.count != 1 { await Task.yield() }
        await recorder.discard()
        let second = Task { await recorder.start(api: api, target: FrozenRecording(taskId: "B", version: 2)) }
        while permissions.count != 2 { await Task.yield() }
        permissions[0].resume(returning: false)
        await first.value
        XCTAssertEqual(recorder.frozen?.taskId, "B")
        XCTAssertTrue(recorder.busy)
        XCTAssertNil(recorder.error)
        permissions[1].resume(returning: false)
        await second.value
        XCTAssertNil(recorder.frozen)
    }
    func testFailedRequestFromAIsIgnoredAfterBStarts() async {
        let gate = RequestGate()
        let api = BridgeAPI(base: URL(string: "https://fixture.invalid")!, token: "fixture", transport: { request in try await gate.send(request) })
        let recorder = Recorder(permission: { true }, capture: { _, _ in })
        let first = Task { await recorder.start(api: api, target: FrozenRecording(taskId: "A", version: 1)) }
        while await gate.count < 1 { await Task.yield() }
        await recorder.discard()
        let second = Task { await recorder.start(api: api, target: FrozenRecording(taskId: "B", version: 2)) }
        while await gate.count < 2 { await Task.yield() }
        await gate.fail(0); await first.value
        XCTAssertEqual(recorder.frozen?.taskId, "B")
        XCTAssertTrue(recorder.busy)
        XCTAssertNil(recorder.error)
        await gate.fail(1); await second.value
        XCTAssertNil(recorder.frozen)
    }
}
private actor RequestGate {
    private var pending: [CheckedContinuation<(Data, URLResponse), Error>] = []
    var count: Int { pending.count }
    func send(_ request: URLRequest) async throws -> (Data, URLResponse) { try await withCheckedThrowingContinuation { pending.append($0) } }
    func fail(_ index: Int) { pending[index].resume(throwing: URLError(.cannotConnectToHost)) }
}
