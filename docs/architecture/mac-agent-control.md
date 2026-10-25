# Mac Agent 控制面架构合同

日期：2026-10-25。Issue：#93。状态：设计合同，待分阶段实现；本文不宣称 Mac、本机灵犀、TLS、手机或公网链路已经可用。

## 目标和范围

VoxCode 在现有服务器任务工作区之上增加一个可选的 Mac 控制面：手机浏览器通过服务器查看和切换任务；服务器把允许的本地控制命令发送给用户 Mac 上的常驻 Agent；灵犀语音把用户意图转换为同一套命令。现有服务器 `TaskService` 仍是 Codex 任务状态、版本、执行和证据的唯一业务入口，Mac Agent 只负责本地窗口/应用控制、设备状态和受限的本地能力。

第一版任务对象以现有服务器/Codex 任务为主，支持 `list_tasks`、`get_task_snapshot`、`switch_task`、`focus_window`、`open_project`、`send_message`、`pause_task`、`resume_task`、`stop_task`。第一版不接管 Mac 上已有的任意终端进程，不提供远程桌面，不提供任意 Shell、任意路径或任意 AppleScript。

## 组件边界

```text
手机浏览器 ── HTTPS/WSS ──┐
                          ▼
                 VoxCode 控制服务器
                 ├─ 现有 HTTP 页面/API
                 ├─ 现有 TaskService / task RPC
                 ├─ Device/Command gateway
                 ├─ Linx voice adapter（可选）
                 └─ audit/event store
                          ▲
             主动出站 WSS │
                          │
                  Mac Agent（launchd）
                  ├─ 设备注册/心跳/重连
                  ├─ allowlist 本地命令
                  ├─ AXUIElement/AppleScript 适配器
                  └─ Keychain 凭据
```

服务器不能通过入站端口直接控制 Mac。Mac Agent 主动建立受认证的 WSS，并在断线后指数退避重连；服务器以 `lastSeen` 和能力快照显示离线状态。手机只访问服务器，不持有灵犀或 Codex 凭据。

现有模块复用关系：

- `apps/server/project-service.mjs`：任务和项目的唯一业务服务。
- `apps/server/task-rpc.mjs`：服务器内部受保护 RPC；不改为公网 API。
- `apps/server/http-server.mjs`：登录会话、项目/任务 REST 和现有页面；新增设备/命令路由时保持 Origin、CSRF、body/timeout 限制。
- `apps/server/mcp-server.mjs`：灵犀意图查询和草稿入口；模型不能直接确认任务、执行 Shell 或跳过授权。
- `apps/server/mcp-proxy-bridge.mjs`：仅借鉴 WSS 边界、重连和去重实现；Mac Agent 使用独立协议和权限。

## 命令合同

所有命令使用版本化 JSON 信封：

```json
{
  "protocolVersion": 1,
  "requestId": "req-uuid",
  "operationId": "op-uuid",
  "deviceId": "macbook-local",
  "type": "switch_task",
  "taskId": "task-uuid",
  "expectedRevision": 12,
  "payload": { "focus": true },
  "issuedAt": "2026-10-25T00:00:00Z",
  "expiresAt": "2026-10-25T00:00:30Z"
}
```

Agent 只接受服务器签名/配对后下发的命令，并按 `type` 白名单校验参数。所有改变状态的命令必须检查 `requestId` 去重、`expiresAt`、`deviceId`、任务目标和 `expectedRevision`；冲突返回 `revision_conflict`，不能静默覆盖。每个设备最多一个活动控制连接；未知结果重连后先查询对账，不自动重放。

响应统一包含：

```json
{
  "protocolVersion": 1,
  "requestId": "req-uuid",
  "operationId": "op-uuid",
  "status": "accepted|succeeded|failed|expired|rejected|unknown",
  "errorCode": null,
  "agentObservedAt": "2026-10-25T00:00:01Z",
  "snapshot": { "activeTaskId": "task-uuid" }
}
```

