# Issue 131 Selector Independent Architecture Review

Final disposition: **PASS** for the repaired frozen files listed below. No unresolved actionable findings remain in the reviewed selector scope. The initial `26ae2c9` review requested the single P2 repair preserved below; that finding is now resolved.

## Narrow Repair Re-Review

The follow-up changes `taskAction()` so only an explicit HTTP 409 with code `revision_conflict` removes the known-rejected pending identity, and persists that removal. The next explicit action uses the refreshed task metadata and a new request ID. It does not automatically retry. Network errors, `outcome_unknown`, `request_conflict`, untyped 409 and other ambiguous failures continue retaining the exact original payload/ID. If cleanup storage fails after a definite rejection or a successful response, the original record is restored in memory as uncertain, preserving identity for later recovery.

Independently checked the three freeze hashes and reran the same six-file focused command recorded below: **93 passed**, zero failed/cancelled/skipped, exit 0. The three new regressions cover both targets' successful conflict recovery, four ambiguous/identity failure classes and cleanup failures after rejection or success. Existing uncertain replay tests remain intact.

Additional independent probes against the actual repaired HTML passed for archive/delete/restore on both Mac and Server: after a typed conflict the refreshed snapshot is revision 2, the first request remains the only dispatch until another explicit action, and that action sends revision 2 with a new ID and commits once. A 503 carrying `revision_conflict` still retains the original identity. A late Mac typed conflict after switching targets clears only the Mac record, preserving Server feedback, output and edited draft. No new browser run was performed for this behavior-only repair; the browser evidence limits below still apply.

Final frozen SHA256:

```text
3d964a15b801f621b56ef5480c8179fce24983674941191680cd99bbaaa287bd apps/server/public/index.html
3d03601e6a4db930a229c3aa80eed0dd831c233d61a71d742821527f1a8df3ae apps/server/test/execution-target-ui.test.mjs
9d9a7bb6b37896303946943d9f4f7c7743a73c0c385080a26754fc3410efe9e0 docs/verification/execution-target-ui.md
```

## Initial Finding (Resolved)

### P2: A definite metadata revision conflict becomes a permanently uncertain request

`apps/server/public/index.html:221` marks every failed metadata action uncertain, including an explicit HTTP 409 with code `revision_conflict`. The changed `mutation()` at line 103 always returns an uncertain record's original payload, even when the refreshed task has a newer metadata revision. Consequently an ordinary archive, restore or delete conflict can never recover through the instructed refresh and retry: each retry resubmits the known-rejected revision and request ID.

I independently reproduced this against HTML and harness source read directly from `26ae2c9`, avoiding the coordinator's integration working tree. Start with metadataRevision 1, advance the simulated backend task to revision 2, archive, return typed `revision_conflict`, then await the automatic list/detail refresh and two event-loop flushes. The page snapshot becomes revision 2. A second archive still submits the identical revision-1 payload and `fixture-request-1`; no mutation commits and the pending record remains uncertain.

```json
{
  "refreshedMetadataRevision": 2,
  "requests": [
    {"metadataRevision": 1, "archived": true, "requestId": "fixture-request-1"},
    {"metadataRevision": 1, "archived": true, "requestId": "fixture-request-1"}
  ],
  "commits": 0,
  "pendingUncertain": true
}
```

Distinguish definite typed rejection from an unknown outcome so refreshed metadata can produce a new request after a revision conflict. Retain exact payload and request ID for genuinely unknown outcomes, committed-response loss and storage cleanup failure. Add a focused regression demonstrating conflict, authoritative revision refresh and successful retry, alongside existing uncertain replay coverage.

## Reviewed Design

Target workspaces own projects, task snapshots, selection, tabs, checkbox preferences, drafts, loading and action state. Storage namespaces include the execution target. The API boundary attaches one frozen target selector to project, task, result and operation requests; send, metadata and voice paths capture their original target before awaiting. Late project/list/detail successes and failures are guarded, and delayed mutation results update only the originating workspace. No target switch or reload automatically executes a task.

Pending requests persist before dispatch, and persistence failure blocks dispatch. The exact original payload survives uncertain responses, target switching and reload; cleanup failure retains replay identity. Unknown operation IDs are target scoped, the legacy unscoped list migrates only to Mac, and a scoped empty list prevents legacy resurrection. Existing HTTP authorization assertions were retained; browser fixtures adapt routing while asserting exactly one Mac selector for legacy workflows.

## Independent Verification

Executed on the frozen files before integration began:

```sh
node --test apps/server/test/execution-target-ui.test.mjs apps/server/test/workspace-conversations.test.mjs apps/server/test/project-task-tabs.test.mjs apps/server/test/voice-composer.test.mjs apps/server/test/http-server.test.mjs apps/server/test/voice-client.test.mjs
```

Result: **90 passed**, zero failed/cancelled/skipped. `git diff --check db9841a` passed. These tests do not cover the definite metadata-conflict retry finding above.

Additional independent in-memory probes passed for pre-dispatch storage failure, original request ID replay after cleanup failure, operation lookup/reconciliation target capture, identical operation IDs on separate targets, late operation callback isolation, Mac-only legacy operation migration, scoped-empty legacy suppression and late Mac detail failure preserving Server feedback/input/output.

Independently parsed `/private/tmp/execution-target-selector-131-results.json`: desktop 1440x900, mobile 390x844, narrow 320x740 and landscape 844x390 behavior checks passed, errors were empty, controls remained in viewport, recovery did not overlap Send and the composer remained below tabs. Visually inspected narrow recovery, landscape Server, desktop Server and mobile unconfigured screenshots; layouts are coherent and usable.

I did not independently rerun Chromium. The author's documented browser run predates the final stale error/button, action-key, archive-feedback and legacy-operation fixes. The final 90-test run and my source-level probes ran after those fixes. The coordinator owns full integrated tests, coverage and final browser verification.

## Initial Frozen SHA256

```text
cda54a7e4943c8d4c82b09635419a747959722616f8ab6a09c4eef50fd3d1243 apps/server/public/index.html
97bf367f650a03d56a29e7ebd1072b6bc51d304209ca590d3a5f44928b28d806 apps/server/public/voice-client.mjs
e4e57f72a395318d2bca7b4972689d81454f7b49e6d0f46f01988b15bc5b3bea apps/server/test/execution-target-ui.test.mjs
```

No source, tests, Git or live services were changed; only this allocated report was written.
