# Mac security and correctness review

Reviewer: independent architecture/security reviewer 1. Date: 2026-10-23.
Scope: `apps/mac`, shared design and HTTP contract. Remote use is a core requirement; relay implementation is outside this review. No implementation files changed.

## Findings

1. **P1 — Paired remote credentials cannot be revoked.** `apps/mac/service.mjs:24-25` persists raw bearer tokens indefinitely and accepts every stored token; the returned service at line 31 exposes no revocation or expiry operation. A lost phone or leaked remote token retains task creation and approval privileges across restarts. README acknowledges this limitation, but deleting all bridge state is not a usable revocation mechanism because it also removes task history. Add per-device/session records, revocation and a local recovery control; require subsequent requests and voice sessions to observe revocation. Store token verifiers rather than reusable raw credentials. Verify one device can be revoked without losing tasks or revoking the other device.

2. **P1 — Cancellation releases execution ownership before processes demonstrably stop.** `apps/mac/codex.mjs:24` sends SIGTERM after one second; line 27 also sends SIGTERM but does not await child exit or guarantee termination. `apps/mac/service.mjs:21` then deletes the active slot and starts another task. An App Server that delays/ignores termination, or a descendant preview process, can continue accessing the old worktree while a new execution starts. `close()` at service line 31 likewise returns immediately after aborting. Track exit completion, use a bounded termination escalation, and explicitly manage task-owned descendant/runtime processes. Do not free the execution slot or claim stopped until the owned process lifecycle is settled. Existing cancellation test injects an executor that settles correctly and cannot detect this adapter defect.

3. **P1 — File-change approval omits the changes being approved.** `apps/mac/codex.mjs:16` maps both command and file approvals to command/cwd/reason, replacing file-change details with the literal `file changes`. `apps/mac/service.mjs:22` persists only those fields. The phone can approve a write escalation without seeing affected paths or requested root/scope; a generic reason is insufficient evidence. Preserve the installed protocol's relevant file/path/scope fields, and present them before approval. If the MVP cannot represent a request accurately, explicitly decline that approval type. Test command and file-change requests independently, including cancellation, expiry and unsupported scopes.

4. **P1 — Result evidence misses newly created files.** `apps/mac/codex.mjs:26` uses only `git diff HEAD --`, which excludes untracked files. A normal task creating a new page or an entire app can therefore report an empty/incomplete final Git diff. Turn diff notifications at line 20 are useful additional evidence but do not constitute a verified final repository snapshot. Capture Git status and new-file content with bounded size and explicit labels; never stage user changes just to obtain evidence. Include new, modified and deleted files, and bind the final snapshot to the task version. Verify a task that creates only a new file produces visible review evidence.

5. **P2 — Persistence grows without a bound on remote-generated evidence.** `apps/mac/service.mjs:16,21,29` retains events, full evidence and request snapshots indefinitely and synchronously rewrites the entire JSON state. `apps/mac/codex.mjs:19` stores command aggregated output without a size bound. A long-output or repeated remote task can consume memory/disk and stall all task polling and approval handling. Bound individual evidence size and label truncation; add a basic total retention/cleanup policy. This is not a request for an event-bus rewrite.

## Positive checks and limits

- Default loopback binding, explicit external-binding flag, shared API authentication, two slots, worktree separation, task/version checks, idempotency and expiry of in-memory approvals are present.
- No arbitrary preview filesystem/port endpoint is currently exposed; `previewUrl` remains null. Preview authentication and task runtime port isolation are therefore pending, not verified.
- Worktree IDs are server-generated and paths are constructed under the configured data directory (`service.mjs:20`). Persisted worktree paths are trusted on restart; protect local state from modification and do not accept remote path overrides.
- Codex stdio request IDs are correlated; request errors reject, non-completed turns fail, and cancellation does not imply rollback. Unknown interactive requests explicitly reject. Installed-version protocol compatibility beyond the reported initialization smoke remains an integration gate.
- Follow-up messages start a fresh ephemeral Codex thread, retaining files but not conversation history. This is documented; product copy should not imply restored conversational context.
- The bridge itself serves HTTP. `VOXCODE_TRUSTED_HTTPS=1` is an operator assertion, not TLS enforcement (`apps/mac/cli.mjs:5`). Remote deployment must ensure the raw HTTP listener cannot be reached by untrusted peers. Relay correctness, remote token routing and end-to-end TLS remain outside this review.

## Verification

- `node --test apps/mac/test/*.test.mjs`: **7 passed, 0 failed**.
- `npm test --workspace=@voxcode/mac`: not applicable; root declares no npm workspaces. Used the package's direct Node test command instead.
- Existing tests cover pairing throttle/expiry, HTTP authentication, durable replay, stale versions, two injected execution slots, real Git worktree separation, cancellation slot retention for an injected executor, approval single use/cancellation/expiry.
- No Codex adapter-specific protocol tests or real model turn were executed in this review. Missing coverage includes child process exit/termination, turn error events, file-change approval details, unsupported requests and new-file evidence.

Verdict: keep local protocol work, but do not mark remote Mac control ready until findings 1-4 are resolved and exercised with focused adapter/integration verification.
