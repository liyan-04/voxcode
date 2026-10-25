# Progress and verification

## 2026-10-25: legacy server CLI retirement (Issue #139)

- Removed the obsolete scripts/server/cli.mjs command entry and its active
  deployment instructions. The historical package subcommand loses its CLI;
  unpublished #122 tools are not advertised as a replacement.
- Preserved bundle/package/remote/password helpers, application runtime entries,
  historical records and all still-valid deployment regression assertions.
- Two independent reviews pass. Root focused deployment checks: 16/16.
  Complete serial Node/policy/voice suite on integrated2cdfa1f: exit0, expected
  opt-in launchd skip. Active reference search and diff checks pass.
- Source-only cleanup; no service restart, credential/state or live rollback
  file removal. This milestone does not establish device/provider acceptance.

## 2026-10-25: owned Mac restart (Issue #137)

- Added fixed-label in-place restart/status commands. Stop waits for job absence
  and the original PID identity to exit; task RPC must be ready before Agent
  startup. Bounded error-5 retry requires an owned completed stop.
- Separate kernel guard, source/plist/config pinning, active-task refusal and
  explicit rollback protect the installed services. No runtime guard is deleted.
- Two independent reviews pass. Root focused tests: 15 passed, one opt-in skip;
  final complete serial Node/policy/voice suite exit 0 on integrated5e01b5d.
  Author real isolated launchd fixture: 16/16; no installed restart inferred.
- This tool restarts an unchanged installation. Source deployment/activation
  integration belongs to #122; installed repeated restart requires a fresh idle
  gate after source merge. The old temporary129 script is not a supported tool.

## 2026-10-25: execution target selector (Issue #131)

- Added visible Mac/Server selection with independent project/task navigation,
  drafts, checkbox preferences and request recovery. Every operation freezes its
  original execution target; late callbacks cannot replace the other workspace.
- Known-rejected metadata revisions recover on the next explicit action;
  uncertain outcomes retain their original payload and request identity.
- Both independent source reviews pass. Coordinator focused checks: 93/93.
  Complete serial Node/policy/voice tests: 414/414, exit 0. Final real Chromium
  fixtures passed desktop/mobile/narrow/landscape with no page errors.
- Identical serial baseline/head coverage passed: changed lines 3/3, branches
  20/20; overall lines unchanged and branches increased. Exact committed-head
  gate is required before publication. Evidence is local/fixture, not phone or
  live Codex/provider acceptance.
- Gateway fe0d921 was activated at Beijing 21:05:46 with strict TLS, original
  password login, CSRF and target-isolation checks. Its page predates this
  selector. Server executor provisioning, native Codex synchronization and
  project creation remain separate pending capabilities.

## 2026-10-25: dual execution target source milestone (Issue #128)

- Fixed Mac/server selection now routes every project/task request through one
  request-local adapter and registry, with separate replay identities and no
  fallback. Login and authenticated inventory do not wait for either executor.
- Final submission uncertainty regressions preserve the original identity after
  committed mutations and failed detail reads. Root and architecture reviews
  pass for the frozen implementation; reports are under `docs/reviews/`.
- On integrated master `9038762`, coordinator focused checks passed 59/59 and
  complete Node/policy/voice coverage collection passed 394/394. The exact
  `9038762` baseline passed 370/370 after installing its missing Mac Agent
  dependency; the initial incomplete-dependency baseline failed and was discarded.
- Exact-baseline Node coverage gate passed: changed lines 99/99 (100%),
  branches 178/190 (93.68%); overall lines 2282/2326 and branches 2427/2809
  both increased from the baseline. No coverage policy was changed.
- This is local controlled HTTP/Unix RPC evidence. Page selection, Linux
  executor provisioning, live Codex/Linx and physical phone acceptance remain
  separate. Issue #129 heartbeat configuration has no observed scheduler run;
  actual release deployment was performed directly by deployment_ops.

## 2026-10-25: incremental browser control delivery

- PR #133 merged direct task submission into master `9d2402a`: one request
  creates or continues and executes the original turn. Both independent
  reviews passed; final helper/HTTP/runtime checks 34/34 and policy 62/62.
  Scoped baseline coverage passed: changed lines 100%, branches 93.67%, overall
  lines and branches increased. This is source/local fixture evidence.
