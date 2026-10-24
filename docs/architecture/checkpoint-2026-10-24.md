# ARCH-003: cross-component phone-demo checkpoint

Date: 2026-10-24 (Asia/Shanghai). Architect: `/root/architect`. This is an additional architecture/integration check, not either required independent component review, a human GitHub approval or product acceptance.

## Snapshot and authority

Read-only source worktree: `/Users/liyan2026mac/Documents/ChatGPT/1024/voxcode/.worktrees/architecture`, root-provided branch `codex/architecture-checkpoint`, base `d6eac09`. Root confirms this integrated base includes Mac `fecd68f`, Relay `de8fc2d`, iOS `6745dc0` and voice criteria fix `bdd7f29`. The architect ran no Git commands and changed only this new record. Source fingerprints below independently identify the files read; branch/commit/cleanliness information is attributed to root, not a new Git inspection.

Additional read-only evidence came from `.worktrees/integration/docs/reviews/phone-demo-ios-platform.md` (review of `6745dc03d61d2034a5e58f7ec7dea4bf205b97e2`) and the actively changing `.worktrees/ios` IOS-004 source. IOS-004 is uncommitted/in progress at this checkpoint and is not approved by reading its partial changes. Mac and Relay source are quiescent per their handoffs/root.

Current authority remains [phone-demo scope](../phone-demo-scope.zh-CN.md), [implementation plan](../implementation-v1.md), [contract v1](../contract.md) and [architect boundaries](README.md). Three deliveries remain: native iPhone app, public relay, one Mac launch entry with unified start/stop. No extra service, preview, WebView, full workbench or custom AirPlay feature is introduced. Deployment remains deferred. Original competition AirPlay compliance remains unconfirmed.

## Finding and integration recommendation

**ARCH-003-F1, P2: definitive business rejection still shares the idempotency-conflict code.** At this integrated base, `apps/mac/service.mjs:630-639` rejects acceptance with `409 conflict` when a trusted check failed, even after every manual criterion passed. The native `TaskSnapshot.canAccept` (`Core.swift:28-30`) checks manual criteria only, so this request can be sent through the enabled acceptance control. The IOS-004 source inspected during this checkpoint deliberately maps `409 conflict` to `uncertain`, retaining the pending payload. `service.mjs:668-677` also uses that code for an expired/obsolete approval. Therefore the typed-rejection fix alone does not close every definite detail/approval failure: an unchanged retry can remain permanently blocked.

This is a concrete cross-component instance of the existing IOS-004/P2 detail-recovery finding, not a request for new functionality. Do not classify all 409s as rejected: the same code at `service.mjs:557,565` protects changed request payloads/global identity and must retain reconciliation semantics. Root should distinguish definite business-rejection codes in the shared contract, or define a path-specific fresh-state reconciliation that safely releases the failed operation. Keep uncertain network/5xx/identity-conflict retries immutable. Tell both client and server reviewers which resolution is chosen and add the actual expired-approval/failed-check native-client regression.

Resolution selected after the source check: root applied the shared `409 blocked` semantics in integration commit `3b5af3d`; existing `409 conflict` keeps immutable/reconciliation behavior. Mac MAC-005 and iOS IOS-004 are implementing the matching producer/consumer changes. Those source fixes, regressions, integration and independent targeted reviews are pending at this handoff; `d6eac09` remains the source snapshot inspected above.

Architect independently reproduced the server half with the real `createService` and a temporary controlled executor, without changing source or using a model/network/Git dependency. Actual command from the architecture worktree: `node --input-type=module -e` with this program:

