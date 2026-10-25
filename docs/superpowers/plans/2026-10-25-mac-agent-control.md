# Mac Agent Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incrementally connect server-hosted VoxCode to Mac-local Codex through a paired Mac Agent and a Linx voice intent adapter, using independently verifiable pull requests.

**Architecture:** Run the existing TaskService/private task RPC and Codex on the Mac. The server hosts VoxCode HTTP/WSS, device/operation state and a RemoteTaskAdapter forwarding the fixed task methods through the paired outbound Mac Agent. The phone page and server-side Linx adapter address the same Mac tasks.

**Tech Stack:** Node.js 22+, existing ESM server modules, JSON over WSS, HTTPS session cookies, macOS Keychain/launchd for the Agent, existing Node test runner.

**Spec:** `docs/architecture/mac-agent-control.md`

## Global Constraints

- The Mac TaskService remains the only Codex execution authority; the server forwards fixed methods and the Agent cannot execute arbitrary shell or paths.
- Every mutation carries `requestId`, `operationId`, target identity, revision/TTL checks and an auditable result.
- Credentials remain server-side or in macOS Keychain; no secrets, private keys or recordings enter Git.
- Fixture/local evidence cannot be reported as live Linx, device, TLS, public network or outdoor success.
- Each milestone is an independent PR targeting `master`, with focused tests and two independent reviews for implementation components.

### Task 1: Server device and command gateway

**Files:**
- Create: `apps/server/device-gateway.mjs`
- Create: `apps/server/device-store.mjs`
- Modify: `apps/server/http-server.mjs`
- Test: `apps/server/test/device-gateway.test.mjs`
- Test: `apps/server/test/device-store.test.mjs`

**Interfaces:**
- `createDeviceStore({root, clock, random})` stores paired devices, non-secret token digests, last-seen and capability snapshots.
- `createDeviceGateway({deviceStore, clock, limits})` manages authenticated connection handles, `heartbeat`, `commandResult`, and operation reconciliation. The shared protocol validates `task_rpc` payloads; task versions are checked by the Mac TaskService.
- HTTP routes expose authenticated device list, pairing start/complete, command submission and operation lookup; they never expose the Unix socket or arbitrary paths.

- [ ] Write tests for pairing expiry, duplicate request IDs, conflicting payloads, expired commands, revision conflicts, unknown operation reconciliation and offline state.
- [ ] Implement in-memory/unit-store behavior and inject persistence through the existing task data root.
- [ ] Add bounded WSS framing/authentication hooks without coupling to a public listener.
- [ ] Run the focused Node tests and existing server tests; record `fixture/local` evidence.
- [ ] Commit and open one PR with `Refs #93`; obtain independent security and product/platform reviews before merge.

### Task 2: Mac Agent MVP

**Files:**
- Create: `apps/mac-agent/agent.mjs`
- Create: `apps/mac-agent/local-capabilities.mjs`
- Create: `apps/mac-agent/package.json`
- Create: `apps/mac-agent/test/agent.test.mjs`
- Create: `apps/mac-agent/README.md`

**Interfaces:**
- `createMacAgent({transport, keychain, capabilities, clock})` registers, heartbeats, reconnects with backoff, deduplicates commands, and emits bounded results.
- A local task adapter forwards only `rpcMethods` from `packages/control-protocol/index.mjs` into `createTaskRpcClient({socketPath})`. Unimplemented native focus capabilities return `capability_unavailable`.

- [ ] Write transport-fixture tests for register/heartbeat/reconnect, command TTL, duplicate IDs, unknown result handling and capability denial.
- [ ] Implement a fixture transport first; add macOS Keychain and launchd instructions without checking secrets into the repo.
- [ ] Add a local macOS smoke script that is opt-in and records Accessibility permission/application limitations.
- [ ] Run fixture tests on Node 22+ and local smoke only when explicitly configured; label evidence accurately.
- [ ] Commit and open a separate PR targeting `master`; do not combine with server gateway changes.

### Task 3: Phone task/device controls

**Files:**
- Modify: `apps/server/public/index.html`
- Modify: `apps/server/http-server.mjs`
- Test: `apps/server/test/http-server.test.mjs`

**Interfaces:**
- The page consumes authenticated `/api/devices`, `/api/operations` and existing task APIs.
- UI displays `connected/disconnected/unknown`, `lastSeen`, active device, task target and pending operation result.

- [ ] Add HTTP fixture tests for device list, operation submit and stale revision errors.
- [ ] Add responsive controls for task list/switch and explicit error/unknown states.
- [ ] Preserve existing draft/confirm and task polling behavior until event streaming is proven.
- [ ] Run page/API fixture tests and accessibility smoke; open a standalone PR after Task 1 merges.

### Task 4: Linx intent adapter

**Files:**
- Create: `apps/server/linx-intent-adapter.mjs`
- Modify: `apps/server/mcp-server.mjs`
- Test: `apps/server/test/linx-intent-adapter.test.mjs`
- Create: `docs/verification/linx-mac-agent-fixture.md`

**Interfaces:**
- `createLinxIntentAdapter({taskService, deviceGateway, sessionStore, clock})` maps validated intents to read-only queries, safe commands or explicit confirmation cards.
- Session context includes `ownerId`, `deviceId`, `projectId`, `taskId`, and `contextVersion`; model output cannot replace these fields.

- [ ] Write tests for safe query execution, dangerous-command confirmation, owner mismatch, stale context, replay and provider failure.
- [ ] Implement a provider-neutral intent mapper; keep live credentials outside the repository.
- [ ] Run fixture tests with synthetic provider messages; record live Linx as pending.
- [ ] Open a separate PR after the command contract is merged and reviewed.

### Task 5: Composition and local acceptance

**Files:**
- Create: `apps/server/gateway-cli.mjs`
- Create: `apps/server/remote-task-adapter.mjs` (coordinator-owned HTTP/MCP to gateway adapter)
- Create: `apps/server/test/remote-task-adapter.test.mjs`
- Modify: `apps/server/README.md`
- Modify: `README.md`
- Modify: `docs/progress.md`
- Test: `apps/server/test/gateway-cli.test.mjs`

**Interfaces:**
- The server control entry composes RemoteTaskAdapter, HTTP handler, device gateway and optional Linx adapter under a non-root account. Mac task RPC runs locally and is never exposed as a TCP listener.
- Startup refuses unsafe paths, missing TLS/pairing config and ambiguous listener ownership.

- [ ] Write startup/shutdown, health, duplicate-process and rollback tests using local fixtures.
- [ ] Verify RemoteTaskAdapter forwards the exact fourteen allowed Task RPC methods to the configured paired Mac, preserves business requestId/revision, propagates offline/unknown errors, and returns raw RPC snapshots without executing Codex on the server.
- [ ] Implement composition without changing `task-cli.mjs`'s private Unix-socket boundary.
- [ ] Run the full targeted server suite, `npm run test:policy`, `git diff --check`, and a local phone-browser smoke.
- [ ] Record missing real Mac/Linx/TLS/device gates explicitly and open a separate deployment/acceptance PR or Issue.
