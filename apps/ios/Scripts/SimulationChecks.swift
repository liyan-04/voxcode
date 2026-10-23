import Foundation
import VoxCodeCore

@main struct SimulationChecks {
    static func main() async throws {
        let fixture = SimulationBridge()
        let api = BridgeAPI(base: URL(string: "https://simulation.invalid")!, token: "simulation", transport: { try await fixture.send($0) })
        let tasks = try await api.json(Tasks.self, "/api/tasks").tasks
        precondition(tasks.count == 24 && tasks.allSatisfy { $0.title.hasPrefix("[模拟]") })
        precondition(Set(tasks.map(\.shortID)).count == 24)
        precondition(tasks.contains { $0.approval != nil })
        let settings = try await api.json(BridgeSettings.self, "/api/settings")
        precondition(settings.executionLimit == 4 && settings.activeExecutions == 4)
        let settingsBody = try JSONEncoder().encode(SettingsMutation(requestId: "settings-fixed", executionLimit: 1))
        let saved = try JSONDecoder().decode(BridgeSettings.self, from: await api.request("/api/settings", method: "POST", body: settingsBody))
        precondition(saved.executionLimit == 1 && saved.activeExecutions == 4)
        let target = tasks.last!
        do { _ = try await api.json(Result.self, "/api/tasks/\(target.id)/accept", method: "POST", mutation: Mutation(version: 1)); fatalError("Unverified result accepted") } catch let error as APIError { precondition(error.code == "criteria") }
        let passed = try await api.json(Result.self, "/api/tasks/\(target.id)/criteria/manual", method: "POST", mutation: Mutation(requestId: "manual-fixed", version: 1, decision: "pass"))
        precondition(passed.task.canAccept)
        let accepted = try await api.json(Result.self, "/api/tasks/\(target.id)/accept", method: "POST", mutation: Mutation(requestId: "accept-fixed", version: 1))
        precondition(accepted.task.acceptance == "accepted" && accepted.task.acceptanceSnapshot?.version == 1)
        let create = Mutation(requestId: "create-fixed", prompt: "fixture", title: "fixture", criteria: [CriterionInput(text: "fixture")])
        let created = try await api.json(Result.self, "/api/tasks", method: "POST", mutation: create)
        let replay = try await api.json(Result.self, "/api/tasks", method: "POST", mutation: create)
        precondition(created.task.id == replay.task.id)
        precondition(created.task.acceptance == "pending" && created.task.acceptanceSnapshot == nil)
        let count = try await api.json(Tasks.self, "/api/tasks").tasks.count
        precondition(count == 25)
        do { _ = try await api.json(Result.self, "/api/tasks", method: "POST", mutation: Mutation(requestId: "create-fixed", prompt: "changed", title: "fixture")); fatalError("Changed replay accepted") } catch let error as APIError { precondition(error.code == "conflict") }
        let followed = try await api.json(Result.self, "/api/tasks/\(target.id)/messages", method: "POST", mutation: Mutation(version: 1, prompt: "[模拟] 修改", criteria: [CriterionInput(text: "新条件")]))
        precondition(followed.task.version == 2 && !followed.task.canAccept)
        precondition(followed.task.evidence.allSatisfy { $0.version != 2 })
        do { _ = try await api.request("/api/voice/sessions", method: "POST"); fatalError("Fixture pretended to provide live voice") } catch let error as APIError { precondition(error.code == "simulation_no_voice") }
        print("PASS: actual simulation transport, 24 distinct IDs, slot settings, explicit manual acceptance, immutable replay, new-version evidence isolation; no live providers")
    }
    private struct Tasks: Decodable { let tasks: [TaskSnapshot] }
    private struct Result: Decodable { let task: TaskSnapshot }
}