- Issue #121 crash-safe Agent lock: coordinator reran 35/35 Mac Agent tests,
  matching the frozen implementation hashes reviewed by mac_agent_probe.
  Kernel ownership survives helper exit and releases after owner death;
  persistent guards are never removed to force startup. Linux and installed
  migration remain separate deployment checks.
- Issue #129 deployment inventory confirmed owned vm6 control listener and
  strict TLS health, with rollback releases retained. A 15-minute heartbeat
  checks newly merged master for deployment. Source merge, deployment and
  physical phone acceptance remain distinct.

## 2026-10-25: server-only documentation refresh (Issue #91)

- Created `codex/91-docs-refresh` from `origin/master` and aligned the root and
  server READMEs with the files that actually exist after the client/Relay
  cleanup. The supported command is `node --env-file=<private env>
  apps/server/task-cli.mjs start`; it uses a private Unix socket and does not
  provide a composed HTTP/voice deployment.
- Recorded the remaining migration boundary: `apps/server/cli.mjs`, the source
  bundle allowlist and the root aggregate test still reference removed legacy
  paths. They are documented as blocked cleanup work rather than reported as
  working launch or release commands.
- Validation: `npm ci --ignore-scripts --prefix apps/server --offline` passed;
  the focused server fixture command in the READMEs passed 74/74 on macOS
  arm64/Node.js 26. The full `npm test` was run and remains failing in the
  legacy CLI/preflight and source-package tests because those deleted paths are
  still imported. No live, Linux, device, TLS, Linx or deployment evidence is
  inferred from the local fixture pass.

## 2026-10-24: phone duplex WSS design checkpoint (Issue62)
- User requires actual simultaneous phone↔server WSS. Architect and PM recommend authenticated `/api/stream` through a fixed same-host Relay→Bridge proxy, with HTTPS retained for pairing, durable mutations and full evidence. Existing machine Connector and provider Linx WSS are separate connections.
- Design freezes pre-upgrade authorization/revocation, JSON/binary framing, audio credits and bounded queues, ACK-before-events, real task subscriptions/replay/gaps, immutable recording targets and no old audio on reconnect. iOS must change record-only audio/session behavior as well as transport.
- Disposable loopback WS proxy probe passed header auth, backend-before-frontend upgrade, text-before-stop and binary echo after dependency-path correction. It is not product code or TLS/native/provider evidence. Implementation/live/signing gates remain open; [design](architecture/phone-duplex-wss.md) is the next bounded work basis.

## 2026-10-24: dedicated server entry and source bundle (Issue55)
- Added non-root, redacted preflight/start entry that reuses the existing runtime, canonical verified project/data, explicit TTY-only pairing code and owned shutdown. Relay remains separate; no service/account/dependency automation or unrelated listener mutation.
- Explicit Git-blob allowlist/source manifest excludes private configuration and honors the requested commit even with local replacement refs. Two independent reviews fixed Git-replace, writable-ancestor and path-alias findings; [report](reviews/server-source-delivery-2026-10-24.md) records hashes and regressions.
- Coordinator full230/230, exactbase211/211; changed runtime99.33%lines/95.57%branches, no overall decrease. Source archive built from97e7f8f and extracted install/start verified with fixtures. Root test discovery and runtime coverage include apps/server; thresholds unchanged. Linux/live/device and new phone-WSS Issue62 remain open.

## 2026-10-24: server Linx onboarding and phone duplex correction (Issues61/62)
- User confirmed test-agent resources are not ready; [the server onboarding guide](verification/linx-readiness-2026-10-24.md) now covers official console/model/intent/voice/save steps, private software-device activation, terminal-only code, durable identity, exact helper commands, prompt placeholders and staged live/device acceptance. No account or activation was performed.
- User requires phone↔server WSS duplex. Current HTTP audio blocks/voice and task event polling do not satisfy it. Architect and PM evaluated fixed-loopback Relay→Bridge WebSocket forwarding, simultaneous audio/events, explicit confirmation, frozen recording target, bounded queues, voice abort vs task cancel, and reconnect without old audio replay. Issue62 tracks the protocol/implementation; official Linx WSS is a distinct existing server connection.
- Two independent guide reviews have no P0/P1/P2;39 local links and policy45/45 passed. [Review](reviews/linx-server-guide-2026-10-24.md) distinguishes source from live/device gates. Architecture PR58 merged as9236039 and current Linx PR59 as5fc427f; no direct master commit.

