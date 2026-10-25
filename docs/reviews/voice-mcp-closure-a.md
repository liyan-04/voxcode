# Independent review A — Issue #108

Reviewer: `/root/review_voice`, independent of server/browser implementers.
Snapshot: uncommitted `/private/tmp/voxcode-108-voice-mcp-closure`, base `fe0d921`, reviewed 2026-10-25.
Scope: voice-tools/provider/transport/control-runtime and browser client/UI plus focused tests. Read-only review; no source changes.

## Findings requiring resolution

1. **P1 — A result query can misreport an earlier turn as the outcome of an unknown continuation.** `apps/server/voice-tools.mjs:19-31,51-55`: after continuation throws `outcome_unknown`, `uncertain` is saved but ignored whenever taskId exists. `codex_task_result` simply reads the task and can return the previous completed revision/output. Reproduced using a frozen task `t`, completed revision 3 with output `previous turn`, and `continueTask` throwing `outcome_unknown` plus operation `op`: mutation returned unknown, immediately querying returned completed revision 3 / previous turn under the new voice requestId. Retain original operation/submission/expected turn identity; do not clear unknown without reconciliation that establishes this submission's result.

2. **P1 — Voice revocation between internal reads and confirm still dispatches execution.** `voice-tools.mjs:43-48` passes an unguarded adapter to `createTaskSubmission`; `task-submission.mjs:26-29` awaits getTask then calls confirmTask without another capture authorization check. Reproduced with getTask invalidating authorization before returning: tool eventually rejected `voice_context_invalid`, but `confirmedAfterAuthorizationRevoked` was 1. Guard each mutating adapter call immediately before it crosses the target boundary, including internal start/continue/confirm stages, not only entry to the overall tool.

3. **P1 — First nonterminal result plus speech stop closes the live voice socket before later result queries.** `public/voice-client.mjs:96-104` sets hasResult for every status and calls completeSpeech on any later TTS stop. When the 60-second execution wait returns running (or unknown), the spoken progress reply ends and disposes the socket, preventing a subsequent `codex_task_result` from delivering final completion. Query tool also emits no tool.started (`voice-tools.mjs:61`), so query-pending is invisible. Distinguish terminal from running/unknown; keep/reconcile long work and mark every pending query. Add result-running → TTS stop → query → completed → final speech regression.

4. **P2 — Legal multibyte output can silently lose the entire browser tool result.** `voice-tools.mjs:24` allows 8000 output characters plus title/error; `voice-transport.mjs:55` forwards only JSON under 24000 bytes and otherwise silently ignores the event. 8000 Chinese characters alone consume 24000 bytes before JSON/identity overhead. Linx receives the tool result, browser never receives task identity or output. Bound by serialized bytes, explicitly mark truncation, and never silently drop the receipt. Add Chinese/multibyte output regression.

## Verification

`node --test apps/server/test/voice-tools.test.mjs apps/server/test/voice-provider.test.mjs apps/server/test/voice-transport.test.mjs apps/server/test/voice-client.test.mjs apps/server/test/voice-composer.test.mjs` passed 82/82. Log: `/private/tmp/voice108-review-a-tests.log`.

Two small `node --input-type=module` probes used production `createVoiceTools` and reproduced findings 1 and 2 as described. No live service/provider calls or mutations were made.

## Positive observations / remaining gates

The new tool schemas correctly omit target/owner/path/session authority, and ordinary duplicate mutation calls share a receipt. The global cloud MCP write restriction remains intact. Browser PCM has bounded buffering and capture cleanup is separated from playback. These do not waive the findings. Approval remains blocked pending fixes, focused regressions, targeted rereview, runtime integration tests and the independently recorded deployed live path. Fixture output is not live/phone acceptance.

## Targeted rereview — server corrections

Reviewed the subsequent uncommitted `voice-tools.mjs` and its eight tests. Findings 1, 2 and 4 are resolved for the inspected code: reads select the original requestId's retained turn after mutation rather than the task's preceding output; missing evidence remains unknown. The submission adapter guards start/continue/confirm individually immediately before dispatch, preventing the demonstrated intermediate-read revocation race. Serialized output is limited to 16000 bytes and explicit `outputTruncated` is set. `codex_task_result` now announces pending work via onStart.

