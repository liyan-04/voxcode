import Foundation

@main struct V1Checks {
    static func main() throws {
        let data = Data("""
        {"id":"task-0001","title":"同名","prompt":"调整","status":"completed","acceptance":"pending","version":2,"createdAt":"2026-10-23T00:00:00Z","updatedAt":"2026-10-23T00:00:00Z","summary":"","previewUrl":null,"evidence":[],"approval":null,"criteria":[{"id":"c1","text":"点击验证","required":true,"verification":"manual","status":"unverified","evidenceIds":[],"version":2}],"preview":{"artifactId":"abc","version":2,"path":"/preview/abc/"},"acceptanceSnapshot":null}
        """.utf8)
        var task = try JSONDecoder().decode(TaskSnapshot.self, from: data)
        precondition(!task.canAccept)
        task.criteria![0].status = "passed"
        precondition(task.canAccept)
        task.criteria![0].version = 1
        precondition(!task.canAccept, "Old criterion must never permit acceptance")
        task.criteria![0].version = 2
        var tasks = (0..<24).map { index -> TaskSnapshot in var copy = task; copy.id = "task-\(index)"; copy.status = index < 4 ? "running" : index < 8 ? "queued" : "waiting_input"; return copy }
        tasks[0].status = "stopping"
        precondition(TaskFilter.active.apply(tasks).count == 4)
        precondition(TaskFilter.queued.apply(tasks).count == 4)
        precondition(TaskFilter.attention.apply(tasks).count == 16)
        precondition(TaskFilter.all.apply(tasks).count == 24)
        let criteria = [CriterionInput(text: "检查交互", required: true)]
        var mutation = Mutation(requestId: "retry", version: 2, prompt: "调整", criteria: criteria)
        let pending = PendingSubmission(path: "/api/tasks/task-1/messages", mutation: mutation)
        mutation.criteria = [CriterionInput(text: "已修改", required: false)]
        precondition(pending.mutation.criteria == criteria)
        for value in [0, 9] { do { _ = try SettingsMutation(executionLimit: value); fatalError("Invalid execution limit accepted") } catch is APIError {} }
        let settings = try SettingsMutation(executionLimit: 4); precondition(settings.executionLimit == 4)
        let origin = URL(string: "https://121.52.250.201:9899")!
        let scope = try PreviewScope(origin: origin, path: "/preview/abc/")
        for path in ["/preview/abc/index.html", "/preview/abc/assets/app.js", "/preview/abc/#route"] { precondition(scope.allows(URL(string: path, relativeTo: origin)!.absoluteURL)) }
        for raw in ["http://121.52.250.201:9899/preview/abc/", "https://evil.example/preview/abc/", "https://121.52.250.201:9899/api/tasks", "https://121.52.250.201:9899/preview/abc/../other/", "https://121.52.250.201:9899/preview/abc/%2e%2e/other", "https://121.52.250.201:9899/preview/abcd/", "https://121.52.250.201:9899/preview/abc/%2fapi"] { precondition(!scope.allows(URL(string: raw)!)) }
        let recording = FrozenRecording(taskId: "task-1", version: 2)
        var draft = VoiceDraft(id: "draft", taskId: "task-1", version: 2, title: "标题", prompt: "修改", criteria: criteria, expiresAt: "2099-01-01T00:00:00Z")
        precondition(draft.isValid(for: recording))
        draft.taskId = "task-2"; precondition(!draft.isValid(for: recording))
        draft.taskId = "task-1"; draft.version = 3; precondition(!draft.isValid(for: recording))
        draft.version = 2; draft.expiresAt = "2000-01-01T00:00:00Z"; precondition(!draft.isValid(for: recording))
        let request = try BridgeAPI(base: origin, token: "secret").makeRequest("/api/tasks/task-1/preview-session", method: "POST")
        precondition(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
        print("PASS: v1 criteria/version gating, 24-task filters, frozen criteria retry, 1–8 settings, preview scope and frozen voice drafts")
    }
}
