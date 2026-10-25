# VoxCode Server Deployment

## Retired Deployment Entry

Issue [#139](https://github.com/liyan-04/voxcode/issues/139) retires
`scripts/server/cli.mjs`, the orchestration entry for the historical
`/opt/voxcode` Web/task service layout. Its package, upload, deploy, start, stop,
restart, status, logs and rollback commands are no longer available. The old
`package` subcommand also loses its CLI entry; this cleanup does not provide
a replacement packaging command.

That layout is separate from the current `/srv/voxcode-control` gateway. Current
runtime context is documented in [the server README](README.md),
[control runtime verification](../../docs/verification/mac-control-runtime.md)
and [the current architecture](../../docs/architecture/phone-mac-linx-current.md).
The deployment work tracked by
[#122](https://github.com/liyan-04/voxcode/issues/122) must publish and verify its
own supported commands. No replacement deployment command is claimed here.

## Retained Modules And Evidence

`scripts/server/bundle.mjs`, `package.mjs`, `remote.mjs` and `vm6-password.exp`
remain for their existing programmatic consumers and regression coverage.
They are not supported current deployment commands. Reusing them for a new
deployment requires a separate review of the runtime bundle, target layout,
configuration and ownership contract.

The runtime entries `apps/server/server-cli.mjs` and `task-cli.mjs` are separate
from the retired orchestration entry and remain intact. The retained deployment
suite still checks bundle allowlists and hashes, private file handling, strict
TLS/IP identity, service ownership, identity preflight, atomic activation,
rollback and redacted lifecycle logs. Its local fixtures do not prove live
deployment or phone acceptance.

The earlier deployment procedure remains historical evidence in Git history,
[the deployment review](../../docs/reviews/server-deployment-review.md) and
[progress records](../../docs/progress.md). Those records are not current
operator instructions. See
[retirement verification](../../docs/verification/legacy-server-cli-retirement.md)
for this cleanup's dependency audit and checks.

This source cleanup does not restart services, alter private configuration,
remove live releases or delete rollback/state files. Existing host ownership,
strict TLS and separately authorized deployment requirements continue to apply.
