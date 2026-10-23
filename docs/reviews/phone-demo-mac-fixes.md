# MAC-004 remediation record

Date: 2026-10-23. Implementer: `/root/mac_v1`. This records remediation and test evidence; it is not an independent review or approval.

## Snapshot and scope

- Worktree: `voxcode/.worktrees/mac`, branch `codex/mac-phone-demo`.
- Base HEAD: `c40e1d684eb0fbbf26dd3696c2c34be545965d63` plus the uncommitted files listed below.
- Source changes: `apps/mac/server.mjs`, `apps/mac/codex.mjs`.
- Test changes: `apps/mac/test/authorization.test.mjs`, `apps/mac/test/body.test.mjs`, `apps/mac/test/codex.test.mjs`, `apps/mac/test/fixtures/app-server.mjs`, `apps/mac/test/fixtures/approval-ownership.mjs`.
- No shared contract, integration, Relay or iOS source changes. No staging, commits, push, deployment or live execution performed by this task.

## Findings and remediation

### P1: authorization could expire while a JSON mutation body was pending

The HTTP handler initially authorized the request, then awaited its body before settings/create/task mutations. A session revoked or expired during the upload could therefore still mutate state.

Each mutation now reads its complete body and synchronously reauthorizes immediately before its synchronous state change. Pair and unpair retain their existing semantics. Fourteen real HTTP regressions pause an upload after initial authorization, revoke/expire the session, confirm a fresh GET is unauthorized, then complete the upload. Settings, create, follow-up, cancel, approval, criterion and acceptance all return 401 without changing their corresponding real service state.

### P1: command approval bypassed thread/turn ownership checks

App Server requests carrying `id` and `method` previously went directly to `onApproval`, bypassing the notification ownership filter. Requests from resume history, foreign threads, old turns or missing identities could be shown as the current task's approval.

Command approval now requires an active dispatch, the explicit owned thread ID and a valid explicit turn ID. Requests arriving between dispatch and its response share the existing bounded message buffer (64 entries / 262144 bytes) and are checked against the actual returned turn ID before exposure. Rejected dispatches discard and decline buffered approvals; buffer overflow fails closed and terminates the owned process group. The decision callback is single-use, accepts only explicit `accept`, and rechecks cancellation, completion and ownership before replying. File-change escalation remains declined because the phone contract cannot represent its scope.

The actual spawned-stdio fixture covers five invalid ownership cases, a valid early approval, a late decision after completion, dispatch rejection and early-buffer overflow. Protocol errors reject outstanding RPCs promptly so overflow does not wait for the dispatch timeout. Owned process teardown remains covered by the existing adapter suite.

### P2: UTF-8 codepoints split across HTTP chunks were corrupted

The shared JSON reader implicitly decoded each chunk independently. A Chinese codepoint split over chunks became replacement characters, changing titles/prompts/criteria and potentially making exact retries conflict. Decoding replacement characters also inflated the measured byte length.

The reader now accumulates bounded raw Buffers, counts the original bytes and decodes once before JSON parsing. Real HTTP regressions deliberately split three-byte Chinese codepoints at both interior byte positions. Create/follow-up content and exact retries are preserved. Exactly 65536 raw bytes succeeds and 65537 bytes fails with 400.

## Verification

Environment: local macOS, Node `v26.0.0`; real local HTTP sockets, real service state and actual spawned Node App Server fixtures. No real Codex model, Linx, iPhone, cellular network or deployment is exercised by these regressions.

Commands run from `apps/mac` unless stated otherwise:

| Phase | Command | Result |
| --- | --- | --- |
| HTTP race RED | `node --test test/authorization.test.mjs` | 0/14; every invalid mutation returned 200 instead of 401 |
| HTTP race GREEN | `node --test test/authorization.test.mjs test/v1-http.test.mjs` | 17/17 |
| Approval RED | `node --test test/codex.test.mjs` | 13/20; five invalid requests exposed approvals, early approval exposed before response, late callback accepted |
| Approval GREEN | `node --test test/codex.test.mjs` | 20/20 before adding dispatch-rejection/overflow boundaries |
| UTF-8 RED | `node --test test/body.test.mjs` | 0/2; corrupted Chinese title and false 400 at raw-byte limit |
| Focused final | `node --test test/body.test.mjs test/codex.test.mjs` | 24/24 |
| Full final | `npm test` | 66/66, 0 failed/skipped |
| Formatting | Prettier `3.6.2 --write` on the seven source/test paths above, using `/private/tmp/voxcode-npm-cache` | exit 0 |
| Whitespace | `git diff --check` from worktree root | exit 0 |

During the first expanded full run, 63/64 passed: the dispatch-rejection fixture exited on SIGTERM before recording the decline already written to its stdin. The fixture now ignores SIGTERM for that scenario, allowing the bounded existing SIGKILL escalation to preserve the wire assertion. The final focused and full commands above both passed after that fixture correction.