`node --test apps/server/test/voice-tools.test.mjs` passed 8/8 including the new regressions for the reproduced races and Chinese/escaped output. No additional server blocker was found in this targeted pass. Finding 3 remains open pending the separately in-progress browser correction. Unknown mutation with no task identity remains explicitly unknown, without replay; this is safe behavior, not evidence of automatic operation reconciliation or successful execution.

## Final integrated rereview A

Snapshot: base/master `4f0a7f5`; branch HEAD `a119ac3` plus the four uncommitted browser/client test corrections shown by status. Reviewed the integrated implementation, including execution-target selector integration, unknown-operation recovery card routing, no-ASR-submit behavior and nonterminal query lifecycle.

Finding 3 is now resolved: running/queued/draft/cancelling result statuses leave the voice session open across a TTS stop and permit the query/final-result round trip. Completed and rejected/unknown outcomes have distinct completion reasons; unknown is not labeled successful. The query tool emits its pending event. Target-bound operation recovery persists the original target/operation ID; old-target result callbacks do not navigate the newly selected target. All four original findings are closed for this exact snapshot. No additional P0/P1/P2 defect was identified in the final read-through.

Final command:

`node --test apps/server/test/voice-client.test.mjs apps/server/test/voice-composer.test.mjs apps/server/test/voice-tools.test.mjs apps/server/test/voice-provider.test.mjs apps/server/test/voice-transport.test.mjs apps/server/test/control-runtime.test.mjs`

Result: **101/101 passed**, zero failed/cancelled/skipped. `git diff --check` passed. Log: `/private/tmp/voice108-review-a-final-tests.log`.

Reviewed implementation SHA256:

| File | SHA256 |
| --- | --- |
| apps/server/voice-tools.mjs | 778401a9e2e2f685ed56ef8987677e3cc76232ad4d9d39e5f6052025408418b0 |
| apps/server/voice-provider.mjs | 4dee625c528d0f4c0a08149d694de0943b87e209e0811fd3e66d9ded31705def |
| apps/server/voice-transport.mjs | d11df98b4344fb490b8b9968b853fd4447696619c18147bb399c21f909e3f2f3 |
| apps/server/control-runtime.mjs | ec4f1ee169a8c564b376c0d1f3a193bd7d1cc9b7c0cca96a81a9a063547aa568 |
| apps/server/public/voice-client.mjs | 6eedd19d9b46c496900d494f89fbd6d86cf7237372e9037a22eb3685feaf08c8 |
| apps/server/public/index.html | 14ab4b4e9110db430c6de9fd4b9b06ea9e1e8f0f2346c22bf285a3075499e17c |

Review recommendation: source changes pass independent review A for this snapshot. This is one AI code review, not a human GitHub approval or acceptance of a live/phone deployment. The second independent review, full release gates and real deployed audio → device MCP → Mac Codex → real result → Linx TTS evidence remain the coordinator's integration/acceptance responsibilities. No live service calls were performed during this review.

## Final authentication follow-up — `351fb1c`

Inspected the transport follow-up in commit `351fb1cc435b1c0a419a05a90c4f18d326b0a495`. The upgrade request is retained server-side and the original authenticated session is looked up again on every tool authorization, before context resolution. Eviction/revocation of that browser session therefore denies new tool actions even while the WebSocket is still connected. The existing capture-active/expiry checks still run after awaited authorization and context resolution. No new blocker found; no P0/P1 findings remain open in review A.

`node --test apps/server/test/voice-transport.test.mjs` passed **22/22**, including the new evicted-session regression. Log: `/private/tmp/voice108-review-a-auth-tests.log`. The transport hash in the table above is updated to this commit; the other five implementation hashes remain unchanged. Prior browser corrections are now committed in the same revision. Live/device gates remain separate as stated above.
