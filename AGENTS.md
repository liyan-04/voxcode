# VoxCode engineering rules

## Scope
- Build a two-day hackathon MVP: iPhone voice controller, Mac Codex executor, Linx AI voice integration.
- Read docs/design.md, docs/contract.md and docs/plan.md before implementation.
- Record decisions, alternatives, evidence, limitations and optimization proposals in docs/. Do not record private internal reasoning or credentials.
- Never claim mock output is real Codex or Linx output.

## Collaboration
- Workers edit only their assigned paths. The coordinator owns shared contracts and integration.
- Do not commit another worker's changes. Coordinator makes scoped commits after verification.
- Each client, Mac and voice component requires two independent expert reviews; save findings and resolutions under docs/reviews/.
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
- Use Conventional Commits: feat, fix, docs, test, refactor, chore, ci, perf.
- Format: type(scope): imperative summary. Example: feat(mac): add durable task snapshots.
- Use codex/ branches. Never force-push, commit secrets, or merge unreviewed implementation to main.
- Commit focused logical changes with validation evidence; no generated dependencies or recordings.

## Quality
- Write focused regression tests for task isolation, authorization, replay, cancellation and approval expiry before implementing them.
- No fake progress percentages. UI distinguishes disconnected, queued, running, waiting, interrupted, failed and awaiting acceptance.
- Pin dependencies and document supported runtime versions.
- Fix P0/P1 findings before claiming the corresponding component ready.
