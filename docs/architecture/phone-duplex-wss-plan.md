# Phone duplex WSS implementation plan

> Workers execute bounded tasks in independent worktrees; coordinator alone owns shared contracts, commits, milestone PRs and merges. Read phone-duplex-wss.md and repository AGENTS first. Existing user authorization covers continuing this implementation; no repeated design permission checkpoint.

Goal: authenticated simultaneous phone audio/events over WSS, with existing HTTPS durable mutation semantics and server-only Linx/Codex credentials.
Architecture: fixed Relay loopback WebSocket proxy → Bridge stream service → shared voice engine and task subscriptions. Do not add a public port, remote stream tunnel, provider callback or database.
Spec: [phone-duplex-wss.md](phone-duplex-wss.md). Runtime Node>=22, ws8.22.0; iOS17+/SwiftUI/URLSessionWebSocketTask. Exact header, ordering, credit and lifecycle limits come from spec, not duplicated alternatives.

## Relay task

Exclusive: apps/relay/** and scripts/build-relay-package.mjs. Coordinator subsequently updates scripts/build-server-package.mjs closure if a new Relay import is introduced.

- [ ] Add failing loopback tests for unconfigured/invalid proxy target, exact route/query, missing/bad/machine bearer, backend denial/timeout, client disconnect during authorization, upstream close, binary/text preservation and buffer ceilings. Use temporary local listeners and owned cleanup only.
- [ ] Extend createRelay(options) with optional phoneStreamURL; CLI reads VOXCODE_PHONE_STREAM_URL. Validate exact literal ws://127.0.0.1:<port>/api/stream and reject all client-selected upstream/URLs. Backend Bridge authorizes the forwarded phone bearer before its upgrade; Relay completes frontend upgrade only after backend open.
- [ ] Keep /connector machine handling and HTTP routing unchanged. Add bounded pending and active stream budgets, per-IP attempts, deadline and hard message/send-buffer limits; upstream emits no business frames until phone hello. Close both directions on failure, shutdown and heartbeat timeout.
- [ ] Include every new module in Relay package allowlist, configuration example and module README; verify extracted package imports and strict local TLS WSS proxy cases. No live provider/native claim.
- [ ] Run component/full/coverage with real commands, freeze exact paths/hashes; coordinator publishes Draft PR, two independent reviews and fixes before integration.

## Bridge/runtime task

Exclusive: apps/integration/**, apps/mac/service.mjs, apps/mac/server.mjs, new apps/mac/test/stream-subscription.test.mjs and apps/mac/README.md. Do not alter existing Codex executor, Relay, iOS, shared contracts/package policies or source-package builder.

- [ ] First add failing authorization/lifecycle/ordering/credit/replay/reset/gap/backpressure regressions against controlled WS/provider/service dependencies. Existing HTTP voice/tests are compatibility requirements.
- [ ] Extract a shared voice-session engine from the HTTP handler. It owns current authorization, immutable task/version/requestId, single provider, decoder/drafts, TTL/retention, close/revoke and explicit input operations. HTTP adapter delegates to it; WSS code must not fabricate IncomingMessage/ServerResponse or poll HTTP to obtain events. Keep optional input-only hello compatible.
- [ ] Add actual synchronous service subscription with initial lightweight snapshot/cursors and post-commit task/event notifications. No service polling. Replay valid event cursors in bounded batches; detect gaps/future/unknown. Reset establishes a new baseline. Notifications must cover status, evidence/criteria/approval/settings effects on tasks, not only log events.
- [ ] Bridge installs exact /api/stream upgrade only on existing loopback server, authorizes pre-upgrade, preserves limits/TTL/revoke, hello deadline and current connection ownership. Implement spec JSON commands,24-byte PCM frames, independent JSON/audio sequences, cumulative input ACK/credit, ACK-before-startup-events and close cleanup. Durable task mutations remain HTTPS only.
- [ ] Expose attachment through runtime/createServer options without circular imports or unauthenticated standalone listener. Reuse pinned ws via established module resolution; add any dependency requirement explicitly for coordinator review rather than silently altering locks.
- [ ] Add reusable real loopback WS integration composition tests for input still sending while text/audio output arrives, no automatic task mutation, frozen target, two task updates, revoked/expired socket, old recording rejected, slow-peer queues bounded and no leaked sessions/listeners. Avoid production network/accounts.
- [ ] Update integration/Mac module docs, run relevant full regression and coverage, freeze paths/hashes for two independent reviews and coordinator Draft PR.

## iPhone task

Exclusive apps/ios/**. Base on reviewed current server endpoint source PR60 (6890f04) plus current master, preserving its still-open native gates. Coordinator establishes branch and carries the endpoint change explicitly; worker never switches/cherry-picks.

- [ ] Add pure Swift protocol/frame/cursor/credit/epoch regressions before implementation; compile available macOS runners, run real native tests only when SDK exists. No XCTest shim.
- [ ] Add strict WSS request derivation from paired HTTPS root; Authorization header only, same host/port, exact /api/stream, reviewed fixed-IP CA/delegate, no redirects/URL bearer. Use URLSessionWebSocketTask with injectable seam for fixture tests.
- [ ] Implement one owned duplex connection lifecycle for task pushes plus voice commands/binary frames. Cap message/queued bytes/credit, ACK sequencing, stale subscription/recording/epoch rejection, reset and actual task-notification-driven HTTPS refresh. Remove fixed2s task/event and500ms voice polling in real mode; simulation remains visibly simulation.
- [ ] Refactor Recorder and PCMPlayer to share compatible playAndRecord/voice processing behavior for simultaneous capture/playback; do not retain guard !recording or switch category back to playback while microphone active. Preserve4second playback cap, audio generation, permission/interruption/background cleanup, frozen recording target and explicit draft confirmation.
- [ ] Stop ends input at final acknowledged seq; abort promptly clears local output and ends current voice per spec, never task.cancel. Disconnect stops current microphone/playback, clears unacknowledged frames and asks user to record again; reconnect restores tasks only. HTTP uncertain mutations retain original requestId/body.
- [ ] Update module/build docs. Keep Draft until actual iOS SDK build, XCTest/core coverage, two independent source reviews and applicable native gates; signed same-build cellular/Linx/Codex remains separate acceptance.

## Coordinator integration and verification

- [ ] Publish this design/plan and review evidence via PR first; create three child Issues with paths and observable criteria, then let existing agents implement in distinct clean worktrees. Throttle429 and resume workers.
- [ ] Review changed imports and update exact runtime/Relay source-package closure. Add task-appropriate source/tests to discovery/coverage without lowering thresholds. Root README/progress accurately distinguish merged/fixture/live/device/outdoor state.
- [ ] Independently run real composed WSS across TLS Relay/Bridge with controlled Linx/Codex, HTTP compatibility, exact-base coverage and bounded proxy/stream shutdown; two independent reviewers per component. Publish each milestone promptly, ready/merge only after source gates pass.
- [ ] On authorized vm6 ordinary user, check ownership of9899 and strict CA/IP SAN, realNode22/Codex/Linx; unavailable SSH/account resources remain explicit. Actual signed iPhone installation, microphone/audible duplex, background/route change/revoke/reconnect and cellular+VPN finish product acceptance.
