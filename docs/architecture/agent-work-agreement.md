# VoxCode Agent 工作协议与验收标准

本文是架构师给所有开发、评审和集成 agent 的共同工作协议。它把产品目标、任务协商、实现边界和验收证据放在同一个可引用的文件中。若本文与用户最新明确要求冲突，以用户要求为准；涉及合同、权限或安全边界的变化必须先由 coordinator 记录并更新相关文档。

## 1. 产品验收目标

**2026-10-24变更：** 当前目标由[服务器执行架构](server-execution.md)约束：原生iPhone只连接vm6，服务器连接灵矽并运行自己的Codex；不限制AirPlay协议。本文后续历史“Mac”执行描述均按服务器runtime理解，不要求另开公司Mac。G4仍是实际签名安装；G5改为同一安装构建在关闭Wi-Fi、蜂窝+用户VPN下严格TLS连接`100.100.81.209:9899`，完成服务器真实Codex/灵矽、原会话追问、diff/检查和当前版本人工验收。Mac休眠恢复不再是主路径关口，服务器进程/网络恢复与不重复执行取代它。不能因部署位置变化免除G0–G5或两名独立评审。

VoxCode 的交付目标是一个必须同时成立的远程开发闭环，而不是单独的安装包或单独的公网服务：用户在真实 iPhone 上安装原生 VoxCode App，手机通过可信公网 TLS Relay 连接公司 Mac 上的 Connector/Codex，使用语音创建或继续指定项目中的 Codex 任务，查看真实进度、结果、diff 和检查证据，并完成当前版本的人工验收。灵矽 AI 用于语音会话、转写和面向任务的语音协作；模拟器、fixture 或静态假数据只能验证交互形状，不能替代真实设备或公网闭环。

交付闭环包含两个不可拆开的必需部分：

1. **设备交付（G4）**：签名后的原生 iOS 构建可以安装到指定 iPhone，并通过麦克风、任务切换、结果查看和验收界面完成真实设备操作。
2. **远程控制（G5）**：该已安装 App 在关闭 Wi-Fi、使用蜂窝网络时，可以经公网 Relay 到达公司 Mac 的 Connector，并让 Mac 上的 Codex 执行真实任务、返回进度和结果。

只有 G4 与 G5 都有可复核的现场证据，项目才可标记为“交付完成”。只通过 G4 代表“已安装但未完成远程闭环”；只通过 G5 代表“公网服务可用但手机交付未完成”。

首版验收目标按以下层级执行，后一层必须建立在前一层通过的证据上：

| Gate | 目标 | 必须证明的内容 | 证据标签 |
| --- | --- | --- | --- |
| G0 合同 | 三端接口一致 | 请求/响应、状态、错误、版本、requestId、音频格式与鉴权在 iOS/Mac/Relay/Voice 之间一致 | `local` |
| G1 代码 | 可重复的源代码行为 | 关键正向和负向测试、覆盖率门槛、无 P0/P1 review finding | `local`、`fixture` |
| G2 集成 | 本机闭环 | 客户端经 Relay/Connector 到 Mac Bridge，能完成配对、任务、事件、结果、取消和验收 | `local`、`fixture` |
| G3 真实服务 | 真实 Codex/Linx | 使用当前安装版本的 Codex 和已授权灵矽配置，完成一次语音转写、一次任务执行/跟进和真实结果回传 | `live` |
| G4 设备 | 原生 iPhone | 签名安装、麦克风权限、录音中断/恢复、任务切换和验收界面可用；安装记录包含设备型号、iOS 版本、Bundle ID、构建版本和安装结果 | `device` |
| G5 户外 | 手机到公司 Mac | G4 已安装的 App 使用蜂窝网络，通过公网 Relay 到达公司 Mac；Mac 仅出站连接 Relay；验证 TLS 信任、配对、断线重连、睡眠/网络恢复和至少一次真实任务 | `outdoor` |

代码合并最多只能证明 G0–G2。G4 和 G5 是产品交付门槛，不是互相替代的选项；没有 G3–G5 的实际证据，不得在 PR、演示或交接中写“已交付”“真实可用”或“户外已验收”。

## 2. 角色与权限

