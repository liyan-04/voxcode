# Mac Codex read/write acceptance

Issue: #101. This is a separate acceptance harness for a user-authorized local Mac,
not the phone/server/Mac production control plane. It reuses TaskService, its
durable request ledger, the MCP dispatcher, private Unix RPC and WSS proxy bridge.

The two registered Git checkouts have fixed launch policies: `voice` is read-only;
`write` uses `workspace-write`. MCP can create a write draft but cannot confirm it.
The verifier confirms that exact task/revision through the private local socket.
Do not add an MCP confirmation tool or substitute model text for owner approval.

## Setup

Requirements: macOS, Node >=22, Python >=3.11, Git, a working Codex model provider,
and an existing authorized Linx production MCP connection. The verified CLI is
`0.164.0-alpha.11.1`; later versions may require a fresh sandbox compatibility check.

1. Install locked runtime dependencies with `npm ci --ignore-scripts --prefix apps/server`.
2. Put the connection object containing `endpoint` in an owner-only private file.
   Use the existing production WSS endpoint from the MCP console. Do not put it in
   shell arguments, logs, this checkout or the model's workspace.
3. Make an isolated model configuration with `python3 scripts/acceptance/mac-codex/prepare-model-config.py /absolute/private/codex-home`.
   The helper selects the existing provider and model without printing credentials;
   it refuses to overwrite an existing config. Environment-based provider keys
   need an explicit private configuration because task environments discard keys.
4. Adapt `config.example.json` in a private file with mode `0600`. Use distinct
   disposable project roots outside the source checkout; state and credentials
   must remain outside both roots. Create the state directory with mode `0700`.
   The Unix socket path must be canonical and at most 100 bytes.
5. Run `node scripts/acceptance/mac-codex/prepare-fixtures.mjs /absolute/private/config.json`.
   It seeds two disposable Git repositories and refuses a checkout with an existing
   HEAD. It never resets a business repository or silently overwrites fixtures.
6. Start `node scripts/acceptance/mac-codex/bridge.mjs /absolute/private/config.json`.
   This maintains an outbound WSS connection and binds only a loopback status port
   and private owner socket. Keep the production MCP tool binding on the existing
   programming assistant; refresh discovery if needed.

## Verification

Run from a normal host terminal because macOS does not allow nesting Seatbelt
under another restrictive sandbox:

```sh
node --test scripts/acceptance/mac-codex/*.test.mjs
node scripts/acceptance/mac-codex/verify-live.mjs /absolute/private/config.json
```

The live verifier requires a fresh, still-failing write fixture. For another full
run, use new disposable roots and state rather than resetting an existing task.
The configuration paths remain local; the script prints no connection/model token.

The verifier checks:

- A positive sandbox control actually writes inside the fixture. A sandbox that
  fails to launch is a failure, never evidence of a denied write.
- Built-in `:read-only` denies changing the existing read guard; `:workspace`
  denies a sibling write outside the registered project. These direct OS probes
  are separate from model compliance and from upstream model networking.
- Production MCP asks real Codex to read a randomized file; the expected value is
  absent from the prompt and both read fixtures remain unchanged.
- The existing Node test fails before execution. MCP draft creation changes no
  file; local owner confirmation starts the real model. The model fixes only
  `sum.mjs`, leaves the test unchanged, and an independent Node test passes.
- Start/confirm replays preserve task/session identity. MCP does not expose
  confirmation, arbitrary shell commands, filesystem paths or sandbox flags.
- The verifier collects a real Git diff and hashes into the private
  `read-write-verification.json` report. Runtime `getDiff/getChecks` still do not
  provide immutable result snapshots; do not misrepresent this as that feature.

`GET http://127.0.0.1:<statusPort>/status` reports actual connection/CLI state and
registered sandbox modes. It provides no mutation API, tokens or absolute paths.

## Lifecycle And Rollback

The bridge can run under a user LaunchAgent with `RunAtLoad` and `KeepAlive`.
Configure its working directory and log paths outside Git. Send `SIGTERM` for a
graceful shutdown: the bridge stops accepting RPC, cancels active managed tasks,
closes WSS/status and removes its owned socket. Do not force-kill it during a task.
After a crash, reconcile process ownership and the stale socket before restarting;
the RPC server intentionally refuses to replace an existing socket.

For rollback, stop this owned LaunchAgent, restore the prior private launcher and
configuration, and restart it. Keep state/evidence; cancellation does not undo
source edits. The local installation retained the previous read-only launcher.

## Limits

Same-UID environment filtering is not file-read isolation. This harness still
runs under the local user and uses a private copy of their model credentials.
Do not expose it as a multi-tenant service or make arbitrary repositories writable.
`workspace-write` also has Codex-defined temporary paths; it is not a claim that
every path outside the fixture is immutable. The tested sibling guard is outside
those temporary roots.

Production MCP success does not prove microphone ASR/TTS, trusted voice-capture
correlation, phone/outdoor acceptance, desktop chat switching, continuous Codex
resume, or production phone confirmation. Those gates remain separate. Cloud
tool mutation here is an explicitly authorized acceptance client, not proof of
the main product's voice-session authorization. The MCP console states that its
connection token expires after 30 days.

Official configuration reference for built-in permission profiles:
<https://developers.openai.com/codex/config-reference>