## 2026-10-24: latest official Linx server protocol (Issue #57)
- Pinned current official docs revision `20ce1b29a1bdff575a4c3317689bae30a7e08535` (2026-10-22); server integrates outbound WSS software-device voice plus device MCP. Cloud SSE callbacks and third-app SSE are alternative routes, not required services for this path. Phone holds no Linx credentials.
- Validates supplied session IDs before STT/TTS/MCP, binds all MCP replies, accepts documented optional hello metadata and never invents an output codec/rate. Voice tools return drafts; explicit phone confirmation remains the execution boundary.
- Frozen implementation `a5ed5ec1259a33ca5035cc51415d456846978525`: full local Node211/211; two independent reviewers each reran voice/integration50/50; coordinator17/17. Exact-source coverage passed100% changed lines/95.65% branches, no overall decrease. [Review and limitations](reviews/linx-current-protocol-2026-10-24.md) retain the earlier EPERM failure and unchanged passing retry.
- Real Relay/Connector/Bridge transport, Opus and temporary Git worktrees use controlled Linx/Codex peers in the composition test. This does not close Linux/Node22, real Linx binding/ASR/tools/audio, authenticated real model, remote TLS, signed iPhone or cellular+VPN acceptance.

## 2026-10-24: bounded voice HTTP smoke tooling (Issue #43)
- Added actual authenticated loopback voice-route client, explicit synthetic PCM input, paced/bounded uploads and polling, redacted stage/event report, independent abort/delete cleanup and identical-ID uncertain-create reconciliation only for cleanup. No task dispatch, approval, result acceptance or playback.
- Root and independent linx_onboarding review found event-type array coercion could fake observed stages; now requires string types. Also bounded decoded frames to negotiated16/24kHz120ms. Regression RED/GREEN and final focused14/14 passed; source review/evidence in reviews/linx-smoke-2026-10-24.md.
- Evidence is local HTTP fixtures, not real provider proof. Actual account/device config still pending; full L3 tool semantics, audible iPhone and cellular/company-Mac gates stay open. README/readiness now point to implemented helper/client rather than nonexistent tools.

## 2026-10-24: native delivery preflight and archive/export tooling (Issue #44)
- Added read-only Xcode/SDK/generator/signing/public-CA preflight and explicit fresh-output manual-development archive/export script, plus permanent controlled command fixtures and iOS README/runbook. This supplies a repeatable entry; no actual signed IPA exists from this environment.
- Independent reviewers root and linx_onboarding caught app provisioning settings leaking globally to local Swift package targets. Fixed by changing only the staged App target; regression failed before fix and nine controlled scenarios now pass. Exact source hashes/review in reviews/ios-device-build-2026-10-24.md.
- Actual preflight exit1: CLT-only, no iPhoneOS SDK/XcodeGen/signing identity or explicit team/bundle/profile/reviewed-CA inputs. Native XCTest/Swift coverage for PR35, signed install, actual microphone/playback and cellular/public Relay/company-Mac acceptance remain open. No threshold waiver or simulator-as-device claim.

## 2026-10-24: private Linx onboarding helper (Issue #42)
- Added offline private software identity init/status and explicit official HTTPS activate/OTA helper. Saved env is0600 in an owned0700 directory; no overwrite, arbitrary token endpoint, firmware download or automatic retry. Activation code is shown only by explicit local interactive option; normal output/errors redact identity/token/code.
- Focused onboarding18/18 and full Node191/191 passed after locked dependencies installed in isolated worktree. Root architect and independent product_manager reviewed exact four-file content snapshots with no outstanding findings; see reviews/linx-onboarding-2026-10-24.md.
- One early wrapper test accidentally attempted a malformed synthetic OTA request before injection existed; no real identity/token/account resource or successful enrollment was established. Subsequent tests use process-wide default-deny HTTPS, verified by regression. Actual user account/device binding and live L1-L5 remain pending. Real-protocol smoke client and native build are separate Issues43/44.

## 2026-10-24: current README and parallel delivery slices (Issue #45)
- Root README now leads with the actual phone/public Relay/company-Mac goal, merged capabilities, runnable entry points, installation boundaries and open signing/Linx/outdoor gates. Module README updates stay with their allocated developers.
- Issues42/43/44 run in independent worktrees for the private Linx onboarding helper, actual voice-route smoke CLI and native device build entry. These are active work, not master-available tools or live results. Model429 causes cooldown/reduced concurrency rather than abandonment.
- A fresh `node scripts/smoke-real-codex.mjs` on existing master-derived source failed with `Codex exited (1)` before file verification; separate stdio initialize diagnostics classified database/permission errors under the restricted local environment. No model-edit or follow-up success is claimed for this run.
- Both the authorized remote preflight and the requested one-minute heartbeat creation were not executed because automatic approval review returned401 `model not in allowed model list`. No bypass or remote changes occurred. Local development continues; actual remote/native/cloud checks remain open.

