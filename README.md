# VoxCode

VoxCode 当前是一个运行在服务器上的语音 Code Agent。服务器保存项目注册表、任务状态和请求去重记录，通过受保护的 Unix socket 调度 Codex CLI；手机浏览器访问 VoxCode HTTPS 管理端，灵矽通过服务器出站 MCP 代理调用只读工具，写操作仍受可信语音上下文门禁保护。

## 当前实现（2026-10-25）

当前 `master` 已经是 server-only 代码树：

- `apps/server/task-cli.mjs` 是目前唯一可以独立启动的服务入口。
- `project-service.mjs` 管理已配置的 Git 项目、任务元数据、归档/恢复和软删除。
- `codex-cli-adapter.mjs` 在受控项目根目录启动 Codex CLI，保存 JSONL 事件、状态、日志和取消结果。
- `task-rpc.mjs` 在私有 Unix socket 上提供有限的 JSON-RPC 方法，不能执行任意 shell 或任意路径。
- `runtime.mjs`、`server-cli.mjs` 和 `scripts/server/cli.mjs` 提供组合启动、打包、上传、部署、生命周期和回滚入口。
- `public/index.html` 是 HTTP 工作区页面；页面和服务端组合部署、服务器语音接入、TLS/WSS 入口仍未形成可发布闭环。

旧的 `apps/mac`、`apps/relay`、`apps/integration`、`apps/ios` 和 `packages/voice` 已从当前主线移除。相关设计、验收和评审文档保留在 `docs/` 作为历史证据；它们不能当作当前目录、启动命令或已交付功能清单。

当前不应宣称已经具备：真实模型开发验收、灵矽实时语音、手机/蜂窝网络验收、独立任务 worktree、多租户隔离或 vm6 线上部署成功。部署脚本和回滚路径已通过本地 fixture，不能替代 Linux/live/device 验收。

## 本地运行任务服务

需要 Node.js 22+、npm、Git 和已认证的 Codex CLI。服务必须由专用非 root 用户运行。先安装 server 自己的锁定依赖：

```sh
npm ci --ignore-scripts --prefix apps/server
```

准备一个私有的项目注册表，例如 `/srv/voxcode/projects.json`：

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

注册表必须由运行用户拥有；推荐权限为 `0600`，且不能允许组/其他用户写入或执行。项目根必须是已有 HEAD 的 Git checkout。状态目录和 Unix socket 的父目录必须由运行用户拥有并保持私有；不要把状态目录放在项目 checkout 内。

启动本地任务服务：

```sh
node --env-file=/srv/voxcode/task.env apps/server/task-cli.mjs start
```

环境文件至少包含：

```dotenv
VOXCODE_PROJECTS_FILE=/srv/voxcode/projects.json
VOXCODE_TASK_DATA=/srv/voxcode/state
VOXCODE_TASK_SOCKET=/srv/voxcode/task.sock
VOXCODE_CODEX_COMMAND=/usr/local/bin/codex
```

这个入口只监听私有 Unix socket，不打开 HTTP 端口。停止时只向自己启动的进程发送 `SIGINT` 或 `SIGTERM`；服务会先关闭 RPC，再取消仍归它管理的运行任务。若清理无法确认，任务会保持隔离状态，必须先对账再恢复。

## 验证

核心 server fixture 回归：

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

在本次文档刷新中，该命令在 macOS arm64、Node.js 26 上通过 74/74。测试使用本地 fixture，不证明真实 Codex 模型、灵矽账号、TLS、手机设备或公网部署成功。

服务器组合入口为 `node --env-file=<private-env> apps/server/server-cli.mjs preflight|start`；任务服务由 `task-cli.mjs` 以独立账户运行。部署包使用 `scripts/server/cli.mjs` 的显式 server allowlist，不再依赖已删除的 Relay/Integration source builder。

## 目录和文档入口

- `apps/server/`：当前任务服务、HTTP/MCP 库、页面和 server fixture。
- `scripts/acceptance/`：历史 Linx/服务器探针，不能代替正式任务服务。
- `docs/architecture/current.md`：目标架构和未完成边界。
- `docs/contract.md`、`docs/architecture/voice-code-workspace-contract.md`：接口目标；未实现的条目会明确标注。
- `docs/verification/`、`docs/reviews/`：实际命令、环境和评审证据。
- `AGENTS.md`、`CONTRIBUTING.md`：分支、Issue、审阅和验证要求。

服务器部署命令（先完成主机身份、配置和 TLS 预检）：

```sh
node scripts/server/cli.mjs package --revision <commit> --output /private/tmp/voxcode-server.tar.gz
node scripts/server/cli.mjs upload --host 100.100.81.209 --archive /private/tmp/voxcode-server.tar.gz
node scripts/server/cli.mjs deploy --host 100.100.81.209 --archive /private/tmp/voxcode-server.tar.gz
node scripts/server/cli.mjs start --host 100.100.81.209
node scripts/server/cli.mjs restart --host 100.100.81.209
node scripts/server/cli.mjs stop --host 100.100.81.209
node scripts/server/cli.mjs rollback --host 100.100.81.209
```

本次运行时提交的本地证据为：`npm test` 146/146、`npm run test:policy` 62/62、服务器运行时与部署专项 62/62；环境为 macOS arm64、Node.js 26、fixture/local。真实 vm6 写入、Codex 模型、灵矽语音和手机验收仍待执行。

修改运行时入口、环境变量、协议或部署方式时，同时更新本文件和 `apps/server/README.md`，并在 `docs/progress.md` 记录实际命令、结果和未完成关口。
