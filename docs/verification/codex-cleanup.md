# Codex Exit and Descendant Cleanup

Issue #104, 2026-10-25. Implementer: Linx/adapter worker. Assigned paths:
`apps/server/codex-cli-adapter.mjs`,
`apps/server/test/codex-cli-adapter.test.mjs`, and this report.

## Behavior

When Codex exits with descendants still in its process group, the adapter must
clean up that group before releasing the execution slot. Previously `finish()`
called `entry.stop()` for that cleanup. `stop()` records cancellation intent,
persists a cancelling receipt and changes the eventual terminal status to
cancelled, even when the CLI exited successfully or failed without cancellation.

Post-exit cleanup now sends TERM and KILL directly, retaining the existing grace
period, group-liveness checks, quarantine behavior and terminal persistence.
Cancellation still uses `entry.stop()`, including a request arriving during the
descendant-cleanup wait, so explicit cancellation continues to produce a
cancelled terminal receipt. Timeout and persistence-failure stop paths remain
unchanged. This correction does not grant approval, acceptance or rollback.

The coordinator-provided local reproduction and its adapter correction were
inspected read-only. No file under `local-linx-codex` was edited. No staging,
commit, branch switch or push was performed by this worker.

## Verification

Evidence: local fixture execution, Node.js test runner. New regressions exercise
the real adapter and task store with controlled child/process-group boundaries.

Before the implementation change:

```sh
node --test --test-name-pattern='descendant cleanup' apps/server/test/codex-cli-adapter.test.mjs
```

Result: two expected failures, one pass. Successful exit 0 and failed exit 7
both incorrectly returned cancelled. The explicit cancellation-during-cleanup
case already passed, establishing the behavior that must be preserved.

After the implementation change:

```sh
node --test apps/server/test/codex-cli-adapter.test.mjs apps/server/test/project-service.test.mjs apps/server/test/task-cli.test.mjs
```

Result: 34/34 pass, no failures, skips or cancellations. New assertions verify
TERM/KILL cleanup, preserved output/exit code, completed versus failed status,
absence of an artificial cancellation revision, slot release, and explicit
cancellation racing with cleanup. Existing tests cover blocked confirmation,
persistence errors, timeout, coalesced event writes and quarantine retention.

The real POSIX process-group test emitted its documented host limitation:
negative-PGID liveness probing returned EPERM. Its conservative cancelling and
quarantined-slot fallback passed. This run does not establish confirmed real
descendant cleanup in that branch. No real model, private credential, deployed
service, phone, Linx or outdoor verification was performed by this worker;
the coordinator owns separate live rerun evidence and integration/review gates.
