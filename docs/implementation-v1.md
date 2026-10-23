# Approved MVP Implementation Plan

> For agentic workers: use subagent-driven-development. A dedicated architect coordinates the iOS, Mac and Relay developers; see docs/architecture/README.md. Coordinator owns shared contract application, integration and commits. User approved continuation on 2026-10-23; deployment remains deferred.

**Goal:** Complete the native phone-to-Mac voice development and evidence loop under the approved scope.
**Architecture:** Native SwiftUI app, one public relay and one Mac launch entry point containing the outbound connector/task/result modules. Codex App Server and Linx AI remain dependencies. Interactive generated-site preview and a full Mac workbench are deferred.
**Tech Stack:** Node >=22, SwiftUI iOS 17+, Codex App Server, PCM/Opus, pinned dependencies.
**Spec:** docs/phone-demo-scope.zh-CN.md supersedes the historical broader proposal. Interfaces: docs/contract.md v1, using the phone-demo subset; preview routes are deferred.

## Global Constraints

- Native app, real Linx integration, outdoor access and inspectable results remain acceptance gates.
- The user approved demonstrating inside VoxCode on the phone. Results are real diff/files/checks/manual acceptance; no interactive generated-site preview or Mac workbench is required for this first demo. Original competition AirPlay compliance remains unconfirmed.
- At least 20 managed tasks; default four execution slots, configurable 1–8; one active turn/task.
- No plaintext remote credentials, arbitrary trust, public App Server, automatic merge/deployment, or fixture-as-live claims.
- Keep existing dirty work; use focused codex/ branches and PRs targeting the verified integration base (currently codex/mvp). Follow CONTRIBUTING.md and docs/agent-collaboration.md. Deployment only after explicit later resumption, and never replace an occupied 9899 service.
- Two independent expert reviews per component; targeted red/green regressions; coordinator commits only after verification.

## Task 1: Durable execution and configurable scheduling

Owner: Mac worker. Files: apps/mac/{service,server,codex}.mjs, tests and README.
Interfaces: settings/configure routes, criteria mutations, onSession/onEvidence callbacks from contract v1. Existing optional preview metadata is future work.

- [ ] Write failing tests for four active slots/fifth queued, 1–8 validation, lowering/persistence/replay, and >=20 tasks.
- [ ] Add durable settings without losing approval/cancel capacity or crash quarantine.
- [ ] Write adapter tests that follow-up resumes the same durable thread; never silently create a replacement. Persist thread/turn identity via onSession.
- [ ] Add criterion snapshots, explicit manual pass/fail and acceptance gating; inherit criteria unverified on follow-up.
- [ ] Preserve owned process teardown, secret environment stripping and version-bound evidence. Return actual diff/files/check commands, exit codes and bounded output.
- [ ] Coordinate a minimal aggregate monitoring snapshot with the coordinator: authenticated, bounded state/counters/durations, no prompts/tokens/private paths or task labels. A status page is optional polish.
- [ ] Run Mac tests, then obtain two independent scoped reviews before committing this feature.

## Task 2: Native task management and identity