服务器保存 `serverCached` 与 `agentObserved` 两类状态；页面显示同步时间和状态来源，不把旧缓存伪装成实时状态。取消是异步操作，不代表代码回滚。

## 配对、鉴权和本地安全

MVP 使用一次性配对码/二维码建立设备身份，服务端只保存设备公钥或不可逆 token 摘要；Agent 私钥放入 macOS Keychain，不能写入仓库、任务日志或页面。生产 WSS 使用严格证书校验；开发 fixture 可使用 loopback，但必须显式标记 `fixture`。服务器会话使用现有登录 cookie/Origin 保护，设备命令额外绑定 `userId + deviceId + taskId`。

Mac 本地能力默认拒绝：

- 不执行任意命令行、任意路径、任意脚本字符串。
- `open_project` 只接受服务器下发的已登记项目 ID，Agent 自己解析本地映射。
- `focus_window` 只接受已声明的 bundle ID/窗口标识；Accessibility 权限缺失时返回明确错误。
- 发送消息、暂停、继续和停止必须复用服务器 TaskService 的权限和版本检查。
- 删除、发布、部署、对外发送等高风险动作必须在手机显式确认后才生成命令；灵犀不能代答确认。

## 灵犀语音边界

灵犀只负责 ASR、意图和可选 TTS；所有意图必须转换为上述标准命令或服务器任务 API。语音会话冻结 `userId/deviceId/projectId/taskId/contextVersion`，模型不能改写目标。查询和切换可以直接执行；危险动作先返回待确认卡片，手机确认后由服务器生成新的幂等命令。灵犀凭据只放服务器环境，真实 WSS/ASR/TTS/MCP 需要单独的 `live` 验证记录；配置文件存在不算接通。

## 失败和恢复

- 手机断线：任务继续运行，重连后通过快照/事件游标同步。
- Mac Agent 断线：禁止新建本地控制命令；普通服务器任务可继续，页面显示 `lastSeen`。
- 命令发送超时：显示 `unknown`，先查询 `operationId` 再允许重试。
- Agent 重启：重新注册能力和活动任务快照；不重复执行未确认命令。
- Accessibility/应用不存在：返回 `capability_unavailable`，服务器任务状态不被伪造为成功。
- 服务器重启：恢复持久命令 ledger 和设备状态；未对账操作保持未知。

## 分阶段交付和独立 PR

每个阶段都必须有独立测试、独立 review 和独立 PR，验证后即可合并到 `master`；不等待最终全链路完成。

1. **合同与 fixture（本 PR）**：文档冻结设备、命令、配对、Linx 边界；证据 `local`。
2. **服务器 gateway**：设备注册、命令 ledger、WSS handler、HTTP 状态/配对 API；使用 fake Agent 和 fake TaskService，覆盖去重、TTL、revision、断线；证据 `fixture/local`。
3. **Mac Agent MVP**：Node/Swift 可选实现，launchd 启动、Keychain、WSS 重连、`list_tasks/switch_task/focus_window/open_project`；本机 Accessibility 权限和真实应用操作单独记录；证据 `local`，不声称公网可用。
4. **手机页面控制**：复用现有页面，显示设备连接/同步时间，支持查看任务和切换；页面不直接读 Mac 文件；证据 `fixture/local`。
5. **灵犀适配器**：先固定口令/fixture 意图，再接真实服务器端 WSS、ASR、MCP、TTS；危险命令确认和会话绑定回归；真实资源证据 `live`。
6. **组合启动与部署**：将 HTTP、WSS gateway、TaskService 和 Linx 适配器组合到受保护的非 root launcher；严格 TLS、端口归属、回滚和手机网络验证另开验收 Issue。

## 明确未完成项

当前代码树尚无 `apps/mac-agent`、设备 gateway 的生产启动器或可用的真实灵犀配置。现有服务器 fixture 通过不证明 Mac Accessibility、真实 Codex、真实 Linx、手机设备、TLS、公网或户外网络成功。历史 `.worktrees/mac`、`.worktrees/relay`、`.worktrees/integration` 只能作为设计和测试参考，不能直接视为当前主线实现。
