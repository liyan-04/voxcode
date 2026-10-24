# Outdoor iPhone relay

## 手动安装包

在仓库根目录运行 `npm run package:relay` 可生成 `dist/voxcode-relay-0.1.0.tar.gz`。包内包含 Relay、Connector、配置模板、前台/后台启动脚本、状态/停止脚本和手动 systemd 用户服务模板；安装器只写入新的私有 prefix，已存在的 prefix 会拒绝覆盖。完整步骤见 [`packaging/README.md`](packaging/README.md)。

The public relay accepts phone HTTPS API calls and forwards them over the company
Mac's **outbound** WSS connection. The Mac's bridge stays on loopback; no company
router port forwarding or inbound Mac firewall rule is needed. This is a single
configured Mac MVP. Node >=22 and exact-pinned `ws` are required on both hosts.

```
iPhone -- HTTPS --> fixed-IP TLS relay (:9899)
                               |
company Mac connector -- WSS --+
       |
       +-- HTTP --> Mac bridge (127.0.0.1:8787)
```

## Configure and run

On both hosts, run `npm ci --ignore-scripts` in `apps/relay`. Each process reads
environment variables; Node can load a private `.env` with `--env-file=.env`.
`.env.example` lists all settings and intentionally contains no usable key.

Generate one random machine key with `openssl rand -hex 32`. Set the same
`VOXCODE_MACHINE_ID` and `VOXCODE_MACHINE_KEY` on the public server and company Mac.
The key must be 32-256 base64url characters; use a generated random value. This
key belongs only to the relay and connector, never to the phone. Keep the env
file private and outside commits.

Relay deployment is authorized on the designated personal vm6 host via the
liyan-server skill; the earlier bili-xs8 route is superseded. Verify the target
and public mapping, check9899 on that host, and stop if occupied. The intended endpoint is `https://121.52.250.201:9899`,
with WSS upgrades on the same port. No domain or additional public port is needed.

### Local trust material

From the repository root, this opt-in helper creates an entirely new ignored
directory and refuses existing output. OpenSSL 3+ and Git are required:

```sh
node scripts/create-local-tls.mjs --ip 127.0.0.1
```

This command is a local fixture. A later authorized deployment uses the actual
IPv4 in place of loopback. Default output is `.voxcode-tls/<IP>/`; optional
`--out` must name a new direct child of the repository's ignored `.voxcode-tls/`.
The helper validates the IPv4, uses structured OpenSSL arguments, verifies the
issued leaf against that IP, and writes:

- `VoxCodeCA.pem` and `VoxCodeCA.der`: public root certificates for the Mac and
  signed iOS app respectively. These contain no private key.
- `relay.pem` and `relay.key`: IP-SAN server certificate and its private key.
- `VoxCodeCA.key`: private signing key, never a client asset.

The output directory is mode 0700 and keys are mode 0600. The CA is EC P-256,
SHA-256, valid for ten years; the server leaf is valid for one year and only the
supplied IP. On generation failure, any partial ignored directory is retained;
inspect it before choosing a new output directory. Never commit generated
material. Transfer only reviewed public trust through the signed app or an
independently verified channel; do not bootstrap trust over public HTTP. Rotation
requires the corresponding reviewed client trust update.

### Process configuration

`VOXCODE_TLS_CERT` and `VOXCODE_TLS_KEY` are file paths loaded by the relay CLI.
Both are required together. `VOXCODE_TLS_CA` is the public PEM file path loaded
by the connector CLI. Factory callers pass bytes/PEM directly:

```js
createRelay({machineId, machineKey, tls: {key, cert, ca}});
createConnector({machineId, machineKey, relayURL, bridgeURL, ca});
```

`tls.ca` is optional server trust material and does not enable mutual TLS;
the connector still authenticates using its machine credential. Connector
certificate-chain, hostname/IP and expiry checks are always enabled, including
when a custom CA is supplied. TLS 1.2 or later is required. Missing custom CA uses
system roots; it does not accept a private CA automatically. No credentials,
bodies, private key material or WebSocket frames are logged by these CLIs.

For local TLS verification, keep `VOXCODE_RELAY_HOST=127.0.0.1`, set the local
certificate/key paths and select an available local port. From `apps/relay`:

```sh
node --env-file=.env relay-cli.mjs
```

