# Server execution entry (source delivery)

This entry runs the existing integration runtime on an authorized server: local
Codex App Server stdio plus Bridge/Connector/voice. iPhone talks only to the
existing authenticated TLS Relay. `apps/mac` remains the execution module name;
it does not require a company Mac to remain online. No server sound card is
needed. This source bundle is neither an iPhone installation nor a live deployment.

Two persistent Node processes are required: existing Relay, and this runtime.
Active Codex turns create additional managed child processes. Bridge always binds
127.0.0.1; the only external entry is Relay. No new proxy, API or account automation
is provided. Do not run the old connector/integration CLI in parallel with this
entry using the same machine identity or state directory.

## Manual preparation

Use Node >=22, npm, Git, and a manually installed/authenticated Codex CLI. Run
tasks as an ordinary dedicated execution user: **start refuses root**. Arrange
that account, an authorized existing Git checkout with a HEAD commit, Codex
authentication and approved check commands manually. A config.toml or missing
auth.json alone does not establish whether authentication works. Linux cannot
build Xcode/iPhone apps; signing and installation still require Mac/Xcode.

Keep Relay TLS private key/config under a separate service account. Runtime uses
only its public CA file, machine credentials and optional Linx credentials. A
0600 file is still readable by a task running under the same UID. Environment
filtering and Codex `workspace-write` do not provide full file-read isolation or
multi-tenant security. A dedicated user limits scope; further voice/execution
identity separation or container controls are needed for stronger isolation.

Prepare a state parent outside the project owned by the execution user with mode
0700, plus private configuration files outside the source checkout (0600, parent
0700). The data directory may be absent; preflight never creates it. Do not copy
credentials into an archive, command argument or phone. Commands below use only
private file paths as arguments; avoid shell tracing and shared terminal capture.
Every canonical state-path ancestor must belong to this execution user or root
and must not permit group/other writes. Root-owned sticky temporary directories
(such as `/tmp`) are allowed. A 0700 leaf under an untrusted writable ancestor
is insufficient because its directory entry can be renamed/replaced. This is a
read-only POSIX owner/mode precheck, not a sandbox or protection against root,
same-UID changes, ACL grants or filesystem changes after checking.
The runtime uses the exact checked canonical project/state paths held privately
by preflight. It does not resolve the original environment paths again: a mutable
symlink alias cannot redirect launch to a different unchecked target. Private paths
remain absent from the JSON report.

The runtime environment file uses existing names:

```dotenv
VOXCODE_PROJECT=/srv/authorized-project
VOXCODE_DATA=/srv/private-executor/state
VOXCODE_PORT=8787
VOXCODE_RELAY_URL=wss://100.100.81.209:9899/connector
VOXCODE_MACHINE_ID=replace-with-existing-machine-id
VOXCODE_MACHINE_KEY=replace-with-private-base64url-key-32-to-256-characters
VOXCODE_TLS_CA=/srv/executor-config/public-ca.pem
```

Optional voice requires all `LINX_TOKEN`, `LINX_DEVICE_ID` (MAC-form software
device identifier), `LINX_CLIENT_ID` (UUID). `LINX_WS_URL` optionally replaces the
default `wss://xrobo-io.qiniuapi.com/v1/ws/`. Configure/bind the Linx software
device/agent manually; the phone stores no provider credentials. Omit every Linx
input to disable voice. Configuration is never proof of live success.

For a new Relay only, its separate account's private env file supplies the same
machine identity/key plus `VOXCODE_RELAY_HOST`, `VOXCODE_RELAY_PORT=9899`,
`VOXCODE_TLS_CERT` and `VOXCODE_TLS_KEY`. Follow the existing Relay README for
strict certificate/IP SAN and trust. This entry never starts or replaces Relay.

## Build and install the source bundle

From a reviewed, committed repository revision, choose an unused output outside
the checkout:

```sh
node scripts/build-server-package.mjs --output /tmp/voxcode-server-source.tar.gz --revision HEAD
tar -tzf /tmp/voxcode-server-source.tar.gz
```

The builder reads only the explicit allowlisted blobs at the resolved Git commit,
ignoring local Git replace objects even if the working tree differs. `manifest.json` records the full revision and
SHA-256 per source/lockfile. Uncommitted new server files must be reviewed and
committed by the coordinator before a deliverable can be built. Required missing
files/symlinks, unsafe paths and existing output are rejected. No node_modules,
.git, private env/CA/key files or test state enters the bundle.

