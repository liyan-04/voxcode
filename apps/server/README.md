# Server task runtime

日常安装、启动、停止、重启和发布统一使用仓库根目录的
`install.sh`、`start.sh`、`stop.sh`、`restart.sh`、`deploy.sh`。
首次准备和现有服务接管见[生命周期部署说明](../../docs/deployment/control-lifecycle.md)。
下文保留模块级前台调试命令。


## Formal Mac control and browser voice

The current phone-to-paired-Mac entry is `control-cli.mjs`, not the historical
server-local task deployment described below. Its optional private `voiceFile`
enables authenticated `/ws/voice` PCM transcription alongside `/agent` on the
same HTTPS listener. Install both pinned dependency sets:

```sh
npm ci --ignore-scripts --prefix apps/server
npm ci --ignore-scripts --prefix packages/voice
```

`voiceFile` references a private canonical JSON file containing exactly
`url`, `token`, `deviceId`, and `clientId`; its URL must be
`wss://xrobo-io.qiniuapi.com/v1/ws/`. Reuse the control configuration's checked
file ownership/mode rules. Do not embed this tuple in source, browser assets,
Mac task configuration or deployment archives. Use a dedicated formal Linx
assistant with no cloud MCP tools: the software-device `tools:[]` registry does
not disable tools configured separately on a cloud assistant.

Health `voiceAvailable:true` and `voiceState:"configured"` mean configured
capability, not successful ASR. `voiceProviderState` reports the last provider
connection state (`idle`, `connecting`, `ready`, `failed` or `disabled`); public
health does not open provider connections or dispatch Mac RPCs. Transcription
never creates or confirms a task; normal phone draft/confirmation is retained.
One fixed configured account owns the voice admission slot across login cookies.

The backend serves only the exact `/voice-client.mjs` and `/voice-worklet.js`
module URLs; the browser UI component supplies their bytes. Protocol, limits,
checks and deployment gates are recorded in
[backend verification](../../docs/verification/browser-voice-backend-2026-10-25.md).

The remaining sections retain the server-local task runtime reference.

`apps/server` 是当前 VoxCode 主线中的服务器运行时。它把已登记的 Git 项目映射到任务服务，由专用非 root 用户通过 Codex CLI 执行任务；`server-cli.mjs` 负责 HTTPS 页面、MCP dispatcher 和出站 WSS bridge 的组合启动，`task-cli.mjs` 负责独立任务账户和 Unix RPC。

## 支持的入口

| 文件 | 用途 | 当前状态 |
| --- | --- | --- |
| `task-cli.mjs start` | 启动项目/任务服务和受保护 Unix socket | 支持 |
| `project-service.mjs` | 项目注册、任务元数据、归档/恢复、软删除 | 被 task runtime 使用 |
| `codex-cli-adapter.mjs` | Codex CLI 草稿、确认、JSONL 事件、取消和证据占位 | 被 task runtime 使用 |
| `task-rpc.mjs` | Unix socket JSON-RPC 白名单 | 被 task runtime 使用 |
| `http-server.mjs` | 登录、项目/任务 HTTP API 和静态页面 handler | 库/fixture |
| `mcp-server.mjs` | 受 token 保护的 MCP dispatcher | 库/fixture |
| `mcp-proxy-bridge.mjs` | 服务器到远端 MCP WSS 的重连与请求去重 | 被 server runtime 使用 |
| `runtime-config.mjs` | HTTPS、账户、TLS、socket 和灵矽 endpoint 预检 | server runtime 使用 |
| `runtime.mjs` / `server-cli.mjs` | HTTPS 管理端、只读 MCP 代理和安全关闭 | 支持；语音写入仍受门禁 |

`task-cli.mjs` 不打开 TCP/HTTP 端口，也不接收浏览器或语音凭据；它只创建一个受保护的 Unix socket。`server-cli.mjs` 读取脱敏预检报告后启动 HTTPS 管理端，MCP 写操作在可信语音上下文关联完成前保持拒绝。