## 2026-10-24: monitoring, PM and documentation milestones (Issue #40)
- PR34 monitor contract, PR36 authenticated Relay monitor/package, PR37 PM collaboration, PR38 README/script ownership and PR39 Linx onboarding evidence are merged to master. Six verified merged remote heads retired; dirty worktrees remain preserved.
- Final server local suite173/173 and changed coverage76/76lines44/48branches passed; two independent reviews resolved packaging closure and blocking readiness probe. Native PR35 remains Draft because native XCTest/SDK/coverage are unavailable, despite source reviews and6+3local shim checks.
- [Exact review/evidence and remaining priorities](reviews/monitoring-2026-10-24.md) distinguish implementation from real Linx, signed iPhone and cellular/company-Mac acceptance.

## 2026-10-24: architect documentation and delivery ownership (Issue #33)
- User assigned root/module README and build/deployment script consistency to the architect. Added role/PR checkpoints and corrected conflicting iOS TTS/TLS statements and runtime environment-file instructions.
- Package module closure is audited with server monitoring Issue #29; its new runtime module must be included and imported from the extracted installation package. No remote deployment, signed build or live Linx pass is claimed by these documentation changes.

## 2026-10-24: phone monitoring contract (Issue #25)
- User accepts native phone monitoring instead of a required Grafana deployment. Frozen [contract/design](architecture/phone-monitor.md) forwards the existing paired aggregate monitor, adds bounded Relay transport metrics only after Mac authorization, and separates configuration from live voice success.
- Server #29 and iOS #30 use independent worktrees/owned paths. Phone monitoring refresh does not control task execution or alter task connection state; failed/old samples remain visibly stale.
- Independent design review found ambiguous request/success/error counter relationships; fixed to requestsTotal = responsesTotal(<400) + errorsTotal(>=400), including public, denied and offline finished requests. No runtime/device/live pass claimed by this contract PR.

