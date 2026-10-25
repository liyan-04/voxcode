# VoxCode Agent 工作协议与验收标准

本文是架构师、开发、评审和集成 agent 的共同工作协议。当前产品边界以 [current.md](current.md) 和 [语音工作区合同](voice-code-workspace-contract.md) 为准；本文只定义任务协商、实现、审查和证据流程。若本文与用户最新明确要求冲突，以用户要求为准。

## 1. 当前验收目标

当前实现是服务器任务工作区：`apps/server/task-cli.mjs` 通过受保护 Unix socket 运行 Codex CLI；HTTP、MCP 和浏览器语音模块分别组合，并在真实服务、浏览器和部署环境中单独验收。页面和语音入口必须共享项目授权、任务版本、requestId、证据和结果状态。配置存在、fixture 通过或本地串联都不能证明真实 Codex、灵矽或手机闭环。

当前最小验收顺序如下：

| Gate | 目标 | 证据 |
| --- | --- | --- |
| G0 合同 | HTTP/MCP/语音入口的请求、响应、状态、错误、版本和身份语义一致 | `local` |
| G1 代码 | 关键鉴权、项目隔离、重放、取消、审批和版本行为可重复 | `local`、`fixture` |
| G2 服务组合 | 服务器 task runtime、HTTP/MCP 和语音模块按当前合同组合 | `local`、`fixture` |
| G3 真实服务 | 指定版本的真实 Codex、provider 和结果证据成功运行 | `server-live` |
| G4 手机浏览器 | 手机浏览器通过已授权部署访问服务器并完成任务、结果和验收路径 | `phone-live` |

代码合并最多证明 G0–G2。G3/G4 必须保留真实环境、版本、输入、结果和未通过项；不得用模拟输出替代。

## 2. 角色与权限

| 角色 | 负责内容 | 不能做的事 |
| --- | --- | --- |
| 产品负责人（用户） | 需求取舍、外部资源、最终验收和危险操作授权 | 不应被要求在聊天中发送密钥、密码、OTP 或私有证书 |
| Architect | 分解服务器/runtime 任务、维护接口和依赖、检查跨模块一致性、提出验收结论 | 不提交、推送、合并或部署，不擅自扩大实现路径 |
| Coordinator | 修改共享合同/文档、集成 worktree、运行验证、提交和 PR、发布里程碑、执行合并后清理 | 不把单个 agent 报告当成验证证据，不跳过用户授权 |
| Implementer | 在 Issue 分配路径内实现、测试、记录 handoff 和阻塞 | 不 stage/commit/push/switch/reset 或修改他人路径 |
| Independent reviewer | 对需求、代码、证据和风险独立检查，给出 P0–P3 findings | 不审查自己的实现，不以测试通过替代产品验收 |

当前默认路径所有权见 [`docs/agent-collaboration.md`](../agent-collaboration.md)。跨边界修改必须先向 coordinator 提出路径、原因、接口影响和验证方案。

## 3. 任务协商

GitHub Issue 是任务事实来源，Pull Request 是代码和 review 事实来源，仓库 `docs/` 是长期审计记录。每个任务开始前必须写清：

```text
Task ID / goal:
GitHub Issue / parent / dependencies:
Base revision / dependency:
Owner and exclusive writable paths:
Inputs / shared interfaces:
Acceptance criteria / exact checks:
Evidence label required:
Explicit exclusions:
Reviewer roles:
```

Implementer 发现合同、权限、凭据、平台能力或资源不足时，先标记 `Blocked` 并提出最小决策，不得自行扩大范围。交接必须列出 revision、changed paths、行为/合同影响、命令结果、环境、证据类别、未运行项和下一步。

## 4. 实现和 PR 规范

- 一个 PR 只解决一个可审查里程碑或紧密相关行为。标题使用 `type(scope): summary`，填写 `Summary`、`Validation`、`Risks`、`Review` 和里程碑 tag。
- 相关测试必须和行为一起提交。鉴权、项目隔离、重放、取消、审批、任务版本和结果验收的改变要有正向及负向回归。
- 每个实现组件需要两名独立 reviewer；架构师跨组件检查不计入其中。P0/P1 必须修复并定向 rereview；P2/P3 必须记录接受理由和验收影响。
- 每个可验证里程碑在相关检查通过后发布 Draft PR；真实服务、手机或部署 gate 未完成时必须在 PR 和进度记录中保留。
- 不提交密钥、密码、OTP、录音、设备私有标识、CA 私钥、生成依赖和生产数据；日志、fixture 和 handoff 只使用合成样例。

## 5. 验收流程

### Phase A：合同和范围

Architect 检查任务是否对应当前架构和工作区合同，确认输入输出、错误码、身份绑定、项目范围和版本语义。Coordinator 先合并共享合同，再允许消费者实现；任何新增预览、任意项目、全量桌面工作台或新部署单元都要单独立项。

### Phase B：实现验证

Implementer 先写能证明风险行为的失败测试，再实现最小改动。Coordinator 检查 staged diff、秘密扫描、依赖锁定和路径边界，运行组件测试、策略测试、`git diff --check` 及适用的 coverage/build 命令。结果记录 exact command、pass/fail 数量、revision、环境和未运行项。

### Phase C：独立 review

两名 reviewer 分别从正确性/安全和平台/产品行为检查同一 revision。Review report 保存到 `docs/reviews/`，包含 scope、revision、findings、验证、resolution 和 remaining gates。修改后只重跑受影响检查和定向 rereview，不能沿用旧 revision 的通过结论。

### Phase D：跨模块组合

Coordinator 按顺序验证：认证和项目选择 → 单任务草稿 → 显式确认 → 事件/进度 → 结果 diff/check evidence → 同任务 follow-up → cancel/approval → 当前版本 acceptance。跨任务串线、旧版本写入、重放重复执行、断线错误恢复或敏感信息泄露都阻止进入下一阶段。

### Phase E：真实资源和发布验收

按 G3、G4 顺序执行。每项写明真实资源、时间、版本、网络、输入、预期和实际结果。部署前只读检查目标主机、端口和监听进程归属；无关服务或归属不明时停止并通知用户。模拟结果在 UI 和报告中标注 `simulation`，fixture 不能关闭 live gate。

### Phase F：合并与清理

PR 检查、review 和对应 gate 完成后，由用户或授权 coordinator 合并。合并后按 [`cleanup-policy.md`](cleanup-policy.md) 判断是否可删除 topic branch、worktree 和临时产物；PR、merge SHA、review 和进度证据永久保留。

## 6. 最低验收清单

提交“可验收”状态前，handoff 必须回答：

- 任务在哪个 revision、branch 和 worktree 上完成？
- 哪些 exact commands 通过，结果是多少？哪些检查没有运行，为什么？
- 证据属于 `simulation`、`fixture`、`local`、`server-live` 还是 `phone-live`？
- 目标、项目、版本、context 和 requestId 是否冻结并去重？
- 失败、取消、审批等待、断线、恢复、重放和旧版本写入的行为是什么？
- 两名独立 reviewer 的 revision、P0–P3 findings 和 resolutions 是什么？
- 还剩哪些产品验收门槛？谁提供资源？下一步是哪一个可执行动作？

无法回答其中任何一项时，状态应保持 `In Progress`、`Blocked` 或 `Needs review`，不得标记 `Accepted`。
