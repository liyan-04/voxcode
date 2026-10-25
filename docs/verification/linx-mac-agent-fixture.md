# Linx / Mac Agent intent fixture

Date: 2026-10-25. Issue: #97, part of #93. Evidence: macOS / Node.js 26, local fixture only.

## Current target and source audit

The latest user-approved target is:

```text
Phone browser -> server VoxCode -> Mac Agent -> Mac Codex CLI -> Mac project
                       ^
                  Linx voice intent (second input, same frozen target)
```

The base revision inspected was `e25485e` (`origin/master` at worktree creation).
It removed the historical `apps/integration`, `apps/mac`, and `packages/voice`
trees. Local historical worktrees and commits retain voice session, software
device onboarding, and integration code, but those historical implementations
do not establish the new remote Mac gateway or current live configuration.
The base's server CLI executor is a separate implementation from this latest
Mac target. This fixture does not connect either executor to a voice provider.

## Adapter contract

`apps/server/linx-intent-adapter.mjs` receives provider-neutral `{action,args}`.
The authenticated server route supplies a frozen context with exactly
`{ownerId,deviceId,projectId,taskId:null|string,contextVersion}`. The provider
cannot supply identity, a new device/project/version, shell, paths, approvals,
execution, or result acceptance. The route must derive this context from its
authenticated session and capture; passing model-supplied context is invalid
integration. The injected service remains responsible for project/device/task
authorization and safe result projection.

| Provider action | Injected service method / effect |
| --- | --- |
| `list_tasks` | `remoteTaskService.listTasks(context,{})` |
| `get_task_snapshot` | `getTaskSnapshot(context,{taskId})`; task must equal frozen task |
| `get_projects` | `getProjects(context,{})`; service authorizes returned projects |
| `switch_task` | `switchTask(context,{taskId})`; service authorizes selection within frozen device/project |
| `propose_task` | Local draft `{prompt,title?}`; no service mutation |
| `propose_followup` | Local draft `{taskId,deltaPrompt}`; task must equal frozen task |

`deviceGateway` may be injected instead of `remoteTaskService` with the same
method signatures. A task switch does not mutate this capture's context; the
phone route must reconcile/close the capture before establishing a new target.
These are fixture injection contracts; no actual gateway transport is wired here.

Only the authenticated phone route may call `confirm({requestId},context,authorization)`.
It calls the constructor-injected `authorizeConfirmation({context,draft,authorization})`
function and requires literal `true`. Default, denied, thrown, stale, concurrent,
and repeated confirmations fail closed. Confirmation returns a confirmed draft
for the route to review and hand off; it never starts Codex, approves Codex
permissions, or accepts a result. `confirm` is absent from all provider action
definitions, and model `prepare` calls cannot invoke it. Authorization must
validate a real server session; accepting a provider boolean is not sufficient.

Request keys are `(ownerId,requestId)`. Identical replays share the first result
or sanitized error, including pending calls; different payload/device/context
under the same key conflicts. Canonical argument order does not change identity.
The in-memory cache defaults to 128 entries and a 120-second TTL after completion;
limits are configurable up to 1,024 entries / one hour. Full caches reject new
requests. Pending calls and in-flight authorization are not evicted. Responses
are limited to 64 KiB. Provider/authorization errors omit private diagnostics.
TTL expiry and process restart end deduplication; a production gateway must
persist business request identity, and must not automatically replay proposals
or selection calls after expiry or restart. This fixture is not that ledger.

## Minimal provider readiness

`probeLinxReadiness({configured,probe?})` emits only configured, readiness, and
`live:false`. It makes no default network request. An operator may inject a
bounded, read-only provider probe using independently supplied private config;
the function never returns provider payloads or exception text. A positive
readiness result is not ASR, TTS, tool-correlation, or live development evidence.

The actual local probe inspected only presence booleans for `LINX_API_KEY`,
`LINX_API_TOKEN`, `LINX_TOKEN`, `LINX_URL`, `LINX_WS_URL`, `LINX_DEVICE_ID`,
`LINX_CLIENT_ID`, `XROBO_MCP_ENDPOINT`, `VOXCODE_MCP_ENDPOINT_FILE`, and
`VOXCODE_VOICE_CONFIG_FILE`. All were absent. No credential file contents,
tokens, identities, keys, activation codes, recordings, or full URLs were read.

Actual result: **configuration unavailable; no authenticated provider readiness
request attempted; live status unknown**. Wiring a real provider probe requires
an authorized private configuration source and an agreed read-only endpoint;
this fixture does not search private files or infer credentials from historical
acceptance records.

## Validation and remaining gates

```sh
node --test apps/server/test/linx-intent-adapter.test.mjs apps/server/test/mcp-server.test.mjs
# 22 tests passed (12 adapter + 10 existing MCP), 0 failed/skipped
node --check apps/server/linx-intent-adapter.mjs
# exit 0
git diff --check
# exit 0
```

The replacement test initially failed because the earlier adapter lacked the
new readiness export; implementation then passed the complete fixture suite.
Cases cover action allowlisting, service calls, owner/device/project/task/context
mismatch, owner-scoped replay, concurrent requests, bounded TTL retention,
default-denied phone confirmation, duplicate/expired authorization, input copy
isolation, oversized responses, provider failures, and readiness redaction.

Unverified: remote Mac pairing/ownership, production HTTP/WSS route integration,
Linx credentials and real provider handshake/audio/tool-capture correlation,
Mac Codex execution, phone behavior, Linux, TLS, and outdoor connectivity. Local
tests and historical evidence cannot close those gates. Coordinator owns commit,
PR, and integration; the worker changed only the adapter, its test, and this file.
