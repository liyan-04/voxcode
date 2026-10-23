import XCTest
@testable import VoxCodeCore
final class CoreTests: XCTestCase {
    func testRecordingRemainsBoundWhenSelectionChanges() {
        let frozen = FrozenRecording(taskId: "A", version: 3, requestId: "stable")
        XCTAssertFalse(frozen.matches(taskId: "B", version: 3))
        XCTAssertFalse(frozen.matches(taskId: "A", version: 4))
        XCTAssertEqual(frozen.requestId, "stable")
    }
    func testMutationEncodesFrozenIdentityAndVersion() throws {
        let value = Mutation(requestId: "retry-id", version: 2, prompt: "fix", taskId: "A")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
        XCTAssertEqual(object["requestId"] as? String, "retry-id")
        XCTAssertEqual(object["taskId"] as? String, "A")
        XCTAssertEqual(object["version"] as? Int, 2)
    }
    func testNewVoiceSessionExplicitlyEncodesNullBinding() throws {
        let data = try JSONEncoder().encode(VoiceStart(recording: FrozenRecording(taskId: nil, version: nil)))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(object["taskId"] is NSNull)
        XCTAssertTrue(object["version"] is NSNull)
    }
    func testPairNeverSendsExistingBearerAndRejectsPathPrefix() throws {
        let client = BridgeAPI(base: URL(string: "https://draft.example")!, token: "old-secret")
        XCTAssertNil(try client.makeRequest("/api/pair", method: "POST").value(forHTTPHeaderField: "Authorization"))
        XCTAssertThrowsError(try BridgeAPI.validateOrigin(URL(string: "https://draft.example/mac-a/")!))
    }
    func testUncertainSubmissionPreservesPayloadAfterDraftEdit() {
        var draft = Mutation(requestId: "stable", version: 2, prompt: "original")
        let pending = PendingSubmission(path: "/api/tasks/A/messages", mutation: draft)
        draft.prompt = "changed"
        XCTAssertEqual(pending.mutation.prompt, "original")
        XCTAssertEqual(pending.mutation.requestId, "stable")
    }
    func testCancelledAudioEpochRejectsOldChunks() {
        var epoch = RecordingEpoch(); let old = epoch.id; epoch.invalidate()
        XCTAssertFalse(epoch.allows(old)); XCTAssertTrue(epoch.allows(epoch.id))
    }
    func testOfflineHealthPreservesLastConnectionAndRecovers() {
        var health = ConnectionHealth(); let date = Date(timeIntervalSince1970: 10)
        health.succeeded(at: date); health.failed("offline"); health.failed("offline")
        XCTAssertEqual(health.lastSuccess, date); XCTAssertEqual(health.issue, "offline")
        health.succeeded(); XCTAssertNil(health.issue)
    }
    func testEmptyPostUsesJSONContentTypeRequiredByRelay() throws {
        let client = BridgeAPI(base: URL(string: "https://paired.example")!, token: "phone-token")
        for path in ["/api/unpair", "/api/voice/sessions/recording-1/stop"] {
            let request = try client.makeRequest(path, method: "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertNil(request.httpBody)
        }
    }
    func testAudioPostPreservesBinaryContentTypeAndBytes() throws {
        let client = BridgeAPI(base: URL(string: "https://paired.example")!, token: "phone-token")
        let pcm = Data([0, 255, 1, 0])
        let request = try client.makeRequest("/api/voice/sessions/recording-1/audio", method: "POST", body: pcm, binary: true)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
        XCTAssertEqual(request.httpBody, pcm)
        XCTAssertNil(try client.makeRequest("/api/tasks").value(forHTTPHeaderField: "Content-Type"))
    }
}
