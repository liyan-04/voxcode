# Mac Agent Fixture Evidence

Issue: Refs #95. Part of #93. Date: 2026-10-25.

## Scope And Historical Audit

Base: `origin/master` `e25485e`, macOS arm64, Node.js v26.0.0. The assigned changes
are limited to `apps/mac-agent/**` and this report. The coordinator supplied
`packages/control-protocol/index.mjs` as the shared contract dependency.

The historical `.worktrees/mac` bridge owns its own local task HTTP service,
durable Codex sessions and approval rules; it does not implement the new device
gateway protocol. Its worktree has pre-existing dirty files and was not edited.
The historical `.worktrees/relay` implements a machine-authenticated outgoing
connector and request forwarding with heartbeat/reconnect behavior. Current
master retains the private Unix task RPC client and service, but no Mac agent
gateway. The new agent reuses that local RPC client rather than restoring the
historical HTTP bridge or executing Codex on the VoxCode server.

## Verification

```sh
npm ci --ignore-scripts --cache /private/tmp/voxcode-mac-agent-npm-cache --prefix apps/mac-agent
node --test apps/mac-agent/test/*.test.mjs
VOXCODE_GATEWAY_FIXTURE_ROOT=<gateway-checkout> node --test apps/mac-agent/test/*.test.mjs
git diff --check
```

The dependency installation completed with one pinned dependency and zero audit
findings. Before the latest independent review, the prior full suite passed 19/19
with the real gateway selected, or 18 passed / one explicit gateway skip without
that checkout. The latest review fix was verified with the focused command below,
not by rerunning that original full suite.
Evidence class: `fixture` and `local`.

The suite exercises matching registration/connected handshake, pre-handshake
denial, serial execution, persisted request replay, changed-payload and operation
conflict, revision rejection, TTL/capability/device rejection, unknown inflight
recovery, stale socket generation filtering, Keychain CLI arguments, TLS guards,
fixed local capability arguments and task RPC allowlists.

One test opens a real local WSS server using a generated temporary certificate
and explicitly trusted CA. It proves registration, heartbeat acknowledgments,
raw RPC result return, reconnection and same-command deduplication. A normal
untrusted client rejects that certificate. Another test uses the actual protected
Unix RPC server/client against a synthetic adapter. No model is launched.

## Integration Review Corrections

Four reviewer findings were first reproduced with failing regressions: actual
gateway heartbeat rejection/reconnect, unsupported reconcile frames, open_project
requiring a removed task/revision field, and a second agent opening the same ledger.

The corrected client sends identity-bound heartbeats and accepts only a current
connection/device acknowledgment. Reconcile reads committed ledger records and
never executes a command: completed receipts replay; inflight/missing/identity
mismatches return unknown. Shared envelope validation now owns the operation
shape, including task-free open_project. An exclusive private lock guards the
ledger, is released by clean close, and refuses stale locks until explicit human
reconciliation. Regression tests cover these behaviors and invalid heartbeat ACKs.

The actual gateway fixture uses the latest `93-gateway` worktree modules through
an injected transport. It verifies multiple heartbeat intervals with one stable
connection, command results, a lost completed receipt reconciled from the Mac
ledger, and both inflight and missing ledger outcomes reported unknown. Capability
call counts prove reconcile does not dispatch again. Real WSS/TLS remains covered
by its separate local fixture. Server/shared files were not edited by this worker.

The subsequent polling-capacity finding was also reproduced before implementation:
read-only status requests filled the same permanent ledger as mutations. Entries
now retain explicit readOnly/expiresAt metadata; valid new commands prune expired
read receipts and expired unknown reads before capacity checks. Writes, unknown
writes, running reads and legacy entries without read-only metadata remain
reserved. Three regressions use maxEntries=1, an injected clock, actual wall-clock
expiry and clean restarts to prove read capacity is reclaimed while mutation
receipts survive their envelope expiry.

## Latest Independent Review Corrections

Review source: `mac-agent-review-gateway.md`, reviewed by the independent gateway
implementation worker. Its business-ID, uncertain-result and path-trust findings
were reproduced in six failing focused tests before the implementation change.

The task adapter now forwards the shared-validator-cloned argument array without
comparing or replacing its business requestId. Gateway/agent operation identity
remains the separate outer requestId. Unknown/deadline/unavailable/oversized or
invalid reply errors stay nonterminal unknown, retain a durable reservation, and
are never redispatched by request replay or reconcile. A result that cannot be
encoded after successful execution is also unknown rather than failed.

Configuration and ledger parent/ancestor ownership, permissions and canonical
paths are validated before access. Private JSON uses one O_NOFOLLOW file
descriptor for fstat/read and rejects multiple hardlinks, non-regular files and
unsafe modes. A fixture replaces the config pathname after fstat and proves the
original descriptor still determines endpoint and Keychain service. Only synthetic
Keychain outputs are used.

Latest command (gateway checkout supplied locally):

```sh
VOXCODE_GATEWAY_FIXTURE_ROOT=<gateway-checkout> node --test \
  apps/mac-agent/test/review-regressions.test.mjs \
  apps/mac-agent/test/gateway-integration.test.mjs
# 8 passed, 0 failed/skipped
```

The targeted checks include an actual Unix TaskService call with differing outer
and inner IDs; a real RPC deadline followed by TaskService commitment; a committed
write whose oversized RPC reply is rejected; unknown-error receipt replay; local
result serialization failure; writable ancestor rejection; same-FD configuration
replacement; and actual gateway-to-agent-to-Unix-RPC argument preservation. The
gateway fixture waits for three heartbeat frames with a 100 ms interval, avoiding
an artificial 30 ms ACK deadline while disk persistence tests run concurrently.

## Read-Only macOS Probe

Only service metadata, existence checks and CLI version output were examined.
No keychain item, token, certificate identity, application credential, configuration
content or TCC database was read. No OS control, deployment or launchd installation
was performed.

| Probe | Observation | Limit |
| --- | --- | --- |
| `launchctl print-disabled system` | System service metadata is queryable. | Does not establish an installed VoxCode agent. |
| `launchctl list` | Current user-domain query unavailable in this execution context. | User LaunchAgent state remains unverified. |
| `security list-keychains` | Two configured keychain paths; paths omitted. | No generic-password item read and no unlock tested. |
| `codex --version` | `codex-cli 0.154.0`. | No authentication or model task tested. |
| Accessibility | Not verified; System Events check unavailable in this context. | No TCC content read or permissions changed. |
| Linx configuration | Common `~/.linx`, `~/.config/linx` and Application Support Linx/Chinese-name directories absent; no matching app found in `/Applications`; no matching environment variable names present. | Does not exclude other configuration locations or a remote/provider setup. |

## Remaining Gates

The CLI and LaunchAgent template are prepared but not installed. Actual Keychain
token retrieval, live gateway registration/TLS, local Codex task service/model
execution, native window/project actions, launchd restart, Linx and phone access
remain unverified. The task runtime keeps its existing dedicated-user and socket
authorization requirements. Stale ledger locks require explicit process/task
ownership reconciliation; they are not automatically reclaimed. Two independent
reviews and coordinator integration are pending.
