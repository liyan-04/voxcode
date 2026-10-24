# VoxCode for iPhone

SwiftUI iOS 17+ phone controller. Current scope: `docs/phone-demo-scope.zh-CN.md`; contract v1. The phone shows task activity, versioned conditions, diff/check evidence and manual acceptance. WebView/site previews and the Mac workbench are deferred.

## Build

Requires full Xcode 16 or newer, iOS SDK, Apple signing account, and XcodeGen 2.44.1. No iOS build has been verified on the development machine (only Command Line Tools is installed).

1. Install Xcode and select it with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
2. Install pinned XcodeGen 2.44.1 from its upstream release. In this directory run `xcodegen generate --spec project.yml`.
3. Open `VoxCode.xcodeproj`. Select the VoxCode target, set a unique bundle identifier and your development team under Signing & Capabilities.
4. Attach an iPhone running iOS 17+, trust the Mac, enable Developer Mode, and Run. A paid account is needed for TestFlight distribution; free personal signing can install to your own device with its provisioning limits. Record the signed build identifier, Bundle ID, device model and iOS version.
5. Configure the bridge behind trusted HTTPS reachable from the phone. Enter its root URL and expiring pairing code in Settings. Tokens stay in device-only Keychain. Never enter Linx or Codex credentials on the phone.
6. Complete the remote delivery check with this same installed build: turn off Wi-Fi, use cellular data and the user VPN, pair through vm6 Relay `https://100.100.81.209:9899`, confirm the company Mac Connector is online, submit a real Codex task, and record the returned requestId/result. An installed app without this cellular+VPN Mac task is only a device milestone; a working relay without this signed install is only an infrastructure milestone.

This build requires HTTPS. Ordinary hosts use system certificate trust; the configured fixed IP uses the explicit reviewed CA trust path described below. Arbitrary self-signed certificates are rejected. Path-prefixed URLs, userinfo, query and fragments are explicitly rejected. Settings edits a separate draft address: only a successful unauthenticated pairing replaces the origin/token record together in Keychain. Polling always uses that paired origin; old unbound token-only records are ignored and require re-pairing. Local network and microphone permission descriptions are included. The app does not discover hosts with Bonjour.

## Behavior

Task snapshots and persisted activity poll every two seconds. Cancellation displays the actual server state (`stopping` until acknowledged), and never promises rollback. Operation approval and completed-result acceptance are separate actions. Results only show evidence matching the current task version; preview links require HTTPS.

Offline polling errors stay inline with the last successful connection time; only user operations raise alerts. Pairing returns the result of that specific attempt and retains the previous origin when it fails. Revoke Pairing calls authenticated `POST /api/unpair` before clearing Keychain. If offline, Forget Locally Only is explicitly available and warns that the server credential remains active.

Recording is foreground-only. App backgrounding, audio interruption, or an input-route change stops capture and best-effort sends stop-listening while retaining the editable draft. There is no automatic resume; a fresh recording builds a new converter. Discard invalidates the audio epoch and cancels every queued/in-flight upload immediately; session deletion runs as best-effort cleanup without blocking dismissal. Old tap callbacks and queued chunks cannot enter a subsequent recording. Stop normally drains pending PCM before sending stop-listening. Interrupted requests can already have reached the server, so session stop/delete is cleanup rather than rollback.

Recording freezes task ID, version and request ID before any permission or network await. The bridge retains this mapping. AVAudioEngine converts microphone audio to 16 kHz mono signed PCM16, uploads ordered chunks, and stops on upload overflow. Stop drains pending audio then ends listening; editable STT never automatically submits. Once a user edits text, later recognition cannot overwrite edits. First submission freezes the entire mutation and route; while awaiting confirmation, fields lock and Retry sends the identical payload and request ID, even if server polling already advanced its version. Errors also refresh server tasks for reconciliation. A changed task version blocks a first submission and requires reopening the composer. The bridge decodes negotiated provider Opus to bounded PCM and the native player handles ordered frames with abort/recording epochs. Live cloud output and audible iPhone playback remain unverified; no output is simulated.

## Verification

Core regression tests: `swift test` in this directory (requires a toolchain with XCTest; Command Line Tools alone may lack it). With full Xcode/iOS SDK, run:

```sh
xcodegen generate --spec project.yml
xcodebuild -project VoxCode.xcodeproj -scheme VoxCode -sdk iphonesimulator -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project VoxCode.xcodeproj -scheme VoxCode -destination 'platform=iOS Simulator,id=<available-iPhone-UDID>' CODE_SIGNING_ALLOWED=NO test
```

`VoxCodeTests` exercises actual Recorder startup callbacks using controlled permission/network/capture dependencies. These are native fixture tests, not microphone/device acceptance. A simulator `.app` is not a signed iPhone IPA. Device installation uses the chosen bundle ID, a development team and normal Apple provisioning; no signing has been verified locally. This Mac currently has Command Line Tools, not the iOS SDK.

