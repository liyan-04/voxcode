# Mac Agent 控制面架构合同

日期：2026-10-25。Issue：#93。状态：设计合同，待分阶段实现；本文不宣称 Mac、本机灵犀、TLS、手机或公网链路已经可用。

用户已明确执行位置：手机通过服务器上的 VoxCode 控制 Mac 上的 Codex；灵犀是通向同一个 Mac Codex 的第二入口。本文取代 PR #94 最初把服务器作为 Codex 执行端的假设。

## 目标和范围

服务器部署 VoxCode 页面、登录、设备网关和灵犀接入；Mac 部署 Agent、现有 TaskService/私有 task RPC 和 Codex CLI。手机浏览器和灵犀经同一网关控制同一 Mac 任务，代码、执行会话、任务版本和执行证据留在 Mac。服务器保存设备和操作回执以及有来源/更新时间的任务缓存，不启动第二份 Codex。

第一版复用 VoxCode 管理的 Mac Codex CLI 任务：查看、创建草稿、确认执行、停止、归档/恢复，以及手机当前任务切换。没有真实适配器的 Codex Desktop 会话接管、暂停/恢复、任意终端进程和窗口自动化不能标记可用。原生聚焦能力按 Agent 实际公布的 capability 启用；不提供任意 Shell、任意路径或任意 AppleScript。

## 组件边界

```text
手机浏览器 ── HTTPS/WSS ──┐
                          ▼
                 VoxCode 控制服务器
                 ├─ 现有 HTTP 页面/API
                 ├─ RemoteTaskAdapter（不执行 Codex）
                 ├─ Device/Command gateway
                 ├─ Linx voice adapter（可选）
                 └─ audit/event store
                          ▲
             主动出站 WSS │
                          │
                  Mac Agent（launchd）
                  ├─ 设备注册/心跳/重连
                  ├─ 固定白名单 task RPC → Mac TaskService → Mac Codex
                  ├─ AXUIElement/AppleScript 适配器
                  └─ Keychain 凭据
```

服务器不能通过入站端口直接控制 Mac。Mac Agent 主动建立受认证的 WSS，并在断线后指数退避重连；服务器以 `lastSeen` 和能力快照显示离线状态。手机只访问服务器，不持有灵犀或 Codex 凭据。

现有模块复用关系：

- `apps/server/project-service.mjs`：在 Mac 上运行，任务和项目的唯一业务服务。
- `apps/server/task-rpc.mjs`：在 Mac 上运行，只监听私有 Unix socket；不改为公网 API。服务器使用远程 adapter，经 Agent 转发相同方法及参数。
- `apps/server/http-server.mjs`：登录会话、项目/任务 REST 和现有页面；新增设备/命令路由时保持 Origin、CSRF、body/timeout 限制。
- `apps/server/mcp-server.mjs`：灵犀意图查询和草稿入口；模型不能直接确认任务、执行 Shell 或跳过授权。
- `apps/server/mcp-proxy-bridge.mjs`：仅借鉴 WSS 边界、重连和去重实现；Mac Agent 使用独立协议和权限。

## 命令合同

所有命令使用版本化 JSON 信封。本地任务转发使用 `type: task_rpc` 和 `payload: {method, params}`，`params` 是现有 Task RPC 的参数数组。固定方法为 `status/listProjects/getProject/listTasks/getTask/startTask/confirmTask/cancelTask/archiveTask/deleteTask/restoreTask/getLogs/getDiff/getChecks`。网络写操作必须带原 TaskService 的 `requestId`，确认执行必须带 `revision`，元数据操作必须带 `metadataRevision`。RPC 禁止顶层 `projectId/taskId/expectedRevision`，授权、展示和执行目标只从经过校验的 payload 导出，避免双重目标。读方法不要求任务或版本。Mac 的 TaskService 执行最终项目、版本及权限校验。原生 `open_project` 仅要求已登记项目，不要求先有任务。

```json
{
  "protocolVersion": 1,
  "requestId": "req-uuid",
  "operationId": "op-uuid",
  "deviceId": "macbook-local",
  "type": "task_rpc",
  "payload": { "method": "confirmTask", "params": ["task-uuid", {"revision":12,"requestId":"confirm-uuid"}] },
  "issuedAt": "2026-10-25T00:00:00.000Z",
  "expiresAt": "2026-10-25T00:00:30.000Z"
}
```

Agent 只接受已配对 WSS 下发的命令，并按 `type` 和 RPC method 白名单校验参数。共享校验位于 `packages/control-protocol/index.mjs`，命令 64 KiB、结果 1 MiB、有效期最长 60 秒。所有改变状态的命令检查 `requestId`、`expiresAt`、`deviceId` 以及原 TaskService 的版本字段。每个设备最多一个活动连接；未知结果先查询对账，不自动重放。客户端重试使用同一个业务 requestId，不能重新生成身份再次执行。