Unpack into a new version directory after reviewing the listing/manifest. From
that package root install dependencies manually from the three exact lockfiles:

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix apps/relay
npm ci --ignore-scripts --prefix packages/voice
```

Launching never installs dependencies. Root dev dependencies are included by the
root lock; module dependencies are not bundled. Full regression tests remain in
the repository, rather than this runtime source archive.

## Check, launch and pair

First identify listeners and ownership on 9899 and 8787 with authorized local
tools such as `ss -ltnp` or `lsof -nP -iTCP:9899 -sTCP:LISTEN`. vm6's reported
9899 Node listener must be identified; do not kill/replace it. If it is unrelated
or ownership is uncertain, stop and notify the operator. An existing intended
Relay must use the agreed machine identity and valid TLS. Check the configured
Bridge port is free. Preflight does not connect to or mutate services.

From the package root as the dedicated execution user:

```sh
node --env-file=/srv/executor-config/runtime.env apps/server/cli.mjs preflight
node --env-file=/srv/executor-config/runtime.env apps/server/cli.mjs start
```

Preflight emits only bounded check names/statuses, parsed tool versions and HEAD;
it does not echo private paths, URLs, identities, keys or provider output. It checks
Node, non-root UID, Git/Codex versions, existing checkout HEAD, private owned
writable state parent, strict WSS configuration, public CA syntax, port syntax and
optional Linx completeness. It creates no state, installs nothing and makes no
provider/Relay requests. It cannot prove port availability, account authorization,
certificate hostname validity, authentication, model execution or live voice.

For first pairing, use an explicitly private interactive terminal:

```sh
node --env-file=/srv/executor-config/runtime.env apps/server/cli.mjs start --show-pairing-code
```

The opt-in code goes only to a TTY stderr and expires after five minutes. The flag
is rejected before startup when stderr is redirected. Ordinary logs contain no
pairing code. Pair the phone through Relay using this code; do not copy the code
to logs or chat. If it expires, cleanly stop this owned runtime and restart with
the flag for a new code. Existing phone sessions persist across clean restarts.

Only if preparing a new, verified-free Relay, run this separately as its owner:

```sh
node --env-file=/srv/relay-config/relay.env apps/relay/relay-cli.mjs
```

This is the second Node process. Do not run it when the intended Relay already
exists. Same-host Connector still uses strict WSS and CA/IP SAN verification;
never replace WSS with plaintext or disable certificate validation for routing.

## Stop, recovery and rollback

Send Ctrl-C/SIGTERM only to the runtime you started and positively identify by
live ownership/command/cwd. It closes its Connector, Bridge, voice and managed
executions; after 15 seconds an unresolved shutdown exits with a generic warning.
Verify owned children have stopped before restarting. Never signal an unrelated
listener, saved PID or service, and leave the separate Relay running when it is
still needed. Do not run two runtimes on the same state directory.

After an unclean stop, the existing runtime quarantines unknown execution state.
Use Linux `ps`/`ss`/`lsof` to verify process ancestry, group, cwd and ownership;
do not assume a saved PID is still the same process. Follow
`apps/mac/README.md` and `apps/mac/recover.mjs --confirm-executions-stopped` only
after verifying all affected owned executions stopped. This does not reconcile
unknown Codex turn dispatch; those tasks remain blocked. Do not clear snapshots
or change data directories to bypass quarantine.

For a source update, stop the owned runtime, preserve private state/config backups,
unpack into a fresh version directory, manually install locks, preflight and
restart. Roll back source only after verifying stopped owned processes and data
compatibility; retain the previous package. Do not overwrite configuration or
restore a snapshot that would discard newer results without an explicit recovery
decision. No systemd/user creation, provider onboarding or automatic rollback is
included.

## Evidence and open gates

Local fixtures test read-only/redacted preflight, launch rejection, strict local
TLS runtime lifecycle, exact Git source packaging, manual locked dependency
installation and an unpacked runtime startup. Tool fixtures are synthetic;
no real Codex/Linx model success is claimed. Run from the full repository:

```sh
node --test apps/server/test/*.test.mjs scripts/test/server-package.test.mjs
```

The unpacked install fixture uses npm's offline cache populated by the three
manual installs above. If those installs used a custom cache, pass the same npm
`npm_config_cache` environment setting when running tests. OpenSSL and tar are
also required for these local fixtures.

Linux x86_64/Node22, real Codex two-turn edit/check/resume/cancellation, intended
Relay ownership and TLS, live Linx ASR/MCP/audio, signed iPhone and cellular/VPN
acceptance remain separate gates. User-reported vm6 tooling/ports are preparation
evidence; this source task performs no SSH or live deployment.
