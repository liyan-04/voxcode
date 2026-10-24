# Web project/task workspace: independent delivery review

Reviewer: `/root/delivery_reviewer`. Date: 2026-10-25 (Asia/Shanghai). Issue #74 / PR #86, reviewed commit `4e02ead`. Independent of implementation; no code, Git, credential or remote changes. AI review evidence is not human approval.

## Snapshot

- `apps/server/http-server.mjs`: SHA-256 `3a291ff3ac5810c3ac0f411983de22cad93e54ef40b74cc0a96a610ad701cca3`.
- `apps/server/public/index.html`: SHA-256 `cb2f594cd7619673063b37f7870b779c2531502cc047ffc3104511d671abfed6`.
- `apps/server/test/http-server.test.mjs`: SHA-256 `4800f6dc25d603bd97009363d2c89eb7e52ce1a07504dc6cc60676b008034c70`.

## P1 — Execution confirmation permits missing revision/requestId

Location: `http-server.mjs:43`; related create/cancel routes at `:34` and `:44`.

Metadata mutations enforce version and identity, but confirm forwards optional revision/requestId unchanged. Current CLI/project-service compatibility permits absent revision, so an authenticated `POST /api/tasks/:id/confirm` with `{}` starts the current draft without the required CAS or durable request identity. Create and cancel similarly do not require requestId at this public boundary. This bypasses the frozen version/identity contract and prevents reliable uncertain-response reconciliation.

Actual Node 22 HTTP reproduction with a valid login/Origin and controlled draft adapter:

```json
{"case":"confirm without revision/request identity","status":200,"forwarded":{}}
```

Fix: require a bounded nonempty requestId for create/confirm/cancel; require a positive safe-integer revision for confirm before invoking the adapter. Keep internal legacy adapter compatibility separate from the browser API. Add missing/invalid identity/version regressions and assert no adapter call. Existing tests currently accept create without requestId and should be updated to the actual contract.

## P1 — New typing is erased when a pending create succeeds

Location: `public/index.html:79`.

During a create request the send button is disabled but the textarea remains editable. On success the handler unconditionally deletes the submitted target's draft, then empties the textarea if the target key matches. It does not check whether the user typed more requirements while waiting. It also opens the new task and moves away from that new input. The request sent only the original prompt; the added requirement is silently lost.

Reproduced by executing the actual extracted onsubmit handler with a held API promise, editing the input/draft during that promise, then resolving the creation. Actual result:

```json
{"case":"typing while create pending","input":"","savedDraft":null}
```

Fix: capture submitted draft identity/version and clear only when the current saved content still matches. Preserve newer text and current target rather than auto-navigating away; alternatively make that exact target's input read-only while pending with clear feedback. Cover same-target edits, switch-away/switch-back, and delayed successful create in a frontend regression. Do not move newer text into the just-created task without explicit user action.

## P2 — Late detail responses can roll back fresh task state

Location: `public/index.html:65`, `:74`.

`loadTask` checks only current task/project, not request generation or task revisions. A detail response requested before a newer list refresh or another detail read can arrive last and overwrite `state.snapshot` and `state.tasks` with older draft/metadata state. It can re-show confirm or outdated archive/delete controls. Server-side CAS can prevent the action only once the missing-confirm-CAS P1 is fixed; the visible status is still wrong.

Actual extracted-handler repro: begin a held draft detail read, populate fresh list state `running/revision:2`, then release the draft response. Result: `snapshot:'draft', taskList:'draft'`. Use per-target request generation and compare both execution revision and metadataRevision before applying a response; increment generation across target changes/close and mutation refreshes. Add a reordered-response regression.

## P2 — Persisted initial requirement is not rendered after completion

Location: `public/index.html:71`.

Conversation renders only `task.prompt`. The CLI deliberately removes prompt after terminal completion, while the new project service preserves it as `initialPrompt`. Completed and restored tasks therefore show “原始指令未提供” despite the server retaining the original requirement. Render the persisted initialPrompt fallback; label this as the initial message plus bounded output, not complete Codex conversation history.

## Confirmed

- Login cookie is HttpOnly/Secure/SameSite, server-side expiry/max-session limits apply, and POST API Origin must match exactly.
- Project list excludes server paths; task list and detail/mutation project checks prevent explicit cross-project spoofing.
- Metadata mutation types, active/quarantined guards, parent same-project/nondeleted checks and strict visibility flags have HTTP coverage.
- Soft deletion/restoration and tab closure do not imply deleting files, cancelling tasks or resuming model execution.
- Dynamic task/project text is inserted with textContent; no model HTML rendering was found.
- Voice and resume remain visibly unavailable instead of pretending execution.

## Verification and disposition

`/Users/liyan2026mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/node --test apps/server/test/http-server.test.mjs`: **9/9 passed**, macOS/Node 22.22.2. `git diff --check`: passed. Additional reproductions used actual HTTP handler and extracted production frontend handlers with controlled asynchronous dependencies; no browser/device/live verification was performed by this reviewer.

Resolve both P1 findings, add targeted regression tests and perform independent follow-up review before ready/merge. A Draft PR is appropriate for this snapshot. Real browser, phone, WebSocket microphone and deployment acceptance remain pending.
