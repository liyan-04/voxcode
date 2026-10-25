# Mac control runtime

Issue: Refs #98, part of #93. Evidence: local fixture, 2026-10-25.

Phone HTTPS and outbound Linx MCP share one remote task adapter. An outbound
verified WSS Agent on the configured Mac forwards the 14 allowlisted task RPC
methods to its private Unix socket. The server does not start Codex. A logged-in
phone session maps to the operator-configured owner/device; clients cannot choose
another owner or Mac. Phone project/task selection changes its displayed target.
Native desktop chat/window switching is not provided by this task_rpc release.

The separate `control-cli.mjs` preserves the previous server execution entry.
Public health reads cached server observations; background readiness probes are
bounded. Browser APIs require sessions and POST Origin validation. Pairing and
operation lookup/reconciliation routes use that same authenticated fixed target.
WSS limits preauth/total sockets, frames, queues, registration and authenticated
idle time. Shutdown bounds proxy, transport and HTTP cleanup and closes tracked
raw TCP sockets. Stopping the server does not cancel Mac tasks.

Ambiguous writes retain their business identity and expose safe operation IDs.
The phone retains up to 32 unknown write IDs across reload, offers query/reconcile,
and never records background read failures as completed mutations. Preparatory
reads that fail cannot expose a mutation recovery ID. Mac offline prevents new
phone writes; local draft input remains available. Project RPC failures do not
change the server/Mac transport status.

MCP advertises seven read tools only. Cloud transport is not authenticated voice
capture correlation. ASR/TTS, voice writes, native app focus, existing Codex desktop
chat enumeration and task continuation are not certified by this source milestone.

## Run

Node >=22, non-root account, pinned dependencies:

```sh
npm ci --ignore-scripts --prefix apps/server
npm ci --ignore-scripts --prefix apps/mac-agent
VOXCODE_CONTROL_CONFIG=/absolute/private/control.json node apps/server/control-cli.mjs preflight
VOXCODE_CONTROL_CONFIG=/absolute/private/control.json node apps/server/control-cli.mjs start
```

Use `apps/server/deploy/control.json.example`. Canonical private config, secret
files and trusted ancestors are checked. TLS certificate SAN/dates/key matching
are required; never disable TLS verification. The example systemd unit creates
no task service and runs as the separate `voxcode-control` account.

Package only reviewed committed source, without private configuration:

```sh
git archive --format=tar.gz --output=/private/tmp/voxcode-control-source.tar.gz HEAD apps/server packages/control-protocol
shasum -a 256 /private/tmp/voxcode-control-source.tar.gz
```

Verify the digest before extracting into a new root-owned release directory.
Run `npm ci --ignore-scripts` in that release's apps/server, point `current` at
the checked release, then run preflight as the service account. Keep shared state
and secrets outside releases. Replacing a listener first requires confirming its
ownership; an unrelated process on port 9899 must not be stopped.

On Mac run the existing `task-cli.mjs start` with a private project registry,
owned task state and Unix socket (see task deployment examples), then
`apps/mac-agent/cli.mjs --config /absolute/private/agent.json --task-socket /absolute/private/rpc.sock`.
Use the Agent's Keychain and launchd templates, trusted CA via
`NODE_EXTRA_CA_CERTS`, and an independent Mac task service. The Agent token remains
in Keychain, model credentials remain on Mac, and the server keeps token digests.
Register only explicitly chosen Git project roots. Initial validation should use
an isolated synthetic project. This service's tasks are distinct from desktop
Codex chats.

## Rollback

Stop only the owned `voxcode-control` service. Repoint `current` to the preceding
reviewed release and restart, keeping shared configuration/state. First-install
failure removes only its new current symlink and stops its service; preserve
ledger/keys for reconciliation. Never delete unknown operations or stale Agent
locks to force retries. On Mac unload only the installed VoxCode control Agent
and task launchd labels, then reconcile active tasks before changing task runtime.

## Verification

- All server tests: 149/149 before subsequent execution cleanup fix.
- Focused control/WSS tests: 27/27, including actual HTTPS -> WSS -> Agent ->
  private Unix RPC with distinct inner/outer request IDs, duplicate writes,
  confirmation/cancellation, MCP status and offline behavior.
- c8 changed control modules: lines 95.75%, branches 83.05%.
- Repository policy: 62/62. Whitespace checks pass.
- Two independent integration reviewers and a separate transport reviewer;
  resolutions under `docs/reviews/mac-control-runtime-2026-10-25.md`.

The final task service in the composition test is synthetic. Real model,
deployed Mac/server, phone certificate installation, voice audio and outdoor
acceptance require their own evidence; fixture status is not deployment status.