Wire 握手：Agent 发 `{type:"register",protocolVersion:1,deviceId,token,capabilities}`，服务器返回 `{type:"connected",protocolVersion:1,deviceId,connectionId}` 后才接收命令。心跳使用 `heartbeat/heartbeat_ack`。服务器发送 `{type:"command",command:<信封>}`；Agent 返回 `{type:"commandResult",protocolVersion:1,requestId,operationId,deviceId,status,errorCode,snapshot}`。回执绑定已认证连接，不能用消息内身份覆盖连接身份；旧连接关闭不能清除新连接。

时间戳使用 `Date.toISOString()` 的 UTC 毫秒格式（例如 `.000Z`）。响应统一包含：

```json
{
  "protocolVersion": 1,
  "requestId": "req-uuid",
  "operationId": "op-uuid",
  "status": "accepted|succeeded|failed|expired|rejected|unknown",
  "errorCode": null,
  "agentObservedAt": "2026-10-25T00:00:01Z",
  "snapshot": { "status": "running", "taskId": "task-uuid" }
}
```

服务器保存 `serverCached` 与 `agentObserved` 两类状态；页面显示同步时间和状态来源，不把旧缓存伪装成实时状态。取消是异步操作，不代表代码回滚。

## 配对、鉴权和本地安全

MVP 使用一次性配对码/二维码建立设备身份，服务端只保存设备公钥或不可逆 token 摘要；Agent 私钥放入 macOS Keychain，不能写入仓库、任务日志或页面。生产 WSS 使用严格证书校验；开发 fixture 可使用 loopback，但必须显式标记 `fixture`。服务器会话使用现有登录 cookie/Origin 保护，设备命令额外绑定 `userId + deviceId + taskId`。

Mac 本地能力默认拒绝：

- 不执行任意命令行、任意路径、任意脚本字符串。
- `open_project` 只接受服务器下发的已登记项目 ID，Agent 自己解析本地映射。
- `focus_window` 只接受已声明的 bundle ID/窗口标识；Accessibility 权限缺失时返回明确错误。
- 创建、确认、停止、归档等操作必须复用 Mac TaskService 的权限和版本检查；当前未实现的续聊/暂停功能明确不可用。
- 删除、发布、部署、对外发送等高风险动作必须在手机显式确认后才生成命令；灵犀不能代答确认。

## 灵犀语音边界

灵犀只负责 ASR、意图和可选 TTS；意图转换为同一远程任务 API，最终由 Mac Codex 执行。语音会话冻结 `ownerId/deviceId/projectId/taskId/contextVersion`，模型不能改写目标。首批写操作保留草稿和手机确认；MCP 不得代答 Codex 审批或用户验收。云端 MCP token 仅代表入口认证，不证明属于某位手机用户的语音上下文，未完成可信关联前保持写工具禁用。灵犀凭据只放服务器，真实 WSS/ASR/TTS/MCP 需要单独 `live` 证据。

## 失败和恢复

- 手机断线：任务继续运行，重连后通过快照/事件游标同步。
- Mac Agent 断线：禁止派发新命令；Mac 上已运行的 Codex 任务继续，页面显示 `lastSeen`，重新连接后对账。
- 命令发送超时：显示 `unknown`，先查询 `operationId` 再允许重试。
- Agent 重启：重新注册能力和活动任务快照；不重复执行未确认命令。
- Accessibility/应用不存在：返回 `capability_unavailable`，Mac 任务的服务器缓存不被伪造为成功。
- 服务器重启：恢复持久命令 ledger 和设备状态；未对账操作保持未知。

## 分阶段交付和独立 PR

每个阶段都必须有独立测试、独立 review 和独立 PR，验证后即可合并到 `master`；不等待最终全链路完成。

1. **合同与 fixture（本 PR）**：文档冻结设备、命令、配对、Linx 边界；证据 `local`。
2. **服务器 gateway**：设备注册、持久命令 ledger、认证连接 handle；固定 RPC 白名单经 Agent 转发到 Mac，覆盖去重、TTL、版本、断线和重启；证据 `fixture/local`。
3. **Mac Agent MVP**：Node 实现，launchd 启动、Keychain、WSS 重连、`task_rpc` 固定方法转发；本机原生聚焦能力按实际适配情况单独公布和验证；证据 `local`，不声称公网可用。
4. **手机页面控制**：复用现有页面，显示设备连接/同步时间，支持查看任务和切换；页面不直接读 Mac 文件；证据 `fixture/local`。
5. **灵犀适配器**：先固定口令/fixture 意图，再接真实服务器端 WSS、ASR、MCP、TTS；危险命令确认和会话绑定回归；真实资源证据 `live`。
6. **组合启动与部署**：服务器组合 HTTP/WSS/RemoteTaskAdapter/Linx；Mac 组合 TaskService/私有RPC/Agent/Codex。严格 TLS、端口归属、回滚和手机网络验证另开验收 Issue。

## 明确未完成项

当前代码树尚无 `apps/mac-agent`、设备 gateway 的生产启动器或可用的真实灵犀配置。现有服务器 fixture 通过不证明 Mac Accessibility、真实 Codex、真实 Linx、手机设备、TLS、公网或户外网络成功。历史 `.worktrees/mac`、`.worktrees/relay`、`.worktrees/integration` 只能作为设计和测试参考，不能直接视为当前主线实现。
