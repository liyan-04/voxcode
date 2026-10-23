# iOS phone-demo implementation handoff

Date: 2026-10-23. Owner: `/root/ios_v1`. Status: source milestone for a draft PR; independent review and native SDK verification pending. This is an implementation handoff, not an independent review or device acceptance.

Base: `a352757`, branch `codex/ios-phone-demo`, worktree `.worktrees/ios`; retained earlier `cd81e20` work was copied by the coordinator and continued only in this worktree. No worker staging, commits, branch changes, pushes or deployments.

## Scope and paths

- Core: `apps/ios/Sources/VoxCodeCore/Core.swift`.
- Native: `apps/ios/VoxCode/{Recorder,Session,VoxCodeApp,ComposeView,SettingsView,TaskDetail,SimulationBridge,PCMPlayer,BridgeTransport,AnchorMetadata}.swift`, `Info.plist`, `project.yml`.
- Tests/runners: `apps/ios/Tests/VoxCodeCoreTests/V1CoreTests.swift`, `apps/ios/NativeTests/{RecorderTests,TransportTests,SimulationTests}.swift`, `apps/ios/Scripts/{CoreChecks,RecordingRaceChecks,V1Checks,AudioChecks,AnchorChecks,SimulationChecks,CoreBenchmarks}.swift`. Existing CoreChecks is retained unchanged.
- Evidence/docs: `apps/ios/Benchmarks/core-baseline.json`, `apps/ios/README.md`, this handoff. No shared contracts were edited.

## Behavior and contract effects

- Actual Recorder uses generation-owned state before permission/network awaits. Stale start failures/final callbacks and poll responses cannot clear a newer target/busy/error or insert old transcript/audio. Discard cancels queued/in-flight uploads without draining. Interruption cancels polling and stops capture/output; stop drains uploads normally.
- Native lists support 24+ tasks, distinct short IDs, counts and four filters. Settings consume authenticated v1 default-four/configurable-1–8 routes; pending settings retry preserves request ID/value. Connection/sync/recovery state remains explicit, with offline snapshots available.
- Composer edits 1–12 conditions, freezes target/version before recording, consumes matching unexpired VoiceDraft proposals and displays focus suggestions without retargeting/submitting. Version rereview preserves text and creates a new submission identity. Confirmed uncertain submissions retain route/text/conditions/version/request ID, lock editing and persist in an app-local journal scoped to the paired origin/credential hash. The bearer remains in Keychain. Pairing replaces origin/token together only after successful save.
- Native results show actual current-version diff/check text, commands, exit codes and criterion evidence IDs. Manual pass/fail is distinct from operation approval and acceptance. Acceptance is disabled offline or unless current required criteria passed. Historical evidence and acceptance snapshots remain separately visible. No preview controls or WKWebView were implemented.
- Only `121.52.250.201` has an iOS 17 ATS exception. App origins are HTTPS-only; URLSession requires TLS 1.2+, rejects redirects, cookies and caches. Fixed-IP trust uses an exact IP SSL policy, the optional reviewed bundled `VoxCodeCA.der` as the sole anchor, no network trust fetching and SecTrust evaluation. A bounded DER reader also validates the bundled anchor's CA flag and own validity. Missing/invalid CA fails clearly; ordinary HTTPS uses system trust. No production CA or private key is included.
- Server-decoded PCM16LE mono at 16/24 kHz is validated, converted to Float32 and scheduled via AVAudioEngine. Ordered events, cursor expiry, frame/queue bounds, aborted TTS, immediate abort/discard/interruption and recording-start queue clearing are implemented. Audio received while recording is discarded. No native Opus dependency or claim of audible device success.
- Explicit simulation mode uses the actual injected in-memory transport: 24 labelled task snapshots, synthetic diff/checks, settings, operation approval, versioned manual acceptance and mutation replay. A persistent simulation banner appears on every screen; no real provider/network execution occurs. Voice recording is disabled in simulation rather than substituting fake STT.

## Actual verification

Environment: local Apple Swift 6.3, arm64 macOS 26.3.2, Command Line Tools only. Commands below run from this worktree unless noted.

