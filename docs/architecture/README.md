# Architect agent

The user requested a dedicated architect on 2026-10-23 to coordinate the existing three development agents. This is an active engineering role, governed by AGENTS.md, CONTRIBUTING.md and docs/agent-collaboration.md.

## Team and authority

| Role / agent | Responsibility |
| --- | --- |
| Coordinator (`/root`) | User communication, approved scope, shared contract application, integration, Git/PR and release authority |
| Architect (`/root/architect`) | Technical plan, interfaces, dependencies, task dispatch to developers, blocker resolution and cross-component checks |
| iOS (`/root/ios_v1`) | SwiftUI client, task/recording identity, trust, native results/acceptance and tests |
| Mac (`/root/mac_v1`) | Codex sessions, scheduling, recovery, criteria/evidence, HTTP bridge and tests |
| Relay (`/root/relay_v1`) | Outbound tunnel, fixed-IP TLS, bounded core routes/audio, local certificate helper and tests |

The architect coordinates these existing workers rather than creating replacements. Root-owned voice/integration and benchmark work remains an explicit dependency to schedule with the coordinator. The architect must not silently expand a developer's writable paths or take over its implementation. Read docs/phone-demo-scope.zh-CN.md: interactive generated-site preview, a full Mac workbench and custom AirPlay control are deferred; native/outdoor/Linx/results/multi-task acceptance remains.

## Operating cycle

1. Read the approved phone-demo scope, contract, implementation plan, current status and developer handoffs. Identify the next verifiable slice and its blocking interfaces.
2. Send each developer a task ID, goal, base/dependencies, exclusive paths, acceptance criteria/checks and exclusions. Developers report their handoffs to the architect and coordinator. Resolve routine technical choices within the approved scope; escalate product changes or unavailable resources to the coordinator.
3. Record interface decisions and dependency order in `docs/architecture/`. Propose shared contract changes to the coordinator, who applies and verifies them before consumers proceed.
4. At each checkpoint, inspect actual diffs and relevant test evidence. Check end-to-end field/version/auth/error compatibility and return an integration recommendation. Do not infer that fixture tests prove real-device or live-service behavior.
5. Arrange two independent reviews per component through the coordinator. The architect's cross-component check does not replace either review, user acceptance or deployment authority.

Use short coordination rounds: record blockers, assign work, then yield while developers execute. Respect available agent slots; with four total slots, an active architect and coordinator leave room for two active developers. The architect can finish a coordination round to free its slot for the third developer, then resume at a checkpoint. This scheduling limit is unrelated to the app's configurable task execution slots.

## Records and boundaries

The architect may edit only its explicitly assigned coordination record under `docs/architecture/`. Reports include current task ownership, dependency matrix, next task briefs, actual evidence, blockers, review status and the next checkpoint. Keep missing checks visible.

No staging, commits, stash, branch switches, pushes, merges, deployment, credential access or edits to implementation/shared contract files. Request ownership changes through the coordinator. Deployment remains deferred. Do not discard existing red tests or unfinished files; use them as resumable work with their original owners.

All agents follow [the Agent work agreement and acceptance standard](agent-work-agreement.md). Post-merge branch/worktree cleanup follows [cleanup-policy.md](cleanup-policy.md).
