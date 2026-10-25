# Issue 114 independent core review

Reviewer: mac_agent_probe, independent of gateway_impl implementation.
Date: 2026-10-25. Worktree: `/private/tmp/voxcode-114-task-continuation`.
Base HEAD: `50cab45cafb2d49b525ce7e1be8319016e079339`; reviewed the uncommitted 11-file content snapshot listed below. No source, Git or live state was changed.

Latest disposition: PASS for the corrected core snapshot below. Both original P2 findings are resolved by source inspection, 78 independently executed focused regressions and the two updated external probes. No remaining core P0/P1/P2 finding identified. The older findings and hashes are retained below as historical evidence.

## Corrected Snapshot Follow-Up

Date: 2026-10-25. The 11 current file hashes were independently computed and match the updated handoff exactly. Review remained read-only for repository source, Git and live state; only this report and the two external probe assertions were updated.

Session mismatch: the execution-local `sessionRejected` latch is set before stopping. `entry.event` refuses later same-chunk events, the stdout data handler refuses subsequent chunks, and stderr no longer overwrites the mismatch error. The adapted `/private/tmp/review-114-mac-probe.mjs` passed with same-chunk and later-chunk agent content plus later stderr before asynchronous process close. Output/current-turn output and logs stayed empty, saved UUID and prior turn stayed intact, recency equaled the accepted draft timestamp, and the explicit mismatch error remained on both task and current turn. The repository regression additionally checks later command events and a matching-session event after rejection cannot reset the latch. Original P2-1 is closed.

List/history transport: `summarizeTask` allowlists bounded primitive fields, omitting prompts, turns, output, logs and request identities. Adapter `listTasks` uses summaries. `listTaskRecords` retains full local records for service lookup, replay and reconciliation and is absent from the network allowlists. ProjectService's internal `all` uses full records, while its public list applies summarization after metadata decoration, preventing `initialPrompt` from re-expanding replies. Full `getTask` remains unchanged. Original P2-2 is closed.

The adapted `/private/tmp/review-114-history-probe.mjs` passed through actual Unix RPC: each individual full task remains 547895 bytes with all 18 turns, their combined full content is 1095793 bytes, and their successful summary list is only 483 bytes. Original prompt/result strings remain intact, and the local full-record path still exposes retained history. The independently executed service tests cover large decorated initial metadata, actual CLI-store reconstruction, task ownership/request replay, and recovery of a pending durable continuation receipt after the final ledger write fails.

Executed again:

```sh
node --test apps/server/test/codex-cli-adapter.test.mjs apps/server/test/project-service.test.mjs apps/server/test/task-rpc.test.mjs apps/server/test/remote-task-adapter.test.mjs apps/server/test/http-server.test.mjs packages/control-protocol/test/protocol.test.mjs
node /private/tmp/review-114-mac-probe.mjs
node /private/tmp/review-114-history-probe.mjs
git diff --check
```

Results: 78 passed, 0 failed; both external probes exit 0; whitespace check exit 0. No model or service was launched. The actual installed CLI evidence verified in the initial review was not changed or rerun as a model.

Downstream UI integration dependency, communicated to the coordinator for #124: this tree's existing `public/index.html:98` still replaces `state.snapshot` with a list result during polling. With summary lists, the UI must fetch/retain a full selected-task detail rather than treating a summary as complete conversation content. This core review does not certify deployment of the old page against the new list contract. The core fixes can be integrated independently; combined browser release must satisfy this dependency. Finite summary fields remove history-driven amplification but are not a claim of unbounded task-count pagination.

Corrected reviewed hashes:

