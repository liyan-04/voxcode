# Execution ledger: phone demo, 2026-10-23

Plan: [implementation-v1](../implementation-v1.md). Authority: [phone-demo scope](../phone-demo-scope.zh-CN.md). Interfaces: [contract v1](../contract.md). Architect: `/root/architect`; integration/Git/PR owner: `/root`.

## Release and boundaries

The user authorized the architect and existing developers to start implementation. Root switched the shared checkout to `codex/phone-demo`; architect verified HEAD `cd81e20` on that branch. Existing dirty iOS/Mac/Relay work and `.gitignore` changes were retained. No additional approval is required for the bounded source tasks below.

| Agent | Exclusive writable paths | Initial execution state |
| --- | --- | --- |
| `/root/mac_v1` | `apps/mac/**` | MAC-002+003 released; current adapter/continuity RED reproduced: 9 passed/5 failed |
| `/root/relay_v1` | `apps/relay/**`, `scripts/create-local-tls.*` | RELAY-002 released through existing-agent followup |
| `/root/ios_v1` | `apps/ios/**` | IOS-002 then IOS-003 prepared; root releases after architect yields its slot |
| `/root/architect` | Only this new `docs/architecture/execution-2026-10-23.md` | Task/dependency ledger and additional architecture check |
| `/root` | Shared contract/docs/CI, voice/integration, benchmark tooling; Git/PR/integration | Applies interface changes before consumers; owns real-resource probes and Mac launch integration |

No worker stages, commits, stashes, switches branches, resets, cleans or pushes. No deployments, credential reads or duplicate workers. Retain unrelated changes and unfinished deferred files. Report needed shared changes to root; do not edit shared files. During this release root applied the bounded `GET /api/monitor` and PCM output contracts; the final small MAC-003 monitor slice and native PCM playback below are now authorized. Do not build preview, WKWebView, publication, full workbench or custom AirPlay control.

Ruling: use the three existing developers and current exclusive paths in the root-selected shared branch, rather than fresh workers/worktrees from the generic skill workflow, because this session has explicit resumable ownership and root controls Git. Risk: shared checkout integration requires exact path discipline and quiescent branch changes.

Ruling: one Mac launch entry means unified start/stop of connector/task/result modules, not a mandated single OS process. Keep stdio App Server and loopback bridge boundaries; root integrates the launcher. Risk: accidental duplicate startup/teardown must be covered in integration checks.

## Preflight interface and plan check

| Tasks checked | Producer / consumer or internal consistency | Finding / decision |
| --- | --- | --- |
| Task 1 / MAC-002+003 | Durable settings/session/criteria work and specified tests | Existing adapter/continuity RED is the first slice; route work follows. Default4/config1-8 and approval/stopping occupancy remain invariant. |
| Task 2 / IOS-002+003 | Core model changes versus native recorder/UI/tests | Core reducer passing does not fix native stale callbacks. Wire recorder first, then native management/results; exclude deferred preview. |
| Task 3 / RELAY-002 | TLS/core route tests versus transport/helper implementation | Preserve existing public factories and HTTP loopback fixtures. Retain preview tests as deferred material instead of implementing their omitted dependencies. |
| Task 4 / root voice | Tool/draft/audio ownership and true playback | Root selected pinned `opusscript@0.1.1` to decode provider Opus on Mac; iOS consumes signed int16 LE PCM through AVAudioEngine. Native playback is explicitly allocated below; no metadata-only playback claim. |
| Task 5 / root benchmarks+monitor | Measured reports versus platform scope | Reproducible fixture/local scripts are required. No invented thresholds; authenticated aggregate schema must precede consumers. Status-page polish is optional. |
| Task 6 / delivery | Source checks versus live/device/outdoor acceptance | Code can progress on labelled fixtures; missing signing/Linx/outdoor resources remain explicit delivery gates, not fabricated success. Deployment remains deferred. |
| Mac / iOS | Settings, Task/Criterion/Evidence, criteria mutation and standard errors | Use v1 unchanged: settings default4/range1-8/maxTasks32; criteria 1-12/text<=500; version/requestId mandatory where specified; private worktree/thread identifiers excluded from public Task. |
| Mac / Relay | Settings/criteria HTTP and voice-abort exact routes | Mac owns server settings/criteria; Relay adds only exact v1 core allowlist. Root owns voice-abort handler. Auth/status/body budgets must remain compatible. |
| Relay / iOS | Fixed-IP trust material and endpoint identity | Helper provides public PEM/DER handoff and IP SAN; native code bundles reviewed public CA only. Reject wrong CA/IP/expiry/plaintext; never disable validation. No production key generation/deployment now. |
| Mac / root voice+benchmark | Public task/evidence and trusted callbacks | Persist session identity before dispatch; unknown result blocks replay; trusted command status/exitCode are bounded version evidence. Root scripts consume public/stable seams, not private state paths. |
| iOS / root voice | Frozen recording, draft/focus/audio events | Drafts are suggestions only; editing/confirmation retains task/version semantics; uncertain submissions keep original requestId/content. Native audio ownership requires explicit root assignment. |
| Mac / root monitoring+launcher | Aggregate contract and unified startup | Root applied MonitorSnapshot before Mac implementation; authenticated local-only endpoint must stay outside Relay allowlist. Root coordinates launcher without changing worker-owned files concurrently. |

