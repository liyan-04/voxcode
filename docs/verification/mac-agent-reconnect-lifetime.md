# Mac Agent reconnect lifetime

Issue: [#119](https://github.com/liyan-04/voxcode/issues/119).
Base: `de10f5b02c5deca06c42a8c1b9e02d04d76850f5`.
Environment: local macOS arm64, Node v26.0.0, 2026-10-25.

The pending reconnect timer now remains referenced. After a WebSocket closes
or its constructor throws, an otherwise idle standalone Agent process stays
alive for its intentional reconnect. Explicit `close()` still clears the
retry timer and releases the Agent's own ledger lock. Heartbeat behavior,
backoff, ledger ownership checks and manual stale-lock reconciliation are
unchanged. There is no automatic stale-lock deletion.

## Real child-process regression

`apps/mac-agent/test/reconnect-process.test.mjs` launches actual Node children
with real timers and private temporary ledger files. Its controlled socket
fixture covers two paths: a connected socket closes, or the socket constructor
throws. No network, IPC channel or referenced test timer keeps the child alive.
A 250 ms close callback is deliberately unreferenced; the production reconnect
is scheduled for 1000 ms, so only its reference keeps the child alive long
enough for explicit close. The parent requires the close marker, normal exit
and absence of the owned lock afterward. Every child has a 5-second deadline
and a bounded output buffer.

Before the one-line implementation change:

```sh
cd apps/mac-agent
node --test test/reconnect-process.test.mjs
# 0 passed, 2 failed. Both children exited 0 early, without the close marker.
```

After removing `retryTimer.unref()`:

```sh
node --test test/reconnect-process.test.mjs
# 2 passed, 0 failed. Children survived until explicit close and released locks.
npm test
# 28 passed, 0 failed, including existing strict WSS reconnect and lock tests.
```

`git diff --check` passed. The existing pinned ws 8.22.0 was installed using
`npm ci --ignore-scripts --no-audit --no-fund`; dependency metadata did not
change. This is local process/ledger and existing network-fixture evidence,
not recovery or acceptance of the installed Agent. The coordinator owns
independent reviews, runtime lock-owner reconciliation, installation and live
Mac/server verification. No installed service, stale lock or task state was
modified here. Issue #114 remains frozen.
