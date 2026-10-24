# Progress and verification

## 2026-10-24: GitHub Actions checks disabled
- Removed `.github/workflows/pr-policy.yml` and `.github/workflows/verify.yml` after GitHub reported the repository account could not start jobs because of billing or spending-limit restrictions. This removes the external Actions check path only; local hooks, `npm run test:policy`, component tests, coverage commands and human PR reviews remain required evidence.
- Existing failed Actions runs are historical evidence of the account restriction. They are not treated as application test failures. Future PRs must state exact local commands, environment, unavailable native/live/device gates and the two independent review records.

## 2026-10-24: architect collaboration and post-merge cleanup policy
- Added [the architect collaboration and cleanup policy](architecture/cleanup-policy.md): GitHub PRs remain the merge/evidence source; Issues/Projects coordinate active work; `docs/architecture/` and `docs/progress.md` retain durable decisions and evidence.
- After a PR is merged into `codex/mvp`, only verified dependency-free topic branches, clean project-owned worktrees and disposable build artifacts may be removed. PRs, merge SHAs, reviews and progress records remain. Implementers report eligibility, architects check dependencies, and only the coordinator performs deletion.
- GitHub Projects could not be read with the current CLI token because it lacks `read:project`; Issues/PR labels are the documented fallback until that scope is granted. No external project board was created or modified.
- Existing development worktrees contain retained source changes and were not removed. No cleanup is claimed in this documentation milestone.

## 2026-10-23: initialization
- Remote liyan-04/voxcode verified empty via gh repo view; cloned under workspace.
- Node v26.0.0; codex-cli 0.154.0 available.
- xcodebuild unavailable: selected directory is CommandLineTools; no Xcode in /Applications.
- User authorized parallel development and two expert reviews per component.
- User selected native iOS explicitly; no PWA substitution.
- Three implementers dispatched in parallel: apps/mac, apps/ios, packages/voice; coordinator owns shared integration and records.
- No implementation acceptance claimed. Native build/signing remains blocked by absent Xcode.

## 2026-10-23: parallel implementation and first fixes
- Three source components implemented: native SwiftUI client, Mac task bridge, Linx protocol adapter. Remote relay/connector added after user made outdoor operation core.
- Mac tests cover auth expiry/revocation, durable request replay, two worktrees, cancellation ownership, approvals and bounded evidence.
- iOS core checks reached 27 assertions; syntax/plist checks pass. No actual iOS build/signing/device validation.
- Voice adapter 9 tests; relay 13 tests; integrated voice 4 tests after replay/capacity fixes.
- Root npm test: 43 passed, 0 failed. These are local/fixture tests, not real Linx/model/device verification.
- Prior reviews: two for iOS, two for voice, first Mac/security and relay/security. Independent second Mac/relay reviews in progress; do not label all review gates complete.
- Read-only bili-xs8 check: 9899 showed no TCP listener. Subsequent JumpServer auth refresh failed HTTP403. No remote write/deployment performed.
- Trusted public TLS endpoint still needed. User supplied public IP:9899 and chose to provide another server/domain.
- Requirements audit records actual product gaps, particularly native build, live voice, continuous Codex context and phone preview.

## 2026-10-23: proposal review before further implementation
- User requested a written proposal first and confirmation before continuing. Source edits, live integration and deployment are paused; existing work is retained.
- Product proposal: docs/product-proposal.zh-CN.md. It covers outdoor native control, Linx dialogue/tools, continuous owned Codex sessions, two-task routing, real preview/evidence, acceptance, resources and a two-day plan.
- Two independent reviewers were assigned document-only mobile/product and architecture/Linx reviews. No new source fix or live delivery is claimed during this pause.
- Both document-only reviews are complete: docs/reviews/proposal-mobile.md and docs/reviews/proposal-architecture.md. Their recommendations were incorporated into the proposal; user scope confirmation and live verification remain pending.
- Latest full local Node run before the pause: 48 passed, 0 failed. This does not certify native installation, real Linx speech, real Codex model edits or outdoor access.

## 2026-10-23: HTTP/IP and concurrency clarification
- User has HTTP + IP only, not a domain or existing HTTPS, and rejected a fixed maximum of two concurrent tasks.
- Revised design proposes project-managed TLS at the same IP:9899 with IP-SAN certificate and explicit iOS/Mac trust. No pre-existing HTTPS or domain is required from the user. Same-origin preview requires strictly separate preview and control authorization.
- Revised task proposal separates at least 20 managed tasks from four default execution slots, configurable 1–8, with queuing. Four-way real execution becomes the proposed acceptance target; eight-way performance is not claimed.
- Read-only architecture/mobile follow-up recorded in docs/reviews/network-and-concurrency-followup.md. Only proposal/decision/status documents changed; source, engineering rules, tests and deployment remain paused until confirmation.

## 2026-10-23: approved continuation and repository policy