| Evidence | Actual command/result |
| --- | --- |
| local/core | Four separate `swiftc -module-cache-path /private/tmp/voxcode-swift apps/ios/Sources/VoxCodeCore/Core.swift apps/ios/Scripts/<runner>.swift -o /private/tmp/<binary>` invocations compiled CoreChecks, RecordingRaceChecks, V1Checks and AudioChecks, all exit 0; each binary exited 0/PASS. CoreChecks reports 34 assertions. The other runners cover newer-B recording isolation, criteria/version/settings/24-task/draft rules, PCM/sequence/playback epoch handling. |
| local/fixture | Compiled VoxCodeCore as `/private/tmp/libVoxCodeCore.dylib`, then compiled actual `VoxCode/SimulationBridge.swift` plus `Scripts/SimulationChecks.swift` with that module. Binary PASS: 24 distinct labelled tasks, slot counts/settings, manual acceptance/snapshot, immutable replay/conflict and new-version evidence isolation; live voice explicitly refused. |
| local/fixture | `swiftc ... VoxCode/AnchorMetadata.swift Scripts/AnchorChecks.swift -o /private/tmp/voxcode-anchor-checks`; ran against relay-generated public CA DER for a loopback-only fixture. PASS: CA validity, CA flag and malformed/truncated/indefinite DER rejection. No private key read or fixture bundled as production trust. This is metadata validation, not a fixed-IP TLS handshake. |
| local/typecheck | `swiftc -module-cache-path /private/tmp/voxcode-swift -I /private/tmp -typecheck apps/ios/VoxCode/BridgeTransport.swift apps/ios/VoxCode/AnchorMetadata.swift`: exit 0 against macOS Foundation/Security. This does not establish iOS ATS behavior. |
| local/syntax | `swiftc -frontend -parse apps/ios/VoxCode/*.swift apps/ios/NativeTests/*.swift apps/ios/Tests/VoxCodeCoreTests/*.swift`: exit 0. Syntax only, not SwiftUI/AVFoundation iOS type checking. |
| local/config | `plutil -lint apps/ios/VoxCode/Info.plist`: OK. Ruby YAML parse confirmed explicit VoxCode scheme test target `VoxCodeTests`. `git diff --check -- apps/ios`: exit 0. |
| local/unavailable | `env CLANG_MODULE_CACHE_PATH=/private/tmp/voxcode-clang SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/voxcode-swift swift test --disable-sandbox --cache-path /private/tmp/voxcode-spm-cache --config-path /private/tmp/voxcode-spm-config --security-path /private/tmp/voxcode-spm-security --scratch-path /private/tmp/voxcode-ios-spm-build` from `apps/ios`: core compiled, then exit 1 because the CLT SDK has no XCTest module. An earlier invocation without relocated module caches failed sandbox cache access; the documented cache environment resolved that part. |

Focused failing coverage was authored before its core/native APIs: missing v1/lifecycle/audio symbols failed compilation; production core additions then passed executable runners. The actual native Recorder race fixtures are authored but have not executed locally. Do not call that native red/green or native XCTest success until SDK CI runs them.

## Benchmark

`swiftc -O ... Core.swift Scripts/CoreBenchmarks.swift -o /private/tmp/voxcode-core-benchmarks`, then `/private/tmp/voxcode-core-benchmarks 1000 a352757+ios-working-tree apps/ios/Benchmarks/core-baseline.json`, exit 0. JSON labels synthetic local core CPU work and preserves environment/sample/revision metadata. No thresholds were invented.

| Synthetic operation | Samples | p50 ms | p95 ms | p99 ms | Errors |
| --- | --- | --- | --- | --- | --- |
| Decode/filter 24 tasks | 1000 | 0.081167 | 0.141083 | 0.164875 | 0 |
| Decode/filter 32 tasks | 1000 | 0.084125 | 0.092458 | 0.104458 | 0 |
| Recording epoch race | 1000 | 0.000708 | 0.000709 | 0.000750 | 0 |

These numbers do not measure SwiftUI rendering/navigation, network/API responsiveness, open connections, memory, microphone conversion or audible playback. Safe next measurement seams are URLSessionTaskMetrics for request/connection reuse and Instruments/signposts around native list/audio lifecycle. The coordinator owns broader API/scheduler benchmark tooling.

## Integration and pending gates

