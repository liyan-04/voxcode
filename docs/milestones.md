# Phone-demo milestones and pull requests

The user requested a visible pull request at every verifiable milestone on 2026-10-23. The coordinator performs Git operations for the shared checkout; each PR identifies the actual implementation agent and task. Do not invent separate agent Git identities or count a coordinator commit as independent review.

## Publication rules

- Publish a focused Draft PR when the milestone's relevant checks pass. List unfinished verification and both component reviews explicitly; review can continue on the published snapshot.
- Keep each component's implementation and relevant tests/docs in its own commit and PR. A follow-up fix gets a focused fix commit; publish another PR when it is a separate milestone.
- Each developer uses an independent Git worktree and component branch; the coordinator uses a separate integration worktree. Preserve the original shared checkout during migration. Every PR names its actual base and dependency. Retarget and rerun verification after dependencies merge; do not automatically merge.
- The source PR remains draft until its required checks and two independent reviews are resolved. Code review does not certify signing, device, live voice or outdoor delivery.
- Save task ownership, commands, findings and resolutions in the repository and link them from the PR. Report real evidence classes and the reviewed revision.

## Current milestones

| Milestone | Implementation owner | Scope and evidence | Pull request |
| --- | --- | --- | --- |
| M0 / ARCH-002 | `/root/architect` with `/root` for shared contracts | Source tasks released; PCM and authenticated local monitor interfaces applied; a352757 | [Draft #2](https://github.com/liyan-04/voxcode/pull/2) |
| M1 / MAC-002+003 | `/root/mac_v1` | Durable sessions, scheduling, acceptance and local aggregates; root reproduced 41 local/fixture passes at c40e1d6. Independent review found authorization/approval P1s; MAC-004 fixes in progress. | [Draft #3](https://github.com/liyan-04/voxcode/pull/3) |
| M2 / RELAY-002 | `/root/relay_v1` | Strict fixed-IP TLS, exact routes, certificate helper; root reproduced 28 local/fixture passes at c26fb62 and audit zero after ws 8.22.0. Linux Node 22 CI found incomplete TLS shutdown; RELAY-003 in progress. | [Draft #4](https://github.com/liyan-04/voxcode/pull/4) |
| M3 / VOICE-002+RUNTIME-001 | `/root` | Linx tools/drafts, PCM codec, unified Mac launch and 24-task controlled benchmark; 22 voice/runtime checks passed locally. Independent reviews in progress; real Linx unavailable. | Pending publication |
| M4 / IOS-002+003 | `/root/ios_v1` | Native recording ownership, task/results/acceptance, strict trust, PCM and labelled simulation; implementation and SDK verification in progress | Pending publication |

Deployment remains deferred. All milestone publication is a code/document checkpoint, not completion of the native phone or outdoor acceptance gates.