- User approved continuing implementation and permits an explicitly labelled simulation environment. Earlier pause statements above are historical; deployment remains deferred.
- Baseline 12d74c0 was pushed to codex/mvp. GitHub Actions run 39960662598 passed Node tests, Swift core tests and the unsigned iOS simulator SDK build. This does not prove signing, iPhone installation, real Linx/Codex execution or outdoor connectivity.
- User requested commit/PR and multi-agent rules for all subsequent work. Added a discoverable AGENTS.md entry point, CONTRIBUTING.md, path ownership/task/handoff guidance, PR template, local commit hook and PR metadata/commit CI check on codex/collaboration-policy.
- Local Node v26.0.0: npm run test:policy passed 11 tests, including CLI valid/invalid files, incomplete commit-list rejection and data-only handling of shell-like PR text. The malformed-message regression first failed with TypeError, then passed after input validation. sh -n .githooks/commit-msg passed; npm run hooks:install enabled the local hook.
- Two independent policy reviews completed: docs/reviews/policy-security.md and docs/reviews/policy-workflow.md. Three P2 findings were reproduced and fixed: Markdown comment literals, empty thematic-break sections and manual workflow success without PR metadata. After adding the regressions, 11 tests passed / 2 failed; pinned marked tokenization and the PR-only workflow restored 13 passed / 0 failed. Both reviewers rereviewed and reported no new findings.
- Existing incomplete apps/ios, apps/mac and apps/relay worker changes are excluded from the focused policy commit/PR. Implementation acceptance and fresh v1 component reviews remain pending.
- All three implementation workers read and acknowledged the policy and returned resumable handoffs without source/Git mutations. Mac continuity tests and relay v1 tests remain red/incomplete; iOS core additions are not yet wired into the native UI/recorder. These changes are preserved outside the policy commit.
- Coordinator exported the explicit staged policy files plus baseline tracked sources with git checkout-index into an independent temporary directory, installed locked dependencies with scripts disabled, and ran npm test: 61 passed, 0 failed (including 13 policy tests). This verifies the proposed commit, not the unfinished shared worktree.
- Installing baseline voice/relay dependencies reported an existing ws advisory. npm audit --json --prefix packages/voice identified GHSA-58qx-3vcg-4xpx and GHSA-96hv-2xvq-fx4p with a patched 8.x release available. Dependency remediation belongs in a separate focused fix before live readiness; no forced audit update or deployment was performed. The new root policy dependency audit reported no vulnerabilities.
- No GitHub branch-protection settings were changed. Metadata checks do not establish review truth or product acceptance.

## 2026-10-23: phone-demo scope and architect coordination

- User clarified that opening the app on the phone is sufficient for the demo. docs/phone-demo-scope.zh-CN.md is the current scope: native VoxCode speech, task confirmation, progress, real diff/check results, same-task follow-up and current-version manual acceptance. The older comprehensive proposal remains historical reference.
- Reduced the delivery shape to the native app, one public relay and one Mac launch entry point. Interactive generated-site preview, WKWebView, static publication and the full Mac workbench are deferred. Original competition AirPlay compliance remains unconfirmed.
- Retained outdoor access, strict fixed-IP TLS, real Linx integration, at least 20 managed tasks/default four execution slots/configurable 1-8, recording ownership, replay and cancellation. Simulation must be visibly labelled and does not satisfy live/device/outdoor checks.
- Added the dedicated architect role and ARCH-001 coordination record. The architect obtained read-only handoffs from the three existing developers and prepared bounded next tasks; the coordinator retains shared-file/Git/PR/integration authority. Architect checks do not replace two independent reviews per implementation component.
- Benchmarks remain reproducible scripts/reports with environment and dependency labels, not a performance platform. Monitoring starts with bounded authenticated aggregates; a small status page is optional. No benchmark measurements or monitoring implementation are claimed in this documentation round.
- Published governance commit 4c59925 has passing PR-policy and full Node/Swift/unsigned simulator SDK CI, including run 39966128017. That evidence predates these documentation changes and does not verify the dirty v1 source. Signing/iPhone installation, real Linx, full real Codex edit/follow-up and outdoor operation remain unverified. Source work and unrelated concurrent coverage changes are preserved outside this documentation commit; deployment remains deferred.
- Two independent document-only reviews found no P0/P1; three scope/wording findings were fixed and both targeted rereviews reported no residual findings or conflicts. The exact document snapshot and findings are recorded in docs/reviews/phone-demo-scope.md. Focused policy tests passed 13/13, whitespace checks passed and local Markdown links were checked. No implementation test suite was rerun or native/live/device acceptance claimed for this documentation change.

## 2026-10-23: implementation release and visible milestones

- User authorized the architect and developers to start the approved phone-demo engineering work. Created codex/phone-demo from cd81e20 without discarding retained changes. The architect released MAC-002/003 and RELAY-002, prepared IOS-002/003 and yielded its slot; the coordinator then resumed the existing iOS worker. Task ownership, interface checks and review rotation are in docs/architecture/execution-2026-10-23.md.
- Applied PCM output and authenticated loopback-only MonitorSnapshot interfaces before their consumers. Preview/workbench remain deferred. No deployment was attempted.
- User requires a PR at every verifiable milestone. docs/milestones.md now defines per-agent task attribution, prompt Draft PR publication after relevant checks, explicit pending reviews and named stack dependencies. The coordinator retains Git authority; no separate agent Git identity is fabricated. Review and native/live/outdoor gates remain distinct.
- User further requested independent developer worktrees. The iOS developer paused at a resumable point; Mac and Relay sources are quiescent while they review other components. The coordinator is migrating each retained component snapshot to its own branch/worktree and using a separate integration checkout. Original shared files remain intact; future fixes occur in the assigned worktrees.
- Root reproduced the real Codex startup failure and classified it as a local initialization permission error, before model dispatch. The explicitly approved sandbox-external isolated smoke then passed: two actual model turns, verified answer.txt contents, the same owned Codex thread, ten events. This is live-local executor evidence, not phone/Linx/outdoor evidence. The smoke uses a temporary Git project and removes its files afterward.
- Current shell has none of LINX_TOKEN, LINX_DEVICE_ID or LINX_CLIENT_ID configured; only their presence was checked. Real Linx onboarding/speech remains unavailable. No credential values were printed or requested in chat.