```text
4d2ac5d8556281e804f2a25458c42323f43cd27b2b51af2bed415db76f658eec apps/server/codex-cli-adapter.mjs
9f4161fae8cd37abf88a3a38ecb2672b32ade78bb6242eb9d0958d7d4ba48a23 apps/server/project-service.mjs
0fabd9e0fd6a048927daf783e5d4b681aa8c8c44be79944bf24ccaef343f0cc2 apps/server/task-rpc.mjs
1996de5156474d1d27f11888acd92a751a8edcc26babd3484f015ca5676364b0 apps/server/http-server.mjs
a17fa89f6bad0b3086e7924d9761e0a52680a155311054096e3d76ee9b41e828 apps/server/test/codex-cli-adapter.test.mjs
48b984b2a800a22bd48b245dd1ad327bf4904a29b9f7b28381ec4a20a210d1b3 apps/server/test/project-service.test.mjs
6fc4c9d5d308a72acaf06abf5b0a260cc17516a4d108962a58b5449b4a74c4cb apps/server/test/task-rpc.test.mjs
d9c64f72c472662c774156092639317e57684053df65c71f076f8056bc69729c apps/server/test/remote-task-adapter.test.mjs
5467b64e11e1291596248e24ecf964046cc068194fc304c799746b1ad14d8bc7 apps/server/test/http-server.test.mjs
e2b426bb0ddc8cbd4d2e8155fd2752a2861b4204ab4c1b35f9f7be52b14a037b packages/control-protocol/index.mjs
09e8102180898e0cafc1ffed783e192db76b953a242f2ccdc788b2aad1230056 packages/control-protocol/test/protocol.test.mjs
```

## Original Findings (Resolved)

### P2: reject remaining output after a resumed session mismatch

Location: `apps/server/codex-cli-adapter.mjs:105`, also event handling at line 108 and the stdout line loop at line 180.

The mismatch branch quarantines the task and starts asynchronous termination, but does not latch rejection of subsequent events. If one stdout chunk contains a mismatched `thread.started` followed by an `item.completed/agent_message`, and the child does not close synchronously on TERM, the line loop still processes the wrong session's message. It writes that text into both task output and the pending turn, and bumps `lastConversationAt`. The saved session ID remains the original, making the mixed evidence particularly misleading. Quarantine prevents further execution but does not prevent contaminating the result/history exposed to callers.

Independent reproduction: `node /private/tmp/review-114-mac-probe.mjs` exited 0 against the real adapter. The synthetic child acknowledges termination but closes asynchronously, as a real child normally would. Output:

```json
{"quarantined":true,"output":"WRONG SESSION OUTPUT","turnOutput":"WRONG SESSION OUTPUT","previousTurnOutput":"original output"}
```

Suggested fix: latch a session-mismatch state and ignore all subsequent content events once set; retain the explicit mismatch quarantine error and complete cleanup. Add a regression with mismatch plus a later agent message in the same stdout chunk, and another chunk before process close. Assert that output, current-turn evidence and conversation recency are not updated from rejected events.

### P2: bound task-list responses independently of individual task history

Location: `apps/server/codex-cli-adapter.mjs:193`; the new individual-history guard is at line 66. `apps/server/project-service.mjs:99` forwards complete tasks, and `apps/server/task-rpc.mjs:34` rejects responses over 1 MiB.

The 600000-byte continuation guard bounds a single task, but `listTasks` now returns every task's complete retained turn history. Two individually valid tasks can exceed the 1 MiB transport response limit, causing the entire list to become `response_too_large`. The browser's refresh depends on task lists, so it loses the project task set even though each task remains readable on its own. Retained continuation histories make this reachable with a small number of ordinary multi-turn tasks rather than only a large original task count.

Independent reproduction: `node /private/tmp/review-114-history-probe.mjs` exited 0. It seeds two tasks with 17 historical turns each (12000-character prompts and 20000-character outputs, both within existing per-field limits), calls the actual adapter's `continueTask` successfully for each, then calls real Unix RPC `getTask` and `listTasks`:

```json
{"perTaskBytes":[547895,547895],"listBytes":1095793,"listError":"response_too_large","eachContinuationAccepted":true}
```

Suggested fix: return bounded task summaries from the transport-facing list path and fetch full retained turns through `getTask`, or introduce explicit pagination with an aggregate byte budget. Keep internal service lookups/reconciliation able to access full tasks. Do not discard older turns to fit lists. Add a real RPC regression proving two near-limit histories remain listable and individually retrievable.

## Source checks

