# VoxCode server deployment

VoxCode runs as two Node 22 services on vm6. The phone opens HTTPS on the server;
`voxcode.service` serves the page/API and MCP connection. `voxcode-task.service`
runs Codex CLI and cancels its own process groups through a protected Unix socket.
The MCP proxy WSS transports JSON-RPC tools; it is separate from realtime voice.
Provider voice is disabled in this milestone. No Mac, Relay, sudo wrapper or
public Codex endpoint is required by this deployment.

## Commands

Run from a reviewed checkout. The revision is an operator assertion: package only
a clean, reviewed checkout at that exact commit. Outputs must be outside it.

```sh
node scripts/server/cli.mjs package --revision <commit-hex> --output /private/tmp/voxcode-server.tar.gz
node scripts/server/cli.mjs upload --host 100.100.81.209 --archive /private/tmp/voxcode-server.tar.gz
node scripts/server/cli.mjs deploy --host 100.100.81.209 --archive /private/tmp/voxcode-server.tar.gz
node scripts/server/cli.mjs start --host 100.100.81.209
node scripts/server/cli.mjs stop --host 100.100.81.209
node scripts/server/cli.mjs restart --host 100.100.81.209
node scripts/server/cli.mjs status --host 100.100.81.209
node scripts/server/cli.mjs logs --host 100.100.81.209
node scripts/server/cli.mjs rollback --host 100.100.81.209
node scripts/server/cli.mjs rollback --host 100.100.81.209 --revision <older-commit-hex>
```

`deploy --revision <commit-hex>` reuses an uploaded archive. `deploy --offline`
requires the locked packages in root's npm cache. Start is idempotent and starts
task then Web; stop stops Web then task. Restart stops Web, restarts task, then
restarts Web. Deploy and rollback use the same restart order and verify HTTPS
health with the current revision and `codexAvailable:true` from task RPC.
A lifecycle command failure is reported; it never deletes shared config/state.
Cancelling or stopping execution does not undo code modifications.

Before the first successful deploy, `start` and `restart` report “deploy before
starting” without starting either service. After manual host preparation,
`status` returns `current:null` and the two unit PIDs; it does not require launch
secrets or `identityVerified:true`. `stop` is idempotent even without `current`
and can stop both proven-owned units if launch credentials or release files need
repair. It still requires the root deployment layout, private deploy config,
exact reviewed units and PID/port ownership proof. `logs` uses the same read-only
ownership gate. No command can operate on an unprepared host or foreign service.
Start/restart/deploy/rollback require the full identity/configuration preflight.

The `logs` command returns only recognized lifecycle event names, unit names and
timestamps from a bounded journal query. Raw messages, prompts and provider
content are omitted. Administrator inspection of raw journals is separate and
must be redacted before sharing. There is no arbitrary service/command argument.

## Manual first-host preparation

These are manual administrator steps after reviewing both unit templates. The
scripts do not provision identities, edit sudoers/firewalls, enroll host keys,
replace unknown services or kill foreign processes. Inspect the 9899 listener
and both service definitions first; unrelated ownership is a hard stop. Preserve
the separate #75 acceptance account/resources and other existing services.

Use Linux Node 22 at `/usr/bin/node`, npm, Git, systemd, `ss`, `getent`, SSH and
Codex at `/usr/local/bin/codex`. Inspect existing names before creating accounts:

```sh
getent passwd voxcode
getent passwd voxcode-task
getent group voxcode
getent group voxcode-rpc
# Run the following only for names verified absent:
groupadd --system voxcode
groupadd --system voxcode-rpc
useradd --system --gid voxcode --groups voxcode-rpc --home-dir /var/lib/voxcode --shell /usr/sbin/nologin voxcode
useradd --system --gid voxcode-rpc --home-dir /var/lib/voxcode-task --shell /usr/sbin/nologin voxcode-task
install -d -o root -g root -m 0755 /opt/voxcode /opt/voxcode/releases /opt/voxcode/shared
install -d -o root -g root -m 0700 /opt/voxcode/incoming /opt/voxcode/admin
install -d -o root -g voxcode -m 0750 /opt/voxcode/shared/config
install -d -o root -g voxcode-rpc -m 0750 /opt/voxcode/shared/task-config
install -d -o voxcode -g voxcode -m 0700 /opt/voxcode/shared/state /var/lib/voxcode
install -d -o voxcode-task -g voxcode-rpc -m 0700 /opt/voxcode/shared/task-state /var/lib/voxcode-task
```

Provision an authorized Git checkout at `/srv/voxcode/project`, owned by
`voxcode-task:voxcode-rpc` with no world access. Do not chown an unrelated existing
checkout. This first reviewed unit permits one configured project at that fixed
path; multiple-project mounts require an explicit unit/preflight change. It does
not provide independent task worktrees or fine scope isolation.