These checks establish the reported local regressions. Independent targeted follow-up, coordinator verification and CI remain required; no device/outdoor/live acceptance is inferred.

## SHA-256 content snapshot

```text
5746c879befd65765cf197dae81ae175fba7bfd132e7acc7c3d69a5c368e4158  apps/mac/codex.mjs
5355baba155e700b2ad8bfc1f0e67f590d20c9f288f6d8447968c7a0517cfcd3  apps/mac/server.mjs
0b813482cec6a2d1c35cd7f3f42167199a131077d96d35fb2e89f9196c40be7d  apps/mac/test/authorization.test.mjs
b5075275f0d4ec56e62829892ae3bf56bf991032011e5b830030e60b17e790e5  apps/mac/test/body.test.mjs
b0674bca39961fde94348a67d1efed69705cd7d77796fca294c5c7b997ae3585  apps/mac/test/codex.test.mjs
53b690e66c56cfef0aa936daa46a9e7b04e10c2aaa45fecac51ae1499ab084e2  apps/mac/test/fixtures/app-server.mjs
6aec78bdbf5bc0110d0d7261fd5f97c68dd90cef18fdf9e5a3d6d356845a4c72  apps/mac/test/fixtures/approval-ownership.mjs
```

Suggested commit subject: `fix(mac): recheck mutation authorization and bind command approvals to owned turns`.

## MAC-005: distinguish no-effect business rejection from idempotency conflict

Date: 2026-10-24. Base: `fecd68f12c1dec4254e7379436fc6543143fe081` plus the content snapshot below. Implementer: `/root/mac_v1`. The coordinator owns the shared-contract update and commits; this section is remediation evidence, not independent review.

The architect identified that using `409 conflict` both for request-ID identity collisions and business precondition rejection prevents clients from deciding when editing can safely resume. As explicitly assigned by the coordinator, seven existing synchronous business-precondition failures now return `409 blocked`: follow-up while active/queued; cancellation of a terminal task; acceptance before completion or before required criteria/trusted checks pass; criterion decisions before completion or for a nonmanual criterion; and unavailable/mismatched/expired approval identities. Their checks remain before their respective mutation effects. The four request-ID fingerprint/cross-budget collision sites still return `409 conflict`; replay ordering and approval/authentication execution logic did not change.

Changed paths: `apps/mac/service.mjs`, new `apps/mac/test/blocked.test.mjs`, and existing `apps/mac/test/{service,retention,v1-http}.test.mjs`. Existing approval tests now expect the new business error code; the HTTP acceptance test checks both status and JSON code.

The new focused regression table compares the complete persisted `state.json` bytes before and after each business rejection, including task/evidence/events/replay state, and checks that the rejected request ID is absent from the replay journal. It covers running/queued follow-up, completed/failed/interrupted cancellation, early criterion/acceptance, unverified conditions, sticky trusted check failure, wrong/expired approval IDs, and no extra approval callback. The control case verifies task/settings fingerprint and cross-budget collisions remain `conflict` and the original successful replay remains identical.

Actual commands from `apps/mac`:

| Phase | Command | Result |
| --- | --- | --- |
| RED | `node --test test/blocked.test.mjs` before production edits | 7 failed (`conflict` instead of `blocked`), 1 idempotency control passed |
| Focused GREEN | `node --test test/blocked.test.mjs test/service.test.mjs test/criteria.test.mjs test/v1-http.test.mjs` | 22/22 |
| Final full | `npm test` | 74/74; 0 failed/skipped/cancelled |
| Formatting | Prettier `3.6.2 --write` on service and changed/new tests | exit 0 |
| Whitespace | `git diff --check` from worktree root | exit 0 |

An initial expanded full run had 73/74: an existing retention regression still expected `conflict` for an already-consumed approval with a fresh request ID. Its expected code was updated to `blocked`; successful exact replay and callback-count assertions were preserved. The final full run above includes that correction.

Evidence environment: local macOS, Node `v26.0.0`, controlled executors and real service persistence/loopback HTTP. No live Codex/Linx, native device, deployment or outdoor checks. No Git mutation by the implementer. Source frozen for coordinator/independent follow-up.

```text
d44703fbf7f213794448fd5c5bf395097b11af9a8c677d27a3999c25d01dbfb1  apps/mac/service.mjs
e0b529e9590e9426192bf0bbc3eb2991938608bf02970c4a1691d056d5d6a539  apps/mac/test/blocked.test.mjs
6618d8ab3c7b02c4c865d2cc38c4522bbddc0fa532fa63c994dc0c9beccc6af3  apps/mac/test/service.test.mjs
71dfc00beb516939970e79522ca98b4d736044a094eb3040b3aa390fa979472b  apps/mac/test/retention.test.mjs
d478287ffd739aa8be160b2cdbafda8b098129606c83ab9ada4cecddd852fd66  apps/mac/test/v1-http.test.mjs
```

Suggested subject: `fix(mac): distinguish blocked mutations from idempotency conflicts`.
