import XCTest
import VoxCodeCore
@testable import VoxCode

@MainActor final class SimulationTests: XCTestCase {
    func testExplicitSimulationLoadsTwentyFourDistinctLabelledTasks() async {
        let session = Session()
        XCTAssertFalse(session.simulation)
        await session.setSimulation(true)
        XCTAssertTrue(session.connected)
        XCTAssertEqual(session.tasks.count, 24)
        XCTAssertEqual(Set(session.tasks.map(\.shortID)).count, 24)
        XCTAssertTrue(session.tasks.allSatisfy { $0.title.hasPrefix("[模拟]") })
        XCTAssertEqual(session.settings.executionLimit, 4)
        let saved = await session.saveSettings(limit: 1)
        XCTAssertTrue(saved)
        XCTAssertEqual(session.settings.executionLimit, 1)
        XCTAssertEqual(session.settings.activeExecutions, 4)
    }
    func testSimulationManualAcceptanceAndFollowupKeepVersionsDistinct() async throws {
        let session = Session(); await session.setSimulation(true)
        let target = try XCTUnwrap(session.tasks.last)
        let prefix = "/api/tasks/\(target.id)"
        let denied = await session.mutate(prefix + "/accept", Mutation(version: 1))
        XCTAssertFalse(denied)
        let confirmed = await session.mutate(prefix + "/criteria/manual", Mutation(version: 1, decision: "pass"))
        XCTAssertTrue(confirmed)
        let accepted = await session.mutate(prefix + "/accept", Mutation(version: 1))
        XCTAssertTrue(accepted)
        let followed = await session.mutate(prefix + "/messages", Mutation(version: 1, prompt: "[模拟] 追问", criteria: [CriterionInput(text: "[模拟] 条件")]))
        XCTAssertTrue(followed)
        let updated = try XCTUnwrap(session.tasks.first { $0.id == target.id })
        XCTAssertEqual(updated.version, 2)
        XCTAssertFalse(updated.canAccept)
        XCTAssertTrue(updated.evidence.allSatisfy { $0.version == 1 })
    }
}