## 配置和启动

需要 Node.js 22+、Git、已认证的 Codex CLI，以及一个专用非 root 运行用户。安装 server 锁定依赖：

```sh
npm ci --ignore-scripts --prefix apps/server
```

创建由运行用户拥有、推荐权限为 `0600` 的项目注册表：

```json
{
  "projects": [
    {
      "id": "demo",
      "name": "Demo project",
      "root": "/srv/authorized/demo",
      "enabled": true
    }
  ]
}
```

每个 `root` 必须是已存在且有 HEAD 的 Git checkout。服务会检查项目根、Codex 可执行文件和配置文件的 canonical path、owner、权限及祖先目录；配置文件不能是 symlink，也不能把状态目录放在项目内。

使用私有环境文件启动：

```dotenv
VOXCODE_PROJECTS_FILE=/srv/voxcode/projects.json
VOXCODE_TASK_DATA=/srv/voxcode/state
VOXCODE_TASK_SOCKET=/srv/voxcode/task.sock
VOXCODE_CODEX_COMMAND=/usr/local/bin/codex
```

```sh
node --env-file=/srv/voxcode/task.env apps/server/task-cli.mjs start
```

`VOXCODE_CODEX_COMMAND` 默认为 `/usr/local/bin/codex`，但仍需通过可信 executable 检查。任务进程使用 `codex exec --json --sandbox workspace-write -`，工作目录固定为登记的项目根；任务不能把路径或 shell 参数传给 RPC。

## RPC 和任务边界

RPC 每个请求是一行 JSON，响应也是一行 JSON。允许的方法是：

```text
status, listProjects, getProject, listTasks, getTask,
startTask, confirmTask, cancelTask,
archiveTask, deleteTask, restoreTask,
getLogs, getDiff, getChecks
```

创建任务只生成草稿；必须携带匹配的 `revision` 和 `requestId` 才能确认执行。`requestId` 用于持久去重，JSON-RPC `id` 不能代替它。停止任务只请求取消，不回滚文件。进程归属或持久化清理无法确认时，任务进入 quarantine，服务不会自动重跑。

当前版本只保证一个全局活动 Codex execution slot。项目注册表支持多个项目，但尚未提供每任务独立 worktree 或多租户文件隔离。`getDiff` 和 `getChecks` 在没有采集证据时返回 `collected: false`，不能解释为检查通过。

## 停止和恢复

只向本次启动且已确认归属的服务发送 `SIGINT`/`SIGTERM`。关闭顺序是：关闭 RPC、取消活动任务、等待子进程组清理、确认状态。清理失败时不要删除 socket、清空状态或复用旧 PID；先核对进程组、cwd、owner 和任务状态，再按项目的恢复流程处理。

## 本地验证

安装依赖后运行当前 server 核心 fixture：

```sh
node --test \
  apps/server/test/codex-cli-adapter.test.mjs \
  apps/server/test/http-server.test.mjs \
  apps/server/test/mcp-proxy-bridge.test.mjs \
  apps/server/test/mcp-server.test.mjs \
  apps/server/test/project-service.test.mjs \
  apps/server/test/task-cli.test.mjs \
  apps/server/test/task-rpc.test.mjs
```

本次刷新实际结果为 74/74（macOS arm64、Node.js 26，fixture/local）。这覆盖任务状态、请求去重、取消、Unix socket 边界、HTTP/MCP 认证和 WSS bridge 行为；不覆盖真实 Codex 模型、灵矽服务、Linux、TLS 证书、手机或公网网络。

服务器部署包使用 `scripts/server/bundle.mjs` 和 `scripts/server/package.mjs` 的显式文件清单，排除 Relay、Integration、Mac、测试、凭据和 node_modules；部署前必须通过 server runtime 与 deployment fixture 回归。