| 角色 | 负责内容 | 不能做的事 |
| --- | --- | --- |
| 产品负责人（用户） | 需求取舍、外部资源、最终验收和危险操作授权 | 不应被要求在聊天中发送密钥、密码、OTP 或私有证书 |
| Architect | 分解任务、维护接口和依赖、安排三端开发、检查跨端一致性、提出验收结论 | 不直接修改实现或共享合同，不提交、推送、合并或部署 |
| Coordinator | 修改共享合同/文档、集成 worktree、运行验证、提交和 PR、发布里程碑、执行合并后清理 | 不把单个 agent 报告当成验证证据，不跳过 review 或用户授权 |
| Implementer | 在独立 worktree 的分配路径内实现、测试、记录 handoff 和阻塞 | 不 stage/commit/push/switch/reset/删除 worktree，不改他人路径 |
| Independent reviewer | 对需求、代码、证据和风险独立检查，给出 P0–P3 findings | 不审查自己的实现，不以“测试通过”替代产品验收 |

当前默认路径所有权见 [`docs/agent-collaboration.md`](../agent-collaboration.md)；跨边界修改必须先向 coordinator 提出路径、原因、接口影响和验证方案，获得重新分配后再编辑。

## 3. 任务协商工具与状态机

### 3.1 工具约定

GitHub Issue 是任务事实来源，Pull Request 是代码和 review 事实来源，GitHub Projects 是实时看板，仓库 `docs/` 是长期审计记录。每个任务使用一个 Issue，代码变更使用一个或多个有明确依赖关系的 PR；不要只在聊天里宣布状态。

Project 字段建议固定为：`Status`、`Component`、`Owner`、`Base`、`Dependency`、`Acceptance gate`、`Evidence`、`Risk`、`Target date`。建议状态为：`Proposed → Ready → In Progress → Blocked → Ready for Review → Verified → Accepted → Merged → Cleaned`。`Blocked` 必须写出阻塞者、所需资源、下一次检查时间和临时方案；不能用它隐藏“还没开始”。

当前 CLI token 若没有 `read:project`/`project` 权限，使用 Issue/PR labels 作为降级看板：`status:proposed`、`status:ready`、`status:in-progress`、`status:blocked`、`status:review`、`status:verified`、`status:accepted`、`component:ios`、`component:mac`、`component:relay`、`component:voice`。状态同时写入 `docs/progress.md`，恢复 Project 权限后再同步，不删除历史记录。

### 3.2 Agent 开始任务前

Architect 或 coordinator 必须在 Issue/任务记录中写清：

```text
Task ID / goal:
Base revision / dependency:
Owner and exclusive writable paths:
Inputs / shared interfaces:
Acceptance criteria / exact checks:
Evidence label required:
Explicit exclusions:
Reviewer roles:
```

Implementer 回复确认自己理解的路径和验收条件；发现合同、权限、凭据、平台能力或资源不足时，先标记 `Blocked` 并提出最小决策，不得自行扩大范围。

### 3.3 Agent 完成交接格式

```text
Task / status: implemented | blocked | needs review
Base / reviewed revision:
Changed paths:
Behavior and contract effects:
Commands / exact results / environment:
Evidence label:
Known gaps and unavailable checks:
Integration steps / dependencies:
Suggested PR title:
Cleanup eligibility: eligible | retain, with reason
```

“实现完成”只表示代码工作结束；`Verified` 需要 coordinator 重跑命令并核对 diff；`Accepted` 需要满足任务指定的产品验收条件；二者都不能由 implementer 自己宣告。

## 4. 实现和 PR 规范

- 每个独立行为使用 `codex/<purpose>` topic branch 和独立 worktree。禁止在 `main`、`master` 或 `codex/mvp` 直接 commit/push；必须通过 PR 合并。
- 一个 PR 只解决一个可审查里程碑或紧密相关行为。PR 标题使用 `type(scope): summary`，并填写 `Summary`、`Validation`、`Risks`、`Review` 四节。
- 相关测试必须和行为一起提交。鉴权、隔离、重放、取消、审批、录音所有权和版本验收的改变都要有正向及负向回归。
- 每个实现组件需要两名独立 reviewer；架构师跨组件检查不计入其中。P0/P1 必须修复并定向 rereview；P2/P3 只能明确记录接受理由和对验收的影响。
- 每个可验证里程碑在相关检查通过后发布 Draft PR；未完成的真实设备、live 或 outdoor gate 必须在 PR 和进度记录中显式保留。
- 不提交密钥、密码、OTP、录音、设备私有标识、CA 私钥、生成依赖和生产数据；日志、fixture 和 handoff 只能使用合成样例。

