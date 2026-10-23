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
    func testDraftPromptPopulatesComposerAndLaterDraftPreservesUserTranscript() async throws {
        let fixture = DraftPollTransport()
        let api = BridgeAPI(base: URL(string: "https://fixture.invalid")!, token: "fixture", transport: { request in try await fixture.send(request) })
        let recorder = Recorder(permission: { true }, capture: { _, _ in })
        await recorder.start(api: api, target: FrozenRecording(taskId: "task-a", version: 2))
        let firstDeadline = Date().addingTimeInterval(2)
        while recorder.draft?.id != "first" && Date() < firstDeadline { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(recorder.transcript, "First proposed instruction")
        recorder.transcriptEdited = true; recorder.transcript = "User-edited instruction"
        let secondDeadline = Date().addingTimeInterval(2)
        while recorder.draft?.id != "second" && Date() < secondDeadline { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(recorder.draft?.prompt, "Second proposed instruction")
        XCTAssertEqual(recorder.transcript, "User-edited instruction")
        await recorder.discard()
    }
    func testNewRecordingWaitsForOldDeleteWithoutLosingNewIdentity() async throws {
        let transport = CleanupTransport()
        let api = BridgeAPI(base: URL(string: "https://fixture.invalid")!, token: "fixture", transport: { await transport.send($0) })
        let recorder = Recorder(permission: { true }, capture: { _, _ in })
        let original = FrozenRecording(taskId: "A", version: 1, requestId: "old-recording")
        await recorder.start(api: api, target: original)
        let discard = Task { await recorder.discard() }
        let deleteDeadline = Date().addingTimeInterval(2)
        while !(await transport.deleting) && Date() < deleteDeadline { await Task.yield() }
        let newTarget = original.nextAttempt(afterClosing: recorder.closedRequestId)
        XCTAssertNotEqual(newTarget.requestId, "old-recording")
        XCTAssertEqual(newTarget.taskId, "A"); XCTAssertEqual(newTarget.version, 1)
        let next = Task { await recorder.start(api: api, target: newTarget) }
        let startDeadline = Date().addingTimeInterval(2)
        while recorder.frozen?.requestId != newTarget.requestId && Date() < startDeadline { await Task.yield() }
        XCTAssertEqual(recorder.frozen?.requestId, newTarget.requestId)
        XCTAssertTrue(recorder.busy)
        let before = await transport.creates; XCTAssertEqual(before, 1)
        await transport.finishDelete(); await discard.value; await next.value
        let after = await transport.creates; XCTAssertEqual(after, 2)
        XCTAssertEqual(recorder.frozen?.requestId, newTarget.requestId)
        let identities = await transport.requestIDs; XCTAssertEqual(identities, ["old-recording", newTarget.requestId])
        XCTAssertTrue(recorder.recording)
        await recorder.discard()
    }
    func testLateSuccessfulCreateDeletesOnlyDiscardedSessionAndKeepsNewRecording() async throws {
        let transport = LateCreateTransport()
        let api = BridgeAPI(base: URL(string: "https://fixture.invalid")!, token: "fixture", transport: { await transport.send($0) })
        let recorder = Recorder(permission: { true }, capture: { _, _ in })
        let originalTarget = FrozenRecording(taskId: "A", version: 1, requestId: "recording-a")
        let original = Task { await recorder.start(api: api, target: originalTarget) }
        let firstDeadline = Date().addingTimeInterval(2)
        while await transport.creates < 1 && Date() < firstDeadline { await Task.yield() }
        let firstCount = await transport.creates; XCTAssertEqual(firstCount, 1)
        await recorder.discard()
        let target = originalTarget.nextAttempt(afterClosing: recorder.closedRequestId)
        XCTAssertNotEqual(target.requestId, originalTarget.requestId)
        XCTAssertEqual(target.taskId, originalTarget.taskId); XCTAssertEqual(target.version, originalTarget.version)
        guard target.requestId != originalTarget.requestId else {
            await transport.finishCreate(originalTarget.requestId, id: "aaaaaaaa-0000-4000-8000-000000000000")
            await original.value
            return
        }
        let next = Task { await recorder.start(api: api, target: target) }
        let secondDeadline = Date().addingTimeInterval(2)
        while await transport.creates < 2 && Date() < secondDeadline { await Task.yield() }
        let secondCount = await transport.creates; XCTAssertEqual(secondCount, 2)
        await transport.finishCreate(target.requestId, id: "bbbbbbbb-0000-4000-8000-000000000000")
        await next.value
        XCTAssertEqual(recorder.frozen, target)
        XCTAssertTrue(recorder.recording)
        await transport.finishCreate("recording-a", id: "aaaaaaaa-0000-4000-8000-000000000000")
        await original.value
        let cleanupDeadline = Date().addingTimeInterval(2)
        while await transport.deletions.isEmpty && Date() < cleanupDeadline { await Task.yield() }
        let deletions = await transport.deletions
        XCTAssertEqual(deletions, ["/api/voice/sessions/aaaaaaaa-0000-4000-8000-000000000000"])
        XCTAssertEqual(recorder.frozen, target)
        XCTAssertTrue(recorder.recording)
        XCTAssertFalse(recorder.busy)
        XCTAssertNil(recorder.error)
        await recorder.discard()
    }
    func testUnknownCreateFailurePreservesOriginalRecordingIdentityForRetry() async {
        let api = BridgeAPI(base: URL(string: "https://fixture.invalid")!, token: "fixture", transport: { _ in throw URLError(.networkConnectionLost) })
        let recorder = Recorder(permission: { true }, capture: { _, _ in })
        let target = FrozenRecording(taskId: "A", version: 1, requestId: "unknown-create")
        await recorder.start(api: api, target: target)
        XCTAssertNil(recorder.frozen)
        XCTAssertNil(recorder.closedRequestId)
        XCTAssertEqual(target.nextAttempt(afterClosing: recorder.closedRequestId), target)
    }
}
private actor LateCreateTransport {
    private var pending: [String: (URL, CheckedContinuation<(Data, URLResponse), Never>)] = [:]
    private(set) var creates = 0
    private(set) var deletions: [String] = []
    func send(_ request: URLRequest) async -> (Data, URLResponse) {
        let url = request.url!
        if request.httpMethod == "POST" && url.path == "/api/voice/sessions" {
            let body = try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            let identity = body?["requestId"] as? String ?? ""
            creates += 1
            return await withCheckedContinuation { pending[identity] = (url, $0) }
        }
        if request.httpMethod == "DELETE" { deletions.append(url.path) }
        let json = url.path.hasSuffix("/events") ? "{\"events\":[],\"cursor\":0}" : "{}"
        return response(url, json)
    }
    func finishCreate(_ requestId: String, id: String) {
        guard let (url, continuation) = pending.removeValue(forKey: requestId) else { return }
        continuation.resume(returning: response(url, "{\"id\":\"\(id)\",\"outputSupported\":false}"))
    }
    private func response(_ url: URL, _ json: String) -> (Data, URLResponse) {
        (Data(json.utf8), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
private actor CleanupTransport {
    private var deletion: CheckedContinuation<Void, Never>?
    private(set) var creates = 0, deleting = false
    private(set) var requestIDs: [String] = []
    private var closedIDs: Set<String> = []
    func send(_ request: URLRequest) async -> (Data, URLResponse) {
        let object: String
        if request.httpMethod == "DELETE" && creates == 1 { deleting = true; await withCheckedContinuation { deletion = $0 }; closedIDs.insert(requestIDs[0]); object = "{}" }
        else if request.httpMethod == "POST" {
            let body = try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            let identity = body?["requestId"] as? String ?? ""
            if closedIDs.contains(identity) { return (Data("{\"error\":{\"code\":\"voice_error\",\"message\":\"Closed recording request ID\"}}".utf8), HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: nil)!) }
            creates += 1; requestIDs.append(identity); object = "{\"id\":\"aaaaaaaa-0000-4000-8000-000000000000\",\"outputSupported\":false}"
        }
        else { object = "{\"events\":[],\"cursor\":0}" }
        return (Data(object.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    func finishDelete() { deletion?.resume(); deletion = nil }
}
private actor DraftPollTransport {
    func send(_ request: URLRequest) throws -> (Data, URLResponse) {
        let url = request.url!
        let object: [String: Any]
        if url.path.hasSuffix("/events") {
            let after = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "after" })?.value
            if after == "0" || after == "1" {
                let first = after == "0"
                object = ["events": [["seq": first ? 1 : 2, "type": "draft", "draft": ["id": first ? "first" : "second", "taskId": "task-a", "version": 2, "title": "Synthetic draft", "prompt": first ? "First proposed instruction" : "Second proposed instruction", "criteria": [["text": "Keep this condition", "required": true]], "expiresAt": "2099-01-01T00:00:00Z"]]], "cursor": first ? 1 : 2]
            } else { object = ["events": [], "cursor": 2] }
        } else if request.httpMethod == "POST" { object = ["id": "aaaaaaaa-0000-4000-8000-000000000000", "outputSupported": false] }
        else { object = [:] }
        return (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
private actor RequestGate {
    private var pending: [CheckedContinuation<(Data, URLResponse), Error>] = []
    var count: Int { pending.count }
    func send(_ request: URLRequest) async throws -> (Data, URLResponse) { try await withCheckedThrowingContinuation { pending.append($0) } }
    func fail(_ index: Int) { pending[index].resume(throwing: URLError(.cannotConnectToHost)) }
}