## MAC-002

Owner: `/root/mac_v1`; paths: `apps/mac/**`. Base: `cd81e20` plus retained Mac dirty work. Goal: complete the durable execution slice before HTTP expansion.

- Reproduce existing RED using `node --test test/codex.test.mjs test/continuity.test.mjs` from `apps/mac`. Last reported result was 9 passed/5 failed; record the actual current output before implementation.
- Implement durable owned non-ephemeral start/resume; persist and await `onSession` before turn dispatch. Follow-up resumes the same thread/worktree; resume failure never silently starts a replacement.
- Persist task-specific unknown dispatch/reconciliation state. After ambiguous turn start, refuse automatic replay/follow-up, including after service restart. Preserve owned teardown, crash quarantine, one active turn/task and cancellation/approval slot occupancy.
- Return trusted bounded command evidence with status/exitCode and actual diff including new files; model prose cannot pass criteria. Keep private IDs/paths out of public Task.
- Run focused RED/GREEN adapter/continuity plus relevant recovery/cancellation/evidence regressions. Send root/architect an early integration note as soon as callback or recovery behavior is stable, then continue MAC-003 without waiting for another approval if no shared-interface change is needed.
- Exclude preview/workbench, launcher integration, unrelated dependencies and live-service success requirements. Monitoring follows only the root-applied MAC-003 contract. New contract needs go to root immediately.

## MAC-003

Same owner/paths/base. Dependency: coherent MAC-002 green slice; consume contract v1.

- Add authenticated GET/POST settings and manual criterion mutation HTTP routes; regression coverage for valid/default values, stale version, replay/conflict, invalid range, failed/unverified required criteria and authorization.
- Reconcile retention/acceptance regressions with explicit manual criterion confirmation; preserve separate replay budgets, old evidence/version separation and acceptance snapshots.
- Verify >=20 (benchmark target 24) managed tasks, default four active/fifth queued, configurable 1-8, persisted settings, lowering only future dispatch, approval/stopping retain slots and no parallel turn for one task.
- Keep structured diff/check output inspectable by native consumers. Update Mac README and run the complete Mac suite after the focused slice passes; do not change root CI/coverage tooling.
- At the end, implement the root-applied authenticated local-Mac-only `GET /api/monitor` contract as a small slice: `generatedAt`, `uptimeSeconds`, `executionLimit`, `maxTasks`, `activeExecutions`, `recoveryRequired`, fixed full `counts` including zeros (`completed` excludes accepted), `memory.rssBytes/heapUsedBytes`. These are current aggregates, not durable throughput counters. Add auth/count/nonleak tests. No prompts/IDs/titles/logs/tokens/private paths/thread IDs/unbounded task labels, new listener, Relay exposure or dashboard requirement.

