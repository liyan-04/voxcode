# Issue 126 direct task submission independent review

Reviewer: linx_audit, independent of the implementation. Date: 2026-10-25.
Worktree: `/private/tmp/voxcode-126-direct-task-submission`.
Scope: task-submission helper and its ten tests, HTTP composition/error
handling, control runtime directSubmissions flag, updated real WSS fixture.
No source or Git mutations were made for this review. Subsequent Issue 128
integration is a separate implementation and is not self-reviewed here.

## Result

PASS. No actionable findings in the frozen component.

## Reasoning

- Sending a new instruction creates a task and confirms only initial revision
  1. Sending a follow-up creates the next turn and confirms only the submitted
  base revision plus one. It never substitutes the task's latest revision.
- The execution request identity hashes a versioned namespace, fixed execution
  target, operation kind, task ID and business request ID. It is stable on
  retry and distinct from the create/continue request. Previously confirmed
  turns are protected by the core's retained per-turn confirmation receipts.
  Thus replay of an old new-task or continuation submission cannot confirm a
  later draft; if the old confirm never committed, its immutable revision
  rejects against a later task revision.
- Project membership is checked before confirmation and again before returning
  the result. Continuation also checks it before changing the task. Invalid
  session selectors and extra submission fields are rejected by the helper.
- A busy confirm preserves the created task/submission identity for retry.
  A result read failure after confirmed execution becomes outcome_unknown;
  network unknown outcomes are retained. Errors expose only bounded recovery
  identities and allowlisted codes through HTTP, not executor details.
- Login has no task RPC dependency. Generic HTTP fixtures retain the previous
  draft behavior by default; the real control runtime explicitly enables
  direct submissions. The runtime fixture verifies one POST -> running via
  real local HTTPS -> Agent WSS -> private Unix RPC and duplicate at-most-once
  mutation behavior at the gateway boundary.

## Independent verification

```sh
node --test apps/server/test/task-submission.test.mjs apps/server/test/http-server.test.mjs
node --test apps/server/test/control-runtime.test.mjs
git diff --check
```

Results: 26/26 focused tests passed; 6/6 runtime tests passed; diff check
exited 0. Runtime evidence is a controlled local fixture with substituted task
service/Codex and synthetic voice provider, not real model/provider execution,
deployed Linux, physical phone or user acceptance.

## Frozen SHA256

```text
0f073a4a62bb52cf9b2d14ff8e107f1aa696930ce3930d24b86ca6ebd09ca2e0 apps/server/task-submission.mjs
aa46e8ad35ae7b6b59de49d5ebf9633abffd6b0493fff9fff23bc9187599a774 apps/server/test/task-submission.test.mjs
2d3dae6014a03264ff20f934ec83f1cbe4143aba183e9f085ae1fdf9cdbd6ba8 apps/server/http-server.mjs
3f98d8b0a02664c6d6341bdb63d3a41ef64c2cc96ff755dd891567909f19fd3e apps/server/control-runtime.mjs
057e6a35ea012aee3d3ce8728d1d0769eec604ad8b14595e71bef77c906b37cf apps/server/test/control-runtime.test.mjs
```

## Integration limits

Issue 128 must select the adapter and project registry for each request before
membership checks and construct the submission helper with that same fixed
executionTarget. The present helper default is mac. This review does not
certify the future dual-target routing implementation or page behavior.