On the company Mac, start the normal Mac bridge on loopback. Set
`VOXCODE_RELAY_URL=wss://121.52.250.201:9899/connector`, set `VOXCODE_TLS_CA`
to the reviewed public CA PEM and set
`VOXCODE_BRIDGE_URL` to its actual loopback HTTP origin, then run:

```sh
node --env-file=.env connector-cli.mjs
```

The connector retries dropped connections with exponential delay and jitter,
up to roughly 30 seconds between retries. Independently of the server heartbeat,
it sends a nonce-bearing ping every 15 seconds and requires its matching pong
within 10 seconds. A silent blackhole therefore terminates the local socket
within about 25 seconds and enters reconnect logic; close/shutdown clears both
timers. Status logs contain no credentials.
Keep both processes running with the hosts' process managers. Mac sleep, company
outbound network policy or stopped processes can make the Mac unavailable.
Plain `ws:` is accepted only for literal loopback/localhost development URLs;
remote connectors must use `wss:`. Local bridge destinations must be HTTP on
`127.0.0.1`, `[::1]`, or `localhost`, with no path, credentials or query.
The relay CLI refuses a non-loopback plaintext listener. Factory callers omitting
`tls` must also bind their HTTP test server to loopback. No redirect is followed.

On iPhone, use the configured fixed-IP HTTPS origin and reviewed bundled CA, then pair
using the expiring code displayed by the Mac bridge. `POST /api/pair` is forwarded
to that one Mac and returns the bridge-issued **phone session token**. All task
and voice calls use that token as `Authorization: Bearer <sessionToken>`.
There is no separately provisioned phone relay token and no machine-key pairing.
Relay authentication does not bypass the Mac bridge's pairing, project selection,
version checks, approval rules or authorization.

## Forwarded API

Only these exact method/path families are forwarded:

- `GET /api/health`, `POST /api/pair`.
- `GET /api/monitor` (requires the paired phone session bearer; no query).
- `POST /api/unpair` (requires the phone session bearer).
- `GET|POST /api/settings`.
- `GET|POST /api/tasks`, `GET /api/tasks/:id`.
- `GET /api/tasks/:id/events?after=N`.
- `POST /api/tasks/:id/messages|cancel|accept`.
- `POST /api/tasks/:id/approvals/:approvalId`.
- `POST /api/tasks/:id/criteria/:criterionId`.
- `POST /api/voice/sessions`.
- `POST /api/voice/sessions/:id/audio|stop|abort`.
- `GET /api/voice/sessions/:id/events?after=N`.
- `DELETE /api/voice/sessions/:id`.

IDs contain only letters, digits, underscores and hyphens. Only events routes
allow a query, and only a nonnegative integer `after` is accepted. No remote
destination, arbitrary path, file serving, generic proxy or Codex App Server
endpoint is exposed. Evidence in task JSON is forwarded; there is no preview
file/port tunnel. Preview bootstrap/cookies/static routes are deferred and are
not exposed. Monitor forwarding uses the same fixed loopback bridge and its
session authorization; the machine key cannot read phone monitoring data.

### Paired monitoring

`GET /api/monitor` returns only the documented Mac aggregate snapshot plus a
fixed `relay` object after a successful, valid Mac response. Missing, invalid,
revoked and machine-key credentials never acquire Relay metrics. Offline and
timeout reads remain HTTP 503/504 errors; Relay does not create an offline
snapshot. Malformed successful Mac monitor JSON returns a generic 502. Unknown
fields are omitted, and monitor errors never forward raw bridge messages.

Mac `readiness.codexAvailable` means the Codex executable is present;
`readiness.voiceConfigured` means a voice handler is configured. Neither proves
an authenticated model call or live Linx speech. Mac RSS/heap cover the bridge's
Node process only. The snapshot contains no prompts, code, task IDs, audio,
tokens, private paths, raw exceptions or arbitrary metric labels.

Relay counters cover this process's HTTP requests for its single configured
machine, across its paired phone sessions. Each finished HTTP response increments
`requestsTotal` once; `responsesTotal` counts status below 400, `errorsTotal`
counts status 400 or above, and `timeoutsTotal` counts the 504 subset. Rejected
routes/authentication and transport errors are included. Unfinished client
aborts are not counted. `inFlight` counts pending connector requests and can
include the monitor read itself; its unfinished response is excluded from the
finished counters. `connected` reports the currently connected authenticated
connector and appears only on a successful forwarded snapshot.

