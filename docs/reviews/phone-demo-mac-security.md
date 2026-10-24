# REVIEW-MAC-1: Mac security and ownership review

Reviewer: `/root/relay_v1`, independent of the Mac implementation. This is an AI review, not human GitHub approval or product acceptance.

## Scope and snapshot

- Reviewed component: `apps/mac/**` in `/Users/liyan2026mac/Documents/ChatGPT/1024/voxcode/.worktrees/mac`.
- Reviewed revision: `c40e1d684eb0fbbf26dd3696c2c34be545965d63` (`feat(mac): persist owned sessions and gate versioned acceptance`), Draft PR #3.
- Change base: `cd81e20`; prior retained snapshot `a352757481a04c39f0212fd1f07814a666431ff0` was inspected before the milestone commit. The decisive reproductions below were repeated on `c40e1d6`.
- Mac source was clean at the committed snapshot. Subsequent unrelated untracked review documents were not part of this review. The coordinator has assigned remediation after receiving the findings; this report does not cover those later edits.
- Reviewed durable dispatch/restart quarantine, task and turn ownership, subprocess termination, scheduling/settings, evidence retention, manual criteria/acceptance, replay, HTTP authentication and local-only monitor behavior.
- This reviewer changed only this report. No implementation, Git history, deployment, remote system or production credential was changed or accessed.

## Findings

### P1 / MAC-004: A revoked bearer can finish a slow POST and mutate state

Source: `apps/mac/server.mjs:44`, `apps/mac/server.mjs:52`, `apps/mac/server.mjs:70`, `apps/mac/server.mjs:100`.

The server authenticates once before awaiting the request body. Settings, task creation and task mutations then call `configure`/`mutate` after the await without checking whether the session is still authorized. Revocation or expiry during the body read therefore does not revoke the pending operation. In particular, an already-open approval POST can authorize a command after unpairing has completed.

Reproduction used real loopback HTTP and `createServer`, with a controlled executor, a temporary state directory, and no Codex or network provider:

1. Pair a session. For follow-up/approval cases, create the corresponding completed or waiting-approval task using the fixture executor.
2. Open a Node `http.request` POST with its valid bearer and correct `Content-Length`. Flush headers and write only the first byte (`{`) of the JSON body.
3. Wait until the server has executed its real `service.authorize` method. The fixture wrapped that method only to signal this boundary; it preserved the original authorization result.
4. Send a second HTTP request to `POST /api/unpair` with the same bearer and wait for its `200` response. A fresh authenticated `GET /api/settings` now returns `401`.
5. Finish the original body. It still returns `200` and applies its operation.

Actual output from four separate fixtures:

```json
{"mode":"settings","unpairStatus":200,"freshStatus":401,"delayedStatus":200,"actualEffect":{"executionLimit":8}}
{"mode":"create","unpairStatus":200,"freshStatus":401,"delayedStatus":200,"actualEffect":{"executions":["after-revocation"]}}
{"mode":"messages","unpairStatus":200,"freshStatus":401,"delayedStatus":200,"actualEffect":{"executions":["seed","after-revocation"],"version":1}}
{"mode":"approval","unpairStatus":200,"freshStatus":401,"delayedStatus":200,"actualEffect":{"decisions":["accept"]}}
```

Minimal remediation: read/validate the bounded body, then reauthorize the same bearer immediately before the synchronous state-changing operation. Preserve the initial authorization check so unauthenticated bodies are rejected promptly. Apply this to every authenticated POST mutation, including criteria, acceptance and cancellation. Add real HTTP regressions that revoke or expire the session while a partial body is pending and assert `401`, no replay record, no task/version/settings change and no approval callback. Keep successful current-session controls in the same coverage. A body deadline can additionally bound pending requests, but does not replace reauthorization.

Status: reproduced and sent to the coordinator and Mac implementer; unresolved in the reviewed revision.

### P1: Command approval requests bypass owned thread/turn validation

Source: `apps/mac/codex.mjs:142` and `apps/mac/codex.mjs:154`; compare the ownership checks at `apps/mac/codex.mjs:193`.

JSON-RPC requests with an ID enter the command-approval branch before `notify()`. That branch validates command size and cancellation, but does not validate whether dispatch has started or whether `params.threadId`/`params.turnId` belong to this execution. A foreign, historical or pre-dispatch approval is consequently presented as the current task's operation. A user's decision for that displayed operation is forwarded to the wrong request.

Reproduction used `runCodex` with `task.codexThreadId = "owned-thread"` and a real spawned Node subprocess implementing a minimal fixture App Server. It exercised two independent frame sequences:

1. **Foreign before dispatch:** after receiving `thread/resume`, before returning its result, the fixture sends the request below, then returns `owned-thread` and subsequently starts `owned-turn`.
2. **Old turn on owned thread:** after responding to `turn/start` with `owned-turn`, the fixture sends the same request shape with `threadId: "owned-thread"`, `turnId: "old-turn"`, `command: "stale-command"` and `cwd: "/stale"`.

