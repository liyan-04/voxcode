# Requirements audit: what must actually work

Date: 2026-10-23. This audit separates a plausible design, implemented source, fixture verification and real device verification.

Current scope: [phone demo](phone-demo-scope.zh-CN.md), approved by the user's "手机上打开app演示就可以" clarification. Native VoxCode results/diff/checks replace generated-site interactive preview in first-demo acceptance. Benchmark scripts remain required; a lightweight aggregate monitoring endpoint/page is planned. Original AirPlay competition compliance remains unconfirmed.

## User intent
Carry only an iPhone outdoors, control Codex executing on a company Mac, use Linx AI meaningfully for voice collaboration, manage multiple tasks without cross-talk, receive inspectable results, review progress and accept changes. The user rejected a fixed two-task concurrency limit; the revised proposal targets at least 20 managed tasks, four default slots and configurable 1–8 slots. Available network resources are HTTP + IP:9899, without a domain or existing HTTPS. Deliver native iOS, record decisions and all work in liyan-04/voxcode, with two expert reviews per component, within two days. Deployment remains deferred; later use bili-xs8 on 9899 only if unoccupied.

## Coverage

| Requirement | Current evidence | Remaining gap |
| --- | --- | --- |
| Native iPhone app | SwiftUI source; GitHub Actions 39966128017 passed Swift tests and unsigned iOS simulator SDK build at 4c59925 | Signing, specified iPhone installation and real microphone test remain unverified |
| Outdoor phone -> company Mac | Outbound relay/connector local integration tests | Proposed IP-SAN TLS and explicit client trust, deployment, real cellular/company network and sleep recovery; no user-provided domain assumed |
| Local Codex execution | App Server initialize/thread creation smoke and adapter fixture tests | Full real model task including filesystem write, checks and follow-up |
| Existing Desktop Codex chats | Not supported by current design | Outside first phone-demo scope; do not claim Desktop takeover |
| Voice input via Linx | Real wire adapter; fixture handshake/audio/STT tests | Actual device registration, token and real audio recognition |
| Deep Linx assistant | Proposed scoped MCP/status/draft tools | Not yet registered in working product; current integration is STT plus explicit submit |
| Spoken result/explanation | Adapter forwards TTS metadata/audio | Native raw Opus decoding/playback not implemented or verified |
| Multiple parallel tasks | Current two-slot worktree scheduler and tests | User rejected two-slot limit; proposed 20-task UI and four-way/default, 1–8 configurable execution still require source updates, review and real verification |
| Continuous task conversation | Same worktree reused | Adapter currently starts ephemeral Codex session per execution; original intent/history must be explicitly preserved or use persistent thread lifecycle |
| Phone receives results | Events, bounded code evidence and response notes | Native version-bound diff including new files, actual check command/exit code/output and manual acceptance still need end-to-end verification |
| Phone interactive preview | Optional field exists, no service pipeline | Deferred by phone-demo scope; not a first-demo acceptance gate |
| Approvals and acceptance | Separate routes, stale-version and single-use tests | Real Codex approval cycle and visible on-device UX |
| Background notifications | Not implemented | Can defer APNs; reopening must recover state and user must know foreground limitation |
| AirPlay | System mirroring is a possible later route | Deferred product demo feature; original competition rule still requires organizer clarification |
| Mac development dashboard | API service implemented | Full workbench deferred; lightweight authenticated monitoring considered separately |
| Benchmarks and monitoring | Reproducible script/report and aggregate-only monitoring scope recorded | No new benchmark measurements or implemented monitoring claimed |
| Repo records and review | Baseline/source policy pushed; Draft PR #1 has passed policy/Node/Swift/simulator checks | New phone scope and architect records need scoped commit; fresh v1 component reviews and external acceptance remain open |

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

User subsequently selected loopback-only relay deployment initially, then explicitly deferred deployment until later after the JumpServer 403. No further remote changes are authorized by that deferral; continue code and design work. Real Codex filesystem smoke was attempted locally and with runtime access; the first App Server exited, and the second timed out/interrupted without the expected result. Do not count either attempt as a successful model task.
