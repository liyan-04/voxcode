# Legacy Server CLI Retirement

Issue: [#139](https://github.com/liyan-04/voxcode/issues/139).
Implementation base: `fe0d921`; branch/worktree allocated by the coordinator.
Evidence is local source inspection and fixtures on macOS arm64; no live
service operation is part of this milestone.

## Scope And Dependency Audit

The removed `scripts/server/cli.mjs` orchestrated the historical `/opt/voxcode`
Web/task service layout. It is separate from `/srv/voxcode-control` and from the
retained `apps/server/server-cli.mjs` and `task-cli.mjs` runtime entries.

Before deletion, repository-wide searches found its only code consumer in
`scripts/test/server-deploy.test.mjs`: `parseArgs`, `transport` and `runCli`.
The only active recommended invocations were in `apps/server/DEPLOY.md`.
The deployment review's recorded path/hash is historical evidence and is
preserved, together with all progress/review records. No additional active
documentation path required a change.

The package, upload, deploy, start, stop, restart, status, logs and rollback
commands are retired. The old package subcommand has no CLI entry after this
change. Retained programmatic bundle/package/remote modules and the password
transport helper are not supported current deployment commands. No unpublished
Issue #122 replacement command is introduced.

## Test Preservation

Only the deleted entry's import, SSH/orchestration case and argument parser
assertions are removed. The mixed SSH case's `safeRoot` and `parseConfig`
assertions remain in a module-level validation case. The mixed lifecycle case
retains actual journal filtering/redaction checks.

The combined deployment file is retained without skips. Its bundle/hash,
committed-source packaging, real temporary npm install, strict local HTTPS,
service/cgroup ownership, identity/config preflight, atomic activation,
failed-activation recovery, rollback, lifecycle and synthetic Expect regressions
remain. No retained deployment module or runtime entry was changed.

## Verification

Environment: macOS arm64, Node.js `v26.0.0`. Pinned dependencies were installed
with `npm ci --ignore-scripts --offline` in the root, `apps/server`,
`packages/voice` and `apps/mac-agent`; no manifest or lockfile changed.

Baseline: `node --test scripts/test/server-deploy.test.mjs` passed 17/17 before
the cleanup. Final commands all exited 0 with no failures, skips or cancellations:

| Command | Result |
| --- | --- |
| `node --test scripts/test/server-deploy.test.mjs` | 16/16 passed |
| `npm run test:policy` | 61/61 passed |
| `npm test` | 399/399 passed |
| `node --test packages/control-protocol/test/*.test.mjs apps/mac-agent/test/*.test.mjs` | 41/41 passed |
| `git diff --check` | Passed |

The deployment count decreases by one because the removed upload/deploy
orchestration case exercised only `runCli`. The SSH case becomes the retained
root/config case, and the lifecycle case retains its journal module assertions.

Post-change searches find no remaining import of the retired CLI and no active
recommended invocation. Mentions of its path in the retirement documentation
and earlier deployment review identify removed code or historical evidence.
The protected bundle/package/remote/password helper and runtime entries remain
unchanged. These are source/fixture checks, with real temporary archive/npm and
local HTTPS behavior; they do not exercise vm6 or a model/provider.

Coordinator integration onto master2cdfa1f preserved the frozen source/test
changes. Both independent reviews pass under docs/reviews/legacy-server-cli-*.md.
The coordinator repeated focused deployment tests (16/16) and the complete
serial Node/policy/voice suite (exit0, expected opt-in launchd skip) after
integration; active-reference search and diff checks pass. The scoped PR and
merge remain coordinator publication gates.
This milestone provides no live host, restart, private configuration, rollback
file cleanup, device or outdoor acceptance evidence.
