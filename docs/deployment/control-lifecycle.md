# Control Service Lifecycle

Refs #141, #122, #137. These commands operate the current phone/Linx -> Linux gateway ->
paired Mac architecture. Linux manages **only `voxcode-control.service`**. The
historical `scripts/server` commands and `voxcode.service`/`voxcode-task.service`
are separate deployments.

## Five Shell Entry Points

Run these on the actual service host from a Git checkout (the scripts locate their
own directory, regardless of your current directory). Linux requires a root
operator with a dedicated existing non-root `voxcode-control` service identity;
Mac requires the owning non-root GUI user. Install Node >=22 and Git first. Private
configuration, certificates, pairing, Keychain and Codex authentication must
already exist. This is one-command lifecycle after setup, not credential provisioning.

```sh
export VOXCODE_DEPLOY_CONFIG=/absolute/private/deployment.json
./install.sh
./start.sh
./stop.sh
./restart.sh
./deploy.sh
```

All five accept `--config PATH`, `--dry-run`, `--help`. Default config paths are
`/etc/voxcode-control/deployment.json` on Linux and
`~/Library/Application Support/VoxCodeControl/private/deployment.json` on Mac.
Linux root must use a trusted root-owned checkout and tools; do not run lifecycle
code from another user's writable clone. If invoking through sudo, pass
`--config` explicitly (sudo may discard the environment). Mac does not use sudo.

`install.sh` packages local committed HEAD, installs locked production dependencies
with npm scripts disabled, and registers services without starting. `deploy.sh`
fetches `origin master`, packages the exact fetched commit directly from Git blobs,
and updates/starts an **already owned** installation. Fetch failure changes no
services. It never checks out, resets, stashes, or overwrites your working files.
Private config/state stays outside releases; the previous release remains for
rollback. On activation or health failure the controller attempts to restore its
previous configuration and running state; unresolved recovery blocks later work.
`--dry-run` still fetches and validates source/configuration, but never installs or
starts services. This command performs local activation on the service host; it
does not SSH into another machine. Deploying latest master uses the lifecycle
controller from the invoking checkout; update that checkout separately when new
lifecycle tooling itself is needed.

Mac stop/restart/update refuse active/quarantined/unknown task state before
unloading either job. Agent stops before task, and each unload waits boundedly
for job removal and the original PID's exit. Only launchctl bootstrap code 5 with
its exact Input/output error is retried, at most four submissions; unrelated
errors fail immediately. Task RPC must become ready before starting the Agent.
No runtime guard or ledger lock is deleted to force startup. Local Agent process
health does not prove remote connection or Linx readiness.

Existing one-off deployments must first follow explicit adoption below; install
refuses unrelated or unrecorded services/listeners. Read-only helpers and recovery:

```sh
node scripts/control/entry.mjs status --config /private/deployment.json
node scripts/control/entry.mjs logs --config /private/deployment.json
node scripts/control/entry.mjs rollback --config /private/deployment.json
```

Linux executor provisioning is separately tracked in #134. These scripts manage
the Linux control unit and Mac task/Agent pair, not the historical server units.

## Package A Reviewed Revision

Use Node >=22 and a complete Git checkout. Packaging reads committed regular
files at a full 40-character revision, so uncommitted workspace changes are not
included. The bundle contains server, Mac Agent, control-protocol and voice
sources, browser assets, and each production package/lock. Local imports and
integrity-pinned registry dependencies must close within the bundle.

```sh
node scripts/control/package.mjs --root /path/to/voxcode \
  --revision FULL_40_CHARACTER_COMMIT --output /private/path/control.bundle.gz
```

Record the returned SHA-256 alongside the reviewed revision. Supply both to the
installer; a digest computed from an unreviewed input is not source approval.
Output must be a new file. No credentials or private configuration are bundled.

## Linux Prerequisites

The CLI requires Linux and a root operator. Provision a dedicated non-root
`voxcode-control` account first. Node and the npm CLI must be canonical regular
files with operator/root ownership and no group/world writable ancestors. Use an
owned, isolated copy of the toolchain when a global installation has unsuitable
ownership; these commands never change global npm ownership.

