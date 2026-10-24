# VoxCode

用 iPhone 上的原生 App，通过公网控制公司 Mac 上的 Codex；由 **灵矽 AI** 提供语音交互。手机负责说需求、确认指令、查看进度、检查代码和测试结果、追问与验收，Mac 执行实际开发任务。

**当前状态（2026-10-24）：核心模块及本地测试已具备，完整产品尚未交付。** Relay/Connector 可以进入测试部署；签名 iPhone 安装、真实灵矽语音、已部署公网到公司 Mac 的完整链路仍需逐项验证。安装包、本地 fixture、模拟器和配置存在均不能代替这些验收。

```text
iPhone 原生 App ── HTTPS ──> 公网 Relay :9899
                                  ↑
公司 Mac 统一运行入口 ─── 出站 WSS ─┘
    ├─ Connector + 回环 Bridge
    ├─ 本机 Codex App Server → 各任务独立工作区
    └─ 灵矽 AI WSS → STT / MCP 草稿与查询 / TTS
```

Mac 主动连接公网，不要求公司网络开放入站端口。预定公网入口为 `https://121.52.250.201:9899`，需要部署严格校验的 TLS；固定 IP 可使用经审核、随 App 分发的私有 CA 公开根证书，无需用户提供域名。手机不保存 Codex、灵矽或机器连接密钥。当前版本控制 VoxCode 创建的 Codex 会话，尚不接管已有 Codex Desktop 聊天。

## 手机可以做什么

