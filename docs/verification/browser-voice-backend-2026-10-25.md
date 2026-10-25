# Browser Voice Backend Verification

Refs #108. Base: `1728a4ee9872719b551f4de1667cdd6e115fa840`.
Environment: macOS arm64, Node 26. This is fixture/local backend evidence.
No Git mutation, deployment, phone microphone or cloud tool-isolation acceptance
was performed by this source implementation.

## Behavior and dependencies

`control-runtime.mjs` composes a single exact-path HTTPS upgrade router. `/agent`
retains its existing registration, authentication and capacity logic.
`/ws/voice` requires the real HTTP session cookie and exact configured Origin.
Authentication preserves the actual session expiry but maps admission identity
to the fixed configured user, so distinct login cookies cannot contend for one
software-device session. The formal runtime has one total voice connection slot.
Unknown paths and query variants are rejected once.

Private config adds optional `voiceFile`, read with the existing canonical,
nofollow, owner/mode checked descriptor reader. JSON has exactly four keys:
`{url,token,deviceId,clientId}`; only the fixed official voice WSS URL is allowed.
Provider errors are redacted. Health voice capability is distinct from provider
connection state and MCP status; it does not claim correct ASR or active capture.

Repository `packages/voice` is reused with pinned `ws@8.22.0` and
`opusscript@0.1.1`. The provider registers no device tools and the existing formal
MCP mutation gate remains disabled. This does not establish cloud assistant
tool isolation: deployment must use a dedicated formal assistant with no cloud
MCP tools and independently confirm that coding speech cannot reach the old
proxy/bridge. Preserve old assistants, devices, points and credentials.

The server archive must include voice source/manifests/lock and install both
`apps/server` and `packages/voice` pinned dependencies. Source-bundle/deployment
script integration belongs to the coordinator; this work did not edit those
paths or deploy anything. Optional unconfigured startup does not import the
voice decoder dependencies. Browser public asset bytes are owned by Issue112.

## Phone wire contract

Use same-origin `wss://HOST/ws/voice` with automatic session cookie. Request IDs
and capture IDs are 1-128 ASCII letters, digits, `_` or `-`; UUIDs are accepted.
Every control reply/event has monotonically increasing `seq`. Retry the exact
same control/requestId to receive its cached acknowledgment; a conflicting body
using the same ID closes the connection. Audio is never replayed.

1. Send `{type:"session.start",requestId,context:{projectId,contextVersion}}`.
   `contextVersion` is a positive safe integer. Optional `taskId` or
   `parentTaskId` are mutually exclusive and absent rather than null. No owner,
   device, path or other context keys are accepted. The configured Mac adapter
   validates an enabled project and live nonarchived task membership. Reply is
   `session.ready` with `voiceSessionId`, matching `contextVersion`, null
   `captureId`, and `writeReady:false`.
2. Send `{type:"capture.start",requestId,captureId,contextVersion,format}` where
   format is exactly `{codec:"pcm_s16le",sampleRate:16000,channels:1,frameMs:20}`.
   The server revalidates the frozen target before creating the provider.
   `capture.ready` returns `input`, `output` and matching identity/version;
   output is null or `{codec:"pcm_s16le",sampleRate:16000|24000,channels:1}`.
   Wait for this reply before sending binary PCM.
3. Upload exact 640-byte signed16LE mono 16kHz frames. Maximum recording length
   is 30 seconds/1500 frames; the timer starts immediately before ready is sent.
   The browser uses a shorter deadline to allow for network latency.
4. Send `{type:"capture.stop",requestId,captureId}`. `capture.stopped` includes
   frame count as `lastSeq`. Final text may arrive before or after this reply.
   A stopped capture has a maximum 20-second tail before provider cleanup.
5. Send `{type:"capture.abort",requestId,captureId}` during recording or stop
   tail. `capture.aborted` acknowledges cleanup of voice only. Later callbacks
   are dropped. It never invokes Mac task cancellation.