```js
import {createService} from './apps/mac/service.mjs';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dataDir = mkdtempSync(join(tmpdir(), 'vox-arch003-'));
const service = createService({project:dataDir, dataDir,
  prepareWorktree:() => dataDir,
  executor:({onEvidence}) => onEvidence('test', 'check', 'failed',
    {status:'failed', command:'check', exitCode:1})});
try {
  let task = service.mutate('create', {requestId:'create', title:'Architecture fixture', prompt:'fixture'});
  await new Promise(resolve => setTimeout(resolve, 30));
  task = service.get(task.id);
  service.mutate('criterion', {requestId:'criterion', version:task.version, decision:'pass'}, task.id, task.criteria[0].id);
  try { service.mutate('accept', {requestId:'accept', version:task.version}, task.id); }
  catch (error) { console.log(error.status, error.code, error.message); }
  console.log(service.get(task.id).status, service.get(task.id).acceptance,
    service.get(task.id).criteria.map(item => item.status));
} finally { await service.close(); rmSync(dataDir, {recursive:true, force:true}); }
```

Actual result, exit 0: `409 conflict`, message `Required criteria and trusted checks must pass before acceptance.`; task remained `completed`, acceptance `pending`, manual statuses `[passed]`. This is local/fixture server behavior plus source-level client mapping analysis, not an executed native UI reproduction. Findings and minimal resolution options were sent to root and iOS.

**Recommendation:** keep the milestone PRs Draft through IOS-004, its independent targeted reviews, and fresh integration/native CI. Mac/Relay/voice source and measured fixture coverage support continued integration; they do not establish signed-phone/Linx/outdoor acceptance. No new P0/P1 was identified in this scoped cross-component inspection; the previously reported iOS definitive-rejection P1 remains open until the resolving snapshot and regressions are reviewed.

## Contract and demo-loop check

| Boundary / step | Source evidence at this snapshot | Result / remaining condition |
| --- | --- | --- |
| One Mac entry / outbound connection | `apps/integration/runtime.mjs:5-30` binds bridge to `127.0.0.1`, creates connector using that exact origin, and closes connector/voice/app together | Matches launch-entry design; no separate preview/workbench runtime required |
| Fixed-IP trust | Relay connector requires WSS outside literal loopback, `rejectUnauthorized:true`, CA/IP checks, no redirects (`connector.mjs:11,53`); iOS `BridgeTransport.swift:16-35` uses exact fixed-IP SSL policy and only bundled CA | Public PEM/DER helper handoff matches; missing production DER fails closed. Actual native handshake matrix and reviewed deployment CA remain pending |
| Pairing/authentication | Pair returns phone session token; native binds origin/token atomically. Relay forwards phone bearer, rejects machine key as phone bearer (`connector.mjs:25-33`); Mac reauthorizes after mutation-body awaits (`server.mjs:53-55,73-76,100-112`) | Matches role separation; revoked/expired slow-body mutation fix is present |
| Core routes/errors | Relay `protocol.mjs:24-34` admits exact settings/tasks/criteria/voice create/audio/events/stop/abort/delete; Mac server exposes matching task/settings routes | Fields/paths/JSON forwarding match; F1 error meaning remains ambiguous, requiring root-coordinated resolution |
| Speak / draft / confirm | iOS freezes recording before awaits (`Recorder.swift:23-29`); voice tools guard owner/expiry/frozen task/version and have no task mutation (`voice-tools.mjs:18-48`) | Draft confirmation is native-only. Recorder uses draft.prompt (`:61-63`), Composer protects edited title/criteria; missing prompt wiring is not a finding |
| Same-task follow-up | `codex.mjs:317-356` resumes stored thread with identical cwd/permissions and awaits session persistence before turn dispatch; `service.mjs:319-335,355-358` persists identity and uncertainty | Same-thread live-local smoke is root evidence below; unknown dispatch intentionally requires local reconciliation, never automatic replacement/replay |
| >=20 tasks / execution slots | Service maxTasks32 and durable default4/config1-8; `pump` counts active entries, approval/stopping keep occupancy until settlement (`service.mjs:280-298,371-385`) | Controlled 24-task benchmark exists. Real four-task parallel model work and native navigation remain separate acceptance gates |
| Actual result / acceptance | Trusted command status/exitCode and version evidence; native results show command/output/diff and historical versions (`TaskDetail.swift:32-38,97-109`); manual criteria/snapshot independent of execution completion | No interactive-site dependency. F1 covers failed trusted checks versus native acceptance/pending policy |
| Approval / stop | Mac approval requests are bound to owned active thread/turn; service checks current approval/version/expiry; native explicit buttons/cancel, no tool authorization | MAC-004 source is present. Expired-approval recovery needs the F1 resolution and native regression; cancellation still means stopping, not rollback |
| PCM playback / stop | Mac `audio.js` emits signed int16 LE mono PCM at 16/24kHz; native PCMFrame/VoiceCursor decode and enforce sequence; `PCMPlayer` caps four seconds; Recorder drops audio while recording and clears playback on stop/start | Wire formats match; audible playback, AVAudioSession conversion/interruption and actual microphone feedback remain device gates |
| Closed/revoked voice | Voice reauthorizes after body/readiness awaits, closes decoder/drafts/events and rejects polling after close; original TTL removes closed sessions (`voice.mjs:25-30,52,103-107,129-139,154-158`) | Existing independent follow-up covered auth/payload/retention fixes; new same-recording DELETE/create ordering finding remains tracked by iOS reviewers |
| Monitoring / benchmarks | Authenticated loopback-only Mac monitor, fixed aggregates and no task content; Relay allowlist omits monitor and preview. Benchmark report explicitly names controlled executor/loopback and small samples | No new monitoring platform or exposure. Fixture timings are not Codex/Linx/native/outdoor latency guarantees |