`latencySamples` is bounded to the most recent 128 finished requests. Monotonic
durations run from Relay HTTP ingress through response finish, including upload,
connector and Mac work. `latencyP50Ms`/`latencyP95Ms` use the nearest-rank values,
or JSON null with zero samples. They are not network RTT, model runtime, STT or
TTS latency. Counters and samples reset on Relay restart; no historical uptime
or availability percentage is implied. All fields have fixed keys, without
per-path, identity or content labels. TLS and device/outdoor acceptance remain
separate from local loopback monitoring tests.

POST bodies require `application/json` (optional UTF-8 charset); audio uploads
require `application/octet-stream`. GET/DELETE must have no body and may omit
Content-Type or use JSON. Raw PCM bytes are preserved using base64 inside the
private relay protocol. Request bodies are capped at 1 MiB, responses at 2 MiB,
and only bounded JSON, binary/audio or PNG/JPEG response content types are
accepted. Large evidence must be reduced or handled by a future authorized
artifact route; this relay does not silently truncate it.

Only phone Authorization and allowed Content-Type are forwarded. Host and
Content-Length are generated for the fixed local bridge; cookies, user-supplied
forwarding headers and other arbitrary headers never reach it. Responses forward
only status, body and allowed Content-Type. Cache prevention and `nosniff` headers
are added. The machine key is used only for the outbound WSS upgrade and is never
in a URL or a local bridge request. Treat the public relay host as trusted: it
terminates the phone's connection and processes phone tokens and task contents.

## Failure and security behavior

There is one authenticated connector at a time. Wrong machine credentials are
rejected; a second authenticated connector receives 409 instead of replacing
the existing Mac. Random request IDs bind responses to the active connector;
unsolicited or malformed responses terminate it. Duplicate/late responses cannot
satisfy another request. WebSocket pings detect a broken connection; all pending
HTTP requests fail when it closes. No mutation is automatically replayed on
reconnect. Clients must retain requestId and reconcile task state before retrying.
Aborting an HTTP request or losing connectivity never promises task rollback.

Offline returns JSON 503. Relay request deadline is 15 seconds; the connector's
local HTTP deadline is 14 seconds, including response body reading. The relay's
deadline includes public body reading as well as forwarding. Timeout is 504.
Both sides cap active requests at 32, including at most eight audio uploads or
voice event polls. Media cannot consume all control capacity; cancellation,
approval and task status use the remaining global capacity. Overload returns
429 at the relay or 503 at the connector. Socket queue limits
prevent unlimited buffering. Public request bodies/headers have timeouts and the
relay accepts at most 128 concurrent TCP connections. Pairing is limited globally
to five attempts per minute and health to 60 requests per minute. These limits
live on the relay and survive Mac connector reconnects, but reset on relay process
restart; the Mac bridge's own pairing limits still apply. The global pairing
limit is deliberately conservative for a one-phone demo and can temporarily
block pairing if someone spends the attempts. No IP forwarding header is trusted.

## Verification

`npm test` runs actual local HTTP/HTTPS/WS/WSS round trips, including phone pairing
and authorization, binary input/output, route/header/size limits, offline,
deadline, duplicate connector, unsolicited response, reconnect/watchdog, scoped
core v1 routes, media saturation, strict CA/IP/expiry, CLI TLS paths and helper
no-overwrite cases. The retained `test/deferred/preview-v1.test.mjs` contains
unfinished preview expectations from the broader proposal; it is deliberately
outside `test/*.test.mjs`, remains RED, and can be run explicitly when preview
scope resumes. It is not counted as passing first-demo coverage.

Fixtures do not prove deployed TLS, company outbound access, signed-device trust,
live Codex/Linx or an outdoor iPhone round trip. SSH/public deployment verification remains incomplete.
The relay preserves audio bytes; codec negotiation/decoding/playback belong to
the voice integration and native client.

Benchmark callers can time HTTPS requests and connector `start()`/`close()`,
observe redacted `onStatus` callbacks, and use the returned Node `server`'s
connection events/`getConnections()` to check cleanup. Local timings measure
transport fixtures only. No measurements or latency thresholds are claimed here.

Codex executable readiness is a single asynchronous startup sample with a two-second timeout. Monitor and health reuse it; restart the Mac runtime after installing or changing the CLI. It does not prove authentication or model execution.