1. Coordinator publishes the independent iOS draft snapshot and runs exact-revision Swift core XCTest/coverage plus unsigned iOS simulator build. The VoxCode scheme explicitly includes `VoxCodeTests`; integration CI should run `xcodebuild test` on an available iPhone simulator and retain xcresult. Tests and scripts are different evidence sources; scripts do not satisfy the PR Swift coverage gate.
2. Two independent reviewers must inspect this source snapshot, including TLS identity, recording/playback lifecycle, persisted uncertain submissions and version acceptance. This handoff is not either review. Fix P0/P1 and rerun affected checks/CI.
3. Native fixture tests cover startup permission/HTTP failure ordering, missing/ordinary/fixed-IP trust handling, CA parser failure cases and simulation workflow. Actual private-CA TLS success/wrong-IP/unknown-CA/expiry matrix is still pending native fixture integration; relay local TLS tests cannot certify the iOS client. No production trust material exists yet.
4. Native PCM routing/queued completion/abort behavior, true audible speech, microphone interruption/conversion, signed device installation and 20-task native navigation remain unverified. `outputSupported` is server capability only. Live Linx/Codex, same-thread follow-up and outdoor cellular/company-Mac gates remain open; simulation never closes them.
5. Deployment remains deferred. Public trust asset review and later deployment authorization/occupied-port checks are separate work.

Suggested milestone subject: `feat(ios): add versioned phone task and voice controls`. A smaller initial race commit is possible only if the coordinator separates the shared core/UI patch coherently; do not commit a broken intermediate state.

## IOS-004 rejection recovery and response ordering

Date: 2026-10-24. Source base: `6745dc03d61d2034a5e58f7ec7dea4bf205b97e2`, branch `codex/ios-phone-demo`. This section describes the uncommitted IOS-004 snapshot handed to the coordinator for a scoped commit, independent targeted review and new SDK CI. The preceding cloud CI result for the base does not validate these additions.

### Changed paths and behavior

- `apps/ios/Sources/VoxCodeCore/Core.swift`: retain HTTP status in `APIError`; classify `MutationOutcome`; add recording-attempt identity, snapshot ownership/version-date preference and queued cleanup helpers.
- `apps/ios/VoxCode/Session.swift`: injected fixture transport/preferences retain production defaults. Success or a definitive rejection releases only the matching path/request-ID journal. Settings apply the same rejection policy. Refresh ownership and version/date checks prevent older refresh/replay data from replacing newer observed snapshots.
- `apps/ios/VoxCode/{ComposeView,TaskDetail}.swift`: definitive rejection releases local retry locks and preserves editable content; uncertain responses retain immutable retries. Stale composer versions still require explicit rereview. Detail/criterion errors remain visible.
- `apps/ios/VoxCode/Recorder.swift`: local state/audio clears immediately; the next create waits for the prior known-session DELETE attempt. A user-discarded recording gets a fresh request ID for the same task/version, including discard while create is pending. Internal cleanup after an unknown failed create preserves its original ID. A late successful stale create deletes only the returned stale session and cannot clear the newer recording.
- `apps/ios/VoxCode/SimulationBridge.swift`, `apps/ios/{Scripts/SimulationChecks,NativeTests/SimulationTests}.swift`: manual-acceptance precondition uses `409 blocked`; assertions use typed outcomes and preserve true replay `conflict` handling.
- New `apps/ios/{Scripts/SubmissionChecks,Scripts/OrderingChecks,Tests/VoxCodeCoreTests/MutationRecoveryTests,Tests/VoxCodeCoreTests/SnapshotOrderingTests,NativeTests/SubmissionTests,NativeTests/SessionOrderingTests}.swift`; expanded `NativeTests/RecorderTests.swift`; updated `apps/ios/README.md`.

The explicit no-side-effect whitelist is exactly `(400, invalid)`, `(409, stale)` and `(409, blocked)`, matching the coordinator's shared-contract change and Mac MAC-005. Auth/visibility errors, true identity `409 conflict`, throttling, server/malformed/network errors remain uncertain. In particular a lost response followed by a revoked `401` retry retains the original journal because revocation cannot establish whether the earlier request executed. Older servers returning `conflict` for business preconditions remain conservative.

### Fresh local evidence

Environment reconfirmed: Apple Swift 6.3, arm64 macOS, `xcode-select -p` is `/Library/Developer/CommandLineTools`; there is no local iOS SDK/XCTest execution. Commands below ran in `apps/ios` unless specified.

