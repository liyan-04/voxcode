# Server Codex CLI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Build a server-only VoxCode service where the phone uses HTTPS, 灵矽 connects through Streamable HTTP MCP, and Codex CLI executes controlled tasks on the same server.

**Architecture:** A Node 22 monolith exposes `/api/*` for the phone and `/mcp` for 灵矽. A CodexCliAdapter launches the installed `codex` CLI in an allowlisted project root, persists task state, and exposes only bounded task tools. Mac, Relay, Connector, native iOS, and Linx device WSS remain outside this path.

**Tech Stack:** Node.js 22, built-in `http`, child processes, SQLite or bounded JSON persistence, Streamable HTTP MCP, systemd, reverse-proxy TLS.

**Spec:** User-confirmed server-only architecture in the conversation on 2026-10-24.

## Global Constraints

- Codex execution uses the server-installed `codex` CLI, never the official App Server socket.
- Phone traffic uses HTTPS and never receives Codex or 灵矽 credentials.
- MCP authentication uses `X-MCP-Token` and Streamable HTTP.
- Only configured project roots are executable; arbitrary shell and paths are rejected.
- Write operations require explicit phone confirmation.
- Logs redact tokens, credentials, environment values, and full command arguments.
- Mac, Relay, Connector, native iOS, and device WSS are not dependencies of the server path.

### Task 1: Codex CLI adapter

**Files:**
- Create: `apps/server/codex-cli-adapter.mjs`
- Create: `apps/server/task-store.mjs`
- Test: `apps/server/test/codex-cli-adapter.test.mjs`

**Interfaces:**
- `createCodexCliAdapter({command, projectRoot, dataDir, spawnImpl})`
- `startTask({prompt, title}) -> {taskId}`
- `getTask(taskId) -> task snapshot`
- `listTasks() -> task snapshots`
- `cancelTask(taskId) -> task snapshot`

- [ ] Write tests for allowlisted root, task creation, bounded output, cancellation, and restart persistence.
- [ ] Run `node --test apps/server/test/codex-cli-adapter.test.mjs` and confirm initial failures.
- [ ] Implement the adapter with `spawn`, task IDs, status transitions, timeout, SIGTERM/SIGKILL escalation, and JSON persistence.
- [ ] Run the focused test and confirm pass.
- [ ] Commit as `feat(server): add codex cli task adapter`.

### Task 2: Streamable HTTP MCP server

**Files:**
- Create: `apps/server/mcp-server.mjs`
- Test: `apps/server/test/mcp-server.test.mjs`

**Interfaces:**
- `createMcpServer({adapter, token, serverInfo})`
- MCP tools: `codex_status`, `codex_list_tasks`, `codex_start_task`, `codex_continue_task`, `codex_task_status`, `codex_task_logs`, `codex_task_diff`, `codex_task_checks`, `codex_cancel_task`, `codex_retry_task`.

- [ ] Write tests for `X-MCP-Token`, initialize, tools/list, malformed JSON, unknown tool, and confirmation gating.
- [ ] Implement JSON-RPC over Streamable HTTP with bounded request/response sizes and per-request IDs.
- [ ] Map tools to adapter methods; reject write tools without a confirmed phone session.
- [ ] Run focused MCP tests and confirm pass.
- [ ] Commit as `feat(server): expose codex cli through streamable mcp`.

### Task 3: Phone HTTPS API and web shell

**Files:**
- Create: `apps/server/http-server.mjs`
- Create: `apps/server/public/index.html`
- Test: `apps/server/test/http-server.test.mjs`

**Interfaces:**
- `createHttpServer({adapter, mcp, sessionSecret, host, port})`
- `GET /api/health`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/confirm`
- `POST /api/tasks/:id/cancel`
- `POST /api/login`

- [ ] Write tests for health, session cookie, task creation, confirmation, cancel, CORS/CSRF rejection, and SPA fallback.
- [ ] Implement HTTPS-ready HTTP server with secure cookie session, JSON limits, and static web shell.
- [ ] Keep the web UI limited to task list, status, prompt, confirmation, and cancel.
- [ ] Run focused HTTP tests and confirm pass.
- [ ] Commit as `feat(server): add phone http api`.

### Task 4: Server runtime and deployment

**Files:**
- Create: `apps/server/cli.mjs`
- Create: `apps/server/.env.example`
- Create: `apps/server/systemd/voxcode-server.service`
- Modify: `package.json`
- Test: `apps/server/test/runtime.test.mjs`

- [ ] Add startup validation for Codex CLI path, project root, MCP token, session secret, and data directory.
- [ ] Add health output that reports Codex CLI availability without secrets.
- [ ] Add systemd unit bound to loopback behind an existing TLS reverse proxy.
- [ ] Run all server tests and a local HTTPS smoke test.
- [ ] Commit as `feat(server): add voxcode server runtime`.

### Task 5: Real server verification

**Files:**
- Create: `scripts/smoke-server-codex-cli.mjs`
- Create: `docs/verification/server-codex-cli-2026-10-24.md`

- [ ] Run the CLI adapter against a disposable server project with a harmless prompt.
- [ ] Run MCP initialize/tools/list with the configured token.
- [ ] Run the phone API health/task flow locally.
- [ ] Deploy only after all local checks pass; verify HTTPS, MCP, task start/status/cancel, and restart persistence on vm6.
- [ ] Record exact commands, outputs, residual risks, and any blockers.
