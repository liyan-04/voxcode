# Server runtime independent delivery review

Reviewer: `/root/delivery_reviewer`. Date: 2026-10-25 (Asia/Shanghai). Issue #71 runtime snapshot is the uncommitted `browser_voice` worktree; this review is independent of implementation and does not constitute human approval. No credentials, Git state, browser, or vm6 were changed.

## Snapshot

The worktree has no commit containing the runtime change; the implementation and tests are untracked. SHA-256 values below identify the exact files reviewed:

- `apps/server/runtime-config.mjs`: `65c56769b206685d884cdd4e62995f8f624dc9cb8193e32cee2af586b9cec6ff`
- `apps/server/runtime.mjs`: `ee8c2381987360f2f9135870eec8a6f39dc50488d23fe2621ff005351fe2525c`
- `apps/server/server-cli.mjs`: `88afb6ddc5739affe68acc380b8606300921ad77d46b27261f3652e055dd581e`
- `apps/server/mcp-server.mjs`: `2eacdfa651d97f237ed2f60307baf1db16949ddb3d9272d73e9ea84638d9f51c`
- `apps/server/mcp-proxy-bridge.mjs`: `1720f83dc350735abff960d2b785a5701bd114a707141565697e42d9d069322d`
- `apps/server/task-rpc.mjs`: `1f6ac111a5befa392dcc15da10fa3773b4d15bef4faf8914f1ad893203027494`
- `apps/server/codex-cli-adapter.mjs`: `aba70b6e1b1c55f4b345172721bdc1c8faa46d49298b111e480cf0318a21f0c3`
- `apps/server/task-cli.mjs`: `2f5834e37d7bdc784b00d37f748881ac520644a69bfae4743966c081f0645ce4`
- `apps/server/test/server-runtime.test.mjs`: `c7b3509245fb5df1c9f0e3b712fb0a5574dd2cdde28375565f3680a61a35810e`

## P1 — Direct MCP dispatcher still permits `codex_start_task` with a denying authorizer

`apps/server/mcp-server.mjs` marks `codex_cancel_task` as `write:true`, but the `codex_start_task` definition is missing the same marker. `createMcpDispatcher()` therefore invokes `adapter.startTask()` without calling `authorizeWrite`, even when the caller supplies `authorizeWrite: () => false`. The runtime wrapper in `runtime.mjs` currently filters the public proxy to read tools and rejects any other `tools/call`; its tests pass. That wrapper does not repair the exported dispatcher contract or protect any future direct HTTP/MCP integration that uses `createMcpDispatcher`.

This is an actual local Node 22 reproduction against the reviewed implementation (no network or credentials):

```json
{"case":"direct dispatcher start with deny authorizer","drafts":1,"authorizationCalls":0,"accepted":true}
```

Treat this as a P1 integration gate for the runtime milestone: mark `codex_start_task` (and keep every future mutating tool) as write and reject it before adapter invocation when authorization is absent or false. Add a regression that supplies a denying authorizer and asserts zero adapter writes for both start and cancel. Keep the runtime read-only wrapper as defense in depth. The actual voice-context correlation and trusted-write policy remain unverified, so no MCP mutation should be enabled in production until this is fixed and independently reviewed.

## Confirmed controls

- Server startup requires a non-root Web identity, a distinct task UID, Node 22, canonical private files, a task-owned 0660 Unix socket, HTTPS-only public origin, certificate SAN/date/key matching, and the fixed `wss://xrobo.qiniu.com/v1/mcpproxy/connect?token=...` endpoint shape. Preflight reports contain redacted details; successful configuration is held in a nonforgeable `WeakMap` report association.
- Web runtime is HTTPS, sets bounded request/headers/keep-alive timeouts, rejects all inbound upgrades with 503, and exposes only the login-session HTTP API. It does not expose an inbound MCP route. Outbound proxy state is visible without exposing endpoint or token values.
- Runtime `tools/list` and `tools/call` expose/allow only read tools (`codex_status`, project/task listing, status/logs/diff/checks); all other calls return `-32003` before the adapter. WSS redirects, non-local `ws:` endpoints, binary/invalid JSON-RPC, duplicate-id fingerprint mismatches, payloads, in-flight work and retry/cache sizes are bounded.
- Unix task RPC uses an owner-checked private parent, regular JSON-line framing, request/response limits, deadlines, bounded connections, safe error codes, and removes only the inode it originally bound. Codex credentials are filtered from the child environment; task shutdown reports cleanup uncertainty rather than claiming success.
- Codex process groups receive TERM/KILL on cancellation/timeout and persistence failures quarantine the task. The implementation records lifecycle events by type and bounded agent output; stderr is reduced to a generic diagnostic marker. No raw provider prompt is logged by the runtime path.
- TLS, real Unix RPC, outbound WebSocket fixture, listener ownership, redacted startup errors, and read-only MCP behavior are covered by the actual Node 22 test suite.

## Verification and disposition

`/Users/liyan2026mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/node --test apps/server/test/server-runtime.test.mjs`: **10/10 passed** on macOS/Node 22.22.2. `git diff --check`: no tracked diff was present; reviewed files are untracked in this snapshot. Tests are local/fixture evidence only: they do not prove Linux cgroup cleanup, real Codex CLI execution, live Linx connectivity, voice-context correlation, or vm6 deployment.

Resolve the P1 dispatcher authorization gap, add the denying-authorizer regressions, and obtain an independent follow-up review before exposing any MCP write operation. The server runtime may be considered read-only fixture-ready after that fix; live/device/deployment acceptance remains pending.

## Follow-up — 2026-10-25

The P1 is resolved in the integrated snapshot: `codex_start_task` is marked `write:true`, the denial path performs zero adapter writes, the allowed path requires exactly one authorization call, and the proxy fixture explicitly authorizes its draft retry. The integrated MCP/bridge/runtime suites pass **32/32** under Node 22.23.4; `git diff --check` passes. Independent follow-up reported no new P1/P2. Trusted voice Context correlation and live Linx/Codex/device/vm6 acceptance remain pending.
