# M1: Mac execution milestone

- Task: MAC-002+003; implementer: `/root/mac_v1`; Git coordinator: `/root`.
- Base: `a352757`, `codex/phone-demo-contracts` (PR #2, depends on PR #1).
- Worktree: `.worktrees/mac`; branch: `codex/mac-phone-demo`.
- Exclusive implementation: `apps/mac/**`. Original shared snapshot remains intact.

Durable owned Codex threads resume in the same workspace. An uncertain dispatch blocks follow-up across restart instead of silently creating another thread. Four default execution slots are configurable from one to eight; queued tasks, approvals and stopping work preserve capacity rules. Versioned criteria and trusted command/exit evidence gate manual acceptance. The authenticated loopback monitor exposes bounded aggregate counts and memory only.

## Verification

The coordinator reran `npm test` in this independent worktree's `apps/mac` on 2026-10-23: 41 tests passed, zero failures/skips (Node 26, local/fixture evidence). Coverage includes real temporary Git worktree isolation, process termination, persistent replay, restart uncertainty, settings, approval occupancy, failed-check retention, criteria/acceptance and HTTP authentication. `git diff --check` passed before commit.

The separate real local Codex smoke completed two model turns and verified file content and the same owned thread. That test was run from the retained integration snapshot and does not certify iPhone, Linx or outdoor behavior.

## Remaining Gates

Two independent component reviews and CI coverage remain pending; publish as Draft. Relay and iOS are separate milestones. Unknown-turn recovery remains a local reconciliation operation with fail-closed behavior. No deployment, signed phone test or outdoor test was performed.
