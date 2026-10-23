import Foundation
import VoxCodeCore

actor SimulationBridge {
    private var tasks: [TaskSnapshot] = []
    private var limit = 4
    private var replay: [String: (String, Data)] = [:]
    init() {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let statuses = ["running", "running", "waiting_approval", "stopping", "queued", "queued", "queued", "queued", "waiting_input", "failed", "interrupted", "completed"]
        tasks = (0..<24).map { index in
            let status = index < statuses.count ? statuses[index] : "completed"
            let id = String(format: "sim%05d-0000-4000-8000-000000000000", index + 1)
            var object: [String: Any] = ["id": id, "title": "[模拟] \(index % 2 == 0 ? "登录校验" : "列表空状态") \(index + 1)", "prompt": "[模拟] 检查输入校验", "status": status, "acceptance": "pending", "version": 1, "createdAt": timestamp, "updatedAt": timestamp, "summary": "[模拟] 受控任务快照，无真实 Codex 执行", "evidence": [["id": "diff-\(index)", "kind": "diff", "label": "[模拟] src/validation.ts", "value": "diff --git a/src/validation.ts b/src/validation.ts\n+export const valid = (value: string) => value.trim().length > 0;", "version": 1], ["id": "test-\(index)", "kind": "test", "label": "[模拟] 输入校验检查", "value": "[模拟] 3 tests passed", "command": "npm test -- validation", "exitCode": 0, "status": "passed", "version": 1]], "criteria": [["id": "manual", "text": "[模拟] 查看代码与检查记录", "required": true, "verification": "manual", "status": "unverified", "evidenceIds": [], "version": 1]]]
            if status == "waiting_approval" { object["approval"] = ["id": "fixture-operation", "version": 1, "command": "npm test", "cwd": "[模拟] 项目目录", "description": "[模拟] 运行项目检查"] }
            return try! JSONDecoder().decode(TaskSnapshot.self, from: JSONSerialization.data(withJSONObject: object))
        }
    }
    func send(_ request: URLRequest) throws -> (Data, URLResponse) {
        let url = request.url!; let path = url.path; let method = request.httpMethod ?? "GET"
        let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data("{}".utf8))) as? [String: Any] ?? [:]
        let canonical = String(data: try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]), encoding: .utf8)!
        let signature = path + canonical
        let requestID = body["requestId"] as? String
        if method == "POST", let requestID, let previous = replay[requestID] {
            guard previous.0 == signature else { return try failure(url, "conflict", "[模拟] 重试内容不一致", 409) }
            return response(url, previous.1)
        }
        let data: Data
        if path == "/api/settings" {
            if method == "POST" { guard let value = body["executionLimit"] as? Int, (1...8).contains(value) else { return try failure(url, "invalid", "[模拟] 执行名额无效", 400) }; limit = value }
            var settings = BridgeSettings(); settings.executionLimit = limit; settings.activeExecutions = TaskFilter.active.apply(tasks).count; settings.queuedTasks = TaskFilter.queued.apply(tasks).count
            data = try JSONEncoder().encode(settings)
        } else if path == "/api/tasks", method == "GET" {
            data = try JSONEncoder().encode(TaskList(tasks: tasks))
        } else if path.hasSuffix("/events") {
            data = Data("{\"events\":[],\"cursor\":0}".utf8)
        } else if path.hasPrefix("/api/voice/") {
            return try failure(url, "simulation_no_voice", "模拟演练未连接灵矽，请使用文字指令", 503)
        } else if path == "/api/tasks", method == "POST" {
            guard tasks.count < 32 else { return try failure(url, "task_limit", "[模拟] 已达到 32 个任务", 429) }
            var task = tasks.last!; task.id = UUID().uuidString; task.title = "[模拟] " + (body["title"] as? String ?? "新任务"); task.prompt = "[模拟] " + (body["prompt"] as? String ?? ""); task.version = 1; task.status = "completed"; task.acceptance = "pending"; task.acceptanceSnapshot = nil; task.approval = nil; task.preview = nil; task.summary = "[模拟] 指令已记录，无真实代码执行"; task.evidence = []; task.criteria = try criteria(body, version: 1); task.createdAt = ISO8601DateFormatter().string(from: Date()); task.updatedAt = task.createdAt; tasks.append(task)
            data = try JSONEncoder().encode(TaskResult(task: task))
        } else {
            let parts = path.split(separator: "/")
            guard parts.count >= 4, let index = tasks.firstIndex(where: { $0.id == parts[2] }), body["version"] as? Int == tasks[index].version else { return try failure(url, "stale", "[模拟] 任务不存在或版本已变化", 409) }
            switch parts[3] {
            case "messages":
                tasks[index].version += 1; tasks[index].status = "completed"; tasks[index].acceptance = "pending"; tasks[index].acceptanceSnapshot = nil; tasks[index].prompt = "[模拟] " + (body["prompt"] as? String ?? ""); tasks[index].summary = "[模拟] 追问已记录，无真实代码执行"
                tasks[index].criteria = try criteria(body, version: tasks[index].version)
            case "criteria":
                guard tasks[index].status == "completed", tasks[index].acceptance != "accepted", parts.count == 5, let c = tasks[index].criteria?.firstIndex(where: { $0.id == parts[4] }), ["pass", "fail"].contains(body["decision"] as? String ?? "") else { return try failure(url, "invalid", "[模拟] 条件不可修改", 400) }
                tasks[index].criteria![c].status = body["decision"] as? String == "pass" ? "passed" : "failed"
            case "accept":
                guard tasks[index].canAccept else { return try failure(url, "criteria", "[模拟] 必选条件尚未通过", 409) }
                tasks[index].acceptance = "accepted"
                tasks[index].acceptanceSnapshot = AcceptanceSnapshot(version: tasks[index].version, acceptedAt: ISO8601DateFormatter().string(from: Date()), criteria: tasks[index].criteria!)
            case "cancel": tasks[index].status = "interrupted"
            case "approvals": tasks[index].status = "running"; tasks[index].approval = nil
            default: return try failure(url, "unknown", "[模拟] 未实现的操作", 404)
            }
            data = try JSONEncoder().encode(TaskResult(task: tasks[index]))
        }
        if method == "POST", let requestID { replay[requestID] = (signature, data) }
        return response(url, data)
    }
    private func criteria(_ body: [String: Any], version: Int) throws -> [Criterion] {
        let inputs = body["criteria"] as? [[String: Any]] ?? [["text": "[模拟] 查看结果", "required": true]]
        return try inputs.enumerated().map { index, item in
            try JSONDecoder().decode(Criterion.self, from: JSONSerialization.data(withJSONObject: ["id": "manual-\(index)", "text": item["text"] ?? "", "required": item["required"] ?? true, "verification": "manual", "status": "unverified", "evidenceIds": [], "version": version]))
        }
    }
    private func response(_ url: URL, _ data: Data, _ status: Int = 200) -> (Data, URLResponse) { (data, HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!) }
    private func failure(_ url: URL, _ code: String, _ message: String, _ status: Int) throws -> (Data, URLResponse) { response(url, try JSONSerialization.data(withJSONObject: ["error": ["code": code, "message": message]]), status) }
    private struct TaskList: Encodable { let tasks: [TaskSnapshot] }
    private struct TaskResult: Encodable { let task: TaskSnapshot }
}
