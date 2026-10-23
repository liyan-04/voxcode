# Voice platform and integration review

Reviewer: independent iOS/platform implementer, reviewing packages/voice (not own implementation). Date: 2026-10-23.

## Findings

1. **P2: A valid ready callback can cause an uncaught transport exception.** `packages/voice/src/index.js:76` emits `ready` before calling `resolveConnect()`. A consumer that closes the session from its ready callback runs `finish`, which clears `resolveConnect` at line 26; control then returns and calls undefined. Reproduced with an injected EventEmitter transport and `onEvent: e => { if (e.type === 'ready') session.close(); }`: `resolveConnect is not a function`. Because it originates in the message listener, it can escape into the bridge process. Capture/settle the pending resolver before invoking consumer code, and add a regression that synchronously closes in the ready callback. Review whether connect should resolve or reject in this case, and define that behavior explicitly.

2. **P2: MCP tool dispatch runs before the handshake is ready.** `packages/voice/src/index.js:77` passes MCP messages into `mcp` without checking state; line 45 invokes a registered tool while `connect()` is still pending. Reproduced by sending `tools/call` immediately after connect and before open/hello: invocation count was 1. This bypasses the validated hello gate for optional callbacks. Require ready state for tool dispatch (or explicitly queue capability negotiation while preventing tools/call until ready), and test that pre-hello calls cannot invoke a tool. The MVP bridge's required empty tool registry prevents task mutation through this path today, so this is not a current duplicate-submission finding.

No P0/P1 findings identified in the inspected package. Fix both lifecycle findings before treating the optional tool interface as ready for external registration.

## Compatibility and boundaries

- Current upstream WebSocket documentation was retrieved read-only from `https://raw.githubusercontent.com/qiniu/Xrobot-docs/main/docs/xrobot/platform/websocket.md` during review. Its PCM hello example matches the implementation: signed little-endian 16-bit, mono, 16 kHz. The iOS AVAudioConverter produces this format and sends normal buffers well below the adapter's 32000-byte cap. The documentation recommends 20 ms/640-byte frames; live verification of the larger native upload chunks remains required because this review did not reach Linx.
- Headers, manual listen/stop controls, optional session ID, handshake timeout, STT and TTS forwarding match the documented contract. Binary output remains encoded audio. The documentation explicitly identifies server TTS as Opus, and README correctly states there is no verified iOS raw Opus decoder. No PCM playback claim is made.
- Default tools registry is empty. README correctly requires no model-triggered mutations in the MVP: editable STT and explicit iOS submit remain the only task mutation path. Optional tool callbacks own full authorization/schema checks and can continue running after close; that limitation is documented.
- Credentials stay in request headers on WSS; URL userinfo/query and invalid credential characters are rejected; redirects are disabled. The implementation does not log raw tokens and emits generic provider errors. No live onboarding/registration or authentication evidence is available.
- Per-frame inbound 1 MiB and outbound queue 1 MiB limits, PCM chunk limit, handshake timeout and 256-entry MCP request cap are reasonable MVP bounds. The surrounding HTTP bridge must additionally bound session count/lifetime and retained event bytes; those are outside this package's scope. The output `audio` event must not be retained indefinitely in the bridge, especially while playback is unsupported.

## Verification

`npm test` in `packages/voice` passed all 6 tests (Node built-in runner, installed dependencies already present). Tests use an injected socket, not Linx cloud. Two additional read-only inline Node reproductions confirmed both findings above. No package code was edited. No credentials or audio were sent to a live provider.

Pending: real bound-device authentication, microphone-to-Linx STT, frame sizing acceptance, stopped-session final transcript delivery, provider disconnect behavior, and any future Opus playback.
