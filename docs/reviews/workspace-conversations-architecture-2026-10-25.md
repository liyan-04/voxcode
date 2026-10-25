# Issue 124 Independent Architecture Review

Reviewer: architecture_refresh, independent of gateway_impl implementation.
Reviewed worktree: /private/tmp/voxcode-124-workspace-conversations.
Source snapshot: commit 049f695 reported by coordinator; exact reviewed file hashes below.
Disposition: CHANGES REQUESTED. One P2 with independently reproduced duplicate-execution risk.

## P2: unknown continuation loses its request identity after polling advances revision

Locations: apps/server/public/index.html:91 and :208 (continuation payload identity), :216 (network-error path retains input/pending request).

When a submitted continuation actually completes but the POST response is lost, the page correctly retains its composer input. Polling then loads the completed task's newer revision. Sending that unchanged text again recomputes the mutation fingerprint using the new revision. mutation() discards the pending payload and issues a new requestId, so the backend sees a distinct valid continuation and may execute the same instruction a second time. This is the ordinary lost-ack-after-commit case, not a stale or malformed server response.

Independent reproduction used the actual page and the existing VM fixture harness, composed entirely in memory (no repository source/test edits). The first post callback updates the synthetic authoritative task to completed/revision6 and then throws a transport error. After refresh() and its selected-task read, the unchanged composer still contains "apply change" and the full task is revision6. A second send produces:

```json
[
  {"path":"/api/tasks/one/continue","payload":{"projectId":"a","prompt":"apply change","revision":3,"requestId":"fixture-1"}},
  {"path":"/api/tasks/one/continue","payload":{"projectId":"a","prompt":"apply change","revision":6,"requestId":"fixture-2"}}
]
```

The current uncertain-continuation test throws before any task mutation, so revision stays unchanged and does not exercise this path. The browser fixture likewise returns503 before applying the original operation.

Required repair: preserve the original payload/requestId for an unresolved unchanged submission across automatic revision/history refresh, or block redispatch until the original operation is explicitly reconciled. Do not silently reinterpret an uncertain unchanged retry as a newly authorized turn. Add a regression for server acceptance/completion followed by lost response and a newer full-detail poll; unchanged retry must reuse original identity/reconcile without adding a turn. Also retain the distinct ability to intentionally submit a later new turn after resolving the original operation.

## Independently executed checks

```sh
node --test apps/server/test/workspace-conversations.test.mjs apps/server/test/project-task-tabs.test.mjs apps/server/test/voice-composer.test.mjs apps/server/test/http-server.test.mjs
```

Result: 38 passed, 0 failed/cancelled/skipped, exit0. The targeted in-memory reproduction above also exited0 and printed the differing identities; no model or service was used.

The documented Playwright fixture was independently run with installed bundled Playwright/Chromium and output prefix /private/tmp/workspace-conversations-124-architecture-review. It passed desktop1440x900, mobile390x844, narrow320x740 and landscape844x390, with no page errors, horizontal document overflow or long-event wrapping failure. Synthetic browser results: /private/tmp/workspace-conversations-124-architecture-review-results.json. Existing fixture coverage does not refute the finding because its failure mode precedes server mutation.

git diff --check exited0. No source, tests, Git or installed services changed by this reviewer. Only this allocated report was written; browser artifacts are generated temporary outputs.

## Other reviewed behavior and boundaries

- Full selected-task reads are distinct from bounded list summaries; refreshed summaries merge navigation metadata and do not replace state.snapshot. Slow reads for the same generation are deduplicated; changed target or older execution/metadata versions reject late details.
- Per-turn prompt/output/event rendering uses textContent via element(), including command output and file paths; no new HTML interpolation found.
- Pending send disables concurrent sends and voice start. Delayed successful responses do not switch the current project/task and clear only unchanged source input. Frozen transcription remains keyed to its originating draft.
- Saved legacy draft execution is explicit-only and has no automatic open/poll execution path. It preserves newly typed follow-up text.
- Direct send is a one-request UI contract. Coordinator backend integration is required; base HTTP draft semantics are not magically changed by this page. That dependency is honestly documented.
- Login independence from Mac and selectable executionTarget are newer separately allocated work, not additional findings blocking this bounded conversation increment. The P2 above is within this increment's stated replay/unknown-result contract and does block its merge.

## Reviewed SHA256

fb3d77a35e84a84264af9256b07674fff0c4e2ab3198325609dc74b1b63f5dbc  apps/server/public/index.html
4e76072a074b6aeae5bef693c0592977a49579f7b0f9782b9eb4b279129d03c2  apps/server/test/workspace-conversations.test.mjs
d21a645056b5d0b03280085b7d284ca99507d383a071e26abaf1fe4e1a808497  apps/server/test/workspace-conversations-browser.fixture.mjs
26088c5c454aa65ca5a202b58902af17707a99e372081b23bc7b4361807d3ff6  docs/verification/workspace-conversations.md
