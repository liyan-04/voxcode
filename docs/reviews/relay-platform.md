# Independent relay protocol and platform review

Reviewer: independent protocol/platform reviewer 2. Date: 2026-10-23.
Scope: `apps/relay`, its HTTP/WebSocket tests, and actual iOS request construction for mobile compatibility. The reviewer did not author or modify relay source. iOS remediation below is an implementation follow-up, not an independent review of that remediation.

## Findings

1. **P1 — iOS empty-body POST requests fail the relay content-type contract.** At review time, `apps/ios/Sources/VoxCodeCore/Core.swift:67` set Content-Type only when body was non-nil. `Recorder.stop()` and interruption cleanup call `POST /api/voice/sessions/:id/stop` without a body, and `Session.unpair()` likewise calls `POST /api/unpair` without a body. `apps/relay/protocol.mjs:39-42` requires JSON Content-Type for every non-audio POST, so these operations receive 415 before reaching the Mac. Stopping cannot end provider listening promptly, and revocation cannot complete through the public relay. Fix the common iOS request builder to label empty JSON POSTs and add a regression covering stop and unpair. A valid JSON header with an empty body is sufficient for both current bridge handlers. No relay source change is necessary.

No new P0/P1 relay implementation finding was identified. The iOS issue is a component-boundary finding; its repair needs separate independent review.

## Protocol and liveness evidence

- Both relay and connector repeat exact method/path/query/content-type checks. Event cursors accept only a bounded nonnegative decimal integer; IDs cannot encode traversal or alternate origins. Forwarding uses one fixed loopback HTTP origin, and remote connector URLs require WSS. Phone tokens remain distinct from the machine connection credential.
- Only allowed Authorization and Content-Type headers cross the relay. Responses carry bounded bytes and allowed content types, with cache prevention; redirect destinations, cookies and arbitrary forwarding headers are absent. PCM is preserved as bytes through canonical base64; task evidence remains JSON. No preview/file/port tunnel exists.
- Request IDs are random and bound to their connector. Unknown response IDs terminate that connector; retired IDs are ignored within a bounded set. Connector loss fails pending HTTP requests. Neither reconnect nor request cancellation automatically replays mutations or promises rollback, so clients must reconcile uncertain task results using their retained request IDs.
- The connector now sends a nonce-bearing ping every 15 seconds and requires the matching pong within 10 seconds (`connector.mjs:54-66`). Its own watchdog detects a silent connection independently of the relay heartbeat. Close clears watchdog timers and aborts local in-flight requests before reconnect; shutdown also cancels reconnect. The test disables automatic pong, confirms recovery on a new connection, and confirms no further reconnect/ping after close.
- Relay request timeout is 15 seconds and connector local HTTP timeout is 14 seconds by default, including response-body reads; iOS uses 20 seconds. Slow/stopped bridge requests produce bounded 504 responses. The 32-request, body/response/frame, socket queue and TCP limits bound transport work. Global pairing throttling is intentionally conservative for the single-Mac MVP.
- iOS uses JSON for mutation/session creation and octet-stream for audio. Empty GET/DELETE and JSON-default headers are accepted, event polling is supported, and no persistent phone WebSocket or background iOS connection is required. Trusted public HTTPS and foreground audio lifecycle still require actual device validation.

## Verification and limits

- `npm test` in `apps/relay`: **13 passed, 0 failed**, including real local HTTP/WebSocket pairing, auth, binary round trips, route/type/body rejection, offline/deadline/disconnect, duplicate connector, unsolicited response, unpair, silent-loss reconnect and watchdog shutdown.
- Reviewed CLI configuration and cleanup, fixed-destination validation, route whitelist, framing limits and current iOS callers. No relay source files were changed.
- Tests use local fixtures. No deployed TLS reverse proxy, cellular iPhone round trip, company outbound policy, Mac sleep/wake, live Linx recognition, or authorized remotely reachable preview was verified. Full Xcode/iOS SDK is unavailable; native delivery remains pending.

Verdict: current relay source has no newly identified blocker in this scope, and the previously reported connector liveness issue is resolved in source and local tests. Resolve the phone POST mismatch before claiming the outdoor phone workflow ready.

## Implementation follow-up

The same reviewer subsequently repaired the assigned iOS mismatch in the shared request builder: POST requests now set their Content-Type even when the body is nil. No relay source changed. Standalone assertions and XCTest regression cases cover both empty POST routes, unchanged empty bodies, binary PCM bytes/type, and header-free GET behavior. The standalone regression first failed at the missing JSON header before the fix. This follow-up is not independent approval of the iOS change; a different reviewer must assess the repair.

- README standalone `swiftc` compile and runner: exit 0, **34 assertions passed** after the fix (expected pre-fix failure: `Empty POST must satisfy relay JSON content-type contract`).
- `swiftc -frontend -parse VoxCode/VoxCodeApp.swift VoxCode/Recorder.swift VoxCode/Session.swift`: exit 0. Existing interruption observers, upload cancellation epochs and paired origin/token binding were retained.
- README sandbox-safe `swift test`: core compiled; XCTest suite could not run because this Command Line Tools SDK reports `no such module 'XCTest'`. `xcode-select -p` remains `/Library/Developer/CommandLineTools`. No native build, signing or device run is claimed.
- `git diff --check`: exit 0. No new P1 iOS blocker was identified in this limited transport follow-up; that is not a full native type-check or device review.
