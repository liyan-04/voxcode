import Foundation

@main struct CoreChecks {
    static func main() throws {
        let frozen = FrozenRecording(taskId: "A", version: 3, requestId: "stable")
        precondition(!frozen.matches(taskId: "B", version: 3), "Cross-task route accepted")
        precondition(!frozen.matches(taskId: "A", version: 4), "Stale version accepted")
        precondition(frozen.matches(taskId: "A", version: 3))
        let mutation = Mutation(requestId: frozen.requestId, version: frozen.version, prompt: "fix", taskId: frozen.taskId)
        let data = try JSONEncoder().encode(mutation)
        let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        precondition(object["requestId"] as? String == "stable")
        precondition(object["taskId"] as? String == "A")
        precondition(object["version"] as? Int == 3)
        let retry = try JSONEncoder().encode(mutation)
        let retried = try JSONDecoder().decode(Mutation.self, from: retry)
        precondition(retried.requestId == mutation.requestId)
        let voice = try JSONSerialization.jsonObject(with: JSONEncoder().encode(VoiceStart(recording: FrozenRecording(taskId: nil, version: nil)))) as! [String: Any]
        precondition(voice["taskId"] is NSNull)
        precondition(voice["version"] is NSNull)
        let paired = try PairedBridge(origin: URL(string: "https://paired.example:8443")!, token: "paired-secret")
        let persisted = try JSONDecoder().decode(PairedBridge.self, from: JSONEncoder().encode(paired))
        precondition(persisted == paired)
        let authenticated = BridgeAPI(base: paired.origin, token: paired.token)
        let draft = URL(string: "https://draft.example")!
        let taskRequest = try authenticated.makeRequest("/api/tasks")
        precondition(taskRequest.url?.host == "paired.example")
        precondition(taskRequest.value(forHTTPHeaderField: "Authorization") == "Bearer paired-secret")
        let pairing = BridgeAPI(base: draft, token: paired.token)
        let pairRequest = try pairing.makeRequest("/api/pair", method: "POST")
        precondition(pairRequest.value(forHTTPHeaderField: "Authorization") == nil)
        for invalid in ["https://relay.example/mac-a/", "https://relay.example?x=1", "https://user@relay.example"] {
            do { _ = try BridgeAPI.validateOrigin(URL(string: invalid)!); fatalError("Invalid origin accepted") } catch is APIError { }
        }
        var edited = mutation
        let submission = PendingSubmission(path: "/api/tasks/A/messages", mutation: edited)
        edited.prompt = "different text"; edited.title = "different title"
        precondition(submission.mutation.prompt == "fix")
        precondition(submission.mutation.title == nil)
        precondition(submission.mutation.requestId == "stable")
        var epoch = RecordingEpoch(); let old = epoch.id
        precondition(epoch.allows(old)); epoch.invalidate(); precondition(!epoch.allows(old)); precondition(epoch.allows(epoch.id))
        var health = ConnectionHealth(); let connectedAt = Date(timeIntervalSince1970: 100)
        health.succeeded(at: connectedAt); health.failed("offline"); health.failed("offline")
        precondition(health.lastSuccess == connectedAt); precondition(health.issue == "offline")
        health.succeeded(); precondition(health.issue == nil)
        let revoke = try authenticated.makeRequest("/api/unpair", method: "POST")
        precondition(revoke.httpMethod == "POST"); precondition(revoke.value(forHTTPHeaderField: "Authorization") == "Bearer paired-secret")
        for path in ["/api/unpair", "/api/voice/sessions/recording-1/stop"] {
            let emptyPost = try authenticated.makeRequest(path, method: "POST")
            precondition(emptyPost.value(forHTTPHeaderField: "Content-Type") == "application/json", "Empty POST must satisfy relay JSON content-type contract")
            precondition(emptyPost.httpBody == nil)
        }
        let pcm = Data([0, 255, 1, 0])
        let audio = try authenticated.makeRequest("/api/voice/sessions/recording-1/audio", method: "POST", body: pcm, binary: true)
        precondition(audio.value(forHTTPHeaderField: "Content-Type") == "application/octet-stream")
        precondition(audio.httpBody == pcm)
        precondition(taskRequest.value(forHTTPHeaderField: "Content-Type") == nil)
        print("PASS: routing, origin isolation, immutable retry, cancelled audio epochs, persistent connection health, authenticated revoke, relay-compatible empty POST and PCM (34 assertions)")
    }
}
