# Contributing to VoxCode

Applies equally to humans, the coordinator and AI workers. Read [AGENTS.md](AGENTS.md), the approved [implementation plan](docs/implementation-v1.md) and [agent workflow](docs/agent-collaboration.md) before editing. User instructions take precedence; record material scope changes in the plan or a decision record.

## Branches and change boundaries

- Use `codex/<short-purpose>`, for example `codex/ios-task-filter`. The current remote default branch is `codex/mvp`; verify the PR base instead of assuming `main`.
- Direct commits and pushes to protected branches (`main`, `master`, `codex/mvp`) are prohibited. Every submitted change must be pushed to a `codex/*` topic branch and merged through a pull request. The local commit and pre-push hooks enforce this when installed; the PR workflow fails if a protected branch receives a direct push, while repository branch protection/rulesets remain the authoritative GitHub control.
- One PR addresses one reviewable behavior or closely related set of changes. Prefer small PRs; roughly 400 changed source lines is a review prompt, not a reason to split inseparable changes or omit tests. Exclude generated files when judging size.
- One commit is one coherent change, with its tests and essential documentation. A regression fix belongs with its regression test. Do not split a knowingly broken intermediate state into the shared branch.
- Every verifiable milestone gets an annotated Git tag on the exact commit published by its PR. Use `milestone/<short-name>`. The PR must name that tag in its `## Milestone tag` section; the coordinator creates and pushes it only after milestone checks pass. A tag never replaces review, CI, device or acceptance evidence.
- Independent work should use separate worktrees. In the existing shared-checkout session, workers have exclusive paths and the coordinator alone stages, commits, pushes and switches branches. Do not switch while workers are editing.
- Preserve unrelated user/worker changes. Stage explicit paths and inspect `git diff --cached`; never use `git add .` in shared work. Never rewrite published history or force-push without explicit user instruction.
- After a PR is merged, cleanup is allowed only after the checks in [docs/architecture/cleanup-policy.md](docs/architecture/cleanup-policy.md) pass. Keep the PR, merge SHA, reviews and progress records; use `git branch -d` for a verified local topic branch and never delete protected, unmerged or dirty work.

## Commit messages

Required subject: `type(scope): summary`, at most 100 Unicode characters. Use lowercase type/scope. English or Chinese summaries are welcome; describe the concrete result. Avoid `WIP`, `misc`, `update` and claims of completion unsupported by evidence.

| Type | Meaning |
| --- | --- |
| `feat` | New capability |
| `fix` | Correct a defect |
| `docs` | Proposal, decision, instructions or review record |
| `test` | Verification coverage without a behavior change |
| `refactor` | Structural change with equivalent behavior |
| `perf` | Measured performance improvement |
| `build` | Build system or packaging |
| `ci` | Automated checks or delivery workflow |
| `chore` | Maintenance or dependencies |
| `revert` | Revert identified commits, explaining impact |

Preferred scopes: `ios`, `mac`, `relay`, `voice`, `integration`, `preview`, `protocol`, `security`, `repo`, `deps`. Other descriptive lowercase scopes are allowed. Historical `client` commits are valid; use `ios` for new native client changes.

```text
fix(ios): preserve the new recording after an old start failure

Ignore the stale start callback after recording ownership changes.
Validation: swift test; recording race regression passed (local core).
Device: microphone interruption not run; requires signed iPhone build.
Refs: docs/implementation-v1.md, task 2
```

Use `!` before `:` for breaking changes, for example `feat(protocol)!: require versioned acceptance`. Explain compatibility and migration in the body using `BREAKING CHANGE:`. Do not invent issue IDs, coauthors or validation results. AI attribution is optional and must reflect actual participation.

Install the repository-local subject hook once:

```sh
npm ci --ignore-scripts
npm run hooks:install
npm run test:policy
```

The hook checks the subject only. It is bypassable and is not a substitute for CI or review. Do not bypass it for routine work; if tooling fails, fix the checker or document an explicitly approved exception.

## Pull requests

