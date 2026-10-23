# Integration follow-up review

Reviewed 2026-10-23 by an independent reviewer who did not author the implementation. This review changes only this report. Scope: integrated voice retention/replay and authorization-change cleanup; native iOS HTTP, credential and audio fixes; Linx handshake/readiness fixes. Compared against `relay-security.md`, `ios-protocol.md`, `ios-platform.md`, `voice-platform.md` and `voice-security.md`.

## Findings and verdict

### P2: A stale recording-start failure discards the next recording

Location: `apps/ios/VoxCode/Recorder.swift:36-37`.

`start` captures `startingGeneration` and checks it after successful permission/session-create awaits (17,20), but its catch unconditionally changes the error and calls `discard()`. The UI permits Discard Recording while session creation is busy (`VoxCodeApp.swift:86`), then permits a fresh recording after discard clears `frozen`. If start A's HTTP request is still pending, the user discards A and starts B, and A subsequently fails, A's catch stops B's engine, invalidates B's epoch, cancels B's uploads and deletes B's session. A's completion can also change B's busy/error state. Guard the error/final-state path against `startingGeneration` before modifying the recorder or calling discard. Verify a delayed failing create response from A after discard/start B leaves B untouched. This is source-confirmed by the await/interleaving and unconditional catch; no native runtime reproduction was possible without the iOS SDK.

No P0/P1 was identified in this focused follow-up. The known P1 credential-origin leak and false recording state are addressed in source. The assigned replay, retention, retry, polling, re-pairing and voice-readiness findings are addressed, but the new P2 above prevents treating recording-generation isolation as complete.

Verdict: resolve the stale-start error-path finding before signing off the native recording lifecycle. Known prior P1 source blockers are resolved. End-to-end readiness also remains pending: the native app has not been built against the iOS SDK or run on a phone, and real Linx authentication/STT and cellular-to-company-Mac HTTPS operation have not been demonstrated. This review does not re-review the relay connector's separate liveness finding or certify broader Mac execution behavior.

## Integrated voice resolutions

| Prior finding / check | Current evidence | Result |
| --- | --- | --- |
| P2: expired recording request ID starts a second provider session | `apps/integration/voice.mjs:23-26` replaces a closed entry with a ten-minute request tombstone. Replay checks at lines 50-55 reject closed/conflicting identity with 409. The TTL callback closes/deletes the session without deleting the request record (76-80). The expired-recording regression at `apps/integration/test/voice.test.mjs:72` passes. | Resolved within the bounded retry window. A later recording requires a new request ID. |
| P2: closed sessions/events have unbounded retention | The default entry cap is 32 (19), and both maps are checked before allocation (61). Each entry retains at most 48 selected events, with text/state/message limited to 4096/64/200 characters (66-73). Audio and raw MCP events are excluded. Closing releases the provider session reference (25); the original TTL removes the session entry, while the request tombstone remains bounded. | Resolved by explicit count and per-field bounds. Capacity exhaustion intentionally returns 429. |
| Authorization revocation/expiry must stop retained voice sessions | `voice.mjs:29-34` subscribes once per service and reauthorizes retained owners; failed authorization closes the provider. `handler.close()` unsubscribes and clears timers/maps (122-126). Shared HTTP authorization runs before voice routing (`apps/mac/server.mjs:44-51`). | Source confirmed and exercised through the real local bridge/relay stack. Unpair closed the provider once; the revoked bearer received 401 and the other phone remained authorized. |
| Native voice route/body contract | `VoiceStart` explicitly encodes nullable task/version (`apps/ios/Sources/VoxCodeCore/Core.swift:23-32`). Create/audio/stop/events/delete calls in `Recorder.swift:19-70` match the handler and relay allowlist. `Core.swift:67` sends JSON Content-Type for a nil-body POST and preserves octet-stream for PCM. The relay requires those POST types (`apps/relay/protocol.mjs:39-42`); bridge stop/unpair do not parse a JSON body. | Empty-body stop and unpair each returned 200 through relay -> connector -> bridge; uploaded PCM bytes were unchanged. |

Owner matching still prevents another paired phone from accessing a known voice session (`voice.mjs:95-96`). The reviewed local round trip returned 404 for that attempt. Frozen task/version validation and the required empty tools registry remain present (`voice.mjs:57-60,83`); STT cannot directly submit a coding task.

## Native iOS resolutions

