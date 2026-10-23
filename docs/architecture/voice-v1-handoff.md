# M3: Voice, runtime and benchmark milestone

Tasks: VOICE-002 and RUNTIME-001. Implementer and Git coordinator: `/root`.
Independent worktree: `.worktrees/integration`, branch `codex/integration-phone-demo`.
Base shared contract: `a352757` (PR #2); integration includes Mac `c40e1d6`
and Relay `c26fb62` (PRs #3/#4), cherry-picked without merging any GitHub PR.

## Behavior

Six scoped Linx MCP tools read actual task state/evidence or propose frozen,
expiring drafts/focus. No voice tool dispatches code, approves an operation or
accepts a result. Documented hello placeholders supply the frozen target/policy.
The bridge decodes provider Opus to bounded signed PCM with a pinned codec and
serves ordered bounded events. Abort stops voice output only. Request identity,
tool deduplication, authorization and session cleanup remain explicit.

A unified Mac entry starts the loopback bridge and optional outbound connector,
rejects partial configuration and closes both resources. The controlled benchmark
manages 24 tasks and tests four-slot occupancy, queueing, cancellation and replay.
The real Codex smoke verifies two turns, actual file contents and owned-thread
continuity in a temporary Git project.

## Actual Verification

Coordinator ran `npm run test:coverage:node` on 2026-10-23 in this worktree:
117 passed, zero failed/skipped; Node 26 local/fixture evidence. Coverage summary:
91.95% lines and 81.88% branches. This is a local collection, not a claim that
the PR's changed-code/baseline CI gates have passed.

`node scripts/benchmark.mjs --output coverage/benchmark.json` passed: 24 executions
started once, at most four active, fifth queued, 23 completed and one cancelled;
stopping retained a slot until termination. Create/list/status samples were
24/60/60 with zero unexpected responses. This is loopback HTTP with a gated
executor and temporary directories; it excludes real models, Git worktree setup,
TLS, native UI, Linx and outdoor latency. Machine-readable reports include
revision/dirty state, environment, counts and p50/p95/p99; no threshold was set.

The separate earlier `live-local` smoke completed two real model turns, verified
`VOXCODE_OK` then `VOXCODE_FOLLOWUP` in a file and the same owned thread (ten
events). It does not establish live Linx, iOS or outdoor completion.

## Review And Remaining Gates

`/root/mac_v1` independently reproduced revoked authorization during slow create
and closed-session audio/draft retention. Focused tests first failed, then passed
after reauthorization at await boundaries and closed-session cleanup/poll rejection.
A targeted review found timer cleanup could retain closed sessions forever;
preserving TTL deletion plus an expiry/capacity regression addresses that finding.
Independent follow-up and `/root/relay_v1` review remain required. The original
report is retained under `docs/reviews/phone-demo-voice-execution.md`.

Mac authorization/approval findings and Relay Node 22 shutdown CI failures remain
under their owners' separate fix tasks at publication. Native SDK tests, two source
reviews per component, real Linx, signed iPhone and outdoor acceptance remain
open. The current environment has no configured Linx onboarding fields. Never
substitute fixture evidence for those gates. Deployment remains deferred.