```json
{"id":900,"method":"item/commandExecution/requestApproval","params":{"threadId":"foreign-thread","turnId":"foreign-turn","command":"foreign-command","cwd":"/foreign"}}
```

The fixture's `onApproval` callback recorded the operation and called `reply("accept")`. The subprocess confirmed receiving the response for ID 900, then reported the owned turn as deliberately failed with `fixture-stop:accept`. This avoids invoking repository evidence collection and demonstrates the decision reached the subprocess, rather than only observing a callback.

Actual output:

```json
{"mode":"foreign-before-dispatch","outcome":"fixture-stop:accept","approvals":[{"command":"foreign-command","cwd":"/foreign","description":"item/commandExecution/requestApproval"}]}
{"mode":"owned-thread-old-turn","outcome":"fixture-stop:accept","approvals":[{"command":"stale-command","cwd":"/stale","description":"item/commandExecution/requestApproval"}]}
```

Minimal remediation: enforce owned active dispatch, thread and turn identity before invoking `onApproval`; decline mismatches and requests received before dispatch. Legitimate approvals can arrive after `turn/start` is sent but before its response, so buffer them within explicit count/byte bounds until the returned turn identity can be validated. Do not grant ownership to an arbitrary early frame. Add regressions for foreign thread, old turn, pre-dispatch requests, legitimate early owned approval and existing cancellation/single-use behavior. Preserve the existing fail-closed file-write escalation behavior.

Status: reproduced and sent directly to the coordinator and Mac implementer; unresolved in the reviewed revision.

## Verification and limitations

- Local runtime: macOS, Node `v26.0.0`.
- Command: `cd apps/mac && npm test`, at `c40e1d6`: exit 0; 41 tests passed, 0 failed, 0 skipped/cancelled. This includes real Git worktree isolation and controlled App Server/process fixtures, not live Codex.
- Additional commands: two inline `node --input-type=module` reproductions from `apps/mac`; both exited 0 after asserting the vulnerable behavior. HTTP reproduction covered settings/create/messages/approval, while approval RPC reproduction covered foreign pre-dispatch and stale-turn requests.
- Read-only inspection confirmed durable dispatch uncertainty blocks follow-up instead of replaying work, termination retains ownership until cleanup, settings keep separate bounded replay capacity, criteria bind to versions, and trusted failed checks remain sticky after evidence eviction.
- Existing exact mutation replay intentionally returns the original immutable response snapshot; it does not reapply old acceptance to the current task. This behavior was not reported as a defect.
- The monitor checks the actual socket peer rather than forwarding headers, and the public task projection excludes private stored session identities/worktree metadata.
- No live Codex/Linx, iPhone/device, signed build, deployed relay, cellular or outdoor path was exercised. Current fixtures do not prove real App Server history behavior, although both missing ownership checks are directly reproduced.
- Both P1 findings require fixes and targeted rereview. The second independent component review, coordinator verification and human/product acceptance remain separate gates. Deployment remains deferred.

## Reviewed file fingerprints

SHA-256 below is computed from the committed `c40e1d6` blobs for every changed Mac file relative to `cd81e20`; later working-tree edits are excluded.

```text
4633aad5a99b5627f05f0b157c285ad2aa4fbeb7209288c47307945aa494d24b  apps/mac/README.md
62927ba005cd1924fdde579c249ea3869f7ba8588637e495daeddc5e31df41f8  apps/mac/codex.mjs
45dabcad2355e06e9c5de2dd2fda6b0b2a42a7d06869bdee2f1208d40fa558cf  apps/mac/server.mjs
162ac27fdca82efcf1690c8a17260688bebd16c97daee2f0cde8f05620a7040e  apps/mac/service.mjs
ce7f114900f05ad091a7133bc5a5b532c7b20f74454777681b752c0ebbda0a7c  apps/mac/test/codex.test.mjs
912500d8e32075a7afa3cfa14b89e9490756876f854f566ee9e724f9f2799704  apps/mac/test/continuity.test.mjs
70f178826e34183a852f9c430435dac019e6a76cfae76342a034fb34df6cac87  apps/mac/test/criteria.test.mjs
f28984988326311e3b68e71a7e1c7d21f4fcf12a57d6316d95a41b58bd2869dd  apps/mac/test/fixtures/app-server.mjs
baeb1508c4e7b2eb924113d61342f4af6163ae5df8cfa27d6e9d7362d469ae84  apps/mac/test/fixtures/crash-bridge.mjs
e803a347d81ba45e31f443ac4540f036b7bfa1c0bf3d437d2e54016bcf091bec  apps/mac/test/retention.test.mjs
16d744860bcf1784ca60eaac8d931ed13a1eeced707fc1983d852ba453f19afc  apps/mac/test/service.test.mjs
6f9b2c147fd1bdecb38d9c55af072d60f240ada66bcbcb901c0f26a0380d30e3  apps/mac/test/settings.test.mjs
680167c9cddd6de0137c3bb869027cfbac544a68f962987ad9726921d5a2da8f  apps/mac/test/v1-http.test.mjs
```
