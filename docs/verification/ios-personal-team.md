# 使用普通 Apple ID 安装到 iPhone

跟踪：[Issue #52](https://github.com/liyan-04/voxcode/issues/52)。用户已选择普通 Apple ID / Personal Team 真机安装。本文补充[已有归档脚本](ios-device-delivery.md)之前的首次账号、签名和设备准备，不代表已生成 IPA 或安装成功。

## 首次安装路径

1. 从 Mac App Store 完成 Xcode 安装，启动 Xcode，由用户阅读并处理条款、账号和首次组件安装提示，安装 iOS 平台支持。工程要求 iOS 17+、Xcode 16+。仅安装 Command Line Tools 不具备 iPhoneOS SDK。
2. 在 Xcode Settings → Accounts 中由用户自行添加 Apple ID。不要把密码、验证码、登录令牌或描述文件发到聊天和仓库。
3. 用数据线连接解锁的 iPhone，由用户在手机上处理信任电脑提示。按手机实际提示在 Settings → Privacy & Security 中启用 Developer Mode；可能需要重启并再次确认。
4. 从记录的源码版本，在独立目录复制 `apps/ios` 的 `VoxCode`、`Sources`、`Tests`、`NativeTests`、`Package.swift` 和 `project.yml`。不要复制 `.build`、已有生成工程、用户状态、配置文件、私钥或描述文件。使用固定 XcodeGen 2.44.1 在副本生成工程。
5. 用 Xcode 打开副本中的 `VoxCode.xcodeproj`，选择 `VoxCode` app target → Signing & Capabilities，启用 Automatically manage signing，选择自己的 Personal Team，并将 Bundle Identifier 改为自己的唯一值。仅在副本的 app target 设置团队和 bundle，不要全局覆盖 SwiftPM 和测试 target 的签名。
6. 在 Xcode 顶部选择实际连接的 iPhone，运行 `VoxCode` scheme。Xcode 的正常账号和自动签名流程会在用户账号权限内准备开发证书和描述文件；遇到钥匙串或设备管理提示由用户本机处理。根据 iOS 提示到 VPN & Device Management 中信任开发者。
7. 确认手机能实际安装并启动，再验证麦克风权限、录音中断、任务页面和实际服务器通信。保留准确的源码版本、bundle、工具版本和脱敏结果，不公开 UDID、描述文件、证书身份或账号。

普通 Apple ID 的免费开发签名通常有效 7 天，受 Apple 当时的账号、设备和应用额度限制，需要重新签名安装。这个路径不提供 TestFlight/App Store 分发。首次安装优先使用 Xcode Run，不承诺 Personal Team 能完成独立 IPA 导出。已有脚本只读取现成 identity/profile；它不创建账号或自动签名资源。只有存在有效资源、实际导出并检查通过的开发 IPA 才能作为安装包交付，且只能安装到描述文件允许的设备。

## 本次已验证的准备工作

证据类别：`local`。日期：2026-10-24。源码：master `3828d3285858d7805475c9d0489c2823656b322a`。原有脏工作区未修改，新建 `codex/52-iphone-install` 独立工作区。

- 官方发布：[XcodeGen 2.44.1](https://github.com/yonaskolb/XcodeGen/releases/tag/2.44.1)。从官方 release asset 下载 `xcodegen.zip`，大小 4,297,406 字节，SHA-256 `a2e905fb68446e9bb4008cdfe2e13e3f176d0cbcca828b71770f8e53fca91b73`，与 GitHub release asset 的公开 digest 一致。解压前检查路径穿越、符号链接和总大小；工具仅保留在本地准备目录，没有全局安装。
- 实际执行 `xcodegen --version`：`Version: 2.44.1`。
- 在独立源码副本实际执行 `xcodegen generate --spec project.yml`：exit 0，生成 `VoxCode.xcodeproj`。本地清单记录源码版本、源文件 SHA-256，并明确 `nativeBuilt=false`、`signed=false`、`installedOnDevice=false`、`productionCAIncluded=false`。生成工程不等于编译成功。
- 按 README 分别运行根目录、`packages/voice`、`apps/relay` 的 `npm ci --ignore-scripts` 后执行 `npm test`：205/205 通过，0 失败、0 跳过。仅安装根目录依赖时，首次测试因 voice/relay 缺少 `ws` 失败；补齐锁文件定义的模块依赖后通过，没有因此修改代码。该结果不证明 iOS 编译或真实 Codex/灵矽调用。

## 尚未完成的关口

- 本机仍在下载完整 Xcode；用户报告商店约 10 GB，预计 1.5 小时，时间仅是当时商店估计。未启动原生编译、签名或安装，没有 IPA。
- 商店电脑操作未执行：自动审批返回 HTTP 401 / `model not in allowed model list`。用户已在本机手动恢复安装；没有绕过审批。
- Apple ID 登录、证书和设备描述文件、实际 iPhone 信任及 Developer Mode 仍需用户完成。不要因为用户愿意登录就记作已经登录。
- [Issue #48](https://github.com/liyan-04/voxcode/issues/48) 独立处理 vm6 VPN 入口和信任配置。当前记录版本仍固定处理旧 IP；正确入口的 IP SAN、经审核公开 CA、iOS 配置适配未完成前，不能宣称可以访问新入口。绝不把 loopback fixture CA 放入交付包。
- [PR #35](https://github.com/liyan-04/voxcode/pull/35) 的监控页面仍是 Draft，不在上述 master 工程中；它的真实 XCTest/覆盖率门槛另行验证。
- 实际灵矽 STT/草稿/可听播报、真实 Codex 修改和同会话追问、断网重试与版本验收、蜂窝链路是独立关口。手机安装成功只完成安装部分。

## 服务器运行 Codex 的可行方向

用户补充：本次不限制 AirPlay 协议，并询问服务器安装 Codex 后是否可以手机直连服务器。推荐方向是把项目、依赖、测试和 Codex 执行端放到服务器，手机通过受认证的 TLS 接口访问 VoxCode 服务，灵矽 AI 继续承担语音交互。服务器执行与公司 Mac 执行是两种部署选择；本次准备工作没有据此迁移代码或宣称 Linux 已验证。

[Codex CLI 官方文档](https://developers.openai.com/codex/cli/)提供 macOS/Linux 安装路径；[App Server 官方文档](https://developers.openai.com/codex/app-server/)说明默认 stdio JSONL 及会话、审批、执行事件接口。复用现有本地 stdio 适配器，不把 Codex App Server 无认证地公开到网络。现有 Relay 和 Connector 可先在同一服务器部署，继续保持任务服务回环监听，以较小改动验证服务器执行；减少部署单元可以在验证后单独评审。

服务器模式要求先验证 Linux 上真实任务修改、Git worktree、检查命令、子进程取消、持久会话及权限隔离。项目需要公司内网资源或 macOS/iOS 构建环境时仍需对应执行机器。服务器模式不接管现有 Codex Desktop 聊天；手机 App 的编译和签名仍需 Xcode。无论是否投屏，安装、语音和真实任务验收都保留。