## Remediation and review coordination

Architect sent both current developers bounded coordination messages; no replacement developer/reviewer was created and no new source ownership was assigned.

| Component / reviewer pair | Current boundary and next review gate |
| --- | --- |
| iOS: `/root/architecture_review` platform reviewer + `/root/mac_v1` | iOS implementer first closes IOS-004 typed rejection/journal plus detail/criterion recovery in its own worktree. Mac reviews iOS read-only and independently confirms pending/ordering behavior; architect supplied exact platform-report locations for re-record/delete and older refresh. Those P2s remain tracked for the next root-ordered slice, not a demand to overlap the P1. Both original independent reviewers must rereview material fixes. |
| Mac: `/root/relay_v1` security reviewer + `/root/ios_v1` client reviewer | MAC-004 `fecd68f` resolves reported auth/approval/UTF-8 issues with root 66/66 evidence. MAC-005 is now adding root's `409 blocked` distinction. Original security reviewer needs targeted fix review; iOS returns to second client/protocol review after its own coherent fix. Root tests and this architecture check do not substitute for either reviewer. |
| Relay: `/root/mac_v1` + `/root/ios_v1` | Root reports both reviews and Linux Node22 CI complete for `de8fc2d`; client report identifies exact final commit and fingerprints. No new Relay work dispatched. Later code changes require targeted rereview. |
| Voice/integration: `/root/mac_v1` + `/root/ios_v1` | Mac's auth/close/retention review has a resolved targeted follow-up; iOS's second review found inherited-criteria P2. Root applied `bdd7f29` with RED/GREEN 26/26; iOS must check inherited text/required fields, explicit edits and null rejection on the resolving snapshot after its own P1 slice. |

Four slots are occupied by root, architect and two existing workers. Further reviewer rotations belong to root after a worker or architect yields; architect did not start a fifth agent. Source fixes remain in their owners' independent worktrees; root applies shared contracts/integration and owns all Git/PR operations. Architecture checks stay additional to each component's two reviews.

## Evidence ledger

