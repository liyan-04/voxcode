# Native Codex synchronization: read-only milestone

Date: 2026-10-26. Issue: [#144](https://github.com/liyan-04/voxcode/issues/144). This
milestone implements a bounded read-only native adapter. It is intentionally a
stored-history reader until a shared desktop-authoritative backend is proved.

## Delivered contract

`apps/mac-agent/native-codex-stdio.mjs` starts a pinned, disposable stdio App
Server with an explicitly supplied `CODEX_HOME`, validates the executable
SHA-256 and version, forces file credential storage in that isolated home,
disables analytics/code-mode host, sends `initialize` with
`experimentalApi: true`, and allows only native read methods. It never sends
`thread/resume`, `turn/start`,
`turn/steer`, `turn/interrupt`, or project mutations. A timeout, process exit,
frame overflow, or version drift is a typed failure; it does not retry or
switch to another backend.

`apps/server/native-codex-reader.mjs` consumes that transport (or an approved
shared transport) and provides:

- `inventory()` with cursor pagination for `project/list` and `thread/list`,
  including empty and multi-root projects, explicit native `projectId`, all
  documented source kinds, archived threads, and each thread's stored
  `projectId`, `sessionId`, `cwd`, and runtime status;
- `readThread(threadId)` with paginated `thread/read`, `thread/turns/list`, and
  `thread/items/list`, retaining native thread/turn/item IDs and final item
  shapes;
- `observeStatus(threadId)` with a source marker and `live: false` for stored
  history. `live: true` is possible only when the caller explicitly supplies a
  previously verified `shared-backend` authority;
- `reconnect({request, backendId})`, which preserves execution target and
  rejects backend identity changes.

`apps/mac-agent/native-codex-bridge.mjs` freezes `executionTarget: "mac"` and
the backend identity at construction and exposes the same read-only methods.
There are no mutation methods on the returned object, so this adapter cannot
create a competing turn or silently resume a native active thread.

The adapter does not infer project membership from `cwd`, collapse empty
projects, or translate native IDs into VoxCode task IDs. A coordinator-owned
RPC/HTTP/UI integration must preserve the source object and target isolation.

## Evidence and limits

The installed desktop's bundled Codex CLI was the previously recorded
`0.164.0-alpha.11.1` binary with SHA-256
`a04752e4d46a4d89e53e6f61c59c5349a638c8ce172ffbf391fd482b4d902a4e`.
The bounded probe used only the already isolated
`/private/tmp/voxcode-native-capabilities-20261025/codex-home` and workspace;
it did not read the user's default `CODEX_HOME`, send a model turn, resume a
thread, start a daemon, or change desktop state.

Probe result from the exact bundled binary:

```text
projectCount=2, threadCount=0, emptyProjects=1
authority=stored-history, executionTarget=mac
backendId=stdio:a04752e4d46a4d89e53e6f61c59c5349a638c8ce172ffbf391fd482b4d902a4e
```

The two isolated projects are the prior capability fixture (one project has no
roots). This proves the adapter can consume the version-pinned experimental
project protocol and preserve empty projects. It does not prove that the
desktop's active stdio process is the same backend.

The desktop transport gate remains open. The prior read-only process evidence
shows the installed desktop owns a stdio child, no default app-server control
socket was present, and a second App Server can report an existing desktop
thread as `notLoaded` while the desktop reports `active`. A common
`CODEX_HOME` therefore cannot be treated as live synchronization. No internal
daemon environment switch, private pipe, installed-app change, DB edit, or
unauthenticated listener is used here.

OpenAI's official App Server documentation was fetched on 2026-10-26:
[App Server](https://learn.chatgpt.com/docs/app-server). It documents stdio,
experimental Unix/WebSocket transports, `thread/read`, paginated
`thread/turns/list` and `thread/items/list`, runtime status values, and the
`experimentalApi` capability gate. It also labels WebSocket/local listener
transports experimental and unsupported for production workloads. The
installed bundle's project methods and the isolated project experiment remain
version-bounded evidence rather than a public production contract.

## Verification

All commands ran in the Issue #144 worktree on 2026-10-26.

```text
node --test apps/server/test/native-codex-reader.test.mjs
7 passed

node --test apps/mac-agent/test/native-codex-bridge.test.mjs apps/mac-agent/test/native-codex-stdio.test.mjs
6 passed

node --check apps/server/native-codex-reader.mjs
node --check apps/mac-agent/native-codex-stdio.mjs
node --check apps/mac-agent/native-codex-bridge.mjs
passed
```

The tests cover cursor pagination, empty membership, archived/source isolation,
stored versus shared status labeling, native history IDs, target/backend
reconnect isolation, read-only method gating, executable digest/version pinning,
bounded frames, bounded paginated accumulation, child exit, and unknown-result
timeout without mutation retry.

The existing package-wide suites were also attempted. They were blocked in this
fresh worktree because the preinstalled dependency tree does not contain the
declared `ws` package: server reported 262 passed / 7 dependency-import
failures, and Mac Agent reported 13 passed / 7 dependency-import failures.
The failures occur before the affected tests load their modules; no package
dependency was installed as part of this read-only adapter milestone.

## Coordinator integration contract

The coordinator may add a target-scoped native inventory/history RPC that returns
the adapter's `source` object unchanged. It must keep native project IDs,
thread IDs, session IDs, status source, and canonical roots separate from the
existing VoxCode project/task registry. A write/continuation route requires a
separate approved shared-backend experiment and active-turn ownership contract;
this milestone intentionally does not provide one.
