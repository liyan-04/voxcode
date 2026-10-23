import XCTest
import VoxCodeCore
@testable import VoxCode

@MainActor final class SubmissionTests: XCTestCase {
    func testDefiniteRejectionClearsPersistentJournalButPreservesConfirmedDraft() async throws {
        for (status, code) in [(400, "invalid"), (409, "stale"), (409, "blocked")] {
            let (preferences, binding) = try fixture()
            let pending = submission()
            let session = Session(binding: binding, transport: rejection(status, code), preferences: preferences)
            session.retainSubmission(pending)
            XCTAssertNotNil(Session(binding: binding, preferences: preferences).pendingSubmission)
            let result = await session.mutate(pending.path, pending.mutation)
            XCTAssertEqual(result, .rejected)
            XCTAssertNil(session.pendingSubmission)
            XCTAssertNil(Session(binding: binding, preferences: preferences).pendingSubmission)
            XCTAssertEqual(pending.mutation.prompt, "Confirmed instruction")
            XCTAssertEqual(pending.mutation.criteria?.first?.text, "Keep this condition")
            let reviewed = FrozenRecording(taskId: pending.target?.taskId, version: 3)
            XCTAssertNotEqual(reviewed.requestId, pending.mutation.requestId)
        }
    }
    func testUncertainNetworkAndServerFailuresPreserveExactJournalAcrossRelaunch() async throws {
        let transports: [BridgeAPI.Transport] = [
            { _ in throw URLError(.timedOut) }, { _ in throw URLError(.networkConnectionLost) }, rejection(500, "internal"), rejection(409, "conflict"),
        ]
        for transport in transports {
            let (preferences, binding) = try fixture()
            let pending = submission()
            let session = Session(binding: binding, transport: transport, preferences: preferences)
            session.retainSubmission(pending)
            let result = await session.mutate(pending.path, pending.mutation)
            XCTAssertEqual(result, .uncertain)
            let restored = try XCTUnwrap(Session(binding: binding, preferences: preferences).pendingSubmission)
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            XCTAssertEqual(try encoder.encode(restored), try encoder.encode(pending))
        }
    }
    func testRejectedUnrelatedOperationCannotEraseUncertainSubmission() async throws {
        let (preferences, binding) = try fixture()
        let session = Session(binding: binding, transport: rejection(409, "stale"), preferences: preferences)
        let pending = submission(); session.retainSubmission(pending)
        let result = await session.mutate("/api/tasks/another/cancel", Mutation(version: 1))
        XCTAssertEqual(result, .rejected)
        XCTAssertEqual(session.pendingSubmission?.mutation.requestId, pending.mutation.requestId)
    }
    func testNetworkUncertaintyThenRevokedRetryRetainsOriginalJournal() async throws {
        let (preferences, binding) = try fixture()
        let transport = RevokedRetryTransport()
        let pending = submission()
        let session = Session(binding: binding, transport: { try await transport.send($0) }, preferences: preferences)
        session.retainSubmission(pending)
        let first = await session.mutate(pending.path, pending.mutation)
        XCTAssertEqual(first, .uncertain)
        let restored = Session(binding: binding, transport: { try await transport.send($0) }, preferences: preferences)
        let retry = try XCTUnwrap(restored.pendingSubmission)
        let outcome = await restored.mutate(retry.path, retry.mutation)
        XCTAssertEqual(outcome, .uncertain)
        XCTAssertEqual(restored.pendingSubmission?.mutation.requestId, "confirmed-id")
        XCTAssertEqual(Session(binding: binding, preferences: preferences).pendingSubmission?.mutation.prompt, "Confirmed instruction")
    }
    private func fixture() throws -> (UserDefaults, PairedBridge) {
        let name = "VoxCodeSubmissionTests.\(UUID().uuidString)"
        let preferences = try XCTUnwrap(UserDefaults(suiteName: name))
        addTeardownBlock { UserDefaults(suiteName: name)?.removePersistentDomain(forName: name) }
        return (preferences, try PairedBridge(origin: URL(string: "https://fixture.invalid")!, token: "synthetic-phone-token"))
    }
    private func submission() -> PendingSubmission {
        let target = FrozenRecording(taskId: "task-a", version: 2, requestId: "confirmed-id")
        return PendingSubmission(path: "/api/tasks/task-a/messages", mutation: Mutation(requestId: target.requestId, version: 2, prompt: "Confirmed instruction", criteria: [CriterionInput(text: "Keep this condition")]), target: target)
    }
    private func rejection(_ status: Int, _ code: String) -> BridgeAPI.Transport {
        { request in (Data("{\"error\":{\"code\":\"\(code)\",\"message\":\"Synthetic rejection\"}}".utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!) }
    }
}
private actor RevokedRetryTransport {
    private var count = 0
    func send(_ request: URLRequest) throws -> (Data, URLResponse) {
        count += 1
        if count == 1 { throw URLError(.networkConnectionLost) }
        return (Data("{\"error\":{\"code\":\"unauthenticated\",\"message\":\"Revoked\"}}".utf8), HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!)
    }
}
