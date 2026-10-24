# Server deployment independent delivery review

Reviewer: `/root/delivery_reviewer`. Date: 2026-10-25 (Asia/Shanghai). Issue #79 deployment snapshot is the uncommitted worktree based on `5a7edf6`; this review is independent of implementation and is not human approval. No credentials, Git state, browser, vm6, or external service were changed.

## Snapshot

The deployment scripts and templates are untracked in this worktree. Exact SHA-256 values for the reviewed snapshot are:

- `scripts/server/bundle.mjs`: `fe5deb5c1bd93ebffaf19edacce6f95518f43244ca8120867e722ef2ae3ec8c3`
- `scripts/server/cli.mjs`: `00138408a1f0f625f89573dfcfe821e538856aa764de2d38e084d77e0ca6f34a`
- `scripts/server/package.mjs`: `ddb445595003c1f2a8d07f3f68d9b008b75ec129f0897c809283dbc7de0c24e8`
- `scripts/server/remote.mjs`: `25a95a7403a2363de472acf616e4a8dcb015de52da98d1090ff0869e4ad0509e`
- `scripts/server/vm6-password.exp`: `4472bae4f2ed14b529d1ba0922fced1337bdbf2f57c8961e939c754b0513aa42`
- `scripts/test/server-deploy.test.mjs`: `8ce41208931bfd7ab109b1860dc38125412cba797153b4a4a6c74f157a830000`
- `apps/server/deploy/voxcode.service`: `cec54088a8b9401e7f525f6044eb10295f0353e8d669d88975aa48c6934a99`
- `apps/server/deploy/voxcode-task.service`: `480c25a31376b9fd0485b5be619c80ce486c560d53ed8065760c1d3f536916ba`
- `apps/server/DEPLOY.md`: `d8c51a724572edc69362eea74c348d7e6de856fdede73832b94c5bdb76e97453`

## P1 — The reviewed checkout cannot build the advertised release bundle

`bundle.mjs`/`package.mjs` require these runtime paths: `server-cli.mjs`, `runtime.mjs`, `runtime-config.mjs`, `task-cli.mjs`, `task-rpc.mjs`, `project-service.mjs`, `codex-cli-adapter.mjs`, `task-store.mjs`, `mcp-server.mjs`, `mcp-proxy-bridge.mjs`, and `http-server.mjs`, plus the public page and package files. In this deployment worktree, the required runtime sources are absent from `apps/server`; only the older server module set is present. Running the actual package command against this checkout fails before archive creation:

```text
VoxCode server command failed: ENOENT: no such file or directory, lstat '/private/tmp/voxcode-79-deployment/apps/server/server-cli.mjs'
```

The 16 deployment tests pass because their packaging fixture synthesizes the allowlisted files; they do not exercise this repository's real source tree. This is a P1 release gate: upload/deploy cannot be performed from the reviewed checkout and a passing fixture does not establish an integrated package. Merge the runtime sources into the exact base or make packaging target the actual integrated source layout, then run the real `package` command and inspect/decode the resulting archive before deployment.

## P2 — Revision is an operator assertion, not checked against Git state

`package.mjs` accepts a caller-provided hexadecimal revision and packages the working tree without checking that the checkout is clean or that the value resolves to `HEAD`. `DEPLOY.md` documents this as an operator assertion and requires a clean reviewed checkout, so it is not an undisclosed bypass. A stale or dirty checkout can nevertheless be labeled as a different revision by mistake. Before production use, add an explicit clean-tree/HEAD check or require a recorded source manifest supplied by the coordinator; until then keep this as a documented release-process gate.

## Confirmed controls

- Bundle extraction is regular-file-only ustar with traversal, duplicate, link, extension, size, manifest, per-file checksum, dependency-lock and archive checksum checks. `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` runs in a temporary release before atomic installation.
- Upload verifies the archive hash remotely before rename; SSH/SCP enforce strict host-key checking, key mode checks and bounded arguments. Password transport is restricted to fixed vm6/root and reads the private password file inside Expect, without putting its contents in argv or logs.
- Remote management requires root, exact Node major 22, root-owned protected paths, a lock, exact reviewed dual systemd units, separate Web/task identities/groups, private config and state paths, fixed project mount, active PID/cgroup/listener ownership, and task-before-Web restart ordering.
- Activation verifies the target and current release manifests, atomically switches `current`, health-checks HTTPS certificate identity and exact revision plus `codexAvailable:true`, and restores the prior symlink on failure. Shared state/config and old releases remain untouched. Status/log output is bounded and raw journal messages are omitted.
- The templates isolate `voxcode` Web from `voxcode-task` Codex, use `NoNewPrivileges`, empty capabilities, `KillMode=control-group`, restricted mounts and no sudo wrapper. First deployment and task RPC identity remain blocked until manual host verification.

## Verification and disposition

`/Users/liyan2026mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/node --test scripts/test/server-deploy.test.mjs`: **16/16 passed** on macOS/Node 22.22.2. `git diff --check`: passed. The actual package command failed with the P1 missing-source error above. Fixtures cover temporary npm install, symlink activation/rollback, local HTTPS IP-SAN health and SSH/systemd/account seams; they do not prove Linux cgroup cleanup, real Codex execution, live MCP/voice, phone acceptance or vm6 deployment.

Resolve the missing integrated runtime source/package gate, rerun the real package command and obtain two independent follow-up reviews before any vm6 deployment. No live deployment or live Linx/MCP acceptance is implied by this report.

## Follow-up — 2026-10-25

The missing-source P1 is resolved in the integrated snapshot. The real package command produced `/private/tmp/voxcode-runtime-integrated.tar.gz`, SHA-256 `858897369a8d365a06c44540a0b3e4e2d3f82d8ae8ee031720a3bd8a7183c418`; decoding verified 21 runtime/template entries with matching checksums. Deployment regression tests pass **16/16** under Node 22.23.4. This is a working-tree integration check; the package is not a published release. Revision remains an operator assertion requiring a clean reviewed checkout. Live Linux/systemd/account, vm6, Codex, MCP and voice acceptance remain pending.
