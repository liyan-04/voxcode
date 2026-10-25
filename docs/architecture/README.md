# 架构文档

## 当前入口

2026-10-25 最新方向：手机浏览器 → 服务器 VoxCode → 页面所选执行端。
服务器端调用本地任务 RPC/Codex；Mac 端经主动出站的已配对 Agent 到 Mac RPC/Codex。
项目、任务、请求和语音按 `executionTarget` 隔离。当前正式线上控制面仍单 Mac 路由；
服务器执行端、原生桌面同步和连续双工语音分别由 #134、#144、#153 实施。

- [手机、Mac 与 Linx 当前架构](phone-mac-linx-current.md)：最新产品合同、组件图、
  文字追问与设备 MCP 语音时序、源码/线上状态及部署回滚边界。
- [当前架构入口](current.md)：实际模块入口与当前约束。
- [Mac Agent 控制面合同](mac-agent-control.md)：协议、鉴权、同会话续聊、语音工具及恢复边界。
- [Mac 控制运行记录](../verification/mac-control-runtime.md)：已存在的启动方式和当时验证，
  不是新版项目/续聊/设备 MCP 的完成证明。
- [仓库 README](../../README.md)：启动入口与文档索引。

提交文字/语音执行指令直接执行；项目 → 任务 → 子任务，同任务追问复用持久 UUID。
Linx 交付必须包括设备侧 `tools/list → tools/call → 所选端执行 → 结果 → 继续语音`，
结果归被冻结的原端。登录不依赖 Mac Agent，登录/控制面可达/执行端在线分别记录。
当前 master 为 `1cbe77f`；正式网关应用为 `b8535e65489c1a84d948d1b3ae73ed8948f54f80`，
生命周期控制器为 `8f0f42e6dcd485a3b99d5b0394a096ecd03b745a`。源码已存在、候选已评审、
已合入、已部署和用户验收必须分开记录，详见总览状态表。

## 历史设计与交付证据

仍有参考价值的历史合同、任务状态和交付台账保留在本目录，并明确标注其
证据/目标状态；它们不能覆盖 `phone-mac-linx-current.md` 的当前边界。
旧 server-only、原生 iOS、Relay 双工、phone-monitor、模块 handoff、协调
checkpoint 和分支整合记录已从当前入口移除。`docs/reviews/` 中的日期化评审
仍可引用这些快照，作为审计记录而不是当前实现说明。

## 工程协作

当前角色与权限由 [`AGENTS.md`](../../AGENTS.md)、[Issue 协作](../issue-collaboration.md)
和[开发协作](../agent-collaboration.md)确定。架构工作负责接口、边界、文档一致性与
交付证据，不代替实现的两份独立评审、部署授权或用户验收。协调者分配独占路径，
统一管理 Git、PR、集成与已安装服务；独立工作者仅修改分配范围。

每个能力使用独立 Issue/工作区，在可验证的范围完成测试与评审后单独 PR；不等待
全链路才能发布已完成能力。文档始终写清 `fixture/local/live/device/outdoor` 的证据
环境，保留失败、缺口与历史记录。清理遵循[清理策略](cleanup-policy.md)，不删除
未合入、脏或仍有依赖的工作。