| Evidence | Command and actual result |
| --- | --- |
| local/core | For each of `CoreChecks`, `RecordingRaceChecks`, `V1Checks`, `AudioChecks`, `SubmissionChecks`, `OrderingChecks`: `swiftc -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/<Runner>.swift -o /private/tmp/voxcode-ios004-<Runner>`, then that binary. All six compiled exit 0 and executed exit 0/PASS. CoreChecks reports 34 assertions. SubmissionChecks covers HTTP-status classification, immutable persistence and fresh closed-recording identity. OrderingChecks covers ownership/version/date preference and DELETE-before-create gating. |
| local/fixture | `swiftc -module-cache-path /private/tmp/voxcode-swift -module-name VoxCodeCore -emit-module -emit-library -emit-module-path /private/tmp/VoxCodeCore.swiftmodule Sources/VoxCodeCore/Core.swift -o /private/tmp/libVoxCodeCore.dylib`; then `swiftc -module-cache-path /private/tmp/voxcode-swift -I /private/tmp -L /private/tmp -lVoxCodeCore -Xlinker -rpath -Xlinker /private/tmp VoxCode/SimulationBridge.swift Scripts/SimulationChecks.swift -o /private/tmp/voxcode-simulation-checks`; binary exit 0/PASS. First execution exposed the runner's obsolete `criteria` assertion (exit 133, line 18); updated it to `blocked` plus `.rejected`, recompiled and passed. |
| local/syntax | After the final Recorder startup-discard refinement and native fixtures: `swiftc -frontend -parse VoxCode/*.swift NativeTests/*.swift Tests/VoxCodeCoreTests/*.swift`, exit 0. This is syntax parsing, not native type checking or XCTest. |
| local/config | `plutil -lint VoxCode/Info.plist`: OK. `git diff --check -- apps/ios` from the iOS worktree root after the final source change: exit 0. |

Earlier targeted RED evidence remains specific: SubmissionChecks with the old HTTP-status-loss path compiled but failed with `HTTP 400 invalid must resolve as rejected`; passing final runners verify the core fix. The final native Recorder additions were authored before their respective source refinements but cannot establish native red/green without SDK execution.

Native XCTest cases are authored for persisted invalid/stale/blocked rejection, byte-equivalent uncertain relaunch, unrelated-operation journal isolation, lost-network-response then revoked retry, out-of-order refreshes, mutation versus refresh and older replay completion. Actual Recorder fixtures cover VoiceDraft.prompt population and manual-edit preservation, delayed DELETE versus the next create, closed recording identity, late successful discarded create deleting only its own session while the same-target new recording remains owned, and unknown create failure retaining its request ID. They have not executed locally.

### Final snapshot identifiers and limits

SHA-256 values recorded before coordinator commit:

| Path under `apps/ios` | SHA-256 |
| --- | --- |
| `Sources/VoxCodeCore/Core.swift` | `dc9fcd663b6f8739b533dcc566e490a3befaac01e26c684784b7755ec58dcfa4` |
| `VoxCode/Session.swift` | `b0fa193c590ce9b28f664d4f8cffbea957183df081ece4d24cd186b22bc895c6` |
| `VoxCode/ComposeView.swift` | `d0290ef011b9875c93882d24c7276b16a2a0b42c1c3c4c7ed1e216495eb2ebf1` |
| `VoxCode/Recorder.swift` | `4134bce384827ff105c115607d2b173077ba576fb4cce00ba16fb664bdf46c00` |
| `NativeTests/RecorderTests.swift` | `9eb4c4e353fbf53141b644c3e7b55bef54fffbfed942a09d16dc390c3a4ff750` |
| `NativeTests/SubmissionTests.swift` | `455cb3cf2a74a724124247ae94d04349b8c26525d239857a9e3836b006920821` |
| `NativeTests/SessionOrderingTests.swift` | `7010cc048ce9d9e036b4ed3a28a375d9548d10da76d89a3aa0954c53e22811fa` |

The cleanup barrier covers known-session re-record cleanup on the same Recorder. An old create still in flight can temporarily occupy a provider's single-active-session slot; the next create may receive a transient `429` until stale-session cleanup completes. User re-recording can recover using the fresh attempt ID. No startup serialization or general retry framework was added, and the native late-success fixture does not certify elimination of that remote window.

Coordinator next steps: commit these explicit iOS paths plus this handoff, rerun exact-revision core coverage and unsigned iOS build/native XCTest, and retain two independent targeted review resolutions. Signing, microphone/audible audio, actual private-CA URLSession matrix, real Linx/Codex, native navigation and outdoor cellular gates remain pending. No deployment or production trust material is part of IOS-004. iOS source edits are frozen at this handoff pending coordinator/CI feedback.