- Continuation resolves only the selected task's persisted UUID and emits the proven `exec --sandbox workspace-write resume --json UUID -` command in the configured canonical cwd. There is no `--last` or silent new-session fallback.
- New instructions create a draft, increment the execution revision and retain prior completed prompts/results/events. Launch remains a separate confirmation mutation.
- HTTP, Unix RPC, shared network protocol and service validation reject a client-selected continuation session and extra continuation fields. Network writes require revision and request identity.
- Service routing preserves the original project, checks archived/deleted visibility, and uses the durable mutation ledger. The adapter rejects nonterminal tasks, stale revisions, absent UUIDs and quarantined state. Existing global execution/quarantine behavior is preserved.
- Adapter draft publication occurs after persistence. Durable pending continuation receipts reconcile saved turns after a failed final ledger write, and unchanged unapplied requests can retry. Per-turn confirmation identities prevent an old confirmation replay from launching a later draft.
- Terminal history is cloned before append; cancellation and normal completion retain earlier turns. Legacy task migration marks unavailable prompt history rather than inventing it. The original ProjectService `initialPrompt` stays separate.
- Initial/continuation prompt acceptance and completed agent messages update recency; reads, polls and command feedback do not. Command/file events carry bounded structured fields and timestamps. The two findings above are gaps in output isolation and aggregate transport bounds, not failures of the basic draft/confirm design.

## Independently executed validation

Environment: Darwin arm64, Node.js v26.0.0.

```sh
node --test apps/server/test/codex-cli-adapter.test.mjs apps/server/test/project-service.test.mjs apps/server/test/task-rpc.test.mjs apps/server/test/remote-task-adapter.test.mjs apps/server/test/http-server.test.mjs packages/control-protocol/test/protocol.test.mjs
```

Result: 75 passed, 0 failed. The POSIX group test reported host EPERM on negative-PGID liveness and verified conservative quarantine. `git diff --check` passed.

```sh
node /private/tmp/voxcode-114-resume-probe.mjs --verify /Users/liyan2026mac/Documents/ChatGPT/1024/voxcode-resume-proof-Q6swGJ
```

Result: exit 0; installed CLI `0.164.0-alpha.11.1`, sameSession, nonceConversationMemory, firstInProjectWrite, siblingCanaryUnchanged and siblingWriteToolDenied all true. This is a read-only recheck of coordinator-produced actual CLI evidence, not a newly launched model run. No copied provider config or raw private transcript was printed or included in this report. It supports this installed CLI's resume semantics; it does not certify future CLI versions or deployed browser/server integration.

The two external probes are synthetic targeted reproductions against actual production modules, not modifications to repository tests. Their passing assertions establish the reported erroneous behavior. No broad test counts were inferred from the handoff summary.

## Original Reviewed Snapshot SHA256

```text
0a36c8cb3d25e7031432dd75dcb69c061045891917c2a8983ff619e2b0dfc61e apps/server/codex-cli-adapter.mjs
2e7d59a8c75d2f1f51e1f7143d8c28bc3c65fae4e16300cdb8d19e1af514a192 apps/server/project-service.mjs
0fabd9e0fd6a048927daf783e5d4b681aa8c8c44be79944bf24ccaef343f0cc2 apps/server/task-rpc.mjs
1996de5156474d1d27f11888acd92a751a8edcc26babd3484f015ca5676364b0 apps/server/http-server.mjs
e2b426bb0ddc8cbd4d2e8155fd2752a2861b4204ab4c1b35f9f7be52b14a037b packages/control-protocol/index.mjs
a437e076ac761b6e241d9c3831789362132e8ee37faeca2bfc83ad817d29d1f0 apps/server/test/codex-cli-adapter.test.mjs
8763542d30accd7ab573891d9a63f5a13d8b9671b79e8b297caecb2949e277f7 apps/server/test/project-service.test.mjs
ac98291083b5703108ed3f930bfe598a93066b42d80a576d0880eab6b3e6a19a apps/server/test/task-rpc.test.mjs
5467b64e11e1291596248e24ecf964046cc068194fc304c799746b1ad14d8bc7 apps/server/test/http-server.test.mjs
d9c64f72c472662c774156092639317e57684053df65c71f076f8056bc69729c apps/server/test/remote-task-adapter.test.mjs
09e8102180898e0cafc1ffed783e192db76b953a242f2ccdc788b2aad1230056 packages/control-protocol/test/protocol.test.mjs
```

Remaining evidence outside this review: additive voice HTTP and #124 browser integration, actual full server/Mac/browser continuation workflow, deployment and user acceptance. The two original core fixes and targeted re-review are complete. Other independent review is coordinator-owned. getDiff/getChecks remain explicit uncollected placeholders. No live, microphone, Linx, Safari/iPhone or outdoor validation was performed by this reviewer.