## 2026-10-24: master consolidation and branch retirement
- User made `master` the final integration branch and authorized merging remaining content through PRs, then deleting merged remote branches. PR [#22](https://github.com/liyan-04/voxcode/pull/22) merged the phone loop into `master` at `33d0daf`; its tested head `cbcf71f` has an identical tree.
- Local promotion validation: `npm test` 161/161; `npm run test:policy` 29/29; whitespace checks passed. Existing component reviews remain in `docs/reviews/`; this promotion does not certify native signing, live Linx or outdoor access.
- Full remote head inventory, transitive PR integration evidence and retained local resources are in [the master consolidation audit](architecture/master-consolidation-2026-10-24.md). All 15 audited old remote refs were deleted after current-head/protection/dependency checks. PR #14 was closed as superseded by #19/#22; dirty local worktrees remain preserved. Issue #21 merged through PR #23 at `3b851f1`; its local worktree is still retained.
- Updated the current-base instructions to `master`; retired `codex/mvp`/`codex/phone-demo` must not be targets for new development PRs. Master remains protected against deletion, force push and direct updates.

## 2026-10-24: Issue collaboration policy (Issue #21)
- Added feature/task, bug/regression and acceptance/deployment Issue forms with required scope, owner, dependencies, checks and evidence fields. Forms reuse existing repository labels.
- Added coordinator allocation, separate child Issues/worktrees, exclusive paths, start/blocker/handoff records and Issue-to-PR linkage. Existing tasks retain their names; unavailable GitHub access uses a local pending record until linked before ready-for-review.
- The local PR metadata checker now requires a visible `Refs #N` or `Fixes #N` line; comments, code examples, placeholders and zero are rejected. This is syntax validation only, not Issue existence, ownership or acceptance verification. Git hooks and Actions settings are unchanged.
- Local Node 26: focused PR policy tests passed 16/16; full `npm run test:policy` passed 30/30 on the initial base and 31/31 after aligning this change with `origin/master`. YAML parsing and required/unique form field checks passed for all three templates. Regression first reproduced the comment-only false positive, then passed after Markdown token validation. No product runtime, device, deployment or outdoor acceptance is claimed by this policy change.
- A path error initially placed four governance edits and four added files in the shared checkout. After explicit user approval, only those verified task-owned edits were removed; other worker changes were preserved. Final changes are isolated on `codex/21-issue-collaboration`.

## 2026-10-24: GitHub Actions checks disabled
- Removed `.github/workflows/pr-policy.yml` and `.github/workflows/verify.yml` after GitHub reported the repository account could not start jobs because of billing or spending-limit restrictions. This removes the external Actions check path only; local hooks, `npm run test:policy`, component tests, coverage commands and human PR reviews remain required evidence.
- Existing failed Actions runs are historical evidence of the account restriction. They are not treated as application test failures. Future PRs must state exact local commands, environment, unavailable native/live/device gates and the two independent review records.

## 2026-10-24: delivery target clarification
- Corrected the delivery wording after user clarification: the target is the combined loop of a native app installed on a real iPhone **and** that same build controlling Codex on the company Mac through the public Relay/Connector path. Neither a simulator demo nor an install-only result closes the project.
- G4 device evidence and G5 outdoor evidence must identify the same signed build, device/iOS version, relay endpoint, Mac connector and Codex requestId. Current local state has neither a signed iPhone build nor a live public/outdoor run; these gates remain blocked by the missing Xcode/signing and deferred deployment resources.
- A deployment attempt using the authorized `liyan-server` workflow reached `100.100.81.209` but SSH authentication returned `Permission denied (publickey,password)` before any command ran. No files, processes or ports were changed. The local relay package remains ready for a later authenticated attempt; the public link is still unverified.

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

## Independent milestone publication (2026-10-23)

- M0 a352757 is Draft PR #2. Four independent linked worktrees now exist for iOS, Mac, Relay and coordinator integration; full owned source snapshots were checksum-verified after copying and the original dirty checkout remains intact. See docs/worktrees.md.
- M1 c40e1d6 by /root/mac_v1 is Draft PR #3; coordinator reproduced 41/41 local/fixture tests. Independent Relay review reproduced two P1s: slow-body authorization revocation and foreign/pre-dispatch command approval. MAC-004 fixes are in progress; passing fixture suites did not close these findings.
- M2 c26fb62 by /root/relay_v1 is Draft PR #4; coordinator reproduced 28/28 local/fixture tests after pinning ws8.22.0, audit zero. macOS tests passed, but both Linux Node22 CI runs failed the pre-handshake TLS shutdown regression; RELAY-003 is investigating. No pass was inferred across runtimes.
- IOS-002+003 source by /root/ios_v1 is frozen at 6745dc0 for a separate Draft. Coordinator reproduced full Swift syntax checks and CoreChecks34. The implementer reports additional core/race/audio/simulation/anchor checks; native SDK/core XCTest/coverage and two independent reviews remain pending.
- Root integration Node coverage run: 117 passed, zero failures/skips, 91.95% lines/81.88% branches locally. Voice authorization and closed-event regressions were observed failing before their fixes. A review-discovered closed-session capacity leak was fixed by retaining TTL deletion and covered with an expiry/reopen regression. Voice/runtime uses fixtures; real Linx remains unavailable.
- Controlled 24-task benchmark passed four-slot occupancy, fifth-task queueing, cancellation settling and immutable replay; 23 completed/1cancelled, create/list/status samples24/60/60 with zero errors. This is loopback HTTP/controlled-executor evidence, not real-model, TLS, device or outdoor timing. Source and benchmark evidence are published independently of deployment.
- Published M4 as Draft #5 and M3/integration as Draft #6. iOS6745dc0 PR CI39980579566 passed policy, Node, Swift core coverage and unsigned simulator SDK build. Integration174036b PR CI39981233060 passed Node/Swift coverage, unsigned SDK build and native XCTest. Later source fixes require fresh CI and do not inherit these results.
- RELAY-003 de8fc2d repaired accepted pre-TLS socket ownership; root reproduced28/28, and Linux Node22 CI39981060532 passed. Independent iOS protocol review completed for that fix; its report is in PR#4 and integration. No deployment occurred.
- Independent iOS voice review identified follow-up drafts replacing existing manual conditions when the model omitted criteria. Root reproduced a failing inheritance regression, retained the task's text/required fields by default, preserved explicit edits and rejected invalid explicit null. Voice/runtime26/26 passed after the fix; targeted reviewer follow-up remains required.

## 2026-10-24: isolated worktrees and review remediation

- Five linked worktrees now isolate iOS, Mac, Relay, coordinator integration and architect documentation. Original dirty checkout remains intact. Component Draft PRs #3-#6 identify their implementation owners; milestone fixes are scoped commits on those PRs.
- MAC-004 fecd68f fixes slow-body authorization rechecks, approval ownership and split UTF-8 bodies. Coordinator inspected the diff and reproduced 66/66 Mac tests. PR #3 checks at that revision passed policy, Node and unsigned native SDK jobs (runs39983064716/39983073428/39983073562). Final independent follow-up remains required.
- At integration d6eac09, `npm run test:coverage:node` passed 143/143, zero failed/skipped: lines/statements92.51%(2089/2258), branches82.84%(1038/1253), functions93.61%. These are local/fixture tests, not device or live Linx evidence.
- At the same revision, isolated `node scripts/smoke-real-codex.mjs` passed live-local: two actual model turns, verified file contents, same owned thread,17 events. The temporary project was removed. This does not certify iPhone, Linx or outdoor operation.
- Relay de8fc2d has two independent follow-ups: iOS reproduced all28 tests on Node22; Mac independently reproduced the accepted pre-TLS socket shutdown regression and checked the raw-socket cleanup ordering. The old test was a false negative because it did not wait for server acceptance. No deployment occurred.
- Independent iOS reviews identified definitive rejection being retained as uncertain, voice stop/start ordering and old refresh results overwriting newer snapshots. IOS-004 is in progress in the iOS worktree; previous native CI does not verify that dirty source.
- ARCH-003 found ambiguous business errors: a rejected acceptance and a request-ID identity conflict both returned409/conflict. Shared contract now reserves409/blocked for a no-effect business rejection. MAC-005 and IOS-004 implement and test both sides; unknown/conflicting outcomes retain immutable retries. Those changes and targeted reviews remain pending.

## 2026-10-24: final source and independent follow-ups

- MAC-005f4114f2 implements409blocked before business effects while identity conflicts remain409conflict. Root and two independent reviewers each reproduced74/74 Mac tests; one reviewer used supported Node22. Original security/UTF-8 findings and their resolutions are retained in the component PR#3. Source CI atf4114f2 passed.
- IOS-004452411f fixes definitive rejection recovery, persisted matching-journal isolation, old refresh/replay ownership, known-session DELETE ordering and recording-attempt identity. Root independently compiled/executed six core runners plus actual SimulationBridge transport, all passed; final syntax/plist checks passed. Uncertain auth/transport/server/identity outcomes retain exact retry bytes. Active create discard gets a new recording ID; unknown automatic create cleanup retains its original identity.
- Independent platform review found equal-version/equal-time mutation replays could still overwrite newer state. IOS-0055c2b9a7 adds a strict mutation comparison while ordinary generation-owned refresh accepts equal-time updates. Focused regression failed before the comparison fix and passed afterward. Root and both independent reviewers separately compiled/executed the final OrderingChecks; native fixtures also cover running/current -> queued/replay -> completed/refresh at the same timestamp.
- Integration3fca98f Node coverage:151/151 passed, zero failures/skips; lines/statements92.51%(2089/2258), branches83.26%(1050/1261), functions93.61%. Laterfe54321 changes iOS only. CI39987322901 passed coverage, unsigned SDK build and native XCTest for3fca98f; it does not certify IOS-005. Final exact-source integrationfe54321 run39988267625 passed Node/Swift changed and baseline coverage gates, unsigned SDK build and native XCTest. Coordinator observed `gh run watch 39988267625 --exit-status` exit0; native job120533033021 completed in4m20s, Node job120533033159 in50s. Unsigned simulator app and xcresult artifacts were uploaded; this is cloud simulator evidence, not a signed iPhone package.
- Both independent source reviews now have no open finding in Macf4114f2, Relayde8fc2d, voicebdd7f29 and iOS5c2b9a7. See docs/reviews/README.md for actual reviewers and reassignment. Reports do not count as human GitHub approvals or product acceptance. Architect ARCH-003 remains additional.
- Native fixtures do not prove real microphone/audible speech, production private-CA URLSession matrix, signing/iPhone installation, real Linx, four real parallel model tasks or outdoor connectivity. A stale in-flight create may briefly consume the provider slot and return429; a deliberate new recording can recover after cleanup. Deployment remains deferred.

## 2026-10-24: server execution scope and current Linx protocol

- User explicitly chose native iPhone→server; server integrates Linx AI and locally runs Codex, with no AirPlay protocol constraint. Architect and PM reviewed the scope before implementation. Current decision and bounded tasks are docs/architecture/server-execution.md and server-execution-plan.md. Historical company-Mac execution requirements are superseded; signed installation, strict TLS, real services and same-build outdoor acceptance remain mandatory.
- Architecture source3828d32:49/49 targeted local tests passed on macOSarm64/Node26. Coordinator independently reran the disposable composed check:8/8 passed across actual loopback Relay/Connector/Bridge, actual voice adapter+Opus and owned stdio/worktree fixtures, covering explicit draft confirmation, no automatic execution, replay and same-thread follow-up. Provider and executor were controlled; no Linux/live/device claim. Issue57 will make this reproducible in the repository.
- User-provided vm6 preflight: Linuxx86_64, Node22.23.4/npm10.9.9/Git2.43/Codex0.162.1,32GBRAM,241GBfree,9899Node listener/8787free. Codexconfig exists, checkedauth/Linxenv absent. This does not determine all possible auth methods or prove a model call. Coordinator SSH attempt was not executed because automatic approval returned401/model not allowed; no bypass.
- Independent tasks:55server delivery/preflight/source bundle;56iOS endpoint/trust/server copy;57latest Linx docs and session/protocol/headless regression. Each has an independent worktree and explicit paths, two reviewer requirement and PR-onlymaster integration. Existing Issue48/PR51 endpoint work stays Draft pending scope reconciliation; no worktree reset/overwrite.
- Official Linx docs source commit20ce1b29a1bdff575a4c3317689bae30a7e08535 (2026-10-22) verified. WebSocket+deviceMCP via server-hosted software device avoids a new callback. CloudSSE GET/mcp POST/mcp/message and X-Linx correlation headers are distinct and never sufficient auth. OldC++Demo is not the protocol authority; no physical server audio is needed.
- PersonalTeam first-install guidance reviewed by two independent agents and merged via PR54 into masterd710d7c. OfficialXcodeGen2.44.1 asset SHA256 checked and staged project generated;205/205Node tests passed after all documented locked module dependencies installed. No native compile/sign/install orIPA; fullXcode download ongoing, Issue52 stays open.


## 2026-10-25 — #141 shell lifecycle integration

Owner: current chat coordinator; isolated `codex/141-shell-lifecycle` from `5e01b5d`.
Paths: root lifecycle shell scripts, scripts/control/**, control fixture tests,
root/module READMEs and deployment/review evidence. Reuses copies of #122 candidate
controllers without changing original owner worktrees; #137 unload/PID waiting and
transient bootstrap retry lessons are covered in the Mac controller.

Behavior: five shell entry points on Linux/Mac; deploy reads latest fetched master
blobs without changing the caller checkout, updates owned installations with
activation/health/recovery, and preserves private state. install only registers.
Mac stop refuses active/quarantined/unknown state, unloads Agent first, waits for
process exit, and starts task RPC before Agent. Existing deployments require
explicit adoption. Linux independent executor provisioning remains #134.

Verification (local/fixture, macOS): `npm test` 448/448 passed; separate
`node --test apps/mac-agent/test/*.test.mjs` 35/35 passed; `sh -n` on all five root
scripts and `git diff --check` passed. No runtime source changed; scripts/tooling
are outside runtime coverage percentages per docs/coverage.md. Native systemd,
installed launchd, live TLS/Keychain/Codex/Linx and remote deployment not run.
Independent review records follow under docs/reviews/ before merge.


Final #141 verification after integrating master `4f0a7f5`: `npm test` 464 total,
463 passed, 1 existing opt-in native launchd process fixture skipped, 0 failed;
Agent suite 35/35 passed. Recovery regression proves exact private config edits
are retained after an unconfirmed activation and explicit rollback. Shell syntax
and whitespace checks passed. User explicitly waived the two independent review
requirement on 2026-10-25 and authorized coordinator verification then merge.
A started independent source review found the recovery snapshot defect; fixed
with observed red/green regression. No further reviewer gate remains. No formal
service restart/deploy or live acceptance is claimed. #137 source is now on master
via #142; #122 integration remains separately tracked from live/adoption evidence.
