# Issue 124 Targeted Independent Rereview

Disposition: **PASS** for the frozen Issue 124 repair. The previous P2 is resolved; no new actionable findings identified in this targeted rereview.

Reviewer: `architecture_refresh`, independent of the UI implementation owner and coordinator's first review.
Worktree: `/private/tmp/voxcode-124-workspace-conversations`.
Previous finding: `/private/tmp/voxcode-124-architecture-review.md`.

## Repair Assessment

Reviewed the actual four-file diff and all three added regression tests. In `apps/server/public/index.html:205`, `submitComposer` selects an unresolved submission by its originating draft key and reuses its original payload, request ID and source text. A newer polled task revision no longer replaces the submitted revision or generates a new request ID for the unchanged uncertain operation. The lost-ack-after-commit test independently passed with revision advancing from 3 to 6, original-request replay adding no turn, and a subsequent intentional instruction obtaining a new request ID at revision 6.

Edited input cannot replace an unresolved operation. The visible `retry-submission` action replays the original payload; the success path compares the saved original source text before clearing any draft. Thus edited input survives recovery and can be explicitly sent as a later turn after recovery succeeds. Recovery can run while the task is running, independently of the fresh continuation eligibility check.

Network failures, 5xx, busy, offline, outcome_unknown and untyped 409 preserve the same pending payload. Definitive other 4xx responses release it. The three new tests cover completion followed by a lost response and newer poll, edited-input recovery, and partial admission errors. The HTTP error code is now retained for this classification.

## Independent Verification

Executed against the frozen files:

```sh
node --test apps/server/test/workspace-conversations.test.mjs apps/server/test/project-task-tabs.test.mjs apps/server/test/voice-composer.test.mjs apps/server/test/http-server.test.mjs
git diff --check
```

Result: **41 passed**, zero failed/cancelled/skipped, exit 0. Diff check passed with exit 0.

An additional pure in-memory probe loaded the real page through the existing VM harness without editing source or tests. It separately exercised continuation and creation where the server admits the original request, remains running, and the response is lost. It advanced the selected task through refresh, switched away and back for continuation, edited the input, verified no new request was sent, then used the recovery action. Both modes replayed the exact original path and payload, preserved edited input, and cleared the unresolved marker only after success. The continuation recovery remained enabled with a running task.

The browser fixture's new failure injection was reviewed: `route.fetch()` lets the synthetic server commit, then `route.abort()` discards only the page-visible response. I inspected the author's four-viewport result JSON at `/private/tmp/workspace-conversations-124-lost-ack-results.json`, checked its four recovery-button bounds and empty error/overflow fields, and visually inspected the narrow and landscape recovery screenshots. The recovery control is visible inside each viewport and below the tab bar. This rereview did not rerun the browser fixture; the 41-test suite and the additional VM probes above were independently executed.

## Frozen File Identity

All four independently computed SHA256 hashes match the coordinator-provided new freeze:

```text
ab937c4fb26fa75b0e5efeec86966b13e8a527cc35436ea3e06b1d0924421609 apps/server/public/index.html
eecd470bcd8b2ef9f8bce846168946789e003e9232abe6a72981b26bfe16adac apps/server/test/workspace-conversations.test.mjs
93d2370969d9190fe3f09ba960afc55b1cd06f8722307f46de6bb4604bc28165 apps/server/test/workspace-conversations-browser.fixture.mjs
c061999eeaa0278aaf74353f363eb8c7bad9241a3687e3192439d438de003526 docs/verification/workspace-conversations.md
```

## Boundaries

Unresolved identities remain in current page memory; reload/browser-restart recovery is not claimed. An untyped 409 that never admitted the request can remain blocked until a definitive backend outcome exists; the documented conservative retention prevents silently creating another execution identity. Real model/Linx, physical phone and deployed integration acceptance remain separate. This PASS does not resolve the coordinator's separate Issue 128 RPC deadline/error-classification investigation.

Only this allocated report was written. No implementation, tests, Git state or live services were changed.
