# Linx voice adapter

Node >=22, ESM. Run `npm ci --ignore-scripts` then `npm test` in this directory.
The production transport is exact-pinned `ws`: Node's built-in WebSocket does
not provide the custom handshake headers required by the documented device API.
Injected transports must implement the `ws` constructor and EventEmitter API.

The server runs as a software Linx device: it opens the outbound authenticated
WSS connection and advertises **端侧 MCP** on that same connection. The phone
uses only the authenticated VoxCode voice API and keeps no Linx credentials.
This route needs no ALSA, physical audio device or C++ SDK. The separate
**云端 MCP** SSE route (`GET /mcp`, `POST /mcp/message`) is not implemented here
and requires its own reachable HTTP service. Its `X-Linx-Device-Id`,
`X-Linx-Agent-Id` and `X-Linx-Session-Id` headers correlate requests; they are
not authentication. Third-app business SSE is another optional integration
route, not an additional transport required by this WSS device adapter.

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

The optional hello `session_id` binds the connection. When supplied it must be
a nonempty string of at most 256 characters without whitespace/control characters.
All later controls and MCP success/error replies carry that binding. An incoming
JSON message with an invalid or conflicting ID closes the session before any
transcript, TTS or tool event is dispatched. Omitted IDs remain accepted because
the official device MCP examples omit them. An absent hello ID leaves replies
unbound; later messages do not silently change that binding. Binary audio has no
session field and belongs to its authenticated connection.

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
output. The integration bridge decodes negotiated Opus with exact-pinned
`opusscript` and returns bounded signed PCM frames at the negotiated 16/24 kHz
rate. The adapter's raw frames must never be passed directly to a PCM player or
treated as a WAV/Ogg file. No undocumented output-format switch is used. Local
codec tests encode and decode actual Opus packets; live provider audio and
audible iPhone playback still require verification.

The documented abbreviated server hello may omit `channels`; the adapter uses
the documented mono value when format and sample rate are present. A hello may
also omit `audio_params` entirely: input and MCP remain usable, but the bridge
reports `outputSupported:false` and drops binary output until a new connection
negotiates an output format. No output codec or sample rate is inferred from the
PCM input hello. Supplied malformed or unsupported audio metadata is rejected.

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

The bridge registers six scoped tools: `list_tasks`, `get_task_status`,
`get_task_evidence`, `propose_task`, `propose_followup` and `propose_focus`.
They read actual service state or emit expiring drafts/focus suggestions. Drafts
never dispatch work, approve operations or accept results. Creation freezes the
task/version, supplied through documented hello prompt placeholders. Closing or
revoking expires tools, drafts and audio; slow request bodies recheck authorization
before provider creation. Phone confirmation remains the only execution path.

## Local software-device onboarding

The helper uses the official OTA web-test device format. It needs Node >=22 and
no voice package dependencies. Choose a new, absolute private directory outside
this repository, with an existing parent owned by you or root. It creates only
the final directory (0700), `identity.json` (0600) and, after binding, `.env.linx`
(0600). It rejects symlinks in the path, public permissions, hardlinked files,
wrong ownership, corrupt identities and existing runtime credentials. On macOS,
use `/Users/your-name/...` or `/private/...`; `/tmp` and `/var` are symlink aliases
and are intentionally rejected. Do not use a shared, recorded or synced folder.

From the repository root, replace the example path with your own absolute path:

```sh
node packages/voice/tools/onboard.mjs init --dir /Users/your-name/.voxcode-linx
node packages/voice/tools/onboard.mjs status --dir /Users/your-name/.voxcode-linx
```

`init` is offline. It persists a random locally administered unicast MAC and
UUIDv4, reuses valid existing identity, and never resets it. It does not read
hardware addresses. `status` is also offline: `unconfigured` means the identity
has no saved env file; `configured` means a valid private env file matches that
identity. Neither state proves cloud authorization, connectivity or speech.
Output JSON contains only these states and creation/save flags, never identifiers,
activation codes, tokens, complete responses or private paths.

