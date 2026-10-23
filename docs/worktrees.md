# Independent development worktrees

Migration completed on 2026-10-23 at shared base `a352757` (M0, PR #2).
These paths are relative to the original VoxCode checkout, not the parent repository.

| Role | Worktree | Branch | Milestone |
| --- | --- | --- | --- |
| iOS `/root/ios_v1` | `.worktrees/ios` | `codex/ios-phone-demo` | M4 / IOS-002+003 |
| Mac `/root/mac_v1` | `.worktrees/mac` | `codex/mac-phone-demo` | M1 / MAC-002+003, MAC-004 fixes; PR #3 |
| Relay `/root/relay_v1` | `.worktrees/relay` | `codex/relay-phone-demo` | M2 / RELAY-002, RELAY-003 fixes; PR #4 |
| Coordinator `/root` | `.worktrees/integration` | `codex/integration-phone-demo` | M3 / voice, runtime, benchmarks and integration |

The original `codex/phone-demo` checkout retains all pre-migration implementation
files as a recovery snapshot. Do not use it for new source edits or copy it over
newer component work. Each owner received the full changed/untracked component
snapshot; `rsync -anc` confirmed identical contents before resumption. Generated
dependencies/build products were excluded. `.worktrees/` is committed as ignored.

The native desktop worktree tool cannot select this nested repository and the
parent repository has no commits. The coordinator therefore used `git worktree
add` in the actual VoxCode repository. `git worktree list` identifies all four
linked checkouts. No unrelated repository state was imported.

Workers edit only their worktree and assigned paths, and may inspect another
component for review. They do not stage, commit, switch, reset, clean or push.
The coordinator installs the commit hook in each checkout, stages explicit paths,
verifies snapshots and publishes separate scoped Draft PRs. PR bodies name the
implementer and pending independent reviewers; coordinator commits do not invent
agent Git identities. Integration copies committed component revisions only.

Worktrees isolate files and branches; they still share Git configuration and do
not isolate network ports or credentials. Tests use temporary data and ephemeral
ports. Review reports are written to separately assigned filenames and copied by
the coordinator into the PR that owns the reviewed component.
