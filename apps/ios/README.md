# VoxCode for iPhone

Native SwiftUI iOS 17+ client. The local Swift package contains transport and frozen recording models; the app uses AVAudioEngine and Keychain.

## Build and install

Requires full Xcode 16 or newer, iOS SDK, Apple signing account, and XcodeGen 2.44.1. No iOS build has been verified on the development machine (only Command Line Tools is installed).

1. Install Xcode and select it with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
2. Install pinned XcodeGen 2.44.1 from its upstream release. In this directory run `xcodegen generate --spec project.yml`.
3. Open `VoxCode.xcodeproj`. Select the VoxCode target, set a unique bundle identifier and your development team under Signing & Capabilities.
4. Attach an iPhone running iOS 17+, trust the Mac, enable Developer Mode, and Run. A paid account is needed for TestFlight distribution; free personal signing can install to your own device with its provisioning limits. Record the signed build identifier, Bundle ID, device model and iOS version.
5. Configure the bridge behind trusted HTTPS reachable from the phone. Enter its root URL and expiring pairing code in Settings. Tokens stay in device-only Keychain. Never enter Linx or Codex credentials on the phone.
6. Complete the remote delivery check with this same installed build: turn off Wi-Fi, use cellular data, pair through the public Relay, confirm the company Mac Connector is online, submit a real Codex task, and record the returned requestId/result. An installed app without this public Mac task is only a device milestone; a working relay without this signed install is only an infrastructure milestone.

This build requires HTTPS and does not disable App Transport Security or accept self-signed certificates. Use a device-trusted certificate or authenticated HTTPS tunnel with a dedicated root origin. Path-prefixed URLs, userinfo, query and fragments are explicitly rejected. Settings edits a separate draft address: only a successful unauthenticated pairing replaces the origin/token record together in Keychain. Polling always uses that paired origin; old unbound token-only records are ignored and require re-pairing. Local network and microphone permission descriptions are included. The app does not discover hosts with Bonjour.

## Behavior

Task snapshots and persisted activity poll every two seconds. Cancellation displays the actual server state (`stopping` until acknowledged), and never promises rollback. Operation approval and completed-result acceptance are separate actions. Results only show evidence matching the current task version; preview links require HTTPS.

Offline polling errors stay inline with the last successful connection time; only user operations raise alerts. Pairing returns the result of that specific attempt and retains the previous origin when it fails. Revoke Pairing calls authenticated `POST /api/unpair` before clearing Keychain. If offline, Forget Locally Only is explicitly available and warns that the server credential remains active.

Recording is foreground-only. App backgrounding, audio interruption, or an input-route change stops capture and best-effort sends stop-listening while retaining the editable draft. There is no automatic resume; a fresh recording builds a new converter. Discard invalidates the audio epoch and cancels every queued/in-flight upload immediately; session deletion runs as best-effort cleanup without blocking dismissal. Old tap callbacks and queued chunks cannot enter a subsequent recording. Stop normally drains pending PCM before sending stop-listening. Interrupted requests can already have reached the server, so session stop/delete is cleanup rather than rollback.

Recording freezes task ID, version and request ID before any permission or network await. The bridge retains this mapping. AVAudioEngine converts microphone audio to 16 kHz mono signed PCM16, uploads ordered chunks, and stops on upload overflow. Stop drains pending audio then ends listening; editable STT never automatically submits. Once a user edits text, later recognition cannot overwrite edits. First submission freezes the entire mutation and route; while awaiting confirmation, fields lock and Retry sends the identical payload and request ID, even if server polling already advanced its version. Errors also refresh server tasks for reconciliation. A changed task version blocks a first submission and requires reopening the composer. TTS playback is explicitly unavailable; no output is simulated.

## Verification

Core regression tests: `swift test`. In a restrictive sandbox, use:

```sh
env CLANG_MODULE_CACHE_PATH=/private/tmp/voxcode-clang SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/voxcode-swift swift test --disable-sandbox --cache-path /private/tmp/voxcode-spm-cache --config-path /private/tmp/voxcode-spm-config --security-path /private/tmp/voxcode-spm-security
```

On this machine, SwiftPM compiled the core but could not run XCTest because the Command Line Tools SDK has no XCTest module. The standalone runner additionally covers paired origin isolation, unauthenticated pair, rejected relay paths, immutable retry payload, relay-compatible empty JSON POSTs for stop/unpair, and preserved binary PCM uploads:

```sh
env CLANG_MODULE_CACHE_PATH=/private/tmp/voxcode-clang swiftc -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/CoreChecks.swift -o /private/tmp/voxcode-core-checks
/private/tmp/voxcode-core-checks
swiftc -frontend -parse VoxCode/VoxCodeApp.swift VoxCode/Recorder.swift VoxCode/Session.swift
```

Syntax parsing succeeded; this does not type-check SwiftUI/AVFoundation against the iOS SDK or validate XcodeGen output.

Device acceptance still required: install/sign; pair and reject invalid re-pairing while already connected; revoke and verify bearer rejection; verify offline local forgetting; deny/re-enable microphone; lock/unlock, receive a call and remove a headset during recording; cancel under a blackholed relay and ensure prompt dismissal/no audio leakage to the next recording; remain offline a minute without repeating modal alerts then reconnect; dictate ten alternating-task instructions and verify fixed routing; stop and edit STT; retry after lost response without duplicate execution; change task version during recording and verify refusal; approve/decline pending operation; cancel and observe stopping; inspect real diff/tests then explicitly accept results; verify HTTPS preview belongs to selected task. Verify Linx provisioning and actual transcript with the live bridge. AirPlay is a system-level Mac feature and has no custom implementation here.