Provision the actual private control configuration with that service's numeric
UID/GID, existing TLS certificate/key, login-secret file, and issuer CA. Keep
configuration/credential files and their canonical parents private. TLS must
match the HTTPS origin, remain valid, and verify against the provided issuer CA.
For a certificate chain, supply the direct issuer CA accepted by the runtime.
The control configuration's revision must match the first installed/adopted
bundle. Updates stage only its revision; secret files, device state, login secret,
pairing, registry and task data are retained. In-memory login sessions can expire.

Example operator-owned deployment configuration (mode `0600`, values are paths
and numeric IDs, never secret contents):

```json
{
  "format": 1,
  "root": "/srv/voxcode-control",
  "serviceUser": "voxcode-control",
  "serviceUid": 1234,
  "serviceGid": 1234,
  "node": "/srv/voxcode-control/tools/node",
  "npm": "/srv/voxcode-control/tools/npm/bin/npm-cli.js",
  "controlConfig": "/srv/voxcode-control/shared/config/control.json",
  "caFile": "/srv/voxcode-control/shared/config/issuer-ca.pem"
}
```

Linux systemd paths use plain ASCII path components without spaces, substitutions
or specifiers. State and private configuration must be outside runtime releases.
The commands do not generate accounts, certificates, credentials or pairing.

## Linux Commands

```sh
node scripts/control/linux.mjs install --config /private/deployment.json \
  --bundle /private/control.bundle.gz --sha256 REVIEWED_SHA256 --dry-run
node scripts/control/linux.mjs install --config /private/deployment.json \
  --bundle /private/control.bundle.gz --sha256 REVIEWED_SHA256
node scripts/control/linux.mjs start --config /private/deployment.json
node scripts/control/linux.mjs stop --config /private/deployment.json
node scripts/control/linux.mjs restart --config /private/deployment.json
node scripts/control/linux.mjs status --config /private/deployment.json
node scripts/control/linux.mjs logs --config /private/deployment.json --lines 100
node scripts/control/linux.mjs update --config /private/deployment.json \
  --bundle /private/next.bundle.gz --sha256 REVIEWED_NEXT_SHA256
node scripts/control/linux.mjs rollback --config /private/deployment.json
node scripts/control/linux.mjs uninstall --config /private/deployment.json
```

`install` registers/enables the owned unit; `start` starts it separately. Repeating
the same installation is safe and does not reinstall dependencies. Dry-run checks
bundle/configuration, tool version and service/listener ownership without writing
runtime files, installing dependencies or registering services. Runtime preflight
requires the actual staged dependency installation and runs during real install.

An unrelated unit, drop-in, PID, listener, modified registration or runtime causes
refusal. Ownership is checked again after staging and before activation. Existing
audited one-off Linux deployments require explicit adoption:

```sh
node scripts/control/linux.mjs adopt --config /private/deployment.json \
  --bundle /private/exact-installed-source.bundle.gz --sha256 REVIEWED_SHA256 --dry-run
node scripts/control/linux.mjs adopt --config /private/deployment.json \
  --bundle /private/exact-installed-source.bundle.gz --sha256 REVIEWED_SHA256
```

Adoption accepts the existing private `voxcode-control-bootstrap-v1` deployment
manifest only after matching its revision/service/account, committed gateway and
voice sources, installed locked dependency versions, restricted unit directives,
and live PID/listener identity. It freezes the existing runtime inventory; it does
not reinstall or restart it. It never infers ownership from the unit name alone.

## Recovery And Retention

Update installs locked production dependencies with scripts disabled, separate
owned npm user/global config files and an isolated cache. It checks the staged
private configuration and runs the real control CLI preflight through a directory
symlink before stopping the owned service. The prior runtime and private control
configuration are retained. A previously running service is started and checked
over verified HTTPS against its exact revision; a stopped installation stays
stopped. Rollback validates the previous release before stopping anything.

Activation records its before/after state in private `pending-activation.json`.
On failure it attempts to restore the prior source, configuration and running
state. When recovery is unconfirmed, other actions refuse; `rollback` validates
the retained ownership records and retries recovery. A crashed lifecycle operator
lock may be reclaimed only by recovery after its recorded PID is proven absent.
No runtime Agent or task lock is removed by these scripts. Unknown or still-live
locks require operator reconciliation.