## RELAY-002

Owner: `/root/relay_v1`; paths: `apps/relay/**`, `scripts/create-local-tls.*`. Base: `cd81e20` plus retained `apps/relay/test/v1.test.mjs`. Goal: trusted fixed-IP core transport.

- Reproduce focused TLS/core route RED without entering the known missing-preview readiness wait. Preserve deferred preview tests separately and name their deferred status honestly; do not delete evidence or default-enable preview.
- Preserve `createRelay`/`createConnector` API. Add relay `tls:{key,cert,ca?}`, connector CA option, CLI env file-path inputs and strict HTTPS/WSS validation. Never use `rejectUnauthorized=false` or accept arbitrary certificates.
- Local fixtures must prove matching trusted private CA/IP success and unknown CA/wrong IP/expiry rejection. Existing HTTP loopback tests remain green; plaintext remote credentials remain prohibited.
- Add exact authenticated settings/criteria/voice-abort allowlist while preserving control/audio bounds, timeout, cleanup, cancellation/approval/status capacity and error forwarding. No monitoring/public arbitrary routes or preview transport expansion.
- Add opt-in no-overwrite IP-SAN certificate helper under the assigned script name; output public client CA PEM/DER formats and document the iOS/connector handoff. Generated private material stays ignored/outside Git and logs; `.gitignore` mutation belongs to root.
- Run targeted RED/GREEN checks and the applicable existing relay suite. Report changed paths, factory/CLI names, public CA format, fixture timing/connection-cleanup seams and any blocker early to root/architect. Do not deploy or read remote credentials.

## IOS-002

Owner: `/root/ios_v1`; paths: `apps/ios/**`. Base: `cd81e20` plus retained `Core.swift`, `RecordingRaceChecks.swift`, `V1Checks.swift`. Goal: close the actual native stale-recording race.

- Read current phone-demo scope/contract and this brief, then inspect native Recorder callbacks plus retained reducer. Reproduce recording A start failure/final completion arriving after B starts in executable coverage before changing native behavior.
- Wire generation-owned `RecordingLifecycle` into actual Recorder start/catch/final/poll guards. Old A cannot discard B, clear B busy/error state, append old transcript/audio or mutate frozen target; stop/discard/interruption invalidates old callbacks.
- Run existing core checks and race regression; add a native-facing/XCTest path where the repo supports it and syntax/plist checks as relevant. Request root native SDK CI on the new snapshot; do not infer device success from core timing or unsigned builds.
- Report the first coherent fix and actual checks immediately, then continue IOS-003 without waiting for another approval if no shared-interface change is needed. Suggested coherent subject after verification: `fix(ios): preserve newer recordings after stale start failures`.
- No WKWebView/preview, live credential access, source/Git outside assigned paths or unsolicited Opus dependency work.

## IOS-003

Same owner/paths/base. Dependency: native race slice; Mac settings/criteria and Relay TLS handoff may be consumed through visibly labelled fixtures while pending.

- Add native settings 1-8, >=20-task filters/counts/short IDs and clear queue/running/attention states; show actual connection/sync/recovery status without invented percentages.
- Add criteria editing/confirmation, current-version files/diff/check output and explicit manual acceptance; stale versions and required failed/unverified criteria cannot be accepted. Hide unavailable interactive-preview controls.
- Add fixed-IP URLSession private-CA trust and ATS configuration with strict CA/IP/expiry/plaintext rejection; preserve atomic paired origin/token. Await Relay public CA format/handoff, and report any missing public trust asset without inventing a production certificate.
- Consume contract VoiceDraft/focus events in the existing composer: enforce owner/frozen task/version/expiry, explicit confirmation and immutable requestId/content reconciliation for uncertain responses. Focus is a suggestion, never automatic task submission/retargeting. Coordinate with root voice work; no tool/STT automatic mutations.
- Root explicitly allocated native PCM playback now: use AVAudioEngine for server-decoded signed int16 little-endian mono PCM, negotiated 16000 or 24000 Hz. Voice create returns `outputFormat:null|{format:"pcm",sample_rate:16000|24000,channels:1}`; `outputSupported` only describes server output capability. Process ordered `seq`/base64 PCM events, reject stale lifecycle audio, clear queued playback immediately on abort/recording start, avoid playback feeding recording, preserve TTS `is_aborted`, and handle 409 `cursor_expired` visibly. Add meaningful synthetic PCM/lifecycle/stop regressions; real audible device playback remains a separate gate. No native Opus dependency: root's Mac codec is `opusscript@0.1.1`.
- Run focused core/native checks and send root SDK CI inputs. Provide safe benchmark hooks for 24/32-task decoding/filtering, recording epochs and URLSession metrics, labelling synthetic/core timing separately.

