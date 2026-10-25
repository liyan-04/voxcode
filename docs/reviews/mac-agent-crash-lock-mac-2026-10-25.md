# Issue 121 Independent Review

Reviewer: mac_agent_probe. Date: 2026-10-25. Environment: Darwin arm64, Node.js v26.0.0.
Worktree: `/private/tmp/voxcode-121-agent-crash-lock`.
Base HEAD: `c390bfa3f3b345900f306c9f6821afd8083a1d52`.

Result: PASS for the reviewed macOS source and local-process behavior. No actionable P0/P1/P2 finding identified. No source, Git, installed service or live state was modified.

## Ownership and failure handling

`ledger-lock.mjs:40` retains the opened guard FileHandle in Node; line 45 passes that descriptor to a synchronous, short-lived, trusted system helper. Successful helper exit is observed before the lease is returned. The real-process concurrency tests run competitors after this exit and still observe one winner. This validates the crucial macOS behavior: ownership survives helper exit through the parent's retained shared open-file description. It is not inferred from a helper success code alone.

The guard path is persistent. Acquisition and `assertHeld` compare the current path and held descriptor's device/inode and require a private, owned, regular, single-link file. Symlinks, writable group/other permissions, hard links and replacement are rejected. The parent and ancestor checks come from the existing `private-files.mjs`; the fixed lock helper must be a root-owned canonical regular binary without group/other write access. The foreign-UID rejection was checked in source; this review did not change ownership of a file to another user.

`ledger-lock.mjs:53` treats legacy metadata separately because old Agents lack the guard. Only ESRCH permits migration. A live PID, reused live PID, actual EPERM, or zombie PID remains conservative. Modern version-2 PID fields are observation metadata: the acquired kernel guard decides ownership, allowing recovery after normal exit or SIGKILL even if an old PID remains visible as a zombie or is reused. No process receives a terminating signal based on metadata.

The old metadata is renamed aside before an O_EXCL replacement is created. Old/new Agent races retain the common metadata create barrier. Release removes only its own metadata inode, leaves a replacement inode intact, and always closes metadata/guard descriptors through nested finally blocks. A helper failure or exception after an actual successful lock also closes the parent descriptor; a subsequent acquisition succeeds. Directory fsyncs remain in acquisition/release, and Agent ledger commit fsync behavior remains intact.

`agent.mjs:38` calls `assertHeld` before queued ledger persistence. The integration regression replaces the guard before a command, then verifies state_error, disconnection, zero dispatch and no new receipt. The release path waits for pending ledger writes before closing the lease. The private guard must not be deliberately removed/replaced while an owner is active, as the verification document explicitly requires; inode checks fail closed on the following commit, not as a claim of protection against a malicious same-UID actor replacing files mid-commit.

## Independently Executed Tests

```sh
cd /private/tmp/voxcode-121-agent-crash-lock/apps/mac-agent
npm test
```

Result: 35 passed, 0 failed, exit 0. This includes actual processes/kernel locks for simultaneous acquisition, SIGSTOP retention, graceful release, SIGKILL recovery and stale observation preservation; live/dead legacy migration; acquisition-helper death; guard permissions/symlinks/replacement; Agent zero-dispatch on guard replacement; real reconnect-process lifetime; existing replay/unknown receipts, private RPC and WSS regressions.

```sh
node /private/tmp/crash-lock-review-probe.mjs
```

Result: exit 0. This independent external probe imports the actual frozen lock module and additionally verifies:

- Metadata symlink and hardlink refusal without changing the canary.
- Malformed metadata stays unchanged and acquisition refuses it.
- An exception thrown immediately after the real helper acquires its kernel lock releases ownership during failed-acquisition cleanup.
- Replacement metadata makes `assertHeld` fail; releasing the old lease preserves the replacement file.
- A real root-owned process whose signal-0 probe returns EPERM cannot be migrated from legacy metadata; the record remains intact. No actual signal was sent to that process.
- A separate Node owner calls `process.exit(0)` without release and remains as an actual unreaped zombie under an isolated Python parent. The probe confirms `ps` state Z and successful signal-0 liveness, then immediately acquires the modern kernel lease. Rewriting that observation as legacy version 1 correctly refuses migration while the zombie remains visible. The isolated parent reaps its child during cleanup.

The probe first hit the host sandbox's restriction on child `ps`, then was rerun with local escalation and completed. All state was in an isolated temporary directory and was removed; no service was started or stopped. No long-lived child remains.

`git diff --check` passed. The two new source/test modules were read directly, together with the modified Agent and test and verification document; the review did not rely only on the implementer's test summary.

## Frozen SHA256

```text
babf2090dfe20ac48d42737f4a7918e37cf6092677c72411a2e7d4a117184751 apps/mac-agent/agent.mjs
983ba8b4043e04abad539b05afa6f11d47d2e903c439a4152b1008132581f48d apps/mac-agent/ledger-lock.mjs
8d259b9900fd70830ee4e591c67b701e7c7837249df0ffd08268efe68526acbd apps/mac-agent/test/agent.test.mjs
6c64eba6217237df8562f668385f352f055471fa7ee3da3c72925440617d66c3 apps/mac-agent/test/ledger-lock.test.mjs
329f6b05e3cf76163171175226a2bd2820f382e4f7edda51b2faea5264ede0c8 docs/verification/mac-agent-crash-lock.md
```

Limits: Linux `/usr/bin/flock` execution, physical power loss, installed-service migration/recovery, real user device and outdoor behavior were not performed. Those limits match the implementation document. This AI review is not a human GitHub approval or user acceptance. Coordinator retains integration, second independent review, deployment and operator-script ownership; #122 scripts were outside this review.