First create a competition test agent in [your own Linx console](https://linx.qiniu.com/)
and confirm that its device binding/activation entry is available. If that entry
is unavailable, ask the platform administrator to enable software test devices.
Do not send credentials or screenshots to an Issue or chat. This is the user
console checkpoint; the helper does not create agents or operate your account.

After the account checkpoint and authorization to register this software device,
run this explicitly in a private local terminal:

```sh
node packages/voice/tools/onboard.mjs activate --dir /Users/your-name/.voxcode-linx --show-code
```

`activate` makes a POST to the official HTTPS activation check, then the official
HTTPS OTA endpoint. A pending device returns `pending` with `codeAvailable:true`.
Only `--show-code` with both terminal input and terminal error output displays the
six-digit code on stderr; redirected/noninteractive use is rejected before any
request. The code is not saved. Bind it to your test agent in your own console,
then rerun `activate` to obtain and privately save the device runtime token:

```sh
node packages/voice/tools/onboard.mjs activate --dir /Users/your-name/.voxcode-linx
node packages/voice/tools/onboard.mjs status --dir /Users/your-name/.voxcode-linx
VOXCODE_PROJECT=/absolute/path/to/authorized-test-project node --env-file=/Users/your-name/.voxcode-linx/.env.linx apps/integration/cli.mjs
```

The saved env contains `LINX_WS_URL`, `LINX_TOKEN`, `LINX_DEVICE_ID` and
`LINX_CLIENT_ID`; Node loads it directly. Never place the token in CLI arguments,
phone configuration, shell history, logs or source control. No token CLI option,
force/refresh, identity import or overwrite operation is provided. Existing env
files stop activation before network access. Preserve the directory for the same
bound software identity; credential rotation/recovery requires a separately
reviewed platform procedure. Rollback is to stop using the helper/configuration;
no cloud unbinding, existing configuration mutation or cleanup is automatic.

Requests have a 10-second deadline each and a 64 KiB response limit. The tool
accepts only `https://xrobo.qiniuapi.com/v1/ota/` and its documented `/activate`
endpoint, rejects redirects, never downloads firmware and never retries itself.
The only accepted WebSocket destination is the official WSS endpoint; the exact
official WS default is mapped to its documented WSS equivalent before saving.
Other addresses fail closed for platform review. HTTP200 JSON business errors,
malformed replies, missing tokens after a successful binding check and unsafe
token encodings fail with generic errors. If rate limited or timed out, wait and
retry explicitly; do not start a polling loop. Platform account/device availability
and the sample `xiaoling-web-test` board type still need live confirmation.

The source milestone has fixture/local evidence only. Live L1–L5 remain open:
L1 authenticated handshake; L2 real STT and an editable draft without automatic
execution; L3 real MCP tools with frozen task/version and actual state; L4 audible
phone playback and abort; L5 credential expiry/revocation and the signed phone
cellular-to-Mac path. `configured` and local tests do not close these gates. See
[the readiness guide](../../docs/verification/linx-readiness-2026-10-24.md).

Sources retrieved from upstream main on 2026-10-24:

- https://github.com/qiniu/Xrobot-docs/blob/main/docs/xrobot/platform/OTA.md
- https://github.com/qiniu/Xrobot-docs/blob/main/docs/xrobot/platform/websocket.md
- https://github.com/qiniu/Xrobot-docs/blob/main/docs/xrobot/mcp/hardware-mcp.md

The protocol audit for this adapter is pinned to upstream commit
`20ce1b29a1bdff575a4c3317689bae30a7e08535` (2026-10-22):

- [WebSocket device protocol](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/platform/websocket.md)
- [Device MCP](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/mcp/hardware-mcp.md)
- [Cloud MCP](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/mcp/software-mcp.md)
- [Third-app integration](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/guide/third-app.md)
- [Agent configuration](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/guide/agent-config.md)

The MCP discovery response uses protocol `2024-11-05` and standard tools/list
without requiring optional tool `type` metadata. Configure a tool-capable model,
language/voice, intent and prompt in the Linx agent, then save and reconnect.
Selecting a cloud MCP endpoint in the console does not configure this device
transport or demonstrate successful tool invocation.

Adapter tests use an injected protocol transport. Onboarding tests inject controlled
request/response transports with a process-wide default-deny HTTPS mock; they
verify persistent identity, permissions, no clobber, endpoint restrictions,
pending/bound and error states, deadlines/body limits and redacted output. These
checks do not prove cloud enrollment, STT quality, MCP behavior or phone playback.

From the repository root, the reusable headless composition check is:

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix packages/voice
npm ci --ignore-scripts --prefix apps/relay
node --test apps/integration/test/headless-server.test.mjs
```

It uses actual loopback HTTP/WebSocket Relay → Connector → Bridge transport,
the real Linx adapter with an injected protocol peer, actual Opus decoding,
temporary Git worktrees and a controlled Node stdio subprocess. It verifies
unauthenticated denial, MCP discovery/session binding, one draft per duplicate
tool request, no automatic execution, explicit confirmation/diff, replay,
same-thread follow-up, abort and conflicting-session cleanup. It owns temporary
directories, ephemeral ports and process cleanup and requires no audio hardware.
This is local fixture evidence on the host running the test. It does not prove
remote TLS, Linux deployment, real Linx/model execution or audible phone output;
the existing TLS tests and the live/device gates remain separate.