Copy these templates through an administrator channel:

- `deploy/server.env.example` → `shared/config/server.env`, root:voxcode 0640.
- `deploy/task.env.example` → `shared/task-config/task.env`, root:voxcode-rpc 0640.
- `deploy/projects.json.example` → `shared/task-config/projects.json`, root:voxcode-rpc 0640.
- `deploy/deploy.json.example` → `shared/config/deploy.json`, root:root 0600.

Replace `VOXCODE_TASK_UID` with `id -u voxcode-task`. Supply the Web login secret,
private MCP endpoint, server certificate and private key through private files
under `shared/config`, root:voxcode 0640. Never print their contents or put them
in argv, Git, an archive or task home. The server certificate must contain the
public IP/DNS SAN; `shared/config/health-ca.pem` is the reviewed public CA.
Provision Codex model credentials only in private `/var/lib/voxcode-task`.
Task environment contains only projects/state/socket/CLI paths. Web environment
contains only HTTPS paths, origin, state and expected socket owner; no CLI command
or project path is accepted there. `VOXCODE_TASK_UID` must match the real account.

Render `@ROOT@` in both templates and install root-owned 0644 units:

```sh
sed 's|@ROOT@|/opt/voxcode|g' apps/server/deploy/voxcode.service > /etc/systemd/system/voxcode.service
sed 's|@ROOT@|/opt/voxcode|g' apps/server/deploy/voxcode-task.service > /etc/systemd/system/voxcode-task.service
systemctl daemon-reload
```

Do not start before the first release exists. Systemd creates
`/run/voxcode-task` as task:voxcode-rpc 0750; task RPC creates `rpc.sock` 0660.
The task account must not belong to the `voxcode` credential group. Web has
supplementary `voxcode-rpc`; it cannot read task state/home. Task cannot read Web
config/state/home. Both units use `NoNewPrivileges`, empty capabilities,
`ProtectHome`, restricted writes and `KillMode=control-group`. No sudo installation
is part of this layout. Historical wrapper templates are not bundled or used.

Default `executionMode` is blocked and `identityVerified:false`. After personally
verifying account/group membership, private paths, TLS trust and both reviewed
units, set private deploy config `executionMode:"task-rpc"` and
`identityVerified:true`. Every activation additionally checks actual UID/group
membership, all private directory/file modes, configured task UID, fixed project,
existing socket identity, both unit texts and active PID cgroups. A flag alone
cannot bypass those checks. Keep the default blocked until these checks can pass.

## Releases, transport and rollback

Packaging uses an explicit dependency-complete allowlist: standalone server
runtime, task service, MCP/HTTP modules, pinned manifest/lock and reviewed templates.
Old `cli.mjs`, `preflight.mjs`, other apps, tests, secrets, state and node_modules
are excluded. Undeclared relative imports are rejected. Archives include per-file
SHA256 and an archive sidecar; extraction accepts regular ustar entries only,
32 MiB compressed/64 MiB expanded, no traversal/links/duplicates/extensions.

Remote manager requires root and exact Node major 22. It validates the uploaded
hash, stages a new immutable release, runs `npm ci --omit=dev --ignore-scripts
--no-audit --no-fund`, and atomically switches `current`. It holds a deployment
lock and never overwrites a release. On failed activation it restores the previous
symlink, restarts task then Web and verifies old health. First-deploy failure
removes current and stops only the two verified units. Failed rollback reports
unconfirmed recovery. Shared config/history and old releases remain untouched.

SSH/SCP always enforce `StrictHostKeyChecking=yes`; verify/enroll the host key
through a trusted channel first. Key/agent authentication defaults to BatchMode.
Optional `--identity` uses a private owned regular file; `--known-hosts` selects a
reviewed file. Fixed vm6 root/password transport additionally accepts
`--password-file /private/path`; only its path enters argv, Expect reads contents
internally. Password mode cannot target another host/root. Never disable host-key
checking or use a password in arguments/environment.

Status validates both units and current release. For a stale lock, inspect its
owner and service state; do not blindly remove it. Restart stops running tasks,
which may become quarantined after recovery; explicit reconciliation is required
before dispatching new tasks. This is a conservative safety behavior, not rollback.

## Evidence and remaining gates

`node --test scripts/test/server-deploy.test.mjs` covers actual temporary archive,
locked npm install, symlink activation/rollback and real local HTTPS IP-SAN/CA
health. SSH/systemd/account permissions use fixtures. Tests reject foreign Web or
task cgroups, shared credential groups, unsafe paths, unverified mode, arbitrary
service arguments and false Codex readiness. No live vm6 account provisioning,
Linux descendant cancellation, real model run, live MCP/voice or phone acceptance
is implied. Final integrated package and two independent reviews remain required.
