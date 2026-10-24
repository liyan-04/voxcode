# Codex CLI lifecycle: independent delivery review

Reviewer: `/root/delivery_reviewer`, independent of implementation. Date: 2026-10-25 (Asia/Shanghai). Issue #72. No Git, remote, credential or real-model operations. AI review evidence does not constitute human approval.

## Exact snapshot

Base: `5a7edf6` plus these uncommitted component files:

- `apps/server/codex-cli-adapter.mjs`: SHA-256 `737d3c77683ee6476576132a38850227c29ea310b487e4ce7c497791a2902f72`.
- `apps/server/task-store.mjs`: SHA-256 `9361e937c9193634b4ec63228c8a7b2ed0d19be353d9f380a2b58ae538662747`.
- `apps/server/test/codex-cli-adapter.test.mjs`: SHA-256 `55644e2de7f4b0640449209916dacaf6e4979004dbc27652cc597781b6fa9387`.

## P1 — Cancellation races the incomplete execution entry

Location: `codex-cli-adapter.mjs:19`, `:22`–`:25`, `:31`.

`confirmTask` publishes the entry in `running` and mutates the task to running, then awaits persistence before creating `entry.closed` and assigning `entry.stop`. `cancelTask` is not under the same serial lock and assumes those members already exist. A cancellation arriving while that write is pending throws `e.stop is not a function`; once persistence finishes, the task starts anyway. When confirmation persistence fails, the reserved entry can remain permanently uncancellable with the same incomplete structure.

Reproduced with a controlled store that pauses the first `running` write, then calls `cancelTask`, releases the write, and closes the fixture child. Actual output:

```json
{"case":"cancel during confirmation store write","cancelResult":"e.stop is not a function","spawnCount":1,"status":"completed"}
```

Fix requirements: initialize a complete, cancellable starting entry before publishing it, or serialize mutation acceptance so cancellation can safely wait for/start-stop the entry. Preserve cancellation intent across persistence and prevent a launch after cancellation has won. Add a barrier regression for cancel during confirmation save and a regression for cancel after confirmation save failure. Avoid blocking the entire service behind an unresolvable entry.

## P1 — Persistence failure prevents stopping and makes retries ineffective

Location: `codex-cli-adapter.mjs:24`, `:27`, `:29`, `:31`.

`stop()` sets `entry.stopping=true`, then awaits `save(t)` before sending TERM and installing escalation. A store error rejects before either signal. Subsequent calls return immediately because `stopping` is true, and `cancelTask` waits forever for a process that was never signalled. Timer/stdout callers use `void stop()` without a rejection handler, so this error can also become an unhandled rejection and terminate the service process.

Reproduced using a real adapter and a store that rejects only the first cancelling-state write. After restoring writes, retrying cancellation still sent no signals and remained pending beyond the configured grace period. Actual output:

```json
{"case":"retry stop after recovered persistence error","first":"fixture disk full","second":"still pending","signals":[],"status":"cancelling"}
```

Fix requirements: process termination and escalation must not depend on successfully persisting the cancelling status. Record persistence failure/quarantine conservatively, retain the slot until cleanup is proven, and make repeated stop requests share an actual stop operation or safely retry it. All background stop paths need observed rejection handling. Add regressions for persistence failure, recovered retry and timeout-triggered stop failure.

## P2 — Bounded task snapshots do not bound persistence backlog

Location: `codex-cli-adapter.mjs:26`, `task-store.mjs:14`–`:23`.

Every parsed event clones and queues a complete task-state rewrite. Logs/output are bounded, but the number of pending promises and full-file writes is not. A fast CLI event stream on a slow disk can therefore grow memory and delay terminal-state persistence indefinitely. The event buffer cap does not bound the queue after individual lines have been parsed.

Consider coalescing nonterminal snapshots, applying bounded producer backpressure, or keeping a bounded append/event log with periodic snapshots. Final transitions and mutation receipts must remain explicitly awaited. This is not proof of a live failure; it is a missing resource bound in the source design.

## Verification

- `node --test apps/server/test/codex-cli-adapter.test.mjs`: **11/11 passed**, Node 26 on macOS. The real descendant test took its documented EPERM quarantine branch; successful Linux descendant cleanup remains unverified.
- Two independent local repro scripts ran with `createCodexCliAdapter`, EventEmitter child fixtures, temporary state, and injected store failures/barriers. Neither spawned a real model or signalled an actual PID; both produced the outputs above and cleaned temporary directories.
- `git diff --check`: passed.
- Inspected task store serialization, task restoration, request identity, version checks, output parsing and process cleanup code.

## Disposition

Publishable as a **Draft PR** with these explicit findings. Resolve both P1 findings and run targeted regressions plus independent follow-up review before ready/merge/deployment claims. Keep resume, real diff/checks, Linux process cleanup, dedicated account isolation and live model execution as separate pending gates. The current bounded output is not full conversation history.

## Follow-up after lifecycle repair

Independently reviewed the repaired source on 2026-10-25:

- Adapter SHA-256 `aba70b6e1b1c55f4b345172721bdc1c8faa46d49298b111e480cf0318a21f0c3`.
- Store unchanged at `9361e937c9193634b4ec63228c8a7b2ed0d19be353d9f380a2b58ae538662747`.
- Test SHA-256 `d2b70a304b9316f639bf1860c7ed68b2d7f7aad2e48bb0ac9b2350411b1d9696`.

Fresh Node 22.22.2 run: **18/18 passed**, including confirmation-save cancellation, save failure with cancellable entry, stopping failure and retry, timeout rejection, coalesced event writes, event-save failure and terminal-save quarantine. `git diff --check` passed. The macOS real descendant fixture still follows the explicit EPERM quarantine branch; this does not establish Linux cleanup.

Re-ran both original independent reproductions against the repair. Cancellation while running-save is blocked now prevents launch:

```json
{"case":"cancel during confirmation store write","spawnCount":0,"status":"cancelled","quarantined":false}
```

Cancelling-state persistence failure now sends TERM/KILL, permits both stop waiters to finish and retains quarantine instead of silently releasing the slot:

```json
{"case":"retry stop after recovered persistence error","signals":["SIGTERM","SIGKILL"],"states":["cancelled","cancelled"],"quarantined":[true,true],"activeTasks":1}
```

Both P1 findings are addressed in this exact snapshot. Event persistence now coalesces snapshots with one writer and explicitly orders terminal persistence after prior writes, addressing the P2 backlog finding. No new P1 identified in this targeted follow-up. The component may proceed through its second independent code review and scoped source integration; real Linux/model/deployment gates remain open.
