# RELAY-003: Own stalled TLS sockets during shutdown

Implementer: `/root/relay_v1`. Coordinator owns commits, PR updates and integration. This is implementation evidence, not an independent approval.

## Scope and snapshot

- Base: `c26fb6289373b27f741fd3309db5b4a2cc73e1fe`, Relay milestone Draft PR #4.
- Modified implementation: `apps/relay/relay.mjs`.
- Modified regression: `apps/relay/test/v1.test.mjs`.
- This report is the additionally authorized documentation path. The independent Mac report is a separate deliverable.
- No staging, commit, branch change, push, deployment or production credential access was performed.

## Reproduction and root cause

The coordinator reported Linux Node 22 CI failures in runs `39978288104` and `39978238642`: the existing pre-handshake TCP shutdown test reached its 500 ms deadline before `relay.close()` resolved.

The original test passed locally on both Node 22.23.4 and Node 26.0.0. Inspection showed it waited only for the client's `connect` event. That event can precede the server's `connection` event; closing the listener in that interval prevents the socket from being accepted, so the test can pass without exercising cleanup of an accepted TLS socket.

The test was tightened before changing implementation: subscribe to the Relay server's `connection` event before connecting, and await the accepted raw server socket before invoking `close()`. With only that regression change, the same test failed deterministically on both local runtimes:

```text
Relay shutdown must own pre-handshake TCP sockets
false !== true
```

`server.closeAllConnections()` uses HTTP connection tracking, which does not include accepted sockets that have not completed TLS. `server.close()` stops accepting but waits for existing sockets to close. An idle raw TCP peer can therefore keep Relay shutdown pending until that peer disconnects. The runtime/platform event ordering exposed the missing ownership; increasing the test timeout would not repair it.

## Change

The Relay now tracks each raw socket from the server's `connection` event and removes it on close. An already-closing Relay immediately destroys any connection event arriving during teardown. Shutdown first stops the listener, then closes HTTP connections and destroys every tracked raw socket before awaiting server closure. Existing connector termination, pending-request cleanup and WebSocket server closure remain in the shutdown path.

The regression retains the original 500 ms deadline and additionally checks that the accepted server peer is destroyed before test-side client cleanup, and that `server.getConnections()` reports zero afterward.

## Verification

Environment: local macOS. Node 22 was installed into `/private/tmp/voxcode-node22-npm-cache`; no project dependencies or lockfiles were changed.

| Check | Result |
| --- | --- |
| Tightened regression, before implementation, Node 22.23.4 | 1 failed, expected shutdown assertion |
| Tightened regression, before implementation, Node 26.0.0 | 1 failed, expected shutdown assertion |
| Tightened regression, after implementation, Node 22.23.4 | 1 passed, exit 0 |
| Tightened regression, after implementation, Node 26.0.0 | 1 passed, exit 0 |
| Node 22.23.4 `node --test test/*.test.mjs`, from `apps/relay` | 28 passed, 0 failed/skipped/cancelled, exit 0 |
| Node 26.0.0 `npm test`, from `apps/relay` | 28 passed, 0 failed/skipped/cancelled, exit 0 |
| `git diff --check` | exit 0, no whitespace errors |

Actual Node 22 executable: `/private/tmp/voxcode-node22-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node`.

No Linux runtime was executed locally. A fresh Linux Node 22 CI run remains required after the coordinator commits the fix. Tests use loopback TLS and controlled bridge/connector fixtures; they do not establish deployed, live, device or outdoor behavior.

## Handoff fingerprints

SHA-256 of the modified working-tree files:

```text
cc294bd4c703bcd418d252caa7023f6eefe0bcf03b6f12a44988e2458a59467e  apps/relay/relay.mjs
98784599ec9e8d0ab9620f0b37d1d6f0cd5670027a27bc8efd0543c458614e1f  apps/relay/test/v1.test.mjs
```

Status: implemented and locally verified; coordinator independent review, scoped commit, PR #4 update and Linux CI verification remain pending. Suggested subject: `fix(relay): close accepted sockets before tls handshake completes`.
