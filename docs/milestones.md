# Phone-demo milestones and pull requests

The user requested a visible pull request at every verifiable milestone on 2026-10-23. The coordinator performs Git operations for the shared checkout; each PR identifies the actual implementation agent and task. Do not invent separate agent Git identities or count a coordinator commit as independent review.

## Publication rules

- Publish a focused Draft PR when the milestone's relevant checks pass. List unfinished verification and both component reviews explicitly; review can continue on the published snapshot.
- Keep each component's implementation and relevant tests/docs in its own commit and PR. A follow-up fix gets a focused fix commit; publish another PR when it is a separate milestone.
- Each developer uses an independent Git worktree and component branch; the coordinator uses a separate integration worktree. Preserve the original shared checkout during migration. Every PR names its actual base and dependency. Retarget and rerun verification after dependencies merge; do not automatically merge.
- The source PR remains draft until its recorded local validation and two independent reviews are resolved. Code review does not certify signing, device, live voice or outdoor delivery.
- Save task ownership, commands, findings and resolutions in the repository and link them from the PR. Report real evidence classes and the reviewed revision.
- Every PR receives an annotated tag on its exact commit using the next `VoxCode<major>.<minor>.<patch>` after the highest existing semantic version. Increment patch for a small PR, minor for a larger compatible progress step, and major for a major release or incompatible milestone. Create and push the tag only after verification, and put the exact tag in the PR's `## Milestone tag` section.
- After a milestone PR is merged, apply [the post-merge cleanup policy](architecture/cleanup-policy.md). Cleanup never removes the PR or its evidence; it removes only verified dependency-free topic resources, and only the coordinator performs it.

## Current milestones

| Milestone | Implementation owner | Scope and evidence | Pull request |
| --- | --- | --- | --- |
| M0 / ARCH-002 | `/root/architect` with `/root` for shared contracts | Source tasks released; PCM and authenticated local monitor interfaces applied; a352757 | [Draft #2](https://github.com/liyan-04/voxcode/pull/2) |
| M1 / MAC-002+003 | `/root/mac_v1` | Durable sessions, scheduling, acceptance and local aggregates. MAC-004/005 sourcef4114f2 repairs authorization/approval P1s, split UTF-8 bodies and no-effect business rejection. Root and both independent reviewers reproduced74/74; source CI passed. | [Draft #3](https://github.com/liyan-04/voxcode/pull/3) |
| M2 / RELAY-002 | `/root/relay_v1` | Strict fixed-IP TLS, exact routes, certificate helper. RELAY-003 de8fc2d repairs accepted pre-TLS socket shutdown; 28 local/fixture passes, Linux Node 22 CI and two independent targeted reviews passed. | [Draft #4](https://github.com/liyan-04/voxcode/pull/4) |
| M3 / VOICE-002+RUNTIME-001 | `/root` | Linx tools/drafts, PCM codec, unified launch and24-task controlled benchmark. Integration3fca98f:151 Node checks passed, lines92.51%/branches83.26%; two real local Codex turns/file verification previously passed. Voice sourcebdd7f29 has two independent reviews; native final CI tracked below. Real Linx unavailable. | [Draft #6](https://github.com/liyan-04/voxcode/pull/6) |
| M4 / IOS-002+003 | `/root/ios_v1` | Native task/results/acceptance, strict trust, PCM and labelled24-task simulation. IOS-004/005 source5c2b9a7 fixes definite rejection, refresh/replay ordering and re-record identity. Both independent targeted reviews complete; final exact-source CI39988267625 passed coverage, unsigned SDK build and native XCTest. | [Draft #5](https://github.com/liyan-04/voxcode/pull/5) |

Deployment remains deferred. All milestone publication is a code/document checkpoint, not completion of the native phone or outdoor acceptance gates.
