# Server task runtime

`apps/server` 是当前 VoxCode 主线中的服务器任务层。它把已登记的 Git 项目映射到任务服务，由专用非 root 用户通过 Codex CLI 执行任务。当前可直接启动的入口是 `task-cli.mjs`；HTTP 页面、MCP dispatcher 和出站 WSS bridge 是库模块，尚未由一个生产 launcher 组合起来。

## 支持的入口

| 文件 | 用途 | 当前状态 |
| --- | --- | --- |
| `task-cli.mjs start` | 启动项目/任务服务和受保护 Unix socket | 支持 |
| `project-service.mjs` | 项目注册、任务元数据、归档/恢复、软删除 | 被 task runtime 使用 |
| `codex-cli-adapter.mjs` | Codex CLI 草稿、确认、JSONL 事件、取消和证据占位 | 被 task runtime 使用 |
| `task-rpc.mjs` | Unix socket JSON-RPC 白名单 | 被 task runtime 使用 |
| `http-server.mjs` | 登录、项目/任务 HTTP API 和静态页面 handler | 库/fixture |
| `mcp-server.mjs` | 受 token 保护的 MCP dispatcher | 库/fixture |
| `mcp-proxy-bridge.mjs` | 服务器到远端 MCP WSS 的重连与请求去重 | 库/fixture |
| `cli.mjs` | 旧 preflight/Relay runtime 入口 | 遗留；依赖已移除的旧模块，不要启动 |

`task-cli.mjs` 不打开 TCP/HTTP 端口，也不接收浏览器或语音凭据。它只创建一个受保护的 Unix socket。HTTP/MCP/语音产品链路必须先完成组合 launcher、认证边界和真实验收，才能从“库模块”升级为部署入口。

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

根 `npm test`、`scripts/build-server-package.mjs` 及其测试仍引用已经从主线删除的旧目录。它们属于待清理的迁移遗留，不能作为当前 server runtime 的安装或发布步骤。任何部署前 source bundle 都必须先更新 allowlist、锁文件和解包测试，并重新验证。
