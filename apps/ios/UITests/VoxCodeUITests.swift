import XCTest

final class VoxCodeUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-demo"]
        app.launch()
    }

    func testDemoScreenshots() throws {
        let simulationSwitch = app.switches["模拟演练"]
        XCTAssertTrue(simulationSwitch.waitForExistence(timeout: 10), "模拟演练开关未出现")
        if !simulationSwitch.isSelected {
            simulationSwitch.tap()
        }

        let finishButton = app.buttons["完成"]
        XCTAssertTrue(finishButton.waitForExistence(timeout: 10), "设置页完成按钮未出现")
        finishButton.tap()

        let homeNavigationBar = app.navigationBars["VoxCode"]
        XCTAssertTrue(homeNavigationBar.waitForExistence(timeout: 10), "任务首页未出现")
        attachScreenshot(named: "01-home")

        let firstTask = app.staticTexts["[模拟] 登录校验 1"]
        XCTAssertTrue(firstTask.waitForExistence(timeout: 10), "模拟任务未出现")
        firstTask.tap()

        let taskNavigationBar = app.navigationBars["[模拟] 登录校验 1"]
        XCTAssertTrue(taskNavigationBar.waitForExistence(timeout: 10), "任务详情页未出现")
        attachScreenshot(named: "02-task-detail")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(homeNavigationBar.waitForExistence(timeout: 10), "返回任务首页失败")
        let newTaskButton = app.buttons["新任务"]
        XCTAssertTrue(newTaskButton.waitForExistence(timeout: 10), "新任务按钮未出现")
        newTaskButton.tap()

        let composeNavigationBar = app.navigationBars["新任务"]
        XCTAssertTrue(composeNavigationBar.waitForExistence(timeout: 10), "新任务页未出现")
        attachScreenshot(named: "03-new-task")
    }

    private func attachScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
