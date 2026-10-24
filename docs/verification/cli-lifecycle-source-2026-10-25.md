# CLI lifecycle source milestone

Issue: #72. Local macOS Node26 fixture tests: `node --test apps/server/test/codex-cli-adapter.test.mjs`, 11/11 pass. This batch provides draft/confirm, bounded CLI JSONL output, persistent request/revision identity, cancellation and restart quarantine. It does not use App Server.

Independent review subsequently reproduced two P1 races: cancellation during confirm persistence can observe an uninitialized stop handler; cancellation-state persistence failure can prevent process signals and strand cancellation. Both remain open in this initial Draft milestone and must be fixed with regressions before readiness or deployment. See `docs/reviews/codex-cli-delivery-review.md` when attached.

The host denied negative-PGID liveness probes with EPERM; the descendant test verified quarantine instead of Linux successful cleanup. Linux cancellation, real model execution, session resume and result evidence remain unverified. Fixed single project root is not per-task worktree isolation. This milestone intentionally exposes the source for review without claiming end-to-end completion.
