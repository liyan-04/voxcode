# Independent Mac targeted implementation review

Reviewer: independent security/correctness reviewer, not the Mac implementer or coordinating architect. Date: 2026-10-24.

Reviewed revision: **f4114f2d63178161e182013231a77e01d519f261**, verified as Mac worktree HEAD. Inspected `c40e1d6..f4114f2`, including `fecd68f` authorization/body/approval changes and MAC-005's final service rejection-code changes. Implementation paths were clean; unrelated untracked review documents were left untouched.

## Findings and disposition

**No new actionable P0-P3 findings in this targeted scope.** The reviewed fixes address the checked authorization race, split UTF-8 handling, approval ownership and definite business-rejection classification. This is a source/fixture verification conclusion, not an approval of live deployment or the entire product.

1. **Authorization is rechecked at the mutation boundary.** `apps/mac/server.mjs:53-55,73-76,100-112` reads the complete body, then calls `service.authorize` again before settings/create/scoped task mutations. No await separates that check from the synchronous mutation. Initial authorization remains at line 45. `apps/mac/test/authorization.test.mjs:123-178` exercises revoked and expired credentials during partial body upload for settings, create, messages, cancel, approval, criterion and accept; verifies 401 and unchanged intended task/decision state. Voice handler authorization across its own asynchronous boundaries remains that component's responsibility and is outside this narrow server fix.

2. **Valid split UTF-8 is reconstructed from raw bytes once.** `apps/mac/server.mjs:25-36` accumulates Buffers, counts actual received bytes against 65536 and decodes only after concatenation. `apps/mac/test/body.test.mjs:75-142` deliberately splits Chinese title, prompt and criterion characters across request chunks; checks create/follow-up content and exact replay, then tests the byte-limit boundary. This fixes valid multibyte chunk corruption. It does not claim a separate strict malformed-UTF-8 rejection policy.

3. **Approval authority is tied to the dispatched owned turn.** `apps/mac/codex.mjs:175-219` rejects requests before dispatch, from a foreign/missing thread or turn, after settlement/cancellation, or with unrepresentable command fields. Legitimate early requests wait in a shared 64-message/262144-byte dispatch buffer (`lines 83-96,133-153,193-195`) until the `turn/start` response establishes actual turn identity. Dispatch rejection discards/declines buffered approvals. The reply closure is single-use and rechecks cancellation, settlement and exact thread/turn before accepting. Unsupported file-write scope is still declined (`lines 222-229`). Ownership fixtures cover foreign/pre-dispatch/missing/old identities, valid early delivery, late decisions, rejected dispatch and overflow (`test/codex.test.mjs:290-389`). This does not authorize or take over unrelated Desktop sessions.

4. **`409 blocked` is a definite no-mutation business rejection in the checked branches.** `apps/mac/service.mjs:608,623-624,631-640,648-651,669-678` returns blocked before editing task input, acceptance, criteria evidence, approval state, executor decisions or request replay state. Ordinary active/queued follow-up, terminal cancellation, premature/failed-check acceptance, nonmanual criterion and missing/wrong/expired approval are distinguishable from idempotency collisions. `blocked.test.mjs:35-49` compares the complete persisted state bytes before and after each rejection and checks absence of the rejected request ID; scenarios cover the main business paths, while wrong/expired approvals also verify no extra executor callback. Exact replay remains checked before current business-state validation (`service.mjs:555-566`), preserving a previously accepted result rather than incorrectly returning blocked on retry. Fingerprint and cross-budget collisions remain `409 conflict` (`lines 540-545,557-565`, `blocked.test.mjs:147-163`). Client code may classify this specific reviewed blocked code as definitely rejected; this does not justify treating generic 409/5xx/transport failures as safe to resubmit with a new ID.

## Verification independently executed

- `git rev-parse HEAD` -> `f4114f2d63178161e182013231a77e01d519f261`.
- Read `git diff c40e1d6..f4114f2` for scoped implementation changes; separately inspected the MAC-005 service diff against `fecd68f`.
- Before final commit, ran `node --test apps/mac/test/authorization.test.mjs apps/mac/test/body.test.mjs apps/mac/test/codex.test.mjs apps/mac/test/blocked.test.mjs`: **46 passed, 0 failed** on the subsequently frozen source.
- At the exact final HEAD, independently ran `node --test apps/mac/test/*.test.mjs`: **74 passed, 0 failed**, no skipped/cancelled tests, approximately 3.54 seconds. This result is this reviewer's execution, not a restatement of the coordinator's run.
- Coverage includes owned process-group teardown, failed/malformed protocol paths, durable same-thread follow-up, unknown-dispatch quarantine, new-file/secret/symlink evidence handling, credential revocation, bounded history/capacity, criteria/manual acceptance and HTTP behavior. Most adapter executions use a controlled local App Server fixture, not the real provider/model.
- No implementation/Git mutations, deployment, external service access or credential inspection was performed. Only this report was written.

## Prior security review context and limits

The earlier `docs/reviews/mac-security.md` findings concerned permanent credentials, premature termination, unrepresentable file approval and omitted new-file evidence on a much earlier revision. They remain historical evidence, not current-open findings inferred by filename. Current source/tests contain per-session verifiers/revocation, owned process-group termination with quarantine, fail-closed file escalation and new-file-aware evidence; the final full fixture suite exercised these paths. This targeted review did not repeat a comprehensive filesystem/sandbox threat audit or inspect all deployment/integration code.

Real Codex/model operation, signed iPhone interaction, trusted production TLS, live Linx speech, native playback and outdoor connectivity remain separate verification gates. No fixture pass establishes that the full phone demonstration or remote deployment is ready.
