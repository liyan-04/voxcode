# Mac Agent 控制面合同

更新：2026-10-25。关联 [#93](https://github.com/liyan-04/voxcode/issues/93)、
[#125](https://github.com/liyan-04/voxcode/issues/125)。最新范围同时支持服务器与 Mac Codex，
本文定义其中的 Mac 控制分支及跨端隔离；组件图、用户流程和源码/线上状态见
[手机、Mac 与 Linx 当前架构](phone-mac-linx-current.md)。

## 执行位置与用户行为

手机浏览器只访问服务器 VoxCode，页面选择 `executionTarget`：服务器分支调用服务器
私有 RPC/TaskService/Codex，Mac 分支由 Mac Agent 主动建立经认证、严格验证证书的 WSS，
将固定命令转发到 Mac 私有 Unix RPC/TaskService/Codex。同一次任务提交只能路由到
选定端，不能两端重复执行。Mac 不开放入站控制端口。已有 Codex 桌面聊天、任意终端和窗口自动化不属于
本合同的任务执行能力；原生能力只能按 Agent 实际公布且已验证的 capability 启用。

项目包含任务，任务可以包含子任务。「新建项目」支持登记已有目录或新建目录，
目录范围由该端操作者预先授权；项目行 `+` 创建任务。同任务追问必须续接该端该任务
持久化的 Codex 会话 UUID，并保留此前各轮提示、结果与执行反馈。

**提交文字或语音执行指令即开始执行，不再要求额外的草稿/确认操作。** 目前源码的
`startTask` / `confirmTask` 以及新合入的 `continueTask` 仍是内部两阶段原语，直接提交的
组合接线尚待交付；不能把内部原语重新变成用户级第二次确认。修订号、请求身份、
目标归属、重放防护、沙箱和 Codex 自身权限检查继续保留。语音工具不能代答 Codex
权限批准或用户验收。

登录不得依赖 Mac Agent 启动或可达；登录会话、控制服务可达与所选执行端在线是三个
独立状态。页面、API、请求 ledger、草稿、任务标签、轮次详情和语音回调必须带
`executionTarget`，切换端不能迁移或复用另一端的项目/任务/请求。当前正式运行时
仍固定 Mac adapter，双端选择/路由与隔离尚待接线；旧服务器运行时存在不等于双端已交付。

## 组件与数据责任

| 组件 | 部署位置 | 权威数据 / 职责 |
| --- | --- | --- |
| [`control-runtime.mjs`](../../apps/server/control-runtime.mjs)、HTTP 页面/API | 服务器 | 手机会话、Origin 校验、界面；当前固定账户/Mac，目标执行端选择与路由待接通 |
| [`device-gateway.mjs`](../../apps/server/device-gateway.mjs)、[`device-store.mjs`](../../apps/server/device-store.mjs) | 服务器 | 配对、连接归属、持久操作 ledger、回执与缓存 |
| [`remote-task-adapter.mjs`](../../apps/server/remote-task-adapter.mjs) | 服务器 | Mac 分支把业务 API 转为设备命令，不在此 adapter 执行 Codex |
| [`apps/mac-agent/`](../../apps/mac-agent/README.md) | Mac | Keychain 设备 token、出站 WSS、重连、命令去重与本地转发 |
| [`task-rpc.mjs`](../../apps/server/task-rpc.mjs)、[`project-service.mjs`](../../apps/server/project-service.mjs) | 各执行端 | 本端私有 RPC、登记项目与任务归属、版本和执行槽；跨端状态隔离 |
| [`codex-cli-adapter.mjs`](../../apps/server/codex-cli-adapter.mjs) | 各执行端 | 本端项目 cwd、受控 Codex 启动、会话、任务日志与取消 |
| [`packages/voice/`](../../packages/voice/README.md) 与 voice provider | 服务器上的软件设备 | Linx 音频与设备侧 MCP；正式 provider 尚未接入执行工具 |

手机不持有 Linx、模型或 Agent token。服务器保存设备 token 摘要；Mac Agent 从
Keychain 取 token，模型凭据留在实际执行端的私有任务身份下。私有配置、状态和凭据不得进入源码包、页面或日志。
环境变量过滤不能替代同 UID 文件隔离，任务服务必须使用受控身份与私有状态目录。

## 设备协议与最终校验

当前共享协议位于 [`packages/control-protocol/index.mjs`](../../packages/control-protocol/index.mjs)。
命令信封使用 `protocolVersion/requestId/operationId/deviceId/type/payload/issuedAt/expiresAt`；
任务转发为 `type: "task_rpc"`，`payload: {method, params}`，其中 `params` 为固定 RPC 参数数组。
授权与目标只从已校验的 payload 导出，不另设顶层项目/任务目标。

当前主线 RPC 白名单为：

```text
status, listProjects, getProject, listTasks, getTask,
startTask, confirmTask, cancelTask,
archiveTask, deleteTask, restoreTask,
getLogs, getDiff, getChecks
```

上述白名单对应本文工作区基线 `fe51a88`。`continueTask` 已随 [#114](https://github.com/liyan-04/voxcode/issues/114)
的 [PR #127](https://github.com/liyan-04/voxcode/pull/127) 合入 `f28553f`，尚不代表部署；
项目登记属于 [#115](https://github.com/liyan-04/voxcode/issues/115) 待集成模块。
增加方法必须同步业务服务、私有 RPC、
共享协议、远程 adapter、HTTP 和调用者，不能只放宽 Agent 白名单。

`executionTarget` 是尚待增加的控制层路由/授权合同，不是可随意注入现有 task_rpc
信封的字段。控制层只接受已授权目标 ID，派发前冻结目标并选择对应 adapter；Mac
信封仍绑定其认证设备。操作、任务查询和回执也按同一目标匹配，不能只凭相同 taskId
跨端查询或重放。当前白名单不能据此视为已经支持目标切换。

Agent 先发送 `register`，服务器返回绑定当前连接的 `connected` 后才下发 `command`；
心跳为 `heartbeat/heartbeat_ack`，结果为 `commandResult`。每个设备最多一个活动连接，
消息内身份不能覆盖认证连接身份，旧连接关闭不能清除新连接。命令上限 64 KiB、结果
1 MiB、命令有效期最长 60 秒，时间戳为 UTC 毫秒格式。

网络写操作携带稳定业务 `requestId`；执行校验 `revision`，元数据变更校验
`metadataRevision`。外层传输 request ID 与内层业务 requestId 职责不同，重试不能
重新生成业务身份。Mac TaskService 执行最终项目、任务、版本与权限校验。会话 UUID、
绝对项目路径、Codex 参数和任意 shell 均不是手机或模型可选择的执行授权。

续聊只接受任务已经保存的 UUID，在相同项目 cwd、私有 `CODEX_HOME` 和
`workspace-write` 沙箱中恢复；禁止 `--last`、模型指定 session 和失败后另起会话的
静默回退。每任务最多一个活动轮次；当前服务仍保留一个全局活动执行槽。

## Linx 设备侧 MCP 边界

用户要求的语音链路是 VoxCode 软件设备向 Linx 提供 `tools/list` / `tools/call`，
工具通过已冻结的执行端路由到服务器本地任务服务或同一已配对 Mac，结构化结果返回 Linx 后继续语音。
软件设备不等于 Mac Agent，云端 MCP bridge 也不自动代表当前手机会话。

工具注册与调用必须绑定经手机登录授权的 `executionTarget`、账户、执行设备、项目、任务、语音会话及
`contextVersion`；录音开始冻结目标，执行前再次校验。模型参数不得提升 owner、
目录、执行端、设备、任务或 session 权限。切换页面/执行端、录音中止和迟到回调不得改变已冻结目标；结果归原端。
工具回执需区分已受理、运行中、等待权限、完成、失败和未知结果，并提供可查询的
操作/任务身份；长任务不能把「已受理」当作「已完成」。

当前 SDK 有设备 MCP dispatcher，但正式 [`voice-provider.mjs`](../../apps/server/voice-provider.mjs)
仍传 `tools: []`，`voice-transport.mjs` 仍返回 `writeReady: false`；另一路云端 MCP
只开放七个查询工具。需要实现可信设备会话工具绑定和实际执行往返才能解除语音写入
阻断。ASR、配置就绪、模型产生 tool message 或云 MCP token 都不能替代这项验证。

## 反馈、失败与恢复

- 页面显示实际任务/轮次状态、返回内容、结构化命令/文件事件及更新时间；列表摘要不能
  覆盖选中任务的完整详情。未采集的 diff/checks 保持 `collected: false`。
- 选中端离线时拒绝向该端新派发，保留该端手机输入；Mac 离线不妨碍登录或使用服务器执行端。
  已经运行的 Mac 任务继续。重连后查询并对账，
  服务器缓存必须带来源和观察时间。
- 写入超时显示 `unknown`，先查询/对账原 `operationId`，不重复创建任务或换 requestId
  重发。服务器/Agent 重启也不自动重跑未对账操作。
- 取消是异步操作，不回滚文件；清理或进程归属不确定时保持 quarantine。
- Agent 单写者归属由 [#121](https://github.com/liyan-04/voxcode/issues/121) 的内核锁候选
  改进；持久 guard 文件存在不等于活跃持锁。**禁止删除 guard/ledger 强制启动。**
- 服务停止、版本回滚和任务取消是不同操作。更新任务服务前先核对活动任务及会话格式，
  不能通过删除状态、项目或凭据恢复启动。

每个独立能力完成测试和两份独立评审后通过单独 PR 进入 `master`；线上、手机、
麦克风、语音工具执行和最终用户验收分别记录。本次架构 PR 保持打开，由用户审阅。
