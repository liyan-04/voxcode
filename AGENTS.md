# VoxCode engineering rules

## Scope
- Build a two-day hackathon MVP: iPhone voice controller, Mac Codex executor, Linx AI voice integration.
- Read CONTRIBUTING.md and docs/agent-collaboration.md for mandatory commit/PR and multi-agent rules. Read docs/phone-demo-scope.zh-CN.md, docs/contract.md and docs/implementation-v1.md before implementation; docs/product-proposal.zh-CN.md and docs/plan.md are historical broader plans.
- Record decisions, alternatives, evidence, limitations and optimization proposals in docs/. Do not record private internal reasoning or credentials.
- Never claim mock output is real Codex or Linx output.
- The first demo is the native VoxCode app with real task progress/diff/checks/acceptance. Interactive generated-site preview, full Mac workbench and custom AirPlay control are deferred. Preserve benchmark scripts and lightweight authenticated monitoring; do not build a monitoring platform before the core loop. Original competition AirPlay compliance remains unconfirmed.

## Collaboration
- Workers edit only their assigned paths. The coordinator owns shared contracts and integration.
- A dedicated architect agent coordinates the iOS, Mac and Relay developers: technical task briefs, interfaces, dependency order, blockers and cross-component checks. Read docs/architecture/README.md. The coordinator retains Git/PR, integration and shared-file mutation ownership; architect checks do not replace the two independent component reviews.
- Before dispatch, record goal, writable paths, contract/dependencies and verification criteria. Each developer uses an independent worktree and component branch; preserve the original checkout during migration. Workers must not stage, commit, stash, switch branches or push.
- Do not commit another worker's changes. Coordinator makes scoped commits after verification.
- Each implementation component requires two reviews independent of its implementer; save reviewed revision, findings and resolutions under docs/reviews/. AI reports are not human GitHub approvals or user acceptance.
- Record real verification commands and outcomes in docs/progress.md. Pending verification stays pending.

## Safety and correctness
- Codex is local to the Mac. Do not automate IDE keystrokes or expose an unauthenticated App Server.
- Pairing must authorize a specific Mac and project; secrets stay server-side and out of logs.
- Freeze task target at recording start. Deduplicate mutations using requestId.
- Default four execution slots, configurable 1–8; each task has at most one active turn. Separate worktrees, data directories and immutable result artifacts. Stopping/waiting-approval turns retain their slots; lowering the limit only affects future dispatch.
- Native remote transport uses TLS on the fixed IP with explicit certificate trust; no domain or existing HTTPS is required from the user. Do not accept arbitrary certificates or send remote control credentials over plaintext.
- Deployment remains deferred until the user explicitly resumes it. Recheck bili-xs8:9899 first; if occupied, stop and notify without touching the existing service.
- Cancellation is asynchronous and never implies rollback.
- Execution completion, operation approval and user acceptance are distinct.
- Do not expose preview files, ports or the Mac filesystem without authorization.

## Git
- Required subject: type(scope): summary, lowercase type/scope, at most 100 Unicode characters. Types: feat, fix, docs, test, refactor, chore, ci, perf, build, revert. Example: feat(mac): add durable task snapshots.
- Use codex/ branches and verify the target base (currently codex/mvp). Never force-push, commit secrets or merge unreviewed implementation.
- Commit one coherent change with relevant tests/docs and validation evidence. Coordinator stages explicit paths and inspects the staged diff; never git add . in a shared checkout.
- Follow the PR template: Summary, Validation, Risks, Review. Keep incomplete work/reviews in draft; prefer reviewed squash merges. Do not merge or deploy automatically.
- Install npm run hooks:install in each active checkout. Run npm run test:policy when changing repository policy. CI checks metadata/subjects; required merge enforcement still depends on GitHub branch protection.

## Quality
- Write focused regression tests for task isolation, authorization, replay, cancellation and approval expiry before implementing them.
- No fake progress percentages. UI distinguishes disconnected, queued, running, waiting, interrupted, failed and awaiting acceptance.
- Pin dependencies and document supported runtime versions.
- Fix P0/P1 findings before claiming the corresponding component ready.
- Every handoff lists changed paths, behavior/contracts, actual commands/results, evidence environment, missing checks and next steps. Distinguish simulation/fixture/local/live/device/outdoor; never infer live or device success from fixtures.
