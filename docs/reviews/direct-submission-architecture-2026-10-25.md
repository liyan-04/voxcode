# Issue 126 Independent Architecture Review

Reviewer: architecture_refresh, independent of implementation and linx_audit review.
Worktree: /private/tmp/voxcode-126-direct-task-submission.
Reviewed commit: de3329e, feat(control): execute task submissions directly.
Disposition: PASS for this bounded backend component. No actionable finding identified.

## Reviewed behavior

- start() validates allowlisted fields, creates via the existing adapter and confirms exactly initial revision1. continue() validates task/project membership and allowlisted prompt/revision/requestId, appends through the existing service and confirms exactly submitted base revision+1. It never reads a newer revision and substitutes it for execution.
- The confirmation request ID derives from a versioned namespace, fixed execution target, operation kind, task ID and original business request ID. Unchanged retries produce the same confirmation identity, while different targets/operations are separated. Existing service and adapter receipts retain the actual replay/permissions/sandbox enforcement.
- Replaying an original start/follow-up after later turns cannot confirm the later draft: the deterministic identity and immutable original revision remain bound to the earlier turn. Busy confirmation preserves the original created task/submission identities; failure to fetch the result after admitted execution is conservatively outcome_unknown.
- Project membership is checked before continuation, before confirmation and before returning full task results. Session selection and unexpected helper fields are rejected. Public HTTP errors expose allowlisted codes and bounded recovery identities without executor exception text.
- HTTP login remains entirely before task RPC operations and is tested with zero adapter calls. Generic HTTP construction preserves legacy draft semantics unless explicitly enabled; the formal control composition passes directSubmissions:true.
- The changed control runtime test exercises the one-request direct submission through actual local HTTPS -> authenticated Agent WSS -> private Unix task RPC. Gateway duplicate handling keeps the inner mutations at most once in that fixture. It substitutes the final task service/Codex, so it is not actual model/deployment acceptance.

## Independently executed verification

```sh
node --test apps/server/test/task-submission.test.mjs apps/server/test/http-server.test.mjs apps/server/test/control-runtime.test.mjs
git diff --check HEAD^ HEAD
```

Results: 32 passed, 0 failed/cancelled/skipped, exit0. This includes all ten task-submission focused tests, sixteen HTTP tests and six control-runtime tests. Whitespace check exited0. Environment: macOS arm64, Node26. Reviewed actual helper, HTTP, runtime and test source/diff before comparing the existing linx review; hashes independently matched its frozen snapshot.

No source/test/Git/deployment/installed-service change was made by this reviewer. Only this allocated report was written. No physical phone, provider or model execution was performed.

## Integration boundaries

The helper currently defaults to the fixed mac executionTarget. Issue128 must select the authorized adapter/registry per request and instantiate the helper with that same immutable target; this review does not certify future dual-target routing.

The Issue124 UI has a separate independently reproduced P2: after an executed submission loses its response and polling advances revision, the UI may replace the pending request identity for unchanged text. This backend correctly handles an unchanged original request, but cannot deduplicate a client-created new business request. Therefore this PASS does not clear Issue124; its fix remains necessary before combined deployment. Login-page behavior is separately assigned to Issue131.

## Frozen SHA256

0f073a4a62bb52cf9b2d14ff8e107f1aa696930ce3930d24b86ca6ebd09ca2e0  apps/server/task-submission.mjs
aa46e8ad35ae7b6b59de49d5ebf9633abffd6b0493fff9fff23bc9187599a774  apps/server/test/task-submission.test.mjs
2d3dae6014a03264ff20f934ec83f1cbe4143aba183e9f085ae1fdf9cdbd6ba8  apps/server/http-server.mjs
3f98d8b0a02664c6d6341bdb63d3a41ef64c2cc96ff755dd891567909f19fd3e  apps/server/control-runtime.mjs
057e6a35ea012aee3d3ce8728d1d0769eec604ad8b14595e71bef77c906b37cf  apps/server/test/control-runtime.test.mjs