STT is `{type:"stt.final"|"stt.partial",captureId,text}` with text capped at
4000 characters. No aggregate/final ordering stronger than capture identity is
promised. TTS is `{type:"assistant.event",captureId,state,text?,aborted?}` where
state is `start`, `sentence_start` or `stop`; binary output follows negotiated
output rate. Issue112 currently uses transcription only and makes no playback
claim. Error is `{type:"error",code:"voice_*",captureId|null}` followed by close.

The observed exact service notice "额度不足，请联系灵矽商务", normalized only for
punctuation and whitespace, is converted to a generic provider error and never
forwarded as ASR. Longer ordinary sentences containing that phrase are not
filtered. The earlier live encounter proved an STT event alone is insufficient
evidence of actual recognition.

Bounds: one owner admission, 8 transport-level slots by default but 1 in formal
runtime, 16 KiB max frame, 32 KiB/64 incoming queued frames, 120 messages/sec,
64 KiB outgoing buffer, 30-second capture, 300-second session, actual login
expiry, 10-second initial/provider operation deadlines and 128 control IDs.
Disconnect, expiry, abort, replacement, error and runtime shutdown close only
owned voice resources and discard stale callbacks.

## Executed checks

TDD red observations: optional voice config was rejected, runtime advertised
voice unavailable, exact asset routes returned HTML, stop-tail abort failed,
the known quota notice was emitted as STT, and fixed-owner assertion received
the session-scoped owner. Each corresponding behavior was implemented after
observing its focused failure. Retained voice fixtures were ported before source.

```sh
npm ci --ignore-scripts --prefix apps/server
npm ci --ignore-scripts --prefix apps/mac-agent
npm ci --ignore-scripts --prefix packages/voice
node --test apps/server/test/*.test.mjs packages/voice/test/*.test.js
git diff --check
```

Result: **215/215 passed**, zero failures/cancellations/skips; diff check clean.
Coverage includes strict cookie/Origin/expiry, distinct-cookie contention,
fixed owner/Mac, project/task/parent spoofing, second validation before recording,
actual simultaneous TLS Agent WebSocket and phone voice with private Mac RPC
fixture, unchanged explicit create/confirm flow, malformed PCM, backpressure,
control replay, late callbacks, provider timeout, bounded stop tail, abort after
stop, redaction and the known quota notice. Existing Agent authorization/capacity
tests remain green. SDK tests exercise actual Opus decode and bounded onboarding
fixtures; onboarding tests prevent outbound HTTPS.

## External evidence and remaining gates

Coordinator integration on `50cab45cafb2d49b525ce7e1be8319016e079339`
also adds the SDK tests to root `npm test`, so they remain part of normal
regression and coverage collection. Seven additional provider lifecycle/decoder
regressions pass, with no production source changes. Root
`node scripts/coverage.mjs collect-node --output <private-output>` executed
**286/286 tests**, zero failures/skips/cancellations. Overall line coverage is
1955/1999 (97.79%) and branch coverage 1919/2270 (84.53%), exceeding the exact
base's 1631/1669 (97.72%) and 1518/1802 (84.24%). Changed production coverage is
checked separately against the final published revision. Coordinator reviewed
the added tests; mac_agent_probe independently checked the root test command.

A separate direct live synthetic probe after recharge matched the fixed Chinese
input phrase exactly after punctuation normalization and completed TTS with no
provider error. That record predates formal backend deployment and used a
device on an existing cloud assistant. It is not cloud tool-isolation proof,
formal runtime acceptance, phone audio, or a Mac task created from voice.

Before formal voice deployment: provision/verify dedicated no-MCP assistant and
device, complete two independent source reviews, package dependency closure, and
recheck full tests on the combined backend/UI revision. Then validate actual
formal authenticated WSS audio, human phone transcription, draft/confirm to
paired Mac execution and independent file/test evidence. Reconnect, target
switch, audible phone playback and outdoor acceptance remain separately open.
