# Server Codex task executor

Issue #134 provisions the server execution target as a separate lifecycle from
the HTTPS control service. The task process runs as `voxcode-task` in the
`voxcode-rpc` group and accepts only the private Unix RPC exposed by
`apps/server/task-cli.mjs`. The web identity and root never launch the model.

`scripts/control/server-task.mjs` is the repeatable provisioning boundary. It
validates the service identity and canonical private paths, refuses symlinked or
foreign Codex binaries, copies only explicitly designated model configuration
into the task account's private `CODEX_HOME`, writes the environment and unit
atomically, and records a small ownership/rollback state file. Re-running with
the same revision and hashes is idempotent. An activation health failure restores
the previous environment and unit before returning an error. It never removes an
unknown socket, unit, process, or private credential.

The committed examples contain no credentials:

* [`apps/server/deploy/voxcode-task.service`](../../apps/server/deploy/voxcode-task.service)
  keeps the task `HOME` under `/var/lib/voxcode-task`, denies access to control
  state, and drops capabilities. The controller-generated unit adds the private
  `CODEX_HOME` path under the same directory.
* [`apps/server/deploy/task.env.example`](../../apps/server/deploy/task.env.example)
  contains only project, state, socket, and executable paths. The controller
  adds `CODEX_HOME` to the generated private environment; copy the example to
  an operator-owned private file before use.
* [`apps/server/deploy/task.json.example`](../../apps/server/deploy/task.json.example)
  is the private controller configuration template. Replace the revision,
  numeric account IDs, and designated source paths after the host preflight;
  keep the completed file root-owned with mode `0600`.

Before a live install, the operator must supply a dedicated account/group,
task-owned project registry, a regular executable owned by root or the task
account, and a designated private model configuration. Inspect the existing
resource metadata first; presence of a config file is not proof of model
authentication. A missing designated model file is reported as
`model_config_missing` and no service mutation is attempted.

The current vm6 inventory is a source/deployment blocker for the live gate:
there is no `voxcode-task` account or task socket, the only installed Codex
entry is a symlink whose canonical executable is owned by another UID, and
`/root/.codex/auth.json` is absent. The root-owned `/root/.codex/config.toml`
was observed by metadata only; its presence does not establish authentication.
Provisioning and fixture validation remain independent of that missing resource.

After the coordinator has installed the reviewed revision and supplied the
private JSON configuration, the lifecycle entry is run by the host administrator
with `--config`; the model process itself is always started by systemd as
`voxcode-task`:

```sh
node scripts/control/server-task.mjs install --config /etc/voxcode-task/task.json
node scripts/control/server-task.mjs status --config /etc/voxcode-task/task.json
```

Use `--activate` on the install only after the account, socket parent and model
resource preflight has passed. `update` starts the new unit only after its
health check and restores the previous state on failure.

## Verification

Run the focused lifecycle fixtures from the repository root:

```sh
node --test scripts/test/server-task.test.mjs
```

The fixture tests cover root/symlink rejection, unit isolation, atomic resource
copy, idempotence, foreign-listener refusal, activation rollback, and precise
missing-auth-resource reporting. Fixture output is not evidence of a real model
execution. A live synthetic task may be run only after the coordinator confirms
the merged revision, canonical deployment lease, dedicated account/tool/model
resources, and rollback record.
