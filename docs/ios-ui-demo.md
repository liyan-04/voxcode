# iOS 模拟器界面演示

每次 iOS 前端改动都会在 GitHub Actions 的 `macos-15` runner 上执行一套可重复的界面演示。它使用 Apple 官方 iPhone Simulator，不依赖本地 Xcode。

## 流程

1. XcodeGen 根据 `apps/ios/project.yml` 生成 `VoxCode.xcodeproj`。
2. `xcodebuild` 编译未签名的 iOS Simulator App。
3. CI 选择第一个可用的 iPhone Simulator 并等待启动。
4. `VoxCodeUITests` 打开 App，在“连接与设置”中开启“模拟演练”。
5. UI 测试依次打开任务首页、任务详情和新任务页，并将三张截图作为 XCTest 附件保存。
6. `simctl io recordVideo` 覆盖 UI 测试过程录制 MP4。
7. `xcresulttool export attachments` 导出截图，连同视频和最终模拟器截图上传为 `ios-ui-demo` Artifact。

## 查看结果

打开对应 GitHub Actions run，进入 `native-build` job 的 Artifacts，下载 `ios-ui-demo`。截图文件名对应页面：

- `01-home`：任务首页
- `02-task-detail`：任务详情
- `03-new-task`：新任务页

该演示使用受控的 `SimulationBridge`，所有任务、证据和操作均带有“模拟”标记，不代表真实 Codex 或灵矽执行。它验证界面可启动、页面可进入和演示产物可导出；真实设备签名、麦克风、灵矽账号和公网链路仍需单独验收。

## 手动触发

在 GitHub Actions 选择 `Verify VoxCode` → `Run workflow`。`push` 和 `pull_request` 也会自动运行同一套 UI 演示。
