# Phone-demo Relay security review

Date: 2026-10-23. Reviewer: `/root/mac_v1`, independent of the Relay implementer. Scope: `apps/relay` and `scripts/create-local-tls.mjs`, inspected in the separate Relay worktree. The only authored file is this report in the Mac worktree; no implementation or Git mutations were made by the reviewer.

## Revision and conclusion

Final reviewed revision: `c26fb6289373b27f741fd3309db5b4a2cc73e1fe` (`codex/relay-phone-demo`). `git status --short` was empty before and after the final verification. Review began against `a352757481a04c39f0212fd1f07814a666431ff0` plus the dirty Relay slice; the coordinator then committed that slice and upgraded `ws` to `8.22.0`. The final tests, dependency inspection, audit and hashes below refer to `c26fb62`.

No actionable P0/P1/P2/P3 finding was identified in this scoped review. This is a source/local verification result, not certification of deployed or native-device operation.

## Examined boundaries

- `apps/relay/connector.mjs:11`, `apps/relay/connector.mjs:53`: remote connections require WSS, URL credentials/query/fragment are rejected, redirect following is disabled, certificate verification remains enabled, and TLS 1.2 is the minimum. Custom CA material is passed through without disabling chain, hostname/IP or expiry verification. Missing custom trust uses system roots rather than trusting a private CA implicitly.
- `apps/relay/relay.mjs:14`, `apps/relay/relay-cli.mjs:6`: the HTTPS factory accepts explicit key/certificate material, while the CLI refuses incomplete TLS configuration and non-loopback plaintext listeners. Factory HTTP fixtures must still explicitly bind to loopback, as documented. The server CA option does not imply mutual TLS; the machine credential remains the connector authentication boundary.
- `apps/relay/protocol.mjs:15`, `apps/relay/connector.mjs:24`: Relay and Connector independently apply the exact method/path/query/type allowlist. Encoded separators, traversal punctuation, unknown suffixes and arbitrary destinations cannot reach the fixed local bridge. Settings, criteria and voice abort are included; monitor, preview and App Server are absent.
- `apps/relay/relay.mjs:40`, `apps/relay/relay.mjs:64`: protected phone routes reject missing/malformed bearer syntax and the machine credential. The Mac remains responsible for checking actual phone authorization. Machine upgrades require the configured identity and a constant-time key comparison; a second connector is rejected rather than replacing the first. Only phone authorization and allowed Content-Type reach the bridge, and cookies/arbitrary response headers are excluded.
- `apps/relay/relay.mjs:47`, `apps/relay/connector.mjs:45`: request deadlines include public body reading and local response body reading respectively. Expired or disconnected request ownership is removed before late continuation can forward/respond. Disconnect does not replay mutations. Request/response/frame sizes, TCP count, pairing/health rates and retired/seen IDs are bounded.
- `apps/relay/protocol.mjs:37`, `apps/relay/protocol.mjs:39`: both transport sides reserve capacity against media saturation by allowing at most eight audio uploads/voice polls within the 32-request global limit. Cancellation, approvals and task status remain available under the tested media overload. This is not a claim that control requests are accepted after all 32 global slots are occupied by other work.
- `apps/relay/connector.mjs:55`, `apps/relay/relay.mjs:96`: the independent Connector ping/pong watchdog terminates a silent socket and reconnects; shutdown clears heartbeat/reconnect work and cancels local requests. Relay shutdown also owns TCP sockets that have not finished TLS negotiation.
- `scripts/create-local-tls.mjs:14`: the helper validates canonical IPv4, confines output to a new ignored direct child, rejects existing outputs/symlinks, and invokes OpenSSL with structured argument arrays. It generates an IP-only server leaf with serverAuth, verifies the chain/IP, exports public PEM/DER separately and restricts directory/key permissions. Failed partial output is retained and documented; it is never silently overwritten.

## Actual verification

Environment: local macOS, Node `v26.0.0`, OpenSSL `3.6.4`. The installed package and both manifests were checked to use exact-pinned `ws` `8.22.0`.

```sh
node --test apps/relay/test/*.test.mjs
# 28 passed, 0 failed, 0 skipped/cancelled; exit 0

# From apps/relay:
npm audit --omit=dev --json --cache /private/tmp/voxcode-review-npm-cache
# 0 reported vulnerabilities; exit 0

git diff --check HEAD -- apps/relay scripts/create-local-tls.mjs
# exit 0
```

The tests perform actual local HTTP/HTTPS/WS/WSS traffic with controlled bridge/provider data. Negative cases exercised unknown CA, wrong CA, wrong IP and expired certificates for HTTPS/WSS; wrong/duplicate machine authentication; protected-route authorization; malformed route/type/body inputs; unsolicited/oversized responses; slow request bodies; response deadlines; disconnect and silent-network recovery. Eight blocked media requests were exercised at each transport boundary while cancellation, approval and status requests succeeded. A raw TCP connection that never sent a TLS handshake was closed during Relay shutdown.

Helper and CLI checks actually generated short-lived local fixture material, checked public CA PEM/DER consistency, IP SAN, chain signature, mode 0700 directories and mode 0600 keys, and exercised no-overwrite/existing-symlink rejection. Tests also started both CLIs with local certificate/key/CA paths and verified an HTTPS round trip. Their generated temporary outputs were cleaned by the tests; no private material is included in this report.

