# 当前架构：VoxCode 服务器任务工作区

更新：2026-10-25。本文描述当前 `master` 中已经存在的代码边界；目标产品合同和历史交付记录分别见 [语音工作区合同](voice-code-workspace-contract.md) 与 `docs/reviews/`。如果历史文档仍引用已经删除的 Mac、Relay、原生 iOS 或 Integration 目录，以本文件和实际代码树为准。

## 已实现的最小链路

```text
私有项目注册表 + 已授权 Git checkout
                │
                ▼
     apps/server/task-cli.mjs
                │ 受保护 Unix socket / JSON-RPC 白名单
                ▼
       project-service + task store
                │
                ▼
 codex-cli-adapter → Codex CLI → 项目根目录
```

`task-cli.mjs` 是当前唯一可直接启动的 server 入口。它要求专用非 root 用户、绝对 canonical 配置路径、私有状态目录、可信 Codex 可执行文件和项目 HEAD；它不会打开 TCP/HTTP 端口，也不会接收浏览器、MCP 或灵矽凭据。

任务创建先生成草稿，确认时校验 `revision` 和 `requestId`。任务状态、JSONL 日志、请求去重和项目元数据写入状态目录。取消只终止受管理的执行，不回滚项目文件；进程归属或清理无法确认时进入 quarantine，不自动重跑。

## 已存在但尚未组合发布的模块

- `http-server.mjs` 提供登录、项目/任务 API 和静态页面 handler，`public/index.html` 是工作区页面。
- `mcp-server.mjs` 提供 token 保护的 MCP dispatcher，工具调用复用项目和任务授权。
- `mcp-proxy-bridge.mjs` 提供远端 WSS 的边界、重连、大小限制和请求去重。

这些模块有 fixture 测试，但当前没有生产 launcher 将它们与 task runtime、TLS、浏览器语音或部署服务组合起来。`apps/server/cli.mjs` 仍是旧 preflight/Relay runtime 入口，导入已移除的模块；在修复前不要使用它。

## 安全和隔离边界

- RPC 只允许固定方法和 JSON 参数；不能执行任意 shell、任意路径或任意 Codex 参数。
- 项目根必须是已登记的 Git checkout；状态目录必须在项目外并由运行用户私有拥有。
- 当前只有一个全局活动 Codex execution slot。多个项目可以登记，但尚未提供每任务独立 worktree 或多租户文件隔离。
- `getDiff` 和 `getChecks` 没有采集证据时返回 `collected: false`；配置存在、CLI `--version` 或 fixture 通过都不等于真实模型执行成功。

## 未完成的产品关口

以下能力仍需独立实现和验收，不能从当前 fixture 推导：

- HTTP 页面与 task runtime 的生产组合、TLS/HTTPS、登录会话部署和健康检查；
- 常驻 MCP/WSS 代理与可信灵矽会话关联；
- 真实 Codex 模型的修改、续接、Diff、检查和手机浏览器闭环；
- 每任务 worktree、并发隔离、多租户授权、部署脚本和回滚；
- Linux、真实 Linx、手机/蜂窝网络、签名设备和公网环境验收。

## 验证证据

当前 server 核心 fixture 可从仓库根目录运行：

```sh
npm ci --ignore-scripts --prefix apps/server
node --test \
  apps/server/test/codex-cli-adapter.test.mjs \
  apps/server/test/http-server.test.mjs \
  apps/server/test/mcp-proxy-bridge.test.mjs \
  apps/server/test/mcp-server.test.mjs \
  apps/server/test/project-service.test.mjs \
  apps/server/test/task-cli.test.mjs \
  apps/server/test/task-rpc.test.mjs
```

2026-10-25 在 macOS arm64、Node.js 26 上通过 74/74。根 `npm test`、source bundle allowlist 和旧 preflight 测试仍含删除目录的迁移遗留，修复这些引用前不把它们当作总回归或发布验证入口。真实 Linux、TLS、Codex、Linx、设备和部署证据继续记录在 `docs/verification/`，且必须标明环境类型。