Owner: iOS worker. Files: apps/ios/**. Consumes contract v1; coordinator integrates any Opus dependency afterward.

- [ ] Reproduce/fix recording A start failure discarding recording B using an executable regression.
- [ ] Add settings 1–8, task filters/counts/short IDs, criteria editing/confirmation and version snapshots; verify 20-task navigation logic.
- [ ] Add fixed-IP-only private-CA trust configuration for URLSession; reject wrong IP/CA/expiry and plaintext. Keep paired origin/token atomic. WKWebView is deferred.
- [ ] Render version-bound files/diff/check results and manual acceptance in native views; do not show unavailable interactive-preview controls.
- [ ] Consume version-bound voice drafts in the existing composer; preserve immutable uncertain-response retries and frozen target.
- [ ] Run Swift core tests and actual Xcode SDK build in CI; get two independent reviews. Signing/install remains separately recorded.

## Task 3: Fixed-IP TLS relay and core transport

Owner: relay worker. Files: apps/relay/** and certificate helper script only.
Interfaces: preserve createRelay/createConnector API; add tls:{key,cert,ca?} and connector ca option. Protocol routes follow v1.

- [ ] Write local HTTPS/WSS tests for matching private CA/IP, unknown CA/wrong IP rejection, and existing HTTP loopback fixtures.
- [ ] Implement TLS server/connector options and env path inputs; never set rejectUnauthorized=false.
- [ ] Add settings/criteria/voice abort route allowlist and preserve bounded audio/control handling. Preview bootstrap/cookie/static transport is deferred; retain its unfinished tests separately as future work.
- [ ] Add an opt-in local certificate helper producing ignored files, no overwrite, IP SAN and public CA bundle only for clients.
- [ ] Run existing and new relay tests; record no remote deployment and obtain two reviews.

## Task 4: Linx tools, drafts and audio

Owner: coordinator. Files: apps/integration/**, packages/voice/**, later native audio task.

- [ ] Write tests proving tool calls cannot escape owner/project/frozen target, change tasks, authorize execution, or run after revoke.
- [ ] Register bounded read-only/draft tools, persist expiring session drafts and emit them to phone. Bind dynamic context through documented prompt placeholders.
- [ ] Forward negotiated audio metadata and bounded, ordered Opus frames; add abort without task cancellation and cursor-gap errors.
- [ ] Select a proven pinned Opus dependency; verify decode metadata/frames and native playback state changes. Do not mark playback implemented from metadata alone.
- [ ] Verify real Linx onboarding, STT, MCP negotiation/tool call, draft return and audible speech once credentials/device resources are ready.

## Task 5: Result evidence, benchmarks and lightweight monitoring

Owner: coordinator, with architect/Mac developer for monitoring interfaces. Files: benchmark scripts/reports, integration executor wiring, demo fixtures; Mac files remain owned by the Mac developer.

- [ ] Use a small authorized demo project with repeatable checks; collect actual diff including new files, test command/exit code/output and current-version evidence. Preserve secret/path/symlink filtering.
- [ ] Add reproducible benchmarks for 24-task management, four-slot queueing, replay/cancel invariants and create/list/status API p50/p95/p99/error counts. Include revision/environment/configuration/sample counts and dependency mode in reports.
- [ ] Keep controlled-executor overhead separate from real Codex/Linx/cellular timings; establish a baseline before choosing latency thresholds. Missing scenarios stay unverified.
- [ ] Add bounded authenticated aggregate server monitoring; a small status page is optional. Do not introduce a monitoring platform or independent deployment unit.

## Task 6: Verification and delivery

- [ ] Publish verified source/documents through focused codex/ commits and PRs targeting the verified base; run GitHub Actions native SDK build and repair actual failures.
- [ ] Verify real Codex creates a file and follows up using the same thread; retry prior failed live smoke only after meaningful diagnostic changes.
- [ ] Run full Node tests, Swift core and native SDK build; two reviews for final shared behavior.
- [ ] On specified iPhone, verify signing/install, microphone/interruption, 20-task navigation, four real parallel tasks, ten mixed-target instructions, uncertain-response retry, real diff/check inspection and versioned acceptance.
- [ ] After separate deployment resumption, verify trusted IP TLS over cellular/company networks and respect occupied-port stop rule.
- [ ] Record a clearly identified real three-to-five minute VoxCode phone demo. List remaining live gates; do not call source-only delivery complete. AirPlay rule compliance remains a separate organizer question, not an implemented feature claim.

## Deferred Work

Interactive generated-site preview, static artifact/cookie publication, WKWebView trust, a full Mac workbench, custom AirPlay control, comprehensive dashboards and performance platforms are outside this phone-demo critical path. Existing interfaces/unfinished work are preserved as future scope. Reintroduce them only through an explicit scope update.