## 5. 验收流程

### Phase A：合同和范围

Architect 检查任务是否对应当前 phone-demo scope，确认输入输出、错误码、身份绑定和版本语义；coordinator 先合并共享合同，再允许消费者实现。任何“顺手增加预览、任意项目、AirPlay、全量桌面工作台”的请求必须单独立项，不能隐式加入当前闭环。

### Phase B：实现验证

Implementer 先写能证明风险行为的失败测试，再实现最小改动。Coordinator 检查 staged diff、秘密扫描、依赖锁定和路径边界，运行组件测试、策略测试、`git diff --check` 与适用的 coverage/build 命令。结果记录 exact command、pass/fail 数量、revision、环境和未运行项。

### Phase C：独立 review

两名 reviewer 分别从正确性/安全和平台/产品行为检查同一 revision。Review report 保存到 `docs/reviews/`，必须包含 scope、revision、findings、验证、resolution 和 remaining gates。修改后只重跑受影响的检查和定向 rereview；不能沿用旧 revision 的“通过”。

### Phase D：跨端集成

Coordinator 在 integration worktree 合并依赖 PR，按顺序验证：配对和鉴权 → 单任务创建 → 事件/进度 → 真实 diff/check evidence → 同任务 follow-up → cancel/approval → 当前版本 acceptance → 两个以上任务切换。任何跨任务串线、旧版本写入、重放重复执行、断线后错误恢复或敏感信息泄露都阻止进入下一阶段。

### Phase E：真实资源和发布验收

按 G3、G4、G5 顺序执行。每一项必须写明真实资源、时间、设备/系统版本、网络、输入、预期和实际结果。公网部署前先只读检查目标主机、端口及监听进程归属；无关服务或归属不明时停止并通知用户，已确认属于获授权 VoxCode 部署的现有服务按更新和回滚流程处理。发布包、TLS、签名、灵矽配置和 Codex 版本必须通过人工核对；任何模拟结果要在 UI 和报告中标注 `simulation`。

G4 与 G5 必须使用同一份已签名构建和同一套配对配置完成关联记录：G4 记录安装成功后生成的构建标识，G5 记录该构建在蜂窝网络下完成的 Relay、Mac Connector 和 Codex requestId。仅提供模拟器录屏、未签名 `.app`、Relay health 响应或本机回环日志，均不能单独关闭这两个门槛。

### Phase F：合并与清理

PR 检查、两份 review 和对应 gate 通过后，由用户或授权 coordinator 合并。合并后按 [`cleanup-policy.md`](cleanup-policy.md) 判断是否可删除 topic branch/worktree/临时产物；保留 PR、merge SHA、review 和进度证据。未合并、dirty、被依赖或归属不明的资源继续保留。

## 6. 最低验收清单

提交“可验收”状态前，handoff 必须回答：

- 任务在什么 revision、什么 branch、什么 worktree 上完成？
- 哪些 exact commands 通过，结果是多少？哪些检查没有运行，为什么？
- 证据属于 `simulation`、`fixture`、`local`、`live`、`device` 还是 `outdoor`？
- 如果声称交付完成，是否同时提供了同一已签名构建的 G4 安装证据和 G5 公网蜂窝闭环证据？
- iOS/Mac/Relay/Voice 的接口和鉴权是否在同一版本？
- 任务目标、项目、版本和 requestId 是否冻结并去重？
- 失败、取消、审批等待、断线、恢复、重放和旧版本写入的行为是什么？
- 两名独立 reviewer 的 revision、P0–P3 findings 和 resolutions 是什么？
- 还剩哪些产品验收门槛？谁提供资源？下一步是哪一个可执行动作？

无法回答其中任何一项时，状态应保持 `In Progress`、`Blocked` 或 `Needs review`，不得标记 `Accepted`。