| Evidence / snapshot | Actual observation and limits |
| --- | --- |
| Architect source check at `d6eac09` | Read the scope/contract/role rules, critical native/Mac/Relay/voice/runtime paths, review reports and benchmark/CI definitions; checked SHA-256 values below. No full suite/native build was rerun by architect. |
| Architect temporary fixture, current checkpoint | `node --input-type=module -e` reproduction above exited 0 and confirmed definite acceptance rejection uses 409/conflict. Temporary state was deleted after service shutdown. No production dependency, remote request or credential involved. |
| Root fresh integrated Node evidence, `d6eac09` | Root reports `npm run test:coverage:node`: 143/143; lines 92.51% (2089/2258), branches 82.84% (1038/1253), functions 93.61%. These supplied results are not newly executed by architect. |
| Root live-local post-MAC-004 smoke | Root reports `node scripts/smoke-real-codex.mjs`: passed true, two real model turns, fileVerified true, sameOwnedThread true, 17 events. Establishes local executor creation/follow-up only; not phone/Linx/outdoor/four-parallel acceptance. |
| Root CI evidence | Integration run `39981233060` passed Swift core coverage, unsigned SDK build and native XCTest before IOS-004. Root reports Mac PR #3 latest Node/unsigned SDK CI passed and Relay `de8fc2d` Linux Node22 run `39981060532` passed. Subsequent fixes require new exact-snapshot CI; no automatic inheritance of old passes. |
| Existing benchmark artifacts | `docs/benchmarks/node-local-2026-10-23.json` records revision `b531aa1`, controlled 24 tasks/maxActive4/fifthQueued/replay/cancel invariants, 24/60/60 create/list/status samples with zero errors, no TLS/model/voice. Native core baseline measures synthetic decoding/filter/epoch CPU only. No new timings or thresholds asserted here. |

## Remaining real-resource gates

- Signed build and installation on the specified iPhone; native microphone permissions/conversion/interruption, audible 16/24kHz speech and immediate stop, >=20-task navigation and ten mixed-target instructions without misrouting.
- Real Linx provisioning/STT/MCP negotiation, actual draft/query return and audible result speech. Current lack of configured Linx resources does not block fixture/source integration, and does not become a pass.
- Reviewed production public CA distributed through the signed app, native correct-CA/IP success and wrong-CA/IP/expiry rejection. No production CA/key or deployed TLS endpoint is established by loopback tests.
- Actual cellular-phone/company-Mac path, reconnect/sleep behavior and measured shared-WSS cancellation responsiveness; real four-task parallel isolation/throughput. Deployment stays deferred; a later explicit resumption still requires checking `bili-xs8:9899` and stopping if occupied.
- Competition AirPlay wording remains a separate unconfirmed compliance item; first phone-demo source scope does not claim a waiver or custom implementation.

Next checkpoint: finish and integrate MAC-005/IOS-004 against root's `3b5af3d` rejection contract, obtain the independent targeted reviews above, and run new exact-snapshot integration/native CI. Architect yields now so root can schedule Mac's independent security follow-up; final resolving SHAs can be appended in a targeted later checkpoint. Preserve unavailable live/device/outdoor gates plainly; add no features while these source corrections are closed.

## Read-source fingerprints

SHA-256, architecture worktree baseline supplied as `d6eac09`:

```text
5a3c8b6ca7ded51ac712b111905e7e0c926ffa01dea3967d23950486660d77c3  docs/contract.md
162ac27fdca82efcf1690c8a17260688bebd16c97daee2f0cde8f05620a7040e  apps/mac/service.mjs
5355baba155e700b2ad8bfc1f0e67f590d20c9f288f6d8447968c7a0517cfcd3  apps/mac/server.mjs
5746c879befd65765cf197dae81ae175fba7bfd132e7acc7c3d69a5c368e4158  apps/mac/codex.mjs
3205027658ef928b57ceb91cad822f6ce7a940c38696af719b0c6c24f3919553  apps/integration/voice.mjs
02e6092d4602d069c53bcfe600f20140ae8ed3892ec8bc2f47556fefbcca18d5  apps/integration/voice-tools.mjs
d4785d860766730f6c2c0018e9dc8f119b8e9388cc519cd9e648957d69461a92  apps/relay/protocol.mjs
cc294bd4c703bcd418d252caa7023f6eefe0bcf03b6f12a44988e2458a59467e  apps/relay/relay.mjs
e4a496038f10704770f18687399fb979ce55d9679a88921141047dc1dc11fc3e  apps/ios/Sources/VoxCodeCore/Core.swift
6e4301e787a172f8e74c230942f0cfad4e5fa1b0eef5981811fbfaf35a37d2f4  apps/ios/VoxCode/Session.swift
acbca81f954891ecaaf06ab15459dfe9b5adb5e22e87c0d1e20bb74f07be7df2  apps/ios/VoxCode/Recorder.swift
```
