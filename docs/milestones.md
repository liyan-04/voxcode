# Phone-demo milestones and pull requests

The user requested a visible pull request at every verifiable milestone on 2026-10-23. The coordinator performs Git operations for the shared checkout; each PR identifies the actual implementation agent and task. Do not invent separate agent Git identities or count a coordinator commit as independent review.

## Publication rules

- Publish a focused Draft PR when the milestone's relevant checks pass. List unfinished verification and both component reviews explicitly; review can continue on the published snapshot.
- Keep each component's implementation and relevant tests/docs in its own commit and PR. A follow-up fix gets a focused fix commit; publish another PR when it is a separate milestone.
- Each developer uses an independent Git worktree and component branch; the coordinator uses a separate integration worktree. Preserve the original shared checkout during migration. Every PR names its actual base and dependency. Retarget and rerun verification after dependencies merge; do not automatically merge.
- The source PR remains draft until its required checks and two independent reviews are resolved. Code review does not certify signing, device, live voice or outdoor delivery.
- Save task ownership, commands, findings and resolutions in the repository and link them from the PR. Report real evidence classes and the reviewed revision.
- After milestone checks pass, create an annotated tag on the exact milestone commit with `git tag -a milestone/<short-name> <commit> -m "milestone: <short-name>"`, push it with the PR branch, and put the exact tag in the PR's `## Milestone tag` section. Do not create or move a tag before verification.
- After a milestone PR is merged, apply [the post-merge cleanup policy](architecture/cleanup-policy.md). Cleanup never removes the PR or its evidence; it removes only verified dependency-free topic resources, and only the coordinator performs it.

## Current milestones

| Milestone | Implementation owner | Scope and evidence | Pull request |
| --- | --- | --- | --- |
| M0 / ARCH-002 | `/root/architect` with `/root` for shared contracts | Source tasks released; PCM and authenticated local monitor interfaces applied | Pending publication |
| M1 / MAC-002+003 | `/root/mac_v1` | Durable sessions, configurable scheduling, versioned acceptance and local aggregates; worker reports 41 local/fixture tests passed. Root verified a real local two-turn Codex file edit/follow-up separately. Two source reviews pending. | Pending publication |
| M2 / RELAY-002 | `/root/relay_v1` | Strict fixed-IP TLS, bounded exact routes, certificate helper; worker reports 28 local/fixture tests passed. Deferred preview remains unimplemented. Two source reviews pending. | Pending publication |
| M3 / VOICE-002+RUNTIME-001 | `/root` | Linx tools/drafts, PCM codec, unified Mac launch and 24-task controlled benchmark; 22 voice/runtime checks passed locally. Independent reviews in progress; real Linx unavailable. | Pending publication |
| M4 / IOS-002+003 | `/root/ios_v1` | Native recording ownership, task/results/acceptance, strict trust, PCM and labelled simulation; implementation and SDK verification in progress | Pending publication |

Deployment remains deferred. All milestone publication is a code/document checkpoint, not completion of the native phone or outdoor acceptance gates.