## Reporting and evidence

Every worker handoff to architect and root includes task/status, base/content snapshot, exact changed paths, public behavior/interface effects, actual commands/results with working directory/runtime, evidence label (`fixture`, `local`, `live`, `device`, `outdoor`), failed/skipped checks, blockers and next step. Do not require unavailable live/device resources to finish a code slice, but do not close those gates either.

This release itself reran no implementation tests. Prior ARCH-001 evidence remains historical: iOS synthetic core/race checks passed but native wiring was absent; Mac settings/service/recovery 10/10, criteria 5/5, adapter/continuity 9 passed/5 failed; Relay v1 first four expected failures then interrupted, TLS case incomplete. Current code checks must replace these counts with actual output.

Root retains voice/integration, proven pinned Opus selection, benchmark scripts/reports, shared contracts/CI and Git. Benchmarks cover 24-task management/default-four queueing, replay/cancel invariants, create/list/status p50/p95/p99/error counts with revision/environment/sample/dependency labels. No performance thresholds or live throughput are invented.

## Review rotation and architecture checkpoint

Recommended to root after developers return coherent verified slices: iOS reviewers `/root/mac_v1` and `/root/relay_v1`; Mac reviewers `/root/ios_v1` and `/root/relay_v1`; Relay reviewers `/root/ios_v1` and `/root/mac_v1`. Each pair did not implement that component. Root should schedule bounded read-only rotations after development is quiescent, respecting four slots; do not ask implementers to launch reviewers or self-approve. If a reviewer later contributes implementation to that component, replace its review with another independent reviewer through root.

Each component requires both specification/security and platform/lifecycle scrutiny, exact reviewed snapshot, findings/resolutions under root-managed `docs/reviews/`, P0/P1 fixes and targeted rereview. Historical baseline reviews do not cover v1. Architect's cross-component check is additional; AI reports are not human approvals or acceptance.

Next checkpoint: first MAC-002/IOS-002 green slice or concrete blocker, RELAY-002 TLS/route/CA handoff, and root voice contract needs. Architect checks actual diffs/output for field/version/auth/error compatibility, callback/turn identity, unknown dispatch, CA/IP consistency, control capacity and unchanged slot semantics, then recommends integration. Root reproduces checks, stages explicit paths and owns commits/PRs. Signed iPhone, real Codex/Linx and outdoor gates remain separately pending; deployment is still deferred.

## Dispatch log

- Prepared all three source briefs at verified base `cd81e20` before dispatch.
- Mac and Relay existing-agent followups accepted. Mac immediately reproduced `node --test test/codex.test.mjs test/continuity.test.mjs` from `apps/mac`: 14 tests, 9 passed/5 failed, then began MAC-002; it confirmed no public contract change is needed for private reconciliation state.
- Root-applied monitoring/PCM contract was read and sent to Mac/Relay; Mac may add the exact local monitor endpoint at the end of MAC-003, while Relay must not expose it.
- iOS: full brief prepared; root must release the existing `/root/ios_v1` via followup after architect ends this round, so three developers can execute without exceeding four slots. Do not create a replacement worker.