- 语音形成可编辑草稿，用户确认后才创建任务或追问；录音开始时固定任务和版本，切页不改变指令归属。
- 管理至少 20 个任务（服务端上限 32），默认 4 个执行名额、可配置 1–8；超额排队、每个任务只有一个活跃轮次，工作区和结果独立。
- 查看排队、运行、等待操作授权、停止中、失败和完成状态，检查真实 diff、文件和命令退出结果；按当前版本逐项确认验收条件。
- 断线后恢复快照，对不确定提交沿用原 requestId 对账；操作授权、执行完成与用户验收分别记录。
- 查询已配对 Mac 的任务/名额/内存和 Relay 请求健康。服务端监控已合并；原生监控页面仍在 [PR #35](https://github.com/liyan-04/voxcode/pull/35) 等待原生构建与覆盖率验证。

首版在 VoxCode App 内演示；生成网站的交互预览、完整 Mac 工作台、后台常驻录音与推送延后。原赛题的 AirPlay 要求仍需向主办方确认，当前收敛范围不代表已获豁免。见[手机演示范围](docs/phone-demo-scope.zh-CN.md)与[产品场景](docs/product/positioning-and-scenarios.md)。

## 当前交付进度

| 部分 | 已有内容 | 尚未通过的关口 |
| --- | --- | --- |
| Mac / Codex | 持久任务、独立工作区、同会话追问、调度、授权/停止、版本结果与验收 | 当前环境真实 Codex 启动受数据库权限限制；需在允许的运行环境重新完成实际修改和追问 |
| Relay / Connector | TLS、认证转发、断线重连、限额、聚合监控、手动安装包 | vm6 与公网 IP 映射、9899 空闲、真实部署及公司网络出站验证 |
| 原生 iPhone | SwiftUI 任务、录音/草稿、结果、配对和 PCM 播放实现 | 完整 Xcode/iOS SDK、签名、正式环境 CA 公开证书、真机安装与麦克风/可听播报；PR #35 仍为 Draft |
| 灵矽 AI | 设备 WSS、PCM/Opus 适配、MCP 状态查询与待确认草稿、本地受控回归 | 用户测试智能体与绑定设备尚未准备；真实握手、STT/MCP/TTS 未验收 |
| 工程验证 | 本地 Node 回归、benchmark、两名独立评审、PR 与证据记录 | 同一安装构建在蜂窝网络完成手机 → Relay → 公司 Mac Codex 全流程 |

已合并的监控服务本地验证为 **173/173**，语音/集成验证为 **26/26**；这是特定版本的 local/fixture 证据，详情见[评审记录](docs/reviews/monitoring-2026-10-24.md)和[灵矽就绪记录](docs/verification/linx-readiness-2026-10-24.md)。不代表云端、真机或户外成功。

灵矽[设备激活辅助工具](packages/voice/README.md#local-software-device-onboarding)支持离线身份初始化、固定官方 HTTPS 激活及私有配置保存，需用户先准备测试智能体与设备入口；本地测试不代表已绑定。其余并行任务：[语音联调 CLI #43](https://github.com/liyan-04/voxcode/issues/43)、[iPhone 构建交付 #44](https://github.com/liyan-04/voxcode/issues/44)。未合并工具的命令不作为 master 可用入口。当前远端操作与后台每分钟巡检创建均被审批服务 `401 model not in allowed model list` 阻塞，动作未执行；本地开发继续。

## 本地启动与检查

需要 Node.js 22+、Git，以及在 Mac 上已安装并登录的 Codex CLI（协议核对版本 0.154.0）。所选授权项目需要已有 HEAD 提交。依赖使用锁文件安装：

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix packages/voice
npm ci --ignore-scripts --prefix apps/relay
npm test

VOXCODE_PROJECT=/absolute/path/to/authorized/git/project npm start
```

统一入口默认监听 `127.0.0.1:8787`，本机显示短期配对码。没有灵矽配置时任务服务仍可启动，语音明确不可用。桥接 HTTP 仅用于回环；iPhone 远程连接需要可信 HTTPS，不能直接把此端口暴露公网。

```sh
# 调度/重放/取消与 API 耗时：受控执行器基准
node scripts/benchmark.mjs --output coverage/benchmark.json

# 实际 Codex 修改 + 同会话追问：独立临时项目，需可用的本机运行权限与账号
node scripts/smoke-real-codex.mjs
```

基准记录依赖类型和测量边界，不衡量真实语音/模型/蜂窝耗时。Swift 测试、原生构建及签名步骤见 [iPhone README](apps/ios/README.md)。本开发机当前只有 Command Line Tools，不能据此生成可安装 iPhone 包。

## 部署与安装入口

```sh
npm run package:relay
shasum -a 256 dist/voxcode-relay-0.1.0.tar.gz
```

按照[安装包说明](apps/relay/packaging/README.md)部署。该包包含 Relay、Connector、锁定依赖、配置模板、启动/状态/停止脚本和可选 systemd 用户模板；**不包含 Mac Bridge/Codex、密钥或 TLS 证书**。Node.js 22+，安装器只写新的 prefix，拒绝覆盖已有安装。

部署主机为授权的个人 vm6。先确认目标与公网映射、检查 9899；**端口被其他服务占用就停止，不修改现有业务**。私有配置与 TLS 材料留在部署侧。更新使用新的版本目录，保留旧配置，只停止本安装目录拥有的进程；验证后切换，失败回退旧目录。完整参数见 [Relay/Connector README](apps/relay/README.md)。

公司 Mac 推荐使用[统一运行入口](apps/integration/README.md)启动 Bridge 和内置 Connector；也可单独安装 Connector 连接回环 Bridge。**同一机器身份只运行一个 Connector**。iPhone 通过 Relay 配对到指定 Mac/项目，使用 Mac 颁发的手机会话凭据。

灵矽接入先按[接入指引](docs/verification/linx-readiness-2026-10-24.md)创建测试智能体、确认设备绑定入口。凭据只放 Mac 私有配置，不发到聊天或仓库。当前云端验证仍待资源准备，`voiceConfigured` 只表示配置存在。

## 协作、文档与验收

架构师维护根目录和各模块 README，以及构建、安装、部署、回滚命令的一致性；产品经理与架构师共同维护场景和验收目标。开发 agent 使用独立 Issue、分支和 worktree，协调者分配路径、验收并合入。

`master` 是唯一默认/集成分支。禁止直接 commit/push master；每个可验证里程碑提交 PR，组件需两名独立评审。GitHub Actions 因账户额度问题已停用，必须记录本地实际检查。合并后只清理已确认合入且无依赖的 topic 分支/干净 worktree，保留未合并工作与证据。

- [提交与 PR 规范](CONTRIBUTING.md) · [Issue 协作](docs/issue-collaboration.md) · [多 agent 规则](docs/agent-collaboration.md) · [清理规则](docs/architecture/cleanup-policy.md)
- [Mac README](apps/mac/README.md) · [Relay README](apps/relay/README.md) · [统一入口 README](apps/integration/README.md) · [语音模块 README](packages/voice/README.md)
- [产品定位与场景](docs/product/positioning-and-scenarios.md) · [产品/架构协作](docs/product/pm-architect-workflow.md) · [架构师职责](docs/architecture/README.md)
- [接口契约](docs/contract.md) · [实施计划](docs/implementation-v1.md) · [需求审计](docs/requirements-audit.md) · [竞品调研](docs/research/competitors-mobile.md)
- [进度与验证](docs/progress.md) · [独立评审](docs/reviews/README.md) · [覆盖率规则](docs/coverage.md) · [历史计划](docs/plan.md)

最终验收使用**同一签名 iPhone 构建**完成真实灵矽语音草稿、用户确认、真实 Codex 修改/续接、diff/检查/验收、任务隔离及断网恢复，并单独留下蜂窝网络经公网访问公司 Mac 的记录。任何一个模块就绪都只关闭它自己的关口。