The earlier split runs also passed 22 Relay/v1 tests and six helper/CLI tests. The full 28-test run above was repeated after the coordinator's dependency/commit update. The deferred preview suite was deliberately not run because preview is outside the phone-demo scope.

## Remaining gates

No public listener, deployment, remote host access, company-network partition, signed iPhone trust, real Linx/Codex session or outdoor cellular path was exercised. The declared minimum Node 22 runtime was not separately executed; local results are for Node 26. Dependency audit results describe the registry snapshot at review time and do not prove absence of all security defects.

Existing source boundaries and local TLS tests do not replace the separate deployment-resumption authorization or the occupied-port stop requirement. This review does not independently approve iOS trust handling or the Mac execution implementation.

## Final SHA-256 snapshot

```text
28d9cb2630cb7d2f2d3ba41996b750943ef67b103b619c4abc4d7930563baa8d  apps/relay/.env.example
7b5a53e8e0e7ed23221fd53c3e81e97b4292c88da8ad3aefd6ddf8efef08e47c  apps/relay/README.md
e0e862b8dddc1e3663d09febe6a4250e5b2d158272c76d6ce526f0da33e681fa  apps/relay/connector-cli.mjs
9fe112785f034f6818ccc027d9ff3dfa19d8413ac709427ea8f8ae3c59f9a495  apps/relay/connector.mjs
d4785d860766730f6c2c0018e9dc8f119b8e9388cc519cd9e648957d69461a92  apps/relay/protocol.mjs
a74cc31b16b12906a4d91e227b471ed5c027063f6830036b93569037050b7457  apps/relay/relay-cli.mjs
13ee7f8221d4d9f4ae2327c1c63565a2fa66d7ac1df0b3a3dcd4b9ac71b6dd50  apps/relay/relay.mjs
04416620cfc50d99490468277aa644da4c719e02101ef1ad3c52592a0e8ca071  apps/relay/package-lock.json
1ca455582b17662d4d77d60455ee1ec026e6f93515b4921ce902b64f6d0577c0  apps/relay/package.json
acc86ae42c80e85efda63e3c355a0619c291cf37d20bfa198c3af1c3ecbd7c27  apps/relay/test/relay.test.mjs
7ad0c95d4be1b7d0cd23e32bba86263b4a18365360554805270073128bf45b93  apps/relay/test/tls-cli.test.mjs
b7102ce6eabe9c4c1c6a3623b6fada4876fb0f18e09e8737d95b3b7cb3aa18a1  apps/relay/test/v1.test.mjs
88f54e1c4d281f82fce8daca7835f7940c6a6e40beea2b259f321cdb62c6e8fa  scripts/create-local-tls.mjs
5a3c8b6ca7ded51ac712b111905e7e0c926ffa01dea3967d23950486660d77c3  docs/contract.md
```

## Targeted follow-up: accepted pre-handshake TCP sockets

Date: 2026-10-24. Reviewer: `/root/mac_v1`. Reviewed fix: `de8fc2df0c969fa1e56ef316d0121a8399916ebd`. Verification worktree HEAD was `3a0fc4b3cc61b8628601995393f94983461591e8` (a subsequent review-document commit); `git diff de8fc2d HEAD -- apps/relay scripts/create-local-tls.mjs` was empty. Relay source was clean; an unrelated untracked Mac review document was excluded.

Correction to the initial review's shutdown coverage above: the original fixture awaited only the client `connect` event. That did not establish that the Relay had accepted the server-side socket before shutdown. Its local pass was a false negative for an accepted raw socket that never completes TLS. The coordinator's Linux CI run exposed this missing ownership; the initial no-finding conclusion does not cover that defect at `c26fb62`.

The fix tracks raw sockets from the server `connection` event, immediately destroys a connection arriving while closing, removes tracked sockets on close, stops the listener and destroys the accepted raw sockets before awaiting server closure. It retains connector termination, pending request cleanup and WebSocket server cleanup. The changed regression now waits for the accepted server socket, retains the 500 ms close deadline, checks the peer is destroyed before test-side client cleanup and confirms zero server connections afterward. Code inspection found no new actionable issue in this narrow change.

Independent command from `apps/relay`:

```sh
/private/tmp/voxcode-node22-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --test --test-name-pattern 'relay shutdown closes TCP connections' test/v1.test.mjs
# Node 22.23.4, local macOS: 1/1 passed, 0 failed/skipped; exit 0
```

The full 28-test Node 22 suite was already separately verified by the implementer and iOS independent reviewer; this follow-up did not rerun that full suite or Linux CI. Local TCP/TLS fixture evidence does not establish deployed/device/outdoor behavior. No implementation or Git mutation was made by this reviewer.

Confirmed fix SHA-256:

```text
cc294bd4c703bcd418d252caa7023f6eefe0bcf03b6f12a44988e2458a59467e  apps/relay/relay.mjs
98784599ec9e8d0ab9620f0b37d1d6f0cd5670027a27bc8efd0543c458614e1f  apps/relay/test/v1.test.mjs
```

Status: targeted independent follow-up resolved the reported accepted-socket shutdown defect in `de8fc2d`; no open finding remains in this changed behavior. Human approval and external acceptance gates remain separate.
