# Independent native iOS platform review

Reviewed 2026-10-23. Scope: actual native client, audio lifecycle, retry UX, Keychain binding, polling and delivery feasibility. No implementation files changed. No P0 found. This is a source review, not an iOS build certification.

## Findings

### P1: Audio interruption/background transitions leave a false recording state

Locations: `apps/ios/VoxCode/Recorder.swift:22-35,45-47`; `apps/ios/VoxCode/VoxCodeApp.swift:80-89`; `apps/ios/VoxCode/Info.plist:1-16`.

The recorder does not observe AVAudioSession interruption/route-change notifications or scene transitions. There is no background audio entitlement/mode. Locking the phone, answering a call, or changing the input route during recording can interrupt the audio engine while `recording` stays true. Returning to the app can therefore show an active recording without incoming audio, and the Linx listening session remains open until the user explicitly stops/discards. Define foreground-only recording, observe interruption and scene lifecycle, stop/close listening deterministically, and show an interrupted editable draft. Rebuild the converter after input-format changes. Verify lock/unlock, incoming call and headset removal on device; do not promise background recording.

### P2: Cancel waits for the complete upload backlog before dismissing

Locations: `apps/ios/VoxCode/Recorder.swift:41-47`; `apps/ios/Sources/VoxCodeCore/Core.swift:52`; `apps/ios/VoxCode/VoxCodeApp.swift:86-89`.

Up to 20 queued audio POSTs form a serial task chain. `discard()` waits for the chain without cancelling requests; each request has a 20-second timeout. With a stalled network, Cancel can leave the composer open for many sequential request deadlines before deleting the session. Draining is correct for Stop, but Discard should invalidate the generation, cancel pending/in-flight upload work and dismiss promptly, with best-effort session deletion separately. Regression test cancellation under a blackholed network and ensure old chunks cannot enter the next recording.

### P2: Every offline poll reopens a global error alert

Locations: `apps/ios/VoxCode/Session.swift:23`; `apps/ios/VoxCode/VoxCodeApp.swift:26-27`.

In the core outdoor scenario, Mac or relay disconnection causes every refresh to set the same global error. After dismissing the alert it reappears at the next polling failure, obstructing inspection of cached tasks and pairing settings. Keep persistent connection failures inline with a last-success timestamp; reserve modal errors for user-initiated operations and deduplicate repeated errors. Verify the app remains navigable during a minute-long outage and recovers after reconnect.

### P2: Failed re-pairing can dismiss settings as if successful

Locations: `apps/ios/VoxCode/Session.swift:20-23`; `apps/ios/VoxCode/VoxCodeApp.swift:35`.

When already paired and connected, trying a different origin or invalid code leaves the old `connected == true`. The Pair button dismisses based on that old state even though the attempted pairing failed. Return an explicit success result from `pair` and dismiss only on success of that attempt. Preserve the old binding on failure, but explain which Mac is still paired. Test invalid re-pairing while the old bridge is healthy.

## Previous review fixes verified

- `Session.swift:15-21` stores and uses the paired origin/token together, while Settings has an independent draft address. Pairing replaces the binding only after Keychain save succeeds.
- `Core.swift:45-54` rejects path-prefixed and credential-bearing relay origins and omits authorization for pairing/health.
- `VoxCodeApp.swift:72,77-78,93-97` freezes the complete first-submission payload/path, locks editing and retries that identical mutation even after version advancement.
- Frozen recording identity is established before permission/network awaits. Evidence filters by task version; operation approval and completed-result acceptance remain distinct.

## Verification and remaining delivery gates

- Compiled `Sources/VoxCodeCore/Core.swift` plus `Scripts/CoreChecks.swift` with the README standalone command: exit 0.
- Ran standalone binary: all 19 assertions passed (routing, stale versions, paired origin isolation, unauthenticated pairing, relay validation and immutable retry).
- Ran `swiftc -frontend -parse` on the three app Swift files: exit 0. This is syntax parsing only, not SwiftUI/AVFoundation type-checking.
- `xcode-select -p` is `/Library/Developer/CommandLineTools`; full Xcode/iOS SDK is absent. No simulator build, XcodeGen generation, signing, actual PCM resampling, microphone permissions or device install was verified.
- `project.yml` selects iOS 17 and Swift 5 language mode; the Swift package needs Swift 6 tools, so the documented Xcode 16+ requirement is material. A personal team can provision a developer-mode iPhone with its normal limits; TestFlight requires the appropriate paid account. Current source must not be presented as an already installable IPA.
- Core outdoor delivery still requires deployed trusted HTTPS relay and cellular-to-company-Mac validation. A preview URL being HTTPS does not establish task ownership or remote reachability; real task preview routing is an integration gate.
- No playback or APNs implementation exists; these are explicitly deferred, and system AirPlay remains external to the app. Live Linx registration/STT and phone audio conversion must be demonstrated before claiming end-to-end voice success.
