# Issue 114 core continuation independent review

Reviewer: linx_audit, independent of gateway_impl. Date: 2026-10-25.
Scope: all eleven frozen changed files in
`/private/tmp/voxcode-114-task-continuation`; no source or Git mutations.
Base: `50cab45cafb2d49b525ce7e1be8319016e079339`.
Handoff: `/private/tmp/voxcode-114-core-handoff.md`.

## Result

PASS for the frozen core component. No actionable findings in these eleven
files. This is not complete browser/Mac continuation delivery or user
acceptance. The UI integration requirement below remains mandatory.

## Reviewed behavior

- Continuation creates a draft on the existing task and requires an independent
  confirmation with its new revision. Only the saved UUID chooses the resumed
  conversation. HTTP, Unix RPC, remote facade and shared protocol reject
  injected session selectors or unexpected arguments.
- Earlier turns retain their prompts, results, logs and terminal metadata;
  failed draft persistence does not publish a speculative RAM state. Legacy
  records receive an in-memory initial turn, with missing prompts marked.
- Request identities and fingerprints prevent continuation duplication and
  conflicting reuse. Service pending receipts reconcile a persisted turn.
  Earlier per-turn confirmation identities cannot launch a later draft.
- Archived/deleted tasks cannot continue, running tasks and stale revisions are
  rejected, quarantine retains conservative execution ownership, and the
  existing service confirmation lock continues to enforce one global slot.
- A resumed session mismatch latches rejection before stopping: later same-chunk
  and subsequent stdout plus stderr cannot overwrite the mismatch, UUID, logs,
  result, retained history or conversation recency.
- Recency changes for accepted user prompts and completed agent messages;
  reads, polling, confirmation and command feedback do not refresh it.
- List replies contain bounded primitive summaries after service decoration;
  internal reconciliation uses full records through a non-network method.
  Full individual histories remain available via getTask. The actual Unix RPC
  regression covers two histories above 500000 bytes without expanding lists.

## Independent verification

From the worktree root:

```sh
node --test apps/server/test/codex-cli-adapter.test.mjs apps/server/test/project-service.test.mjs apps/server/test/task-rpc.test.mjs apps/server/test/remote-task-adapter.test.mjs apps/server/test/http-server.test.mjs packages/control-protocol/test/protocol.test.mjs
git diff --check
```

Result: 78 tests passed, zero failed/cancelled/skipped; diff check exited 0.
The POSIX descendant test explicitly reported host EPERM for a negative-PGID
liveness check and verified conservative slot quarantine. This does not prove
successful descendant cleanup on this host.

Inspected the actual CLI probe and ran its evidence-only verifier:

```sh
node /private/tmp/voxcode-114-resume-probe.mjs --verify /Users/liyan2026mac/Documents/ChatGPT/1024/voxcode-resume-proof-Q6swGJ
```

Result: exit 0; sameSession, nonceConversationMemory, firstInProjectWrite,
siblingCanaryUnchanged and siblingWriteToolDenied were all true. The probe
uses identical project cwd and private CODEX_HOME, exact saved UUID, and
`exec --sandbox workspace-write resume --json SAVED_UUID -`.
The denial fallback matches the exact exec custom_tool_call call_id to its
parsed tool output and requires a real nonzero permission-denied result for
the synthetic sibling canary. It does not trust the assistant's textual claim.
Evidence applies to installed CLI `0.164.0-alpha.11.1` and the recorded provider
configuration. No model, live provider or Mac task was started during this
review. Private copied config and raw transcripts must not be committed.

## Integration requirements and limits

The preexisting browser in this worktree assigns a list result to
`state.snapshot` in `apps/server/public/index.html:98`. With the new summary
contract that would erase prompt/output/turns on polling. The coordinator
already owns the pending UI change: keep summary data separate from full
detail and loadTask/getTask for the selected task after refreshing; verify
polls preserve every retained turn and update the current turn. This core PASS
does not waive that requirement before user-facing continuation delivery.

The actual raw CLI resume proof is separate from adapter fixtures. Real
HTTP -> gateway -> Mac Agent -> TaskService continuation, composed browser
behavior, deployment and user acceptance remain coordinator gates. getDiff
and getChecks remain explicit uncollected placeholders. No claim is made for
voice MCP, phone, public WSS or outdoor acceptance by this review.

## Frozen SHA256

All hashes independently matched the handoff:

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
