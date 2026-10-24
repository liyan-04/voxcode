# VoxCode engineering rules

## Scope
- Build a two-day hackathon MVP: iPhone voice controller, Mac Codex executor, Linx AI voice integration.
- Read CONTRIBUTING.md and docs/agent-collaboration.md for mandatory commit/PR and multi-agent rules. Read docs/phone-demo-scope.zh-CN.md, docs/contract.md and docs/implementation-v1.md before implementation; docs/product-proposal.zh-CN.md and docs/plan.md are historical broader plans.
- Record decisions, alternatives, evidence, limitations and optimization proposals in docs/. Do not record private internal reasoning or credentials.
- Never claim mock output is real Codex or Linx output.
- The first demo is the native VoxCode app with real task progress/diff/checks/acceptance. Interactive generated-site preview, full Mac workbench and custom AirPlay control are deferred. Preserve benchmark scripts and lightweight authenticated monitoring; do not build a monitoring platform before the core loop. Original competition AirPlay compliance remains unconfirmed.

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
- Codex is local to the Mac. Do not automate IDE keystrokes or expose an unauthenticated App Server.
- Pairing must authorize a specific Mac and project; secrets stay server-side and out of logs.
- Freeze task target at recording start. Deduplicate mutations using requestId.
- Default four execution slots, configurable 1–8; each task has at most one active turn. Separate worktrees, data directories and immutable result artifacts. Stopping/waiting-approval turns retain their slots; lowering the limit only affects future dispatch.
- Native remote transport uses TLS on the fixed IP with explicit certificate trust; no domain or existing HTTPS is required from the user. Do not accept arbitrary certificates or send remote control credentials over plaintext.
- The approved remote delivery path is iPhone cellular + user VPN → HTTPS vm6 `100.100.81.209:9899` ← outbound Mac WSS Connector → loopback Bridge → local Codex. Read [the VPN delivery and acceptance runbook](docs/architecture/vm6-vpn-delivery.md) before architecture/development/device verification. `121.52.250.201` belongs to bili-xs8 and is not this deployment; a public-IP mapping is not required for this accepted VPN demo. VPN never replaces strict TLS, pairing or authorization.
- Relay deployment is authorized on personal vm6 via the liyan-server skill. Check9899 before changes; if occupied by another service or ownership is uncertain, stop and notify. An existing VoxCode process requires ownership confirmation and a planned update/rollback, not a second listener or an arbitrary kill. User-reported installation/TCP/loopback evidence is recorded separately; matching-IP TLS, Connector and same-build cellular+VPN acceptance remain pending. No credentials/private keys enter GitHub.
- Cancellation is asynchronous and never implies rollback.
- Execution completion, operation approval and user acceptance are distinct.
- Do not expose preview files, ports or the Mac filesystem without authorization.

## Git
- Required subject: type(scope): summary, lowercase type/scope, at most 100 Unicode characters. Types: feat, fix, docs, test, refactor, chore, ci, perf, build, revert. Example: feat(mac): add durable task snapshots.
- `master` is the sole integration and default branch. Create `codex/<issue-number>-<purpose>` topic branches from current `origin/master` and target every new PR at `master`; existing topic names are grandfathered. Retired `codex/mvp` and `codex/phone-demo` are not integration targets. Direct commits or pushes to `main`, `master` or the retired `codex/mvp` name are forbidden. Never force-push, commit secrets or merge unreviewed implementation.
- Commit one coherent change with relevant tests/docs and validation evidence. Coordinator stages explicit paths and inspects the staged diff; never git add . in a shared checkout.
- Follow the PR template: Summary, Validation, Risks, Review. Keep incomplete work/reviews in draft; prefer reviewed squash merges. Do not merge or deploy automatically.
- Every new PR links its primary Issue with a visible `Refs #N` or `Fixes #N` line. Use `codex/<issue-number>-<purpose>` for new topic branches. `Fixes` means all criteria for that Issue are met; keep separate live/device/outdoor gates open. The local PR checker validates linkage syntax; the coordinator verifies the target Issue and evidence.
- Install npm run hooks:install in each active checkout. Run npm run test:policy when changing repository policy. GitHub Actions checks are disabled; local hooks, exact validation records and human PR reviews are the enforcement path.

## Quality
- Write focused regression tests for task isolation, authorization, replay, cancellation and approval expiry before implementing them.
- No fake progress percentages. UI distinguishes disconnected, queued, running, waiting, interrupted, failed and awaiting acceptance.
- Pin dependencies and document supported runtime versions.
- Fix P0/P1 findings before claiming the corresponding component ready.
- Every handoff lists changed paths, behavior/contracts, actual commands/results, evidence environment, missing checks and next steps. Distinguish simulation/fixture/local/live/device/outdoor; never infer live or device success from fixtures.