The PR title follows the same subject format. Fill all five template sections with concrete content; English headings are stable for automation, content may be Chinese.

| Section | Required content |
| --- | --- |
| `## Summary` | Problem/trigger, resulting behavior and scope; link relevant task/contracts |
| `## Validation` | Commands, outcomes, environment and relevant checks not run |
| `## Risks` | Remaining limitations, compatibility and rollback where applicable |
| `## Review` | Independent reports, reviewed revision, findings resolved or still pending |

Open a **draft** when implementation, required reviews or relevant verification is incomplete. Record pending external gates in plain language. A source PR can become reviewable after its specified code gates pass; that does not certify device/outdoor delivery. Never label a feature live-ready while its live acceptance gates remain open.

Prefer squash merge after review, using the conventional PR title. Do not automatically merge, deploy or promote a draft. Stacked PRs must name their dependency and base; retarget and re-run checks after the dependency merges. Changes to requirements, security boundaries or shared contracts require coordinator integration and affected-component review.

## Verification and independent review

- Run checks appropriate to the change. Security, replay, cancellation, recording races and isolation changes require focused regressions. Documentation-only changes need link/content review; avoid meaningless tests that mirror implementation.
- PR unit coverage follows [coverage policy](docs/coverage.md): changed executable lines >=80%, changed branch arms >=70% where emitted, and no overall decrease from the PR base; Node and Swift core are checked separately. Critical authorization/isolation/replay/cancellation/recording scenarios need positive and negative regressions. Coverage never replaces live/device/benchmark acceptance.
- Label evidence as `simulation`, `fixture`, `local`, `live`, `device` or `outdoor`. Include the command, result, revision/environment and limitations. A local fixture pass cannot prove real Linx, Codex model execution, signing or outdoor connectivity.
- Each implementation component (iOS, Mac, relay, voice/integration, preview when added) requires two reviewers independent of its implementation. Cover correctness/security and platform/product behavior. Reviewers inspect requirements and code, not just the author's summary.
- Findings use P0 (critical), P1 (high), P2 (normal), P3 (minor), with file/line, reproduction or reasoning, impact and a proposed fix. Resolve P0/P1 before ready-for-review claims; explicitly track deferred P2/P3 with reason and acceptance impact.
- Save reports and resolutions in `docs/reviews/`. Identify the exact commit or content snapshot reviewed. New changes invalidate affected conclusions and require targeted follow-up. AI review reports do not constitute human GitHub approvals or user acceptance.
- Never commit tokens, passwords, recordings, device identifiers, private CA keys or generated dependencies. Public CA material, if needed, must be explicitly reviewed. Keep samples synthetic and logs redacted.

## Automated policy and its limits

`PR Policy / Commit and PR policy` validates the title, `codex/` branch, substantive template sections and every PR commit subject. It rejects incomplete commit pagination rather than silently accepting an unchecked tail. `Verify VoxCode` runs implementation tests and the unsigned native simulator build. Neither check can infer the truth of a review or a real-device claim.

These workflows report status. They become a mandatory GitHub merge gate only when repository rulesets/branch protection require them. This change does not enable branch protection or invent human approvals. Local hooks apply only in checkouts where installed. Existing history is preserved; the policy applies to new PR commits. Because a PR can change its checker/workflow, policy changes require human review; this status is not a tamper-proof security boundary.

## References and local adaptations

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): typed subjects and explicit breaking changes. VoxCode additionally requires scopes, lowercase type/scope and a 100-character limit.
- [AGENTS.md](https://agents.md/): a discoverable repository entry point for agents. Keep the entry point short and link detailed workflows instead of duplicating them per agent.
- [Git worktrees](https://git-scm.com/docs/git-worktree): isolate independent checkouts; worktrees alone do not isolate ports, credentials or external data.

The collaboration design in `docs/agent-collaboration.md` adapts these practices to the two-day schedule: bounded tasks, stable interfaces, narrow ownership, reproducible evidence and independent reviews. It is a project policy, not a claim that an external standard mandates every rule.