Uninstall stops/disables only the owned service, removes its registration and
recorded runtime directories, and retains private configuration, credentials,
pairing, project registry, task data and tool copies. It has no implicit purge.
Logs are bounded to 1-500 lines and 64 KiB, with labelled credentials and URL
queries redacted. Runtime code must continue avoiding unlabelled secret logging.
Status never prints full private configuration. Stop/status/uninstall remain
available when TLS configuration needs repair.

## Evidence Boundaries

Run `node --test scripts/test/control-package.test.mjs scripts/test/control-linux.test.mjs`
for committed-source packaging and isolated filesystem/command-runner fixtures.
Fixture systemd, npm and health checks are substituted; they are not native or
live service evidence. Linux native systemd and verified deployed TLS health,
Mac launchd and real Agent reattachment require separate authorized checks.

## Prepare Owned Tools

This independent command copies an explicitly reviewed Node executable and the
complete npm package tree. It does not run the old npm, modify Homebrew/global
ownership, or register/restart any service. Source directory group permissions
can be unsuitable for direct service use; each copied byte must still match the
reviewed source hashes. Linked npm entries and unrelated destinations are refused.

```sh
node scripts/control/prepare-tools.mjs inspect \
  --node /opt/homebrew/bin/node --npm-root /absolute/path/to/npm
node scripts/control/prepare-tools.mjs prepare --config /private/tool-plan.json \
  --destination /private/owned-tools --dry-run
node scripts/control/prepare-tools.mjs prepare --config /private/tool-plan.json \
  --destination /private/owned-tools
```

Review the `inspect` result, then place that exact JSON in the private tool plan
(mode `0600`). For an explicitly authorized source owner different from the
operator, `inspect --source-uid NUMERIC_UID` records that owner. The destination's
parent must already be trusted. The copy contains canonical `node` and
`npm/bin/npm-cli.js`, normalized owned permissions and a private provenance
manifest. Repeat preparation accepts only an unchanged owned copy. Source or
destination hash changes cause refusal. Tool runtime version is validated by
the lifecycle installer before use.

## Mac Prerequisites

Run as the non-root account that owns the GUI launchd domain, private config,
project/task data and Keychain item. The owned `~/Library/LaunchAgents` directory
must exist. Provision the actual paired Agent JSON, project registry, protected
Unix socket parent, Codex executable/home and reviewed gateway CA first. The CLI
checks the Keychain item without requesting its password in output or argv.
It does not create, rotate or delete pairing credentials.

Example private deployment configuration (all paths canonical; spaces are
supported on Mac):

```json
{
  "format": 1,
  "root": "/Users/operator/Library/Application Support/VoxCodeControl",
  "home": "/Users/operator",
  "node": "/Users/operator/Library/Application Support/VoxCodeControl/tools/frozen/node",
  "npm": "/Users/operator/Library/Application Support/VoxCodeControl/tools/frozen/npm/bin/npm-cli.js",
  "agentConfig": "/Users/operator/Library/Application Support/VoxCodeControl/private/agent.json",
  "projectsFile": "/Users/operator/Library/Application Support/VoxCodeControl/private/projects.json",
  "taskData": "/Users/operator/Library/Application Support/VoxCodeControl/tasks",
  "taskSocket": "/Users/operator/Library/Application Support/VoxCodeControl/private/rpc.sock",
  "codexCommand": "/Users/operator/Library/Application Support/VoxCodeControl/tools/codex-cli/bin/codex",
  "codexHome": "/Users/operator/Library/Application Support/VoxCodeControl/private/codex-home",
  "caFile": "/Users/operator/Library/Application Support/VoxCodeControl/private/public-ca.pem"
}
```

## Mac Commands

