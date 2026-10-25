# Device WebSocket transport fixture

Issue: #98. Verified locally on 2026-10-25. This module attaches the device transport to an existing HTTPS listener; the fixture does not deploy a listener or execute a Mac task.

## Attachment contract

```js
import {attachDeviceWebSocket} from './apps/server/device-websocket.mjs';

const transport = attachDeviceWebSocket({
  server: existingHttpsServer,
  gateway: deviceGateway,
  publicOrigin: 'https://vox.example',
  path: '/agent',
  limits: {},
});

await transport.close();
```

`server` must be a Node HTTPS server with no existing `upgrade` listeners. Runtime composition must remove its previous catch-all upgrade handler before attachment. The transport owns upgrade routing on that listener: only the exact configured path is accepted, with no query string. Other paths return 404, a present Origin differing from the exact canonical HTTPS `publicOrigin` returns 403, and exhausted connection capacity returns 503. Missing Origin is accepted for native agents. Rejections occur before WebSocket upgrade and gateway authentication.

The first message must be text JSON with `type: 'register'`. Its full schema, device token authentication, and authorization belong to `gateway.connect(register, {send})`. Once connected, subsequent text is passed unchanged to the returned handle's `receive(text)`. The transport calls only that handle's `close()` during cleanup. It never dispatches a task method, retries a command, invokes task cancellation, opens a listener, or closes the provided HTTPS listener.

The gateway `send(frame)` callback serializes JSON and returns a promise settled by the WebSocket send callback or a delivery deadline. Incoming ws text Buffers are converted to UTF-8 strings. Binary frames and excessive payloads are rejected; per-message compression is disabled.

## Bounds and lifecycle

All limits are positive safe integers; unknown limit names and invalid values are rejected.

| Limit | Default | Maximum |
| --- | --- | --- |
| `maxSockets` | 32 | 1024 |
| `maxUnauthenticated` | min(8, maxSockets) | maxSockets |
| `maxPayloadBytes` | MAX_RESULT_BYTES + 2048 (1,050,624) | same |
| `maxPendingMessages` | 8 | 64 |
| `registrationTimeoutMs` | 5000 | 30000 |
| `idleTimeoutMs` | 45000 | 120000 |
| `shutdownTimeoutMs` | 1000 | 10000 |
| `sendTimeoutMs` | 1000 | 10000 |

The registration deadline includes asynchronous `gateway.connect`. Authenticated sockets have a separate idle deadline renewed only after successful registration or a successful handle `receive`; pending or rejected traffic does not extend it. Idle sockets close and are forcibly terminated after the close-handshake deadline, so network partitions and abandoned replacement connections cannot retain network capacity forever. Pending messages include registration and are serialized per socket. A queue overflow closes the connection without executing its remaining queued messages. A disconnected socket retains its capacity reservation while authentication, receive, or handle cleanup remains pending. This prevents repeated reconnects from bypassing the bounds with unresolved gateway work. A handle returned after disconnect is still closed exactly once.

`close()` is idempotent. It detaches this module's listeners, sends close code 1001 to owned connections, and terminates remaining owned sockets at the shutdown deadline. Unresolved gateway calls do not delay shutdown beyond that deadline and are not cancelled. The provided HTTPS server remains available to its owner.

## Verification evidence

Dependency installation used the existing pinned `ws` 8.22.0 lockfile with `npm ci --ignore-scripts` under `apps/server`.

```sh
node --test apps/server/test/device-websocket.test.mjs
# 16 tests passed, 0 failed

cd apps/server
npm test
# 100 tests passed, 0 failed

git diff --check
# passed
```

The tests generate a one-day self-signed loopback certificate with `/usr/bin/openssl`, supply it explicitly as the client CA, and retain normal certificate verification. An untrusted client is rejected. No `rejectUnauthorized: false` setting is used.

Coverage includes accepted native and same-origin browser upgrades; wrong path, query, and Origin rejection; malformed registration, failed authentication, binary and oversize frames; idle and pending authentication deadlines; authenticated idle expiry and renewal after successful heartbeat; forced capacity recovery when an idle client does not answer close; preauth and total socket bounds; retained capacity for retiring authentication; pending-message flood rejection; eventual handle cleanup after disconnect; and bounded shutdown with an unresponsive client and unresolved receive/cleanup work. Configuration checks cover plaintext listeners, noncanonical origins, invalid limits, competing upgrade listeners, and reduced total-socket defaults.

These are real loopback HTTPS/WSS transport tests with a synthetic gateway and synthetic token. Real device pairing, persistent gateway state, deployed TLS/proxy configuration, Mac agent interoperability, and end-to-end task execution require separate integration acceptance. No deployment or live-delivery claim is made here.
