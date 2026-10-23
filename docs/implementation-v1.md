# Approved MVP Implementation Plan

> For agentic workers: use subagent-driven-development. Coordinator owns shared contracts and commits. User approved continuation on 2026-10-23; deployment remains deferred.

**Goal:** Complete the native phone-to-Mac voice development and evidence loop under the approved scope.
**Architecture:** SwiftUI client, authenticated Node bridge, durable Codex threads/worktrees, Linx device WSS/MCP, fixed-IP TLS relay, immutable static preview.
**Tech Stack:** Node >=22, SwiftUI iOS 17+, Codex App Server, PCM/Opus, pinned dependencies.
**Spec:** docs/product-proposal.zh-CN.md. Interfaces: docs/contract.md v1.

## Global Constraints

- Native app, real Linx integration, outdoor access and inspectable results remain acceptance gates.
- At least 20 managed tasks; default four execution slots, configurable 1–8; one active turn/task.
- No plaintext remote credentials, arbitrary trust, public App Server, automatic merge/deployment, or fixture-as-live claims.
- Keep existing dirty work; continue on codex/mvp. Deployment only after explicit later resumption, and never replace an occupied 9899 service.
- Two independent expert reviews per component; targeted red/green regressions; coordinator commits only after verification.

## Task 1: Durable execution and configurable scheduling

Owner: Mac worker. Files: apps/mac/{service,server,codex}.mjs, tests and README.
Interfaces: settings/configure routes, criteria mutations, onSession/onEvidence/onPreview callbacks from contract v1.

- [ ] Write failing tests for four active slots/fifth queued, 1–8 validation, lowering/persistence/replay, and >=20 tasks.
- [ ] Add durable settings without losing approval/cancel capacity or crash quarantine.
- [ ] Write adapter tests that follow-up resumes the same durable thread; never silently create a replacement. Persist thread/turn identity via onSession.
- [ ] Add criterion snapshots, explicit manual pass/fail and acceptance gating; inherit criteria unverified on follow-up.
- [ ] Preserve owned process teardown, secret environment stripping and version-bound evidence. Add bounded trusted publication metadata.
- [ ] Run Mac tests, then obtain two independent scoped reviews before committing this feature.

## Task 2: Native task management and identity

Owner: iOS worker. Files: apps/ios/**. Consumes contract v1; coordinator integrates any Opus dependency afterward.

- [ ] Reproduce/fix recording A start failure discarding recording B using an executable regression.
- [ ] Add settings 1–8, task filters/counts/short IDs, criteria editing/confirmation and version snapshots; verify 20-task navigation logic.
- [ ] Add fixed-IP-only private-CA trust configuration for URLSession and WKWebView; reject wrong IP/CA/expiry and plaintext. Keep paired origin/token atomic.
- [ ] Open scoped preview sessions using isolated WebView storage without exposing the API bearer; block external navigation/native bridges.
- [ ] Consume version-bound voice drafts in the existing composer; preserve immutable uncertain-response retries and frozen target.
- [ ] Run Swift core tests and actual Xcode SDK build in CI; get two independent reviews. Signing/install remains separately recorded.

## Task 3: Fixed-IP TLS relay and bounded preview transport

Owner: relay worker. Files: apps/relay/** and certificate helper script only.
Interfaces: preserve createRelay/createConnector API; add tls:{key,cert,ca?} and connector ca option. Protocol routes follow v1.

- [ ] Write local HTTPS/WSS tests for matching private CA/IP, unknown CA/wrong IP rejection, and existing HTTP loopback fixtures.
- [ ] Implement TLS server/connector options and env path inputs; never set rejectUnauthorized=false.
- [ ] Add settings/criteria/voice abort route allowlist; preview bootstrap/cookie forwarding and exact static routes with safe headers and separate quotas.
- [ ] Add an opt-in local certificate helper producing ignored files, no overwrite, IP SAN and public CA bundle only for clients.
- [ ] Run existing and new relay tests; record no remote deployment and obtain two reviews.

## Task 4: Linx tools, drafts and audio

Owner: coordinator. Files: apps/integration/**, packages/voice/**, later native audio task.

- [ ] Write tests proving tool calls cannot escape owner/project/frozen target, change tasks, authorize execution, or run after revoke.
- [ ] Register bounded read-only/draft tools, persist expiring session drafts and emit them to phone. Bind dynamic context through documented prompt placeholders.
- [ ] Forward negotiated audio metadata and bounded, ordered Opus frames; add abort without task cancellation and cursor-gap errors.
- [ ] Select a proven pinned Opus dependency; verify decode metadata/frames and native playback state changes. Do not mark playback implemented from metadata alone.
- [ ] Verify real Linx onboarding, STT, MCP negotiation/tool call, draft return and audible speech once credentials/device resources are ready.

## Task 5: Immutable result artifacts and workbench

Owner: coordinator after shared integration. Files: apps/preview/**, apps/integration executor wiring, demo/**.

- [ ] Test fixed build/check recipes, isolated artifact snapshots, path/symlink rejection, version ownership, cookie revocation and control API denial.
- [ ] Publish only configured static build outputs with manifest/content digest; never serve active worktree files.
- [ ] Create a small real Web demo and actual checks, screenshots and mobile-interactive preview; record failures honestly.
- [ ] Add a restrained Mac Web workbench for task/activity/results, reusable with system AirPlay. Test real receiver separately.

## Task 6: Verification and delivery

- [ ] Publish existing verified source and approved documents in scoped Conventional Commits on codex/mvp; run GitHub Actions native SDK build and repair actual failures.
- [ ] Verify real Codex creates a file and follows up using the same thread; retry prior failed live smoke only after meaningful diagnostic changes.
- [ ] Run full Node tests, Swift core and native SDK build; two reviews for final shared behavior.
- [ ] On specified iPhone, verify signing/install, microphone/interruption, 20-task navigation, four real parallel tasks, ten mixed-target instructions, uncertain-response retry, preview and versioned acceptance.
- [ ] After separate deployment resumption, verify trusted IP TLS over cellular/company networks and respect occupied-port stop rule.
- [ ] Rehearse AirPlay and record a clearly identified real three-to-five minute demo. List any remaining live gates; do not call source-only delivery complete.
