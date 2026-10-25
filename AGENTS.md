# VoxCode engineering rules

## Scope
- Current user-approved scope supersedes historical native/Relay requirements below: phone browser only, server VoxCode HTTPS/WSS, server-side 灵矽 voice/MCP and Codex CLI (not App Server). Read [current architecture](docs/architecture/current.md), [product workspace](docs/product/voice-code-workspace.md) and [contract](docs/architecture/voice-code-workspace-contract.md) first. Mac, Relay, Connector and native iOS are historical modules outside this delivery. Keep all collaboration, security and verification rules; first-batch draft/confirm and unverified voice-correlation gates remain mandatory.
- Build the current server-hosted task workspace: the protected `apps/server/task-cli.mjs` runtime, server-side Codex CLI integration, HTTP/MCP modules and the browser voice-workspace contract. Read [the current architecture](docs/architecture/current.md), [the workspace contract](docs/architecture/voice-code-workspace-contract.md) and [task/history boundaries](docs/architecture/task-state-and-history.md). The removed Mac, Relay and native iOS execution design is historical and must not be used as current setup guidance.
- Read CONTRIBUTING.md and docs/agent-collaboration.md for mandatory commit/PR and multi-agent rules. Read docs/architecture/current.md, docs/architecture/voice-code-workspace-contract.md, docs/architecture/task-state-and-history.md and docs/contract.md before implementation; docs/phone-demo-scope.zh-CN.md and docs/implementation-v1.md are historical phone-demo records, while docs/product-proposal.zh-CN.md and docs/plan.md are historical broader plans.
- Record decisions, alternatives, evidence, limitations and optimization proposals in docs/. Do not record private internal reasoning or credentials.
- Never claim mock output is real Codex or Linx output.
- The first demo is the native VoxCode app with real task progress/diff/checks/acceptance. Interactive generated-site preview, full workbench and custom screen control are deferred. Preserve benchmarks and lightweight authenticated monitoring. The user explicitly removed the AirPlay protocol constraint on2026-10-24.

## Collaboration
- Start new development, bugfix, architecture, deployment and acceptance work from a GitHub Issue. Record the primary owner/agent role, exclusive writable paths, dependencies and observable acceptance criteria. Follow [Issue collaboration](docs/issue-collaboration.md) and use `.github/ISSUE_TEMPLATE/`.
- The coordinator allocates Issues and paths before agents edit. Each parallel worker uses a child Issue and an independent worktree; post start/blocker/handoff evidence on the Issue through an authorized coordinator. Shared contracts and integration are serialized.
- Workers edit only their assigned paths. The coordinator owns shared contracts and integration.
- The architect also owns project documentation and delivery consistency: root/module READMEs, runnable build/install/deployment entry points and rollback instructions. Developers update their module documentation with behavior changes; the coordinator allocates paths and checks code/docs/scripts together at every milestone. Missing tools, signing, live or deployment evidence stay explicit. Script maintenance does not add deployment authority.
- A dedicated architect agent coordinates the iOS, Mac and Relay developers: technical task briefs, interfaces, dependency order, blockers and cross-component checks. Read docs/architecture/README.md. The coordinator retains Git/PR, integration and shared-file mutation ownership; architect checks do not replace the two independent component reviews.
- Before dispatch, record goal, writable paths, contract/dependencies and verification criteria. Each developer uses an independent worktree and component branch; preserve the original checkout during migration. Workers must not stage, commit, stash, switch branches or push.
- Do not commit another worker's changes. Coordinator makes scoped commits after verification.
- Each implementation component requires two reviews independent of its implementer; save reviewed revision, findings and resolutions under docs/reviews/. AI reports are not human GitHub approvals or user acceptance.
- Record real verification commands and outcomes in docs/progress.md. Pending verification stays pending.
- After a PR is merged into the current base, follow [docs/architecture/cleanup-policy.md](docs/architecture/cleanup-policy.md): preserve PR/review/progress evidence, then let the coordinator remove only verified, dependency-free topic branches, clean worktrees and disposable build artifacts. Never delete protected branches, unmerged work or a dirty worktree.

## Safety and correctness
- Codex runs locally on the execution server through stdio. Do not automate IDE keystrokes or expose an unauthenticated App Server. The retained `apps/mac` path is an implementation module name, not a requirement to run on macOS.
- Pairing authorizes the selected server/project; secrets stay server-side and out of logs. Use a dedicated non-root task account; environment filtering is not same-UID file-read isolation. Protect Relay private keys/config with a separate identity; stronger task/voice credential isolation needs an explicit boundary.
- Freeze task target at recording start. Deduplicate mutations using requestId.
- Default four execution slots, configurable 1–8; each task has at most one active turn. Separate worktrees, data directories and immutable result artifacts. Stopping/waiting-approval turns retain their slots; lowering the limit only affects future dispatch.
- Native remote transport uses TLS on the fixed IP with explicit certificate trust; no domain or existing HTTPS is required from the user. Do not accept arbitrary certificates or send remote control credentials over plaintext.
- Deployment and isolated validation are authorized on vm6 through liyan-server. Current entry is `https://100.100.81.209:9899`, reached by the user's phone VPN; strict TLS/IP SAN and reviewed CA remain mandatory. Confirm ownership of the existing9899process before any update; if unrelated, stop and notify. An occupied port is never implicit permission to replace it. Linux/live/device/outdoor checks remain required.
- Cancellation is asynchronous and never implies rollback.
- Execution completion, operation approval and user acceptance are distinct.
- Do not expose preview files, extra ports or the server filesystem without authorization.

## Git
- Required subject: type(scope): summary, lowercase type/scope, at most 100 Unicode characters. Types: feat, fix, docs, test, refactor, chore, ci, perf, build, revert. Example: feat(mac): add durable task snapshots.
- `master` is the sole integration and default branch. Create `codex/<issue-number>-<purpose>` topic branches from current `origin/master` and target every new PR at `master`; existing topic names are grandfathered. Retired `codex/mvp` and `codex/phone-demo` are not integration targets. Direct commits or pushes to `main`, `master` or the retired `codex/mvp` name are forbidden. Never force-push, commit secrets or merge unreviewed implementation.
- Commit one coherent change with relevant tests/docs and validation evidence. Coordinator stages explicit paths and inspects the staged diff; never git add . in a shared checkout.
- Follow the PR template: Summary, Validation, Risks, Review and milestone tag. Keep incomplete work/reviews in draft. The user authorizes the coordinator to mark ready and squash-merge reviewed PRs after actual checks; this never waives outstanding review or device/live gates. Deployment follows the separate host/service authorization above.
- Every new PR links its primary Issue with a visible `Refs #N` or `Fixes #N` line. Use `codex/<issue-number>-<purpose>` for new topic branches. `Fixes` means all criteria for that Issue are met; keep separate live/device/outdoor gates open. The local PR checker validates linkage syntax; the coordinator verifies the target Issue and evidence.
- Install npm run hooks:install in each active checkout. Run npm run test:policy when changing repository policy. GitHub Actions checks are disabled; local hooks, exact validation records and human PR reviews are the enforcement path.

## Quality
- Write focused regression tests for task isolation, authorization, replay, cancellation and approval expiry before implementing them.
- No fake progress percentages. UI distinguishes disconnected, queued, running, waiting, interrupted, failed and awaiting acceptance.
- Pin dependencies and document supported runtime versions.
- Fix P0/P1 findings before claiming the corresponding component ready.
- Every handoff lists changed paths, behavior/contracts, actual commands/results, evidence environment, missing checks and next steps. Distinguish simulation/fixture/local/live/device/outdoor; never infer live or device success from fixtures.
