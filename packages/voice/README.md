# Linx voice adapter

Node >=22, ESM. Run `npm ci --ignore-scripts` then `npm test` in this directory.
The production transport is exact-pinned `ws`: Node's built-in WebSocket does
not provide the custom handshake headers required by the documented device API.
Injected transports must implement the `ws` constructor and EventEmitter API.

```js
import { createLinxSession } from '@voxcode/voice';
const session = createLinxSession({
  config: {
    url: process.env.LINX_WS_URL,
    token: process.env.LINX_TOKEN,
    deviceId: process.env.LINX_DEVICE_ID,
    clientId: process.env.LINX_CLIENT_ID,
  },
  onEvent(event) { /* Forward through the authenticated bridge. */ },
});
await session.connect(); // Resolves only after validated server hello.
session.startListening();
session.sendAudio(pcmBytes); // signed int16 little-endian, mono, 16 kHz
session.stopListening();
session.close();
```

`connect()` is one-shot and shares its pending promise. Closed sessions require
a new object. A validated hello settles `connect()` before notifying the ready
callback; synchronously closing in that callback is safe, leaves connect resolved,
and causes later audio/listen methods to reject because the session is closed.
`abort()` sends the documented abort control and clears the local
listening state; it does not cancel a Mac coding task. `close()` rejects a pending
connect and closes transport. Handshake deadline defaults to 10 seconds and can
be configured with `config.handshakeTimeoutMs` (1-60000). Transport and provider
errors have generic messages; the module never logs. Callers must keep configuration,
STT text and raw MCP payload events out of logs that may contain sensitive content.

Send PCM only between start and stop. Each chunk must contain complete 16-bit
samples, 1-32000 bytes (at most one second); 640-byte/20 ms chunks are recommended.
The adapter cannot infer whether bytes actually represent the promised sample
rate or byte order. iOS must resample and convert microphone audio before upload.
Backpressure rejects audio when the socket queue exceeds 1 MiB; callers should
stop and surface an error rather than silently lose samples.

Events: `ready` (with additive `audioParams` from server hello), `stt` (`text`),
`tts` (`state`, optional `text`), `audio` (`data` Buffer), `mcp` (`payload`),
and `error` (`message`). The returned audio is the original encoded binary frame.
Upstream documentation explicitly describes server TTS as Opus, normally mono
16/24 kHz and 20/40/60 ms frames. A PCM input hello does **not** establish PCM
output. Native iOS raw Opus decoding/playback is unimplemented and unverified;
these packets must not be passed to a PCM player or treated as a WAV/Ogg file.
No undocumented output-format switch is used. The ready metadata is available
for a future tested decoder.

MCP initialize and tools/list are supported, with an empty tool list by default.
MCP is ignored until the server hello has validated readiness. Closing from an
MCP event callback also prevents subsequent dispatch of that message's tool.
The MVP bridge should register **no model-triggered mutations**: STT flows to an
editable iOS transcript and explicit task submission. Optional `tools` registrations
are `{name,description,inputSchema,invoke}`. The callback owns full schema validation,
authorization and idempotency; it must close over a frozen authorized task context
and must never accept a model-selected project/task target. Do not register shell,
filesystem or general executor tools. Tool request IDs are deduplicated for the
session (limit 256); this does not replace bridge requestId deduplication across
reconnects. Exceptions return generic RPC errors. Calls are not automatically
cancelled or rolled back when transport closes.

## Real integration gate

Register/bind a device to a Linx agent and obtain its real device token through
the platform's supported device onboarding flow. Use its registered MAC as
Device-Id and a persistent software UUID as Client-Id. An arbitrary API key,
made-up MAC or unbound device is not a verified credential. Keep tokens only on
the Mac, never in the phone bundle, repository, error output or HTTP responses.
The WSS endpoint can be obtained through the documented OTA onboarding; the
documented default is shown in `.env.example`. No registration/OTA API is invented
by this module. No real credentials were available for this implementation, so
live authentication, STT quality, MCP behavior and output playback remain pending.

Sources retrieved by curl from upstream main on 2026-10-23:

- https://github.com/qiniu/Xrobot-docs/blob/main/docs/xrobot/platform/websocket.md
- https://github.com/qiniu/Xrobot-docs/blob/main/docs/xrobot/mcp/hardware-mcp.md

Tests use an injected protocol transport, not the Linx cloud. They verify headers,
hello readiness, deadline/closure, manual PCM lifecycle, STT/TTS/audio forwarding,
generic error handling and explicitly registered MCP dispatch with duplicate IDs.
