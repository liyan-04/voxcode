# 服务器 CLI 方案协调与下一批边界

定位：VoxCode 是“语音控制 Code Agent + HTTP 管理”。手机只访问服务器上的 VoxCode；服务器 Codex 通过 MCP 注册到灵矽。Mac、Relay、Connector 和手机原生设备 WSS 不属于新主链路。执行接口采用 Codex CLI，不采用 App Server。

## 已检查的集成接口

本记录基于当前 `apps/server` 快照的源代码检查。协调者报告该快照 16 项测试通过；本记录没有独立重跑测试，也不将 fixture 通过视为线上链路通过。

- `codex-cli-adapter.mjs`：`startTask` 创建持久化草稿，`confirmTask` 启动 `codex exec --json --sandbox workspace-write -`；固定服务器项目根目录，单执行槽，进程组取消，超时停止，重启将旧运行任务标为 interrupted。
- HTTP：`POST /api/login`，`GET /api/health`，`GET/POST /api/tasks`，`GET /api/tasks/:id`，`POST /api/tasks/:id/confirm|cancel`；Cookie 会话和 Origin 校验。`/mcp` 可接入独立 MCP handler。
- MCP：POST JSON-RPC 的 initialize、ping、tools/list、tools/call，`X-MCP-Token` 鉴权；只枚举 adapter 实际实现的方法。写工具默认拒绝，等待 `authorizeWrite`。
- 前端：目前仅密码登录及文本创建草稿。没有录音、灵矽 SDK、任务详情/确认按钮或结果刷新。登录失败也会显示“已登录”，需要修正。

这些只是可组合模块，尚无服务器启动入口、TLS 部署配置及完成的语音控制产品。

## 必须纠正的协议与产品语义

1. MCP 的 `codex_start_task` 描述为执行已确认任务，但实际只创建 draft；应改成“提出任务草稿”，并允许灵矽提出草稿。执行仅由已登录手机 HTTP 确认触发。不能把模型携带的布尔参数当人工确认。
2. `codex_status.available` 目前恒为 true，HTTP health 只检查 adapter 对象存在；须区分进程服务在线、CLI 可启动、模型可调用三个状态。
3. diff/checks 明确返回未采集；前端不得展示成已验证证据。continue/retry 未实现，保持不枚举，不提前承诺。
4. Codex 的 `exec` JSONL 与 MCP JSON-RPC 是不同协议。CLI adapter 解析执行事件，MCP 层提供业务工具，两者不可直接字节透传。

## 两条待闭合链路

### 灵矽 MCP → xrobo WS bridge → 服务器 Codex CLI

xrobo `/v1/mcpproxy/mcp` 是平台侧 HTTP 入口；`/v1/mcpproxy/connect?token=…` 是服务器主动出站连接的 WebSocket 接入点。已有观察表明平台通过 WS 主动发送 initialize/tools/list。两者是同一代理两端，不能因为协议不同就认定其中一端错误。

下一批新增独立 `xrobo-bridge.mjs`：使用有效接入点 Token 建立 WSS，响应平台请求，将业务工具派发给同一 adapter。先抽取传输无关的 MCP dispatch，再复用 HTTP 与 WS，避免复制两套工具逻辑。需断线重连、有界消息/并发、超时、重复调用去重和凭据脱敏。不得把 `lx-` API Key 当作接入点 Token；`no server available` 只证明该请求没有路由到在线后端，不能单凭它推断认证成功。

实链路验收：WSS 连接 → initialize 响应 → tools/list 看到工具 → 一次只读状态工具 → 一次草稿工具 → 手机确认 → CLI 真实执行 → MCP 查询同一任务结果。工具写请求不得绕过手机确认执行。

### 手机网页 → VoxCode → 灵矽 SDK

先核对灵矽当前官方 Web/服务端 SDK 的接入和认证契约，再实现浏览器录音、会话开始/停止、识别文本/对话和播报。长效灵矽凭据留在服务器；若官方 SDK 必须浏览器直连，需先记录与“手机只访问服务器”的冲突并选择受支持的服务端中转，不能暗中新增直连。没有官方 Web 契约证据前不照搬旧设备 WSS。

实链路验收：HTTPS 手机页面获得麦克风权限 → 一段真实语音 → 灵矽识别/对话 → MCP 草稿出现 → 手机确认执行 → 查看真实 Codex 结果。停止、权限拒绝、网络断开必须可恢复；没有真实播报前标记播报不可用。

## 下一批协作范围

| 负责人 | 独占开发范围 | 交付与验证 |
|---|---|---|
| MCP 开发 | MCP dispatch 抽取、xrobo WS bridge 及对应测试 | 本地 WS fixture 与真实 initialize/tools/list/只读调用证据 |
| 语音/前端开发 | Web 页面和独立语音模块及测试 | 登录真实状态、任务列表/详情/确认、官方 SDK 契约与真语音记录 |
| CLI 开发 | CLI adapter、store 及对应测试 | CLI 可用性、确认竞态/取消、持久化、真实单任务文件与退出码证据 |
| 协调者 | 共享契约、启动入口、配置模板、部署、文档与 Git | 集成测试、TLS/会话验收、分步提交与审查 |

冻结共用契约后再并行开发：任务字段统一 `id/status/sessionId`；创建返回 `taskId`；语音/MCP 仅建草稿；手机 confirm 是唯一执行入口；重试需 requestId 去重。开发者不得各自改共享路由与任务状态。

部署最小化为一个 Node 服务进程加 TLS 反代，CLI 为该服务拥有的子进程；xrobo bridge 由同一服务生命周期管理。所有服务器代码和秘密配置分离，使用独立项目目录及数据目录；不改已有 Codex daemon，不开放其 socket。先回环测试，再部署空闲端口，记录启动/停止方式。

提交顺序：协议契约与探针证据 → WS 注册只读闭环 → HTTP 草稿/确认与 CLI 真执行 → Web SDK 真语音 → 端到端与故障验证。每步清楚标注 fixture、服务器真实执行、手机真实设备，未通过的链路维持待验证状态。
