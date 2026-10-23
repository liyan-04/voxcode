import Foundation

@main struct SubmissionChecks {
    static func main() async throws {
        let origin = URL(string: "https://fixture.invalid")!
        for (status, code, expected) in [(400, "invalid", MutationOutcome.rejected), (409, "stale", .rejected), (409, "blocked", .rejected), (401, "unauthenticated", .uncertain), (403, "denied", .uncertain), (404, "unknown", .uncertain), (409, "conflict", .uncertain), (429, "throttled", .uncertain), (500, "internal", .uncertain), (503, "unavailable", .uncertain), (400, "unexpected", .uncertain), (500, "invalid", .uncertain)] {
            let api = BridgeAPI(base: origin, token: "fixture", transport: { request in
                (Data("{\"error\":{\"code\":\"\(code)\",\"message\":\"Synthetic rejection\"}}".utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
            })
            do { _ = try await api.request("/api/tasks", method: "POST"); fatalError("Error status accepted") }
            catch {
                precondition(MutationOutcome.failure(error) == expected, "HTTP \(status) \(code) must resolve as \(expected)")
                precondition((error as? APIError)?.statusCode == status)
            }
        }
        precondition(MutationOutcome.failure(URLError(.timedOut)).retainsPending)
        precondition(MutationOutcome.failure(URLError(.networkConnectionLost)).retainsPending)
        precondition(MutationOutcome.failure(APIError(message: "Missing HTTP status", code: "invalid")).retainsPending)
        let frozen = FrozenRecording(taskId: "task-a", version: 2, requestId: "unchanged-request")
        let pending = PendingSubmission(path: "/api/tasks/task-a/messages", mutation: Mutation(requestId: frozen.requestId, version: frozen.version, prompt: "Preserve this confirmed instruction", criteria: [CriterionInput(text: "Keep the acceptance condition")]), target: frozen)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let saved = try encoder.encode(pending)
        let restored = try JSONDecoder().decode(PendingSubmission.self, from: saved)
        let restoredBytes = try encoder.encode(restored)
        precondition(restoredBytes == saved)
        let reviewed = FrozenRecording(taskId: frozen.taskId, version: 3)
        precondition(reviewed.requestId != frozen.requestId && reviewed.version == 3)
        precondition(frozen.nextAttempt(afterClosing: nil) == frozen, "Unknown create outcome must retain its original ID")
        precondition(frozen.nextAttempt(afterClosing: "unrelated") == frozen)
        let nextRecording = frozen.nextAttempt(afterClosing: frozen.requestId)
        precondition(nextRecording.taskId == "task-a" && nextRecording.version == 2 && nextRecording.requestId != "unchanged-request", "A closed recording needs a fresh ID for the same target")
        print("PASS: typed HTTP rejections unlock editing; uncertain failures preserve immutable retry identity and content")
    }
}
