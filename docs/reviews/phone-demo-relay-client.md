# REVIEW-RELAY-2: Native client and protocol compatibility

Reviewer: `/root/ios_v1`, independent of the Relay implementation. Date: 2026-10-23.
This is an AI code review, not a human GitHub approval, deployment approval or device acceptance.

## Snapshot and scope

- Reviewed worktree: `/Users/liyan2026mac/Documents/ChatGPT/1024/voxcode/.worktrees/relay`.
- Initial baseline: `c26fb6289373b27f741fd3309db5b4a2cc73e1fe` plus the RELAY-003 shutdown changes.
- Final reviewed commit: `de8fc2df0c969fa1e56ef316d0121a8399916ebd` (`fix(relay): close accepted sockets before tls handshake completes`). The coordinator committed the already-inspected changes during this review; HEAD was checked again before recording the result.
- RELAY-003 fingerprints match the implementer handoff: `apps/relay/relay.mjs` SHA-256 `cc294bd4c703bcd418d252caa7023f6eefe0bcf03b6f12a44988e2458a59467e`; `apps/relay/test/v1.test.mjs` SHA-256 `98784599ec9e8d0ab9620f0b37d1d6f0cd5670027a27bc8efd0543c458614e1f`.
- Inspected `apps/relay/{protocol,relay,connector,relay-cli,connector-cli}.mjs`, the three active test files, `apps/relay/README.md`, `scripts/create-local-tls.mjs`, and the shared phone-demo scope/contract.
- Focus: native fixed-IP trust handoff, phone authentication, JSON errors, mutation/voice routes, cancellation and approval capacity, body/deadline/connection bounds. iOS source was not reviewed or modified in this rotation. Relay source was read only.

## Findings

No actionable P0/P1/P2/P3 defect was found in this reviewed scope. No implementation finding remains open from this reviewer.

## Contract checks

| Area | Code and observed behavior |
| --- | --- |
| Fixed-IP trust material | `scripts/create-local-tls.mjs:14` validates canonical IPv4 and a new ignored direct-child output directory; `:24` creates a CA, `:27` assigns only the requested IP SAN to the server leaf, `:30` verifies SSL purpose/IP/chain, and `:33` exports the public root as DER. The documented `VoxCodeCA.der` root plus PEM connector root is compatible with the contract's native private-CA handoff. No generated production CA is claimed or bundled by this review. |
| TLS verification | `relay.mjs:18` and `connector.mjs:53` require TLS 1.2 or later. Connector custom CA use retains `rejectUnauthorized:true`, hostname/IP/expiry validation and `followRedirects:false`. `relay-cli.mjs:9` rejects a remote plaintext listener; connector plaintext is restricted to literal loopback development origins at `connector.mjs:11`. |
| Phone authentication | `protocol.mjs:21` makes only health/pair public. `relay.mjs:41` and `connector.mjs:25` require the phone bearer for settings/tasks/criteria/voice/unpair and reject use of the machine key as that bearer. `connector.mjs:31` forwards the exact phone Authorization value to the one fixed loopback bridge; the bridge retains session authorization. Pairing returns the bridge-issued phone token. |
| JSON errors and retry identity | `relay.mjs:28` and `connector.mjs:20` produce bounded JSON error envelopes. Valid bridge status, content type and body are passed through at `connector.mjs:39` and `relay.mjs:89`, including version-conflict responses. Base64 transport preserves mutation bodies/request IDs without mutation retries or rewritten content. Transport cancellation closes the local HTTP request and does not imply Codex rollback. |
| Settings and task mutations | `protocol.mjs:24` and `:28` allow exact GET/POST settings, follow-up/cancel/accept, approvals and manual criteria paths. Extra segments, arbitrary destinations, encoded paths and non-event queries are rejected. Version/replay/criterion semantics remain Mac-owned; Relay does not acknowledge a mutation itself. |
| Voice | `protocol.mjs:31` permits create/audio/stop/abort/events/delete, while binary audio requires octet-stream. PCM input bytes are forwarded unchanged. Event JSON, including audio frame sequence/draft/focus fields, is transparent to Relay. No voice tool is converted into an implicit task mutation. |
| Capacity and bounds | `protocol.mjs:3` caps in-flight work at 32, media at 8, request bodies at 1 MiB and responses at 2 MiB. Both relay and connector enforce the media cap independently. Cancel/approval/status remain usable under eight held audio requests. Total body/forwarding deadlines and bounded WebSocket buffering prevent unlimited active request growth. Public TCP connections are capped at 128. |
| RELAY-003 shutdown | `relay.mjs:62` now owns raw accepted sockets before TLS completes, destroys sockets arriving during teardown and releases the tracked set before awaiting listener closure at `:110`. The tightened regression waits for the server-side acceptance event and keeps its 500 ms bound. |
| Scope | `/api/monitor`, preview-session, preview files and arbitrary proxy routes are absent from the Relay allowlist. Native JSON evidence remains available through task responses. |

## Verification

Evidence: `local` and `fixture`; macOS arm64, Node 22.23.4. The reviewer independently ran:

```sh
cd /Users/liyan2026mac/Documents/ChatGPT/1024/voxcode/.worktrees/relay/apps/relay
/private/tmp/voxcode-node22-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --test test/*.test.mjs
```

Result: **28 tests passed, 0 failed, 0 cancelled, 0 skipped, exit 0**. This includes actual loopback HTTP/HTTPS/WS/WSS, pairing/bearer/header isolation, exact settings/criteria/voice routes, byte-preserving audio, 409 JSON propagation, CA/IP/expiry rejection, media capacity, stalled body deadlines, connector reconnect/watchdog, CLI public CA paths/helper no-overwrite, and accepted pre-TLS shutdown.

## Remaining gates

- This verifies the Relay/connector fixture chain, not native URLSession trust evaluation. Actual signed native success plus wrong-IP, unknown-CA and expired-chain rejection remains a separate iOS gate.
- The configured real fixed IP and independently reviewed public production CA have not been deployed or tested. Loopback CA fixtures do not establish device or outdoor connectivity.
- Fresh Linux Node 22 CI for `de8fc2d` remains coordinator-owned. Local macOS Node 22 evidence does not substitute for that environment.
- Large evidence above the documented 2 MiB response cap fails explicitly; future artifact delivery needs its own scoped transport. No truncation or artifact/preview proxy is assumed.
- Live Codex/Linx, audible device playback, microphone interruptions and cellular/company-Mac acceptance remain pending and are not Relay code-review findings.

Status: this independent client/protocol review is complete for `de8fc2d`; affected source changes require targeted rereview. Coordinator retains integration, Git, PR and deployment ownership.
