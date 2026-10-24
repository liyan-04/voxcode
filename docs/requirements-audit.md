# Requirements audit: what must actually work

Current2026-10-24 update: [server execution](architecture/server-execution.md) supersedes the mandatory company-Mac and unresolved-AirPlay assumptions in the historical audit below. Native iPhone talks only to vm6; server hosts Linx and Codex. Strict TLS, phone VPN routing, signing/install, actual provider/model tasks, isolation and inspectable current-version acceptance remain gates. User-provided Linux preflight is not an authenticated model run; coordinator SSH checks did not execute because approval returned401.

Date: 2026-10-23. This audit separates a plausible design, implemented source, fixture verification and real device verification.

Current scope: [phone demo](phone-demo-scope.zh-CN.md), approved by the user's "手机上打开app演示就可以" clarification. Native VoxCode results/diff/checks replace generated-site interactive preview in first-demo acceptance. Benchmark scripts remain required; a lightweight aggregate monitoring endpoint/page is planned. Original AirPlay competition compliance remains unconfirmed.

## User intent
Carry only an iPhone outdoors, control Codex executing on a company Mac, use Linx AI meaningfully for voice collaboration, manage multiple tasks without cross-talk, receive inspectable results, review progress and accept changes. The user rejected a fixed two-task concurrency limit; the revised proposal targets at least 20 managed tasks, four default slots and configurable 1–8 slots. Available network resources are HTTP + IP:9899, without a domain or existing HTTPS. Deliver native iOS, record decisions and all work in liyan-04/voxcode, with two expert reviews per component, within two days. Deployment remains deferred; later use bili-xs8 on 9899 only if unoccupied.

## Coverage

The delivery claim has two required halves that must be recorded together: **G4 installs the signed native app on a real iPhone**, and **G5 uses that installed build over a public relay and cellular network to control Codex on the company Mac**. A simulator artifact, a signed install without a remote task, or a relay health check alone is partial evidence and cannot be called the final delivery.

| Requirement | Current evidence | Remaining gap |
| --- | --- | --- |
| Native iPhone app | M4 source6745dc0, Draft PR #5; push CI39980401752 passed core tests and unsigned iOS simulator SDK build; independent local core/syntax checks | PR coverage gate, native XCTest, two reviews, signing, iPhone installation and microphone test |
| Outdoor phone -> company Mac | M2 strict IP-SAN TLS/CA connector and local HTTPS/WSS fixtures; native explicit CA trust source | Production public CA asset, deployment, real cellular/company network and sleep recovery; no domain assumed |
| Local Codex execution | Live-local smoke passed two real model turns, verified file contents and same owned thread; adapter fixtures | Full phone-driven model task/checks/approval, real concurrent models and outdoor path |
| Existing Desktop Codex chats | Not supported by current design | Outside first phone-demo scope; do not claim Desktop takeover |
| Voice input via Linx | Real wire adapter; fixture handshake/audio/STT tests | Actual device registration, token and real audio recognition |
| Deep Linx assistant | M3 registers six scoped real-state/evidence/draft/focus tools, documented frozen prompt context, explicit confirmation; fixture tests | Real registered agent/tool negotiation, speech drafts, queries and usability |
| Spoken result/explanation | Actual Opus codec tests, Mac PCM conversion, native bounded PCM player source | Native/audio fixture execution, live provider output, audible iPhone speech and abort |
| Multiple parallel tasks | M1 default4/configurable1–8 scheduler,32-task capacity; M4 labelled24-task simulation; controlled24-task benchmark | Independent reviews,20-task native navigation and real parallel model verification |
| Continuous task conversation | Durable owned threads/workspaces and uncertain-dispatch fail-closed behavior; real two-turn continuity smoke | Phone-driven continuity, local unknown-turn reconciliation and reviewed approval ownership fixes |
| Phone receives results | Versioned bounded diff/new-file/check evidence and criteria/acceptance implemented in Mac/native source | Independent reviews and full phone-driven evidence/acceptance verification |
| Phone interactive preview | Optional field exists, no service pipeline | Deferred by phone-demo scope; not a first-demo acceptance gate |
| Approvals and acceptance | Separate routes, stale-version and single-use tests | Real Codex approval cycle and visible on-device UX |
| Background notifications | Not implemented | Can defer APNs; reopening must recover state and user must know foreground limitation |
| AirPlay | System mirroring is a possible later route | Deferred product demo feature; original competition rule still requires organizer clarification |
| Mac development dashboard | API service implemented | Full workbench deferred; lightweight authenticated monitoring considered separately |
| Benchmarks and monitoring | Reproducible24-task API/scheduler script; machineJSON at b531aa1 clean,zero errors; native core1000-sample cases; authenticated loopback aggregate endpoint | Synthetic/local evidence only; real model/audio/TLS/device measurements and review remain open |
| Repo records and review | Separate M0/Mac/Relay/iOS/voice Draft PRs #2–#6; independent developer worktrees, explicit owner attribution and review reports | Fresh v1 reviews/fixes/CI and external acceptance remain open; no PR has been automatically merged |

## Product assessment
The architecture can satisfy the needs, but the implementation is not yet a complete product. Passing module tests establishes protocol/state behavior under tested conditions; it does not establish outdoor usability, a working iOS binary, real Linx dialogue or acceptance of a running application.

Mobile dispatch, voice transcription, task switching and completion notifications are already competitor features. Positioning must not claim them as unique. A defensible proposed focus is a Linx voice collaborator that turns speech into explicit acceptance criteria, maintains correct task context, summarizes real validation evidence and closes the loop on phone-visible results. This remains a product hypothesis until implemented and tested.

## Two-day priorities
1. Install and run the native client, pair over trusted TLS relay, submit one real Codex task and receive its actual result.
2. Complete real Linx audio recognition and editable submission. Add read-only status/evidence dialogue only after this works.
3. Use one constrained authorized code project with real phone-visible diff, files, check results and versioned manual acceptance; generated-site interactive preview is deferred.
4. Preserve original task intent across follow-ups; then verify multiple independent tasks under the confirmed concurrency scope, cancellation and approval.
5. Rehearse a three-to-five minute flow: outdoor instruction, clarification, execution, progress query, phone result inspection, correction and acceptance.

Defer broad Desktop chat takeover, arbitrary projects, automatic integration/deploy, speech privilege approval and comprehensive APNs support. A source-only native client or STT-only pipeline must not be presented as the final voice collaboration demo.

## Deployment status
Read-only JumpServer access confirmed bili-xs8 and 9899 TCP showed no listener at check time. A later login refresh returned HTTP 403; no deployment was performed. Recheck port immediately before any future deployment. Public IP/port is specified, but trusted HTTPS/WSS termination remains unresolved. Do not send bearer credentials over public plaintext HTTP.

User subsequently selected loopback-only relay deployment initially, then explicitly deferred deployment until later after the JumpServer 403. No remote changes were made. Continue code and local verification. Earlier failed/interrupted real Codex attempts remain failures; a later explicitly authorized live-local two-turn smoke succeeded and verified file contents and the same owned thread. That success does not close phone, Linx or outdoor gates.
