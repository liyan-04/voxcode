# Issue-driven agent collaboration

GitHub Issues are the coordination record for work in VoxCode. Git branches and pull requests carry the implementation; an Issue carries the goal, ownership, boundaries, dependencies and acceptance evidence that let several agents work without duplicating or overwriting one another.

## Issue-first rule

Create or claim an Issue before dispatching an agent for a feature, bug, architecture decision, security change, deployment, benchmark or acceptance gate. Search open Issues first. Use one primary Issue per independently reviewable behavior; use linked child Issues for parallel owners, paths or review gates. Link dependencies with `Depends on #N` and parents with `Part of #N`.

Every Issue records a goal, scope and exclusive writable paths, dependencies/base revision, acceptance criteria with evidence class (`simulation`, `local`, `fixture`, `live`, `device` or `outdoor`), risks/blockers and one primary owner. Use the templates in `.github/ISSUE_TEMPLATE/`. Put the agent role/chat identity in the body; a GitHub assignee must be an actual eligible GitHub account.

The coordinator alone allocates or reassigns work: reread the latest Issue ownership before dispatch, then record the accepted owner and path boundaries. Comments and assignees are not atomic locks. An agent must wait for allocation rather than claim shared files independently. Review/follow-up work inherits its existing Issue; a new Issue is needed only for a separately scoped outcome. Tasks and branches already underway keep their names and IDs; link them to an existing Issue before their next new PR.

If GitHub is unavailable or rate limited, record the same task/start/handoff fields in `docs/progress.md` with `Issue: pending`; continue independent local work and retry with backoff. Never invent an Issue number. Link the real Issue before marking the PR ready.

## Agent start and handoff

Before editing, the coordinator records the following start information on the Issue, through an explicitly authorized publishing action. Workers without authorization to post provide the same record to the coordinator:

```text
Started: #N
Branch: codex/<issue-number>-<short-purpose>
Worktree: <relative worktree label; full path stays in local handoff>
Base/dependencies: <revision or linked PR>
Writable paths: <exclusive paths>
Planned checks: <commands>
```

Implementation workers change only assigned paths; the coordinator owns staging, commits, branch changes, pushes and integration as defined in `AGENTS.md`. No worker deletes another worker's files. Progress records state what was learned, what remains and whether the Issue is blocked; never include credentials, recordings, private paths or raw private logs in GitHub. Keep machine-specific worktree paths in the local handoff and publish a relative worktree label when needed.

The handoff records:

```text
Status: implemented | blocked | needs review
Reviewed revision/content snapshot:
Changed paths and contract effects:
Commands/results/environment and evidence class:
Known gaps / unavailable checks:
Integration dependencies / next step:
```

Keep the same facts in the PR. Never report a simulated result as live service, device or outdoor evidence.

## Branch and PR linkage

Use `codex/<issue-number>-<short-purpose>` for the topic branch. A PR must contain `Refs #N` or `Fixes #N` for its primary Issue. Use `Fixes` only when the Issue acceptance criteria are complete; use `Refs` for partial or stacked work. Source changes can be ready while separately tracked device/live/outdoor gates remain open. GitHub closing keywords automatically close Issues only when the PR reaches the default branch; after an integration-branch merge, verify the Issue status explicitly. A PR without an Issue reference stays draft until corrected.

The Issue, branch and PR identify the same task. Shared contracts and integration are serialized by the coordinator. Reviewers are independent of the implementer. A merged PR does not close a device or live acceptance Issue without its evidence.

## Status and cleanup

Use the available project fields or labels for `Backlog` → `Ready` → `In progress` → `Blocked`/`Review` → `Done`. Preserve the Issue, PR, review reports and progress evidence after merge. Cleanup follows the repository cleanup policy and never removes an active, dirty or dependent worktree.

## Validation boundaries

The commit/pre-push hooks enforce subjects and protected branches. `npm run test:policy` runs checker regression tests; it does not validate a live PR. Run `node scripts/check-pr-policy.mjs --pr-file <metadata.json>` against the actual PR metadata before ready-for-review. The checker requires a visible line such as `Issue: Refs #21`; comments, quoted examples, fenced/inline code and placeholder numbers do not count. It checks linkage syntax only. The coordinator must verify that the referenced number is an Issue in this repository, not a PR, and that ownership, acceptance and review records match.

Templates use the repository's existing `enhancement`, `bug` and `documentation` labels. Component, priority, owner and state are recorded in the body or available Project fields. Do not require new labels or a GitHub Project to start work. Templates become visible in GitHub's New Issue UI after this change reaches the default branch.
