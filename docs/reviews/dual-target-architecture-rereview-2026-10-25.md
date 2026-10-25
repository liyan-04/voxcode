# Issue 128 Final Targeted Architecture Review

Disposition: **PASS**. The post-mutation detail-read P2 from `/private/tmp/voxcode-128-unknown-architecture-review.md` is resolved by this frozen revision. No new actionable findings identified within this narrow rereview.

Reviewed `/private/tmp/voxcode-128-dual-target-integration`, limited to the helper correction and four new HTTP regressions. `execute()` is entered after a successful start or continuation; its catch now normalizes ambiguous intermediate read failures to `outcome_unknown` even before confirmation is acknowledged. It retains the known task ID and original submission request ID. This preserves the unresolved overall submission without asserting that execution occurred. The initial read before continuation remains outside this normalization and keeps its prior classification with no mutation effects.

Independently executed:

```sh
node --test apps/server/test/task-submission.test.mjs
git diff --check
```

Result: **23/23 passed**, zero failed/cancelled/skipped, exit 0. Diff check passed. The four new HTTP cases cover after-start and after-continuation reads, each with `deadline_exceeded` and a raw Error. They verify HTTP 409 unknown with the original identity, no confirmation before retry, one task/turn after same-identity retry and exactly one confirmation. The existing pre-continuation read regression preserves its original read error without mutation effects.

An independent in-memory probe using real local HTTP and the actual server/helper rechecked the original failure shape for start with a deadline error and continuation with a raw Error. Both first responses were 409 `outcome_unknown` with `task-1` and `original`. Explicit same-identity retries produced:

```json
[{"kind":"start","firstStatus":409,"firstCode":"outcome_unknown","preservedIdentity":"original","commits":1,"confirmations":1,"turns":1},{"kind":"continue","firstStatus":409,"firstCode":"outcome_unknown","preservedIdentity":"original","commits":1,"confirmations":1,"turns":2}]
```

Independently computed SHA256 values match the coordinator's final freeze:

```text
397659803ba86fca115e3898dc02608155dc2f9f42f829c66d553156e62ca3ba apps/server/task-submission.mjs
b79cfe131f93e90139d6902da3bd8f57b85c542d04cab412e7b415a2c097d450 apps/server/test/task-submission.test.mjs
```

The original nine-file routing review and earlier mutation-boundary review are unchanged context; this rereview did not repeat their broader suites. Coordinator integration/full-suite verification and live deployment/device acceptance remain separate. No source, tests, Git or live services were changed; only this allocated report was written.
