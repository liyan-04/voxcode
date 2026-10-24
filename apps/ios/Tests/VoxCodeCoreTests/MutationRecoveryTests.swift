import XCTest
@testable import VoxCodeCore

final class MutationRecoveryTests: XCTestCase {
    func testHTTPInvalidAndStaleAreDefiniteRejections() async throws {
        for (status, code) in [(400, "invalid"), (409, "stale"), (409, "blocked")] {
            let failure = try await responseFailure(status: status, code: code)
            XCTAssertEqual(failure.statusCode, status)
            XCTAssertEqual(MutationOutcome.failure(failure), .rejected)
            XCTAssertFalse(MutationOutcome.failure(failure).retainsPending)
        }
    }
    func testConflictServerFailuresAndUnknownResponsesKeepRetryLocked() async throws {
        for (status, code) in [(401, "unauthenticated"), (403, "denied"), (404, "unknown"), (409, "conflict"), (429, "throttled"), (500, "internal"), (503, "unavailable"), (500, "invalid"), (400, "unexpected")] {
            let failure = try await responseFailure(status: status, code: code)
            XCTAssertEqual(MutationOutcome.failure(failure), .uncertain)
        }
        for error in [URLError(.timedOut), URLError(.networkConnectionLost)] { XCTAssertTrue(MutationOutcome.failure(error).retainsPending) }
        XCTAssertTrue(MutationOutcome.failure(APIError(message: "No response", code: "invalid")).retainsPending)
        XCTAssertFalse(MutationOutcome.succeeded.retainsPending)
    }
    func testUncertainSubmissionPersistenceRetainsAllConfirmedFields() throws {
        let target = FrozenRecording(taskId: "task-a", version: 2, requestId: "immutable-request")
        let value = PendingSubmission(path: "/api/tasks/task-a/messages", mutation: Mutation(requestId: target.requestId, version: 2, prompt: "Confirmed text", criteria: [CriterionInput(text: "Original condition", required: false)]), target: target)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let bytes = try encoder.encode(value)
        let restored = try JSONDecoder().decode(PendingSubmission.self, from: bytes)
        XCTAssertEqual(try encoder.encode(restored), bytes)
        XCTAssertEqual(restored.target, target)
        let reviewed = FrozenRecording(taskId: target.taskId, version: 3)
        XCTAssertEqual(reviewed.taskId, target.taskId)
        XCTAssertEqual(reviewed.version, 3)
        XCTAssertNotEqual(reviewed.requestId, target.requestId)
        XCTAssertEqual(target.nextAttempt(afterClosing: nil), target)
        XCTAssertEqual(target.nextAttempt(afterClosing: "another-attempt"), target)
        let newRecording = target.nextAttempt(afterClosing: target.requestId)
        XCTAssertEqual(newRecording.taskId, "task-a"); XCTAssertEqual(newRecording.version, 2)
        XCTAssertNotEqual(newRecording.requestId, "immutable-request")
    }
    private func responseFailure(status: Int, code: String) async throws -> APIError {
        let api = BridgeAPI(base: URL(string: "https://fixture.invalid")!, token: "fixture", transport: { request in
            (Data("{\"error\":{\"code\":\"\(code)\",\"message\":\"Synthetic rejection\"}}".utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        })
        do { _ = try await api.request("/api/tasks", method: "POST"); XCTFail("HTTP error accepted") }
        catch let failure as APIError { return failure }
        throw APIError(message: "Expected a typed API rejection")
    }
}