```sh
node scripts/control/mac.mjs install --config /private/mac-deployment.json \
  --bundle /private/control.bundle.gz --sha256 REVIEWED_SHA256 --dry-run
node scripts/control/mac.mjs install --config /private/mac-deployment.json \
  --bundle /private/control.bundle.gz --sha256 REVIEWED_SHA256
node scripts/control/mac.mjs start --config /private/mac-deployment.json
node scripts/control/mac.mjs stop --config /private/mac-deployment.json
node scripts/control/mac.mjs restart --config /private/mac-deployment.json
node scripts/control/mac.mjs status --config /private/mac-deployment.json
node scripts/control/mac.mjs logs --config /private/mac-deployment.json --lines 100
node scripts/control/mac.mjs update --config /private/mac-deployment.json \
  --bundle /private/next.bundle.gz --sha256 REVIEWED_NEXT_SHA256
node scripts/control/mac.mjs rollback --config /private/mac-deployment.json
node scripts/control/mac.mjs uninstall --config /private/mac-deployment.json
```

Install writes validated plists and the owned runtime; start bootstraps
`io.voxcode.control-task`, waits for private task RPC, then bootstraps
`io.voxcode.control-agent`. Stop unloads Agent before task and verifies PID/socket
cleanup. A partial Agent start failure unloads the task. Canonical release paths
avoid the task/Agent CLI's directory-symlink entry limitation. Both jobs run via
`env -i`; task execution receives no gateway voice, login, MCP or TLS credentials.
Agent receives only its existing private configuration and the CA path.

Only these two labels and their exact owned plist files are managed. Loaded job
arguments, plist contents and process ownership must match. Status parses a
whitelist of launchd fields and never emits inherited environment blocks. A stale
socket or unknown runtime lock requires reconciliation; neither is force-deleted.
Local start readiness confirms the two processes and task RPC. Real gateway
Agent reattachment remains a separate live check. Private Keychain, Codex home,
pairing state, registry, task data and logs survive uninstall.

## Adopt And Migrate An Audited Mac Installation

The one-off Mac installer used `root/runtime` and saved
`root/private/install-manifest.json`. Later Agent reconnect patches are recorded
separately. This mixed source snapshot must not be described as one exact Git
revision. Review those existing records and put their SHA-256 values into the
private deployment JSON as `legacyManifestSha256` and, when applicable,
`legacyAgentPatchSha256`. No new trust is inferred from their filenames alone.

```sh
node scripts/control/mac.mjs adopt --config /private/mac-deployment.json \
  --bundle /private/reviewed-update.bundle.gz --sha256 REVIEWED_SHA256 --dry-run
node scripts/control/mac.mjs adopt --config /private/mac-deployment.json \
  --bundle /private/reviewed-update.bundle.gz --sha256 REVIEWED_SHA256
node scripts/control/mac.mjs update --config /private/mac-deployment.json \
  --bundle /private/reviewed-update.bundle.gz --sha256 REVIEWED_SHA256
```

Adoption validates the supplied future update bundle, then independently freezes
the audited installed snapshot. Its manifest paths/hashes must match the actual
legacy source; the sole supported source exception is a reconnect-only Agent
patch with the exact separately reviewed report hash and before/after hashes.
The two plists must have the expected paths, arguments, clean environment and
logs. Status labels the installation `audited-legacy-snapshot`, showing its base
revision and patch revisions separately. Adoption creates the lifecycle record
and current link without restarting the running labels.

An old Node alias can be diagnosed during adoption only if its resolved binary
bytes match the newly frozen owned Node. Its identity is recorded and checked on
later process inspection. A stopped job using that alias cannot be bootstrapped;
perform the explicit update to switch both plists to the frozen toolchain. The
update keeps the old runtime and plist snapshots before stopping either job.
Rollback of the old runtime uses the frozen Node/npm paths as well. Neither
preparation nor migration changes global Homebrew permissions or other labels.

These migration paths have isolated fixture evidence, including native plist
parsing on temporary files; they have not been exercised against the installed
GUI services. Run `node --test scripts/test/control-mac.test.mjs scripts/test/control-tools.test.mjs`
on Mac. Mac fixtures skip on other platforms because their parser checks use
native `plutil`; command runners, process checks, Keychain and gateway are still
substituted. Native launchd/live migration and reconnect remain pending.

## Server Execution Scope

This capability manages the control gateway and Mac services. The separately
requested server Codex executor, target switching and authentication availability
independent of Mac connectivity belong to their own capability. These commands
do not install, stop or replace a server execution service.
