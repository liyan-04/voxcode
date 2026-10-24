import XCTest
@testable import VoxCodeCore

final class V1CoreTests: XCTestCase {
    private func task() throws -> TaskSnapshot {
        try JSONDecoder().decode(TaskSnapshot.self, from: Data("""
        {"id":"abcdef12-0000","title":"任务","prompt":"修改","status":"completed","acceptance":"pending","version":2,"createdAt":"2026-10-23T00:00:00Z","updatedAt":"2026-10-23T00:00:00Z","summary":"结果","previewUrl":null,"evidence":[{"id":"e1","kind":"test","label":"检查","value":"通过","version":2,"status":"passed","command":"npm test","exitCode":0}],"approval":null,"criteria":[{"id":"c1","text":"人工检查","required":true,"verification":"manual","status":"unverified","evidenceIds":["e1"],"version":2}],"acceptanceSnapshot":null,"preview":null}
        """.utf8))
    }
    func testAcceptanceRequiresCompletedCurrentRequiredCriteria() throws {
        var value = try task()
        XCTAssertFalse(value.canAccept)
        value.criteria![0].status = "failed"; XCTAssertFalse(value.canAccept)
        value.criteria![0].status = "passed"; XCTAssertTrue(value.canAccept)
        value.criteria![0].version = 1; XCTAssertFalse(value.canAccept)
        value.criteria![0].version = 2; value.status = "running"; XCTAssertFalse(value.canAccept)
        value.status = "completed"; value.acceptance = "accepted"; XCTAssertFalse(value.canAccept)
        value.acceptance = "pending"; value.criteria = nil; XCTAssertFalse(value.canAccept)
        value.criteria = []; XCTAssertFalse(value.canAccept)
        value = try task(); value.criteria![0].required = false; XCTAssertTrue(value.canAccept)
        XCTAssertEqual(value.shortID, "abcdef12")
        XCTAssertEqual(value.statusLabel, "执行完成")
        value.status = "future"; XCTAssertEqual(value.statusLabel, "future")
    }
    func testTwentyFourTaskFiltersRetainSlotStatesAndAttention() throws {
        let original = try task()
        var values = (0..<24).map { index -> TaskSnapshot in var value = original; value.id = "id-\(index)"; value.status = index < 4 ? "running" : index < 8 ? "queued" : "waiting_input"; return value }
        values[0].status = "stopping"; values[1].status = "waiting_approval"; values[8].status = "failed"; values[9].status = "interrupted"
        XCTAssertEqual(TaskFilter.all.apply(values).count, 24)
        XCTAssertEqual(TaskFilter.active.apply(values).count, 4)
        XCTAssertEqual(TaskFilter.queued.apply(values).count, 4)
        XCTAssertEqual(TaskFilter.attention.apply(values).count, 17)
        XCTAssertEqual(TaskFilter.allCases.count, 4)
    }
    func testEvidenceUsesServerIDAndVersionSnapshotRoundTrip() throws {
        var value = try task()
        XCTAssertEqual(value.evidence[0].id, "e1")
        XCTAssertEqual(value.evidence[0].command, "npm test")
        XCTAssertEqual(value.evidence[0].exitCode, 0)
        let old = try JSONDecoder().decode(Evidence.self, from: Data("{\"kind\":\"note\",\"label\":\"old\",\"value\":\"text\",\"version\":1}".utf8))
        XCTAssertEqual(old.id, "note:old:1:text")
        value.acceptanceSnapshot = AcceptanceSnapshot(version: 2, acceptedAt: "2026-10-23T00:00:00Z", criteria: value.criteria!)
        value.preview = TaskPreview(artifactId: "future", version: 2, path: "/preview/future/")
        let decoded = try JSONDecoder().decode(TaskSnapshot.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(decoded.acceptanceSnapshot?.criteria[0].id, "c1")
        XCTAssertEqual(decoded.preview?.version, 2)
    }
    func testSettingsRangeAndImmutableCriteriaRetrySurvivePersistence() throws {
        XCTAssertEqual(BridgeSettings().executionLimit, 4)
        XCTAssertEqual(BridgeSettings().maxExecutionLimit, 8)
        XCTAssertEqual(BridgeSettings().maxTasks, 32)
        for limit in 1...8 { XCTAssertEqual(try SettingsMutation(requestId: "fixed", executionLimit: limit).executionLimit, limit) }
        for limit in [-1, 0, 9, Int.max] { XCTAssertThrowsError(try SettingsMutation(executionLimit: limit)) }
        var value = Mutation(requestId: "fixed", version: 2, prompt: "原文", criteria: [CriterionInput(text: "人工检查")], note: "记录")
        let frozen = FrozenRecording(taskId: "A", version: 2, requestId: "fixed")
        let pending = PendingSubmission(path: "/api/tasks/A/messages", mutation: value, target: frozen)
        value.criteria![0].text = "已改"
        let restored = try JSONDecoder().decode(PendingSubmission.self, from: JSONEncoder().encode(pending))
        XCTAssertEqual(restored.target, frozen)
        XCTAssertEqual(restored.mutation.criteria?[0].text, "人工检查")
        XCTAssertEqual(restored.mutation.note, "记录")
        XCTAssertEqual(restored.mutation.requestId, "fixed")
    }
    func testOldStartFailureAndCompletionCannotChangeNewRecording() throws {
        var state = RecordingLifecycle()
        let a = try XCTUnwrap(state.begin(FrozenRecording(taskId: "A", version: 1)))
        XCTAssertNil(state.begin(FrozenRecording(taskId: "ignored", version: 0)))
        state.discard()
        let b = try XCTUnwrap(state.begin(FrozenRecording(taskId: "B", version: 2)))
        XCTAssertFalse(state.failStart(a, message: "old")); state.finishStart(a)
        XCTAssertEqual(state.frozen?.taskId, "B"); XCTAssertTrue(state.busy); XCTAssertNil(state.error)
        state.finishStart(b); XCTAssertFalse(state.busy)
        XCTAssertTrue(state.failStart(b, message: "current")); XCTAssertEqual(state.error, "current")
        state.invalidate(); XCTAssertFalse(state.allows(b))
    }
    func testVoiceDraftRejectsWrongTaskVersionExpiryAndMalformedConditions() {
        let target = FrozenRecording(taskId: "A", version: 2)
        var value = VoiceDraft(id: "draft", taskId: "A", version: 2, title: "标题", prompt: "指令", criteria: [CriterionInput(text: "条件")], expiresAt: "2099-01-01T00:00:00.000Z")
        XCTAssertTrue(value.isValid(for: target))
        value.taskId = "B"; XCTAssertFalse(value.isValid(for: target)); value.taskId = "A"
        value.version = 1; XCTAssertFalse(value.isValid(for: target)); value.version = 2
        value.expiresAt = "2000-01-01T00:00:00Z"; XCTAssertFalse(value.isValid(for: target))
        value.expiresAt = "invalid"; XCTAssertFalse(value.isValid(for: target))
        value.expiresAt = "2099-01-01T00:00:00Z"; value.prompt = " \n"; XCTAssertFalse(value.isValid(for: target)); value.prompt = "指令"
        value.criteria = []; XCTAssertFalse(value.isValid(for: target))
        value.criteria = Array(repeating: CriterionInput(text: "条件"), count: 13); XCTAssertFalse(value.isValid(for: target))
        value.criteria = [CriterionInput(text: " ")]; XCTAssertFalse(value.isValid(for: target))
        value.criteria = [CriterionInput(text: String(repeating: "a", count: 501))]; XCTAssertFalse(value.isValid(for: target))
        XCTAssertNotNil(WireDate.parse("2026-10-23T00:00:00Z"))
    }
    func testDeferredPreviewScopeRejectsEscapesAndOtherOrigins() throws {
        let origin = URL(string: "https://121.52.250.201:9899")!
        let scope = try PreviewScope(origin: origin, path: "/preview/future-id/")
        XCTAssertEqual(scope.url.absoluteString, "https://121.52.250.201:9899/preview/future-id/")
        XCTAssertTrue(scope.allows(URL(string: "assets/app.js", relativeTo: scope.url)!.absoluteURL))
        for raw in ["http://121.52.250.201:9899/preview/future-id/", "https://121.52.250.201/preview/future-id/", "https://other.test:9899/preview/future-id/", "https://121.52.250.201:9899/api/tasks", "https://121.52.250.201:9899/preview/future-id/%2e%2e/x", "https://121.52.250.201:9899/preview/future-id/%2fx", "https://121.52.250.201:9899/preview/future-id/%25x", "https://user@121.52.250.201:9899/preview/future-id/"] { XCTAssertFalse(scope.allows(URL(string: raw)!)) }
        for path in ["/preview/", "/preview/a", "/preview/../", "/preview/a/b/", "https://evil.test/"] { XCTAssertThrowsError(try PreviewScope(origin: origin, path: path)) }
    }
    func testPCMDecodesSignedLittleEndianAndRejectsUnsupportedOrUnboundedFrames() throws {
        let format = VoiceOutputFormat(format: "pcm", sample_rate: 24000, channels: 1)
        let encoded = Data([0, 128, 0, 0, 255, 127]).base64EncodedString()
        let frame = try PCMFrame(base64: encoded, format: format)
        XCTAssertEqual(frame.sampleRate, 24000); XCTAssertEqual(frame.samples, [-1, 0, Float(32767) / 32768])
        XCTAssertTrue(VoiceOutputFormat(format: "pcm", sample_rate: 16000, channels: 1).supported)
        for format in [VoiceOutputFormat(format: "opus", sample_rate: 24000, channels: 1), VoiceOutputFormat(format: "pcm", sample_rate: 48000, channels: 1), VoiceOutputFormat(format: "pcm", sample_rate: 16000, channels: 2)] { XCTAssertThrowsError(try PCMFrame(base64: encoded, format: format)) }
        for value in ["!", "", Data([0]).base64EncodedString(), Data(repeating: 0, count: 96002).base64EncodedString()] { XCTAssertThrowsError(try PCMFrame(base64: value, format: format)) }
    }
    func testVoiceCursorAndPlaybackEpochRejectGapsOldAudioAndAbortedOutput() throws {
        var cursor = VoiceCursor()
        try cursor.advance(sequences: [1, 2], cursor: 2)
        for (values, next) in [([4], 4), ([], 3), ([2], 2), ([], 1), (Array(3...260), 260)] { XCTAssertThrowsError(try cursor.advance(sequences: values, cursor: next)) }
        XCTAssertEqual(cursor.value, 2)
        try cursor.advance(sequences: [], cursor: 2); try cursor.advance(sequences: [3], cursor: 3)
        var epoch = PlaybackEpoch(); let first = epoch.id
        XCTAssertTrue(epoch.allows(first)); epoch.clear(); XCTAssertFalse(epoch.allows(first))
        epoch.suppress(); XCTAssertFalse(epoch.allows(epoch.id)); epoch.reset(); XCTAssertTrue(epoch.allows(epoch.id))
    }
    func testVoiceWireDecodingPreservesAbortedStateAndNegotiatedFormat() throws {
        let created = try JSONDecoder().decode(VoiceCreated.self, from: Data("{\"id\":\"session\",\"outputSupported\":true,\"outputFormat\":{\"format\":\"pcm\",\"sample_rate\":16000,\"channels\":1}}".utf8))
        XCTAssertEqual(created.outputFormat?.sample_rate, 16000); XCTAssertEqual(created.outputSupported, true)
        let batch = try JSONDecoder().decode(VoiceEvents.self, from: Data("{\"events\":[{\"seq\":1,\"type\":\"tts\",\"state\":\"stop\",\"is_aborted\":true}],\"cursor\":1}".utf8))
        XCTAssertEqual(batch.events[0].is_aborted, true)
    }
    func testTransportPreservesJSONErrorCodesAndBinaryRequests() async throws {
        let origin = URL(string: "https://fixture.invalid")!
        let success = BridgeAPI(base: origin, token: "fixture", transport: { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture")
            return (Data("{\"executionLimit\":4,\"maxExecutionLimit\":8,\"maxTasks\":32,\"activeExecutions\":0,\"queuedTasks\":0,\"recoveryRequired\":false}".utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        let received = try await success.json(BridgeSettings.self, "/api/settings")
        XCTAssertEqual(received.executionLimit, 4)
        let failure = BridgeAPI(base: origin, token: "fixture", transport: { request in (Data("{\"error\":{\"code\":\"cursor_expired\",\"message\":\"expired\"}}".utf8), HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: nil)!) })
        do { _ = try await failure.request("/api/voice/sessions/s/events"); XCTFail("Error response accepted") } catch let error as APIError { XCTAssertEqual(error.code, "cursor_expired"); XCTAssertEqual(error.localizedDescription, "expired") }
        let malformed = BridgeAPI(base: origin, token: "", transport: { request in (Data(), HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!) })
        do { _ = try await malformed.request("/api/tasks"); XCTFail("Error response accepted") } catch let error as APIError { XCTAssertEqual(error.message, "HTTP 503") }
        let invalid = BridgeAPI(base: origin, token: "", transport: { request in (Data(), URLResponse(url: request.url!, mimeType: nil, expectedContentLength: 0, textEncodingName: nil)) })
        do { _ = try await invalid.request("/api/tasks"); XCTFail("Non-HTTP response accepted") } catch is APIError {}
        XCTAssertThrowsError(try success.makeRequest("https://evil.test/api/tasks"))
        XCTAssertThrowsError(try BridgeAPI.validateOrigin(URL(string: "http://121.52.250.201:9899")!))
    }
}
