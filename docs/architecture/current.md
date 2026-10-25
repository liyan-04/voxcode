# 当前架构入口

更新：2026-10-25。最新产品方向、三张架构/时序图和交付状态统一见
[手机、Mac 与 Linx 当前架构](phone-mac-linx-current.md)。

最新目标是双执行端：**手机浏览器 → 服务器 VoxCode → 所选执行端**。
选择服务器时通过本地私有任务 RPC 执行服务器 Codex；选择 Mac 时经主动出站连接的
已配对 Mac Agent、Mac 私有任务服务执行 Mac Codex。页面按所选端显示并隔离项目/任务。
当前正式控制面仍是单 Mac 路由，双端选择与隔离尚待接线。

## 当前产品约定

- 项目包含任务，任务可以包含子任务。主命令是「新建项目」，支持登记已有
  所选端目录或在授权位置新建目录；项目行的 `+` 创建任务。
- 登录成功不依赖 Mac Agent 启动或可达。登录、控制服务可达和所选执行端在线状态
  分别记录；执行端切换不能让任务、请求、草稿、标签或语音结果串端。
- 提交文字或语音执行指令即开始执行，不增加草稿/确认步骤。请求去重、修订号、
  目标归属、沙箱和 Codex 自身权限检查继续生效。
- 同任务追问使用该任务已保存的 Codex 会话 UUID，保留每轮对话与执行反馈；
  子任务与同任务追问是不同操作。
- 语音交付包含 Linx **设备侧 MCP** 的 `tools/list → tools/call → Mac 实际执行
  → 结构化结果 → 继续语音`，仅 ASR 转文字不构成交付。

以上是最新合同，不能推导为全部已上线。当前源码仍保留 `startTask` / `confirmTask`
两阶段原语，正式语音 provider 仍注册 `tools: []`。直接提交接线、设备 MCP 写工具、
同任务页面续聊和项目登记需按[状态表](phone-mac-linx-current.md#能力与证据快照)逐项验收。

## 实际入口与执行边界

| 位置 | 入口 / 模块 | 职责 |
| --- | --- | --- |
| 服务器 | [`control-cli.mjs`](../../apps/server/control-cli.mjs) | 当前 Mac 控制模式的 HTTPS/WSS 组合入口 |
| 服务器 | [`control-runtime.mjs`](../../apps/server/control-runtime.mjs) | 当前页面/API、设备网关、RemoteTaskAdapter、可选语音；双端路由待接入 |
| Mac | [`apps/mac-agent/cli.mjs`](../../apps/mac-agent/cli.mjs) | 经严格 TLS 验证主动连接网关，转发白名单命令 |
| 服务器 / Mac | [`task-cli.mjs`](../../apps/server/task-cli.mjs) | 启动本端任务服务和私有 Unix RPC；不监听公网端口 |
| 服务器 / Mac | [`project-service.mjs`](../../apps/server/project-service.mjs) / [`codex-cli-adapter.mjs`](../../apps/server/codex-cli-adapter.mjs) | 本端登记项目、持久任务和本地 Codex 执行；双端需隔离状态 |

`apps/server/` 是复用模块的目录名，不代表其中的任务服务必须在服务器上运行。
保留的 `server-cli.mjs`、`runtime.mjs` 和 `scripts/server/` 属于此前独立服务器执行模式，
不能当作当前页面已经具备双端切换的证据。`apps/mac-agent/` 和 `packages/voice/` 均已存在。
原生 iOS、旧 Relay/Integration 与桌面聊天接管不属于当前交付。

## 约束与证据

现有任务服务实例目前保留一个全局活动执行槽，未提供每任务独立 worktree 或多租户文件隔离。
代码、模型凭据、会话与任务状态留在实际执行端；控制面保存设备、操作回执和有来源/时间的缓存。
所有目标、缓存、持久请求与语音绑定须包含 `executionTarget`，不能只按项目/任务 ID 区分。
`getDiff` / `getChecks` 未采集时仍为 `collected: false`，不能把模型文字解释为检查通过。
取消是异步操作，不回滚项目文件；执行结束、Codex 权限批准和用户验收分别记录。

2026-10-25 的正式部署探针已验证严格 CA 的 HTTPS/WSS、已配对 Mac 和合成音频 ASR，
并在旧的显式创建/确认流程后验证 Mac Codex 写入与回答。该证据不包含实际 iPhone
麦克风、手机 TTS、设备 MCP 执行往返或新版页面验收。源码与线上版本也并不相同。

协议细节见 [Mac Agent 控制面合同](mac-agent-control.md)，已有启动方法见
[Mac 控制运行记录](../verification/mac-control-runtime.md)。后者是其发布时的证据，
打包、统一生命周期与回滚的当前边界以[新总览](phone-mac-linx-current.md#部署与回滚边界)为准。
