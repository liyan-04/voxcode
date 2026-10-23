# Two-day MVP implementation plan

Status: historical first implementation checklist. User confirmed continuation of the revised proposal on 2026-10-23. Use [implementation-v1.md](implementation-v1.md) for resumed work; its configurable 1–8 slots supersede the two-slot assumptions below. Deployment remains deferred.

> For agentic workers: use subagent-driven-development; read AGENTS.md, design.md and contract.md first.

**Goal:** Deliver a reviewable phone-to-Mac development loop with real integration gates.
**Architecture:** Separate phone client, Mac execution bridge and Linx protocol adapter. Stable HTTP contract enables parallel implementation; coordinator integrates and records decisions.
**Tech stack:** Node >=22 ESM, built-in test runner, SwiftUI iOS 17+ native client.
**Spec:** docs/design.md.

## Global constraints
- Two execution slots and independent worktrees/resources.
- Secrets never committed or sent to client.
- No implementation can be marked integration-tested using fixtures alone.
- Each component receives two independent expert reviews and fixes for blocking findings.

## Day 1
- [x] Inspect empty remote and local toolchain.
- [x] Record design, contract, commit constraints and known review findings.
- [x] Mac worker: write failing authorization/idempotency/isolation tests; implement durable HTTP task service and Codex stdio adapter; run tests. Real model task still gated below.
- [x] Voice worker: write failing handshake/audio/error tests; implement Linx adapter and credential validation; run tests. Live provider validation remains below.
- [x] Client worker: implement native SwiftUI pairing, tasks, frozen recording target, transcript editing, results and acceptance; test target binding and stale updates. Native SDK/device build remains below.
- [ ] Verify real Codex protocol on installed version, real microphone access and reachable preview.

## Day 2
- [ ] Two independent Mac expert reviews; resolve and record findings.
- [ ] Two independent voice expert reviews; resolve and record findings.
- [ ] Two independent client expert reviews; resolve and record findings.
- [ ] Integrate voice, run two independent development tasks, verify stale approval rejection and reconnect.
- [ ] Test on iPhone; verify AirPlay with real receiver.
- [ ] Record demo, known limitations and rehearsal results; prepare reviewable branch/PR.

## Requirement changes
- Native iOS explicitly chosen; PWA is not an acceptable silent substitution.
- Outdoor remote operation became core. Relay and outbound connector source/tests implemented; trusted public TLS and deployment remain unverified.
- Initial relay deployment to bili-xs8 loopback:9899 authorized only if port free; user later deferred deployment after JumpServer403. Recheck before any future deployment.
- Codex continuity, true preview, live Linx dialogue and installed native app are acceptance gaps, not completed checklist items.

## Acceptance
- Target misrouting: zero across ten voice instructions; errors editable before submission.
- At most two tasks run; task changes never touch another task's worktree.
- Polling updates real progress within three seconds on LAN.
- Client reconnect recovers snapshots without duplicate submission.
- Phone opens task-specific preview; evidence matches task version.
- Approval accepted once, stale or cancelled approval rejected.
- Codex completion is not automatic user acceptance.
- Three-to-five minute demo: dispatch, parallel switch, clarification/approval, preview, correction, acceptance.