| Prior finding | Current evidence | Result |
| --- | --- | --- |
| P1: draft bridge address receives the old bridge bearer | `Session.swift:15-21` binds paired origin/token and uses a separate pairing client with no token. Settings owns `draftAddress` (`VoxCodeApp.swift:34-40`). `Core.swift:58-67` validates root HTTPS origins and omits Authorization for pair/health. Keychain replacement completes before changing the in-memory binding. | Resolved in source; standalone origin/header assertions pass. |
| P2: uncertain-response retry can change the payload | `VoxCodeApp.swift:75,80-90,98-103` stores the first route/mutation as `PendingSubmission`, locks the fields and retries that value even after version advancement. Failed submission refreshes server state. | Resolved in source; immutable-payload assertions pass. |
| P2: relay path prefix is silently discarded | `Core.swift:58-60` rejects non-root paths, credentials, queries and fragments. | Resolved by an explicit supported-origin restriction. |
| P1: interruption/background/input change leaves false recording state | `VoxCodeApp.swift:93-95` handles background, interruption-began and input route changes. `Recorder.swift:52,60-64` stops the engine, clears `recording`, invalidates the audio epoch, cancels uploads and best-effort stops listening while retaining the draft. Each fresh recording creates a converter (23-24). | Addressed in source. Phone lock/call/headset behavior remains a device acceptance gate. |
| P2: Cancel waits through the upload backlog | `Recorder.swift:60,66-70` invalidates the generation, cancels all tracked upload tasks, clears the queue and launches deletion separately. Successful permission/create continuations and queued tap/upload callbacks check the epoch (17,20,32,40,46,48). | Backlog draining is addressed and epoch assertions pass. The start failure continuation still has the P2 race above. Prompt dismissal and URLSession cancellation under a blackholed relay still need device testing. |
| P2: offline polling repeatedly opens modal alerts | `Session.swift:23` records connection health rather than the modal error. `VoxCodeApp.swift:16-17,29` displays that health inline and reserves the alert for `session.error`. | Resolved in source; health persistence/recovery assertions pass. |
| P2: failed re-pairing dismisses settings using stale connected state | `Session.pair` returns that attempt's Bool (`Session.swift:20-22`); the Pair action dismisses only on this result (`VoxCodeApp.swift:37`). Failure preserves the previous binding, which is displayed in Settings. | Resolved in source. |

The final nil-body POST fix is specifically covered by `CoreChecks.swift:49-58` and XCTest cases at `CoreTests.swift:45-59`: stop/unpair retain nil bodies with JSON Content-Type; PCM retains its binary header and bytes; GET does not acquire a body header. The standalone checks ran; XCTest was not claimed as executed.

## Voice package resolutions

- Both voice reports' P2 ready-callback exception is resolved at `packages/voice/src/index.js:73-77`: validated hello sets ready state, settles and clears the connect resolver, then emits ready. Synchronously closing from the ready callback leaves connect resolved and later listen/audio calls rejected. The matching regression at `packages/voice/test/session.test.js:23` passes.
- Both reports' P2 pre-hello MCP dispatch is resolved at `index.js:78`: MCP dispatch requires ready state. The additional state check after the consumer MCP callback (30-32) prevents that callback's synchronous close from invoking a tool. Regressions at `session.test.js:22,24` pass.
- Existing boundaries remain explicit: empty model tools in the bridge; optional callback authorization/schema/idempotency belongs to the registrant; already-running callbacks are not cancelled by transport close; output remains encoded audio with no claimed native Opus playback. These are documented limitations, not new findings in this follow-up.

## Fresh verification

All commands below were run during this review and exited 0:

```sh
node --test apps/integration/test/*.test.mjs
# 4 passed, 0 failed

# From packages/voice:
npm test
# 9 passed, 0 failed

# From apps/ios, using the README standalone workflow:
env CLANG_MODULE_CACHE_PATH=/private/tmp/voxcode-clang swiftc -module-cache-path /private/tmp/voxcode-swift Sources/VoxCodeCore/Core.swift Scripts/CoreChecks.swift -o /private/tmp/voxcode-core-integration-followup
/private/tmp/voxcode-core-integration-followup
# PASS: 34 assertions
swiftc -frontend -parse VoxCode/VoxCodeApp.swift VoxCode/Recorder.swift VoxCode/Session.swift
# Syntax parse only
```

An additional read-only inline Node fixture used actual local HTTP/WebSocket relay and connector, the production authenticated Mac HTTP server/service and voice handler, and a fake provider session. It verified: null-bound voice create 200; other owner events 404; exact PCM upload; nil-body JSON stop 200; nil-body JSON unpair 200; provider closed once; revoked owner events 401; second phone tasks 200. No cloud credentials/audio were used and no source/test files were edited.

`xcode-select -p` returned `/Library/Developer/CommandLineTools`. No SwiftUI/AVFoundation type-check, simulator build, signing, XcodeGen output or device execution is certified. Do not treat syntax parsing or the Foundation-only runner as an iOS build.

## Remaining acceptance gates

- Build/sign/install with full Xcode 16+ and test actual microphone permission/resampling, lock/unlock, call interruption, headset removal, slow-network discard and no old audio in the next recording.
- Exercise failed re-pairing, remote revoke, minute-long offline navigation/recovery and immutable retry after a lost response on the native client.
- Demonstrate trusted public HTTPS relay access from cellular to the company Mac, registered Linx device authentication, real STT/final transcript after stop, and ten frozen-target instructions. Output playback remains unavailable.
- Verify selected task/version evidence, approval/acceptance separation and actual authorized preview independently; this follow-up does not establish those live delivery results.
