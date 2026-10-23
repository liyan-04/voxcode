# Outdoor iPhone relay

The public relay accepts phone HTTPS API calls and forwards them over the company
Mac's **outbound** WSS connection. The Mac's bridge stays on loopback; no company
router port forwarding or inbound Mac firewall rule is needed. This is a single
configured Mac MVP. Node >=22 and exact-pinned `ws` are required on both hosts.

```
iPhone -- HTTPS --> public server reverse proxy --> relay (127.0.0.1:8788)
                                                     |
company Mac connector -- outbound WSS ----------------+
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

On the public server, set `VOXCODE_RELAY_HOST=127.0.0.1` and
`VOXCODE_RELAY_PORT=8788`, then run:

```sh
node --env-file=.env relay-cli.mjs
```

Run a TLS reverse proxy on the user-provided domain with a trusted certificate.
For example, a Caddy site proxies both HTTP and WebSocket upgrades automatically:

```caddyfile
your-domain.example {
    reverse_proxy 127.0.0.1:8788
}
```

Only the reverse proxy needs a public listener. Keep port 8788 on loopback. The
relay itself does not issue certificates. Avoid logging Authorization headers,
request/response bodies or WebSocket frames in the proxy and observability tools.

On the company Mac, start the normal Mac bridge on loopback. Set
`VOXCODE_RELAY_URL=wss://your-domain.example/connector` and set
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

On iPhone, use `https://your-domain.example` as the bridge base URL, then pair
using the expiring code displayed by the Mac bridge. `POST /api/pair` is forwarded
to that one Mac and returns the bridge-issued **phone session token**. All task
and voice calls use that token as `Authorization: Bearer <sessionToken>`.
There is no separately provisioned phone relay token and no machine-key pairing.
Relay authentication does not bypass the Mac bridge's pairing, project selection,
version checks, approval rules or authorization.

## Forwarded API

Only these exact method/path families are forwarded:

- `GET /api/health`, `POST /api/pair`.
- `POST /api/unpair` (requires the phone session bearer).
- `GET|POST /api/tasks`, `GET /api/tasks/:id`.
- `GET /api/tasks/:id/events?after=N`.
- `POST /api/tasks/:id/messages|cancel|accept`.
- `POST /api/tasks/:id/approvals/:approvalId`.
- `POST /api/voice/sessions`.
- `POST /api/voice/sessions/:id/audio|stop`.
- `GET /api/voice/sessions/:id/events?after=N`.
- `DELETE /api/voice/sessions/:id`.

IDs contain only letters, digits, underscores and hyphens. Only events routes
allow a query, and only a nonnegative integer `after` is accepted. No remote
destination, arbitrary path, file serving, generic proxy or Codex App Server
endpoint is exposed. Evidence in task JSON is forwarded; there is no preview
file/port tunnel, and this module does not claim that a real preview exists.

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
local HTTP deadline is 14 seconds, including response body reading. Timeout is
504. More than 32 active forwarded requests is rejected, and socket queue limits
prevent unlimited buffering. Public request bodies/headers have timeouts and the
relay accepts at most 128 concurrent TCP connections. Pairing is limited globally
to five attempts per minute and health to 60 requests per minute. These limits
live on the relay and survive Mac connector reconnects, but reset on relay process
restart; the Mac bridge's own pairing limits still apply. The global pairing
limit is deliberately conservative for a one-phone demo and can temporarily
block pairing if someone spends the attempts. No IP forwarding header is trusted.

## Verification

`npm test` runs actual local HTTP/WebSocket round trips, including phone pairing
and authorization, binary input/output, route/header/size limits, offline,
deadline, duplicate connector, unsolicited response and disconnect cases. Test
fixtures are not a live cloud deployment. Deployment, trusted public TLS, company
Mac outbound access and an outdoor iPhone round trip remain pending until the
user-provided server/domain is configured. This relay does not decode Linx Opus
output or change the voice adapter's documented playback limitation.
