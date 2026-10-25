# Device gateway fixture

Issue: #96, part of #93. Date: 2026-10-25. Evidence: fixture/local.

The server is a device gateway and UI host. Codex and the final task authority
remain on the Mac. The gateway does not call a server TaskService or execute a
shell. Task calls use the shared `task_rpc` method and argument validator.
Local controls are limited to `switch_task`, `focus_window`, and `open_project`.

`await createDeviceStore({root})` opens a private, owned, absolute state root
before the gateway can serve. The operator supplies this root; protocol inputs
cannot select paths. Pairing codes and device tokens are persisted as SHA-256
digests. A code is owner-bound, expiring and single-use; an existing device ID
cannot be replaced by another pairing. Each bounded ledger commit syncs the
temporary file, renames it, then syncs the containing directory before allowing
transport delivery. A directory-sync failure after rename blocks this store
with `outcome_unknown`; the operator must reopen it and reconcile persisted
operations. This fixture expects
one active store writer per root; multi-process locking and rotation are not
implemented. Only expired `task_rpc` read-method records may be reclaimed.
Write and local-control operation records retain their deduplication identity;
their capacity exhaustion fails closed and requires operator maintenance.

`createDeviceGateway({deviceStore})` exposes `startPairing`, `completePairing`,
`listDevices`, `submitCommand`, `getOperation`, `reconcile`, and
`connect(register, {send})`. The authenticated connection handle supplies
`receive(frame)` and `close()`. Only the current handle may submit a result;
replacing a connection invalidates the old handle, and its later close cannot
disconnect the replacement. Registration sends `connected` with `connectionId`;
commands use `{type: 'command', command: envelope}`. Heartbeats receive
`heartbeat_ack`. A task RPC result is the raw JSON `snapshot` value.
Pending work defaults to 64 calls (`limits.maxPending`), and input frame size
checks run before admission. Close invalidates its handle immediately and has
a bounded priority reserve of one call per connection. The outer listener must
also bound pre-registration sockets, message bytes and connection deadlines.

Mutations are serialized through durable reservation before transport delivery.
Identical request IDs return the stored outcome, conflicting intents fail, and
unknown results never replay. Restart and connection loss mark pending outcomes
unknown. Reconciliation sends an operation lookup to the authenticated agent.
An agent's `unknown` reconciliation receipt stays nonterminal and can later be
replaced by its final result without resending the command.
Commands that expire before delivery are expired; delivered commands without a
receipt become unknown at their deadline. Operation snapshots remain operation
evidence and never update current device state or lastSeen. Heartbeat snapshots
require canonical ISO `agentObservedAt`; only a strictly newer observation may
replace the cached current snapshot. Its observedAt and receivedAt are distinct;
old or duplicate observations can update heartbeat liveness without refreshing
the cached observation. Device views preserve lastSeen while offline.

Verification on Node v26.0.0/macOS:

- Focused RED/GREEN regressions reproduced owner replacement, missing
  persistence, connection identity/registration, concurrent duplicate sends,
  raw RPC array receipts, limit misspellings, expiry during durable writes and
  protocol identifier recovery before the corresponding fixes. Review fixes
  additionally reproduced unbounded pending work, missing directory sync,
  stale receipt promotion and exhausted read-poll ledgers before repair.
- `node --test apps/server/test/device-store.test.mjs apps/server/test/device-gateway.test.mjs apps/server/test/device-boundary.test.mjs`: 26 passed.
- `node --test apps/server/test/*.test.mjs`: 110 passed.
- `npm run test:policy`: 62 passed.
- `git diff --check`: passed; scoped source is not committed by the worker.

No listener was started or deployed. Real Mac execution, Keychain,
Accessibility, TLS/WSS, phone, Linx and outdoor/network acceptance remain
unverified. Shared protocol and composition changes are coordinator-owned and
require their own tests and independent reviews before integration.