## Demonstration

Settings has an explicit simulation toggle. It selects an in-memory 24-task transport with distinct IDs, synthetic diff/check evidence, default four occupied slots, settings 1–8 and manual version acceptance. A persistent yellow simulation banner appears on every native screen; fixture task titles, summaries and evidence are labelled. No network, Codex or Linx request occurs in this mode. Voice recording is disabled; it never pretends to provide live speech. Switching simulation off restores the paired live origin and its pending submission. Simulation is off at launch.

The real client polls tasks/settings while active and refreshes when returning to the foreground. Last successful synchronization and persistent connection errors remain inline. Offline snapshots remain inspectable; acceptance and mutations require a current connection. Counts distinguish occupied execution slots (`running`, `waiting_approval`, `stopping`), queue and attention. Task details show actual status, command, exit code and current-version evidence separately from old versions. No inferred progress percentages or model-driven criterion pass exists.

## Fixed-IP TLS

The approved deployment entry is now `https://100.100.81.209:9899` over the user VPN (Issue #48). `121.52.250.201` belongs to bili-xs8 and is not the deployed vm6. Read [the common delivery runbook](../../docs/architecture/vm6-vpn-delivery.md). **Implementation gap:** at this documentation revision, `BridgeTransport.fixedIP`, `Info.plist`, the pairing default and related tests still refer to the old IP; changing README or the editable URL alone does not adapt private-CA trust. The iOS owner must update/review those paths, verify wrong-IP/CA/expiry rejection and produce a signed build. A reviewed public DER CA named `VoxCodeCA.der` must be included in the application target's resources before the new address can pair. No production trust asset is committed, downloaded or generated by the phone. The relay helper emits public PEM/DER materials; private keys remain on the deployment side. The local loopback fixture CA is **not** a production trust asset and must not be bundled in the app.

The current source has an iOS 17 ATS exception for the old IP; the new endpoint must receive a reviewed, tested configuration rather than a broad insecure exception. Its insecure-load flag permits the explicit private trust evaluation; application URL validation still rejects all plaintext and URLSession requires TLS 1.2+. Fixed-IP challenges use an exact IP SSL policy, the bundled CA as the only anchor, disabled network trust fetching and `SecTrustEvaluateWithError`. The bundled anchor's DER basicConstraints and own validity period are also checked. Missing, malformed, non-CA or expired anchors fail clearly. Ordinary HTTPS uses system trust. Redirects are rejected; cookies and caching are disabled. WKWebView trust is outside current scope.

The editable pairing address is independent from the existing Keychain origin/token binding. Pairing sends no prior bearer and replaces both only after Keychain save. Root origins only: no path prefixes, credentials, query or fragment. Pairing failures retain the old binding. Revoke calls authenticated `/api/unpair`; offline local forgetting explicitly leaves the Mac credential active.

## Recording, drafts and playback

Before the first permission/network await, Recorder freezes task ID, version and request ID. Actual startup failure/final callbacks, tap uploads and poll results use the same generation owner. Discard immediately cancels uploads and clears state; deletion is best effort. Old permission/request/poll callbacks cannot discard a newer recording or overwrite its transcript/error. Stop drains ordered PCM uploads; interruption/background/input changes invalidate callbacks and stop capture/playback without automatically resuming.

Re-recording preserves the composer text, waits for the prior session's bounded DELETE attempt, and uses a new recording request ID for the same task/version. This avoids reusing a closed voice-session replay ID. Starting while cleanup is pending also waits at the Recorder boundary; local audio/state cleanup remains immediate. Snapshot refreshes use one current request owner, invalidated at mutation start and settlement. Old refreshes and late replay responses cannot replace newer observed task versions/timestamps.

VoiceDraft events must match the frozen task/version, have valid conditions and remain unexpired when consumed. They populate the same editable composer, retaining explicit user edits. Focus events only display a suggestion. No tool, STT or draft submits execution. New task/follow-up confirmation includes edited conditions; an active turn prevents follow-up execution. A version change preserves text and requires explicit rereview of the current version with a new request ID.

The first submission freezes its route, text, version, conditions and request ID. An uncertain response locks editing and Retry sends the identical payload. A small local submission journal survives closing/relaunch and is scoped by a hash of the paired origin plus credential; it does not duplicate the bearer outside Keychain. The journal contains the confirmed prompt/conditions in app-local preferences. Success or explicit pre-mutation rejection clears the matching journal. Structured `400 invalid`, `409 stale` and `409 blocked` responses restore editing while preserving the confirmed text/conditions; stale versions require explicit rereview and a new request ID. Auth/visibility failures, `409 conflict`, `429`, `5xx`, malformed responses and transport failures remain uncertain and retain the original request for reconciliation. A revoked retry cannot prove whether an earlier lost response already executed. Local forgetting also clears the journal. Pending settings follow the same rejection/uncertainty distinction within the session.

Mac-decoded signed int16 little-endian mono PCM at negotiated 16 or 24 kHz is converted to Float32 and scheduled through AVAudioEngine/AVAudioPlayerNode. No native Opus dependency exists. Sequence/cursor validation rejects gaps, regressions and oversized batches. Frame sizes and queued audio (four seconds) are bounded. Audio received while recording is discarded to prevent feedback. Recording start clears output; abort, aborted TTS, discard and interruption stop queued playback immediately. `outputSupported` means the server codec supports the stream, not that a speaker was heard. Native/device audible speech and actual input conversion remain separate acceptance gates.

## Local Checks

From this directory, the full Xcode toolchain can run `swift test --enable-code-coverage`. On this CLT-only machine, SwiftPM compiles core but cannot import XCTest. For sandbox-compatible caches:

```sh
env CLANG_MODULE_CACHE_PATH=/private/tmp/voxcode-clang SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/voxcode-swift swift test --disable-sandbox --cache-path /private/tmp/voxcode-spm-cache --config-path /private/tmp/voxcode-spm-config --security-path /private/tmp/voxcode-spm-security --scratch-path /private/tmp/voxcode-ios-spm-build
```

Executable core checks (compile/run each named runner):

```sh
swiftc -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/CoreChecks.swift -o /private/tmp/voxcode-core-checks
/private/tmp/voxcode-core-checks
swiftc -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/RecordingRaceChecks.swift -o /private/tmp/voxcode-recording-race
/private/tmp/voxcode-recording-race
swiftc -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/V1Checks.swift -o /private/tmp/voxcode-v1-checks
/private/tmp/voxcode-v1-checks
swiftc -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/AudioChecks.swift -o /private/tmp/voxcode-audio-checks
/private/tmp/voxcode-audio-checks
swiftc -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/SubmissionChecks.swift -o /private/tmp/voxcode-submission-checks
/private/tmp/voxcode-submission-checks
swiftc -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/OrderingChecks.swift -o /private/tmp/voxcode-ordering-checks
/private/tmp/voxcode-ordering-checks
```

Actual simulation transport without an iOS SDK:

```sh
swiftc -module-cache-path /private/tmp/voxcode-swift -module-name VoxCodeCore -emit-module -emit-library -emit-module-path /private/tmp/VoxCodeCore.swiftmodule Sources/VoxCodeCore/Core.swift -o /private/tmp/libVoxCodeCore.dylib
swiftc -module-cache-path /private/tmp/voxcode-swift -I /private/tmp -L /private/tmp -lVoxCodeCore -Xlinker -rpath -Xlinker /private/tmp VoxCode/SimulationBridge.swift Scripts/SimulationChecks.swift -o /private/tmp/voxcode-simulation-checks
/private/tmp/voxcode-simulation-checks
```

Public **fixture-only** CA metadata, syntax and plist checks:

```sh
swiftc -module-cache-path /private/tmp/voxcode-swift VoxCode/AnchorMetadata.swift Scripts/AnchorChecks.swift -o /private/tmp/voxcode-anchor-checks
/private/tmp/voxcode-anchor-checks <public-local-fixture-CA.der>
swiftc -frontend -parse VoxCode/*.swift NativeTests/*.swift Tests/VoxCodeCoreTests/*.swift
plutil -lint VoxCode/Info.plist
```

## Core Benchmark

```sh
swiftc -O -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/CoreBenchmarks.swift -o /private/tmp/voxcode-core-benchmarks
/private/tmp/voxcode-core-benchmarks 1000 <revision-and-dirty-label> /private/tmp/voxcode-core-benchmark.json
```

The machine-readable report records environment, samples, p50/p95/p99, errors and limitations for 24/32-task JSON decode/filter and the recording-generation race. This measures synthetic core CPU work, not SwiftUI navigation latency, microphone/playback, network, memory or signed-device performance. No performance threshold has been set. API/connection metrics can be measured with URLSessionTaskMetrics and native navigation/audio allocations with Instruments during later simulator/device acceptance; server benchmarks belong to the coordinator.

## Remaining Gates

Run core XCTest/coverage and native simulator XCTest on this exact source revision, then two independent component reviews. Real gates remain: signed iPhone installation; microphone permissions, interruption and 16 kHz conversion; audible 16/24 kHz speech and immediate abort; trusted fixed-IP URLSession with reviewed CA; real Linx STT/tools/drafts/queries; real Codex task and same-thread follow-up; 20-task native navigation, lost-response replay and stale acceptance; cellular/company-Mac connectivity. Relay deployment is authorized on the designated personal host; new-IP TLS, VPN-routed Connector, and same-build signed-device cellular+VPN verification remain incomplete. A browser certificate bypass cannot close any of these gates. No simulator/core pass closes live, device or outdoor gates.
