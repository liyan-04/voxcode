# Independent voice security review

Reviewer: security/correctness reviewer 2, independently inspected implementation and tests. Date: 2026-10-23.
Scope: `packages/voice`; no implementation changes and no live cloud credentials used.

## Findings

1. **P2 — Optional tool calls can execute before the validated handshake.** `packages/voice/src/index.js:77` dispatches MCP messages regardless of connection state; lines 40-45 invoke registered callbacks before the hello checks at lines 72-76 establish readiness. An injected server `tools/call` before hello invoked the callback once while `connect()` was unresolved. Gate actual tool execution on ready state; if negotiation before hello is required, allow only negotiation. This independently confirms the platform review. It is not a current model-triggered task-mutation blocker: the registry defaults to empty, and the documented MVP must keep it empty.

2. **P2 — Closing inside the ready callback throws from the transport listener.** At `packages/voice/src/index.js:76`, `emit(ready)` runs before `resolveConnect()`. A consumer can synchronously call `close()`, which clears that resolver at line 26. Returning to line 76 throws `resolveConnect is not a function` outside the callback protection. Reproduced with the injected transport. Settle/capture connection completion before calling consumer code, and test synchronous close from ready. This can crash an integrated bridge if the listener exception is unhandled; current bridge reachability depends on its lifecycle callback, which was not reviewed here.

## Security checks that passed inspection

- Credentials are sent only in WSS handshake headers (`index.js:6-9,62`); URL userinfo/query/fragment and invalid header whitespace/control characters are rejected. Redirect following is disabled. No code logs tokens. Transport and provider errors use generic messages. Configuration is operator-controlled: WSS validation is not a hostname allowlist, so callers must not accept endpoint/token configuration from an untrusted phone request.
- Audio/listen operations require ready state; binary inbound audio is ignored before ready (`index.js:69,87-90`). Input PCM sample alignment/chunk limits, a 1 MiB inbound frame cap and outbound buffering checks are present. No encoded audio is misrepresented as decoded PCM.
- The handshake has a configurable 1-60000 ms deadline. Closing rejects pending connect, clears the handshake timer and requests transport close (`index.js:23-28,60`). This is not an unlimited handshake.
- No shell/filesystem tool exists by default. Unknown tools reject; tool exceptions produce generic errors; request IDs are deduplicated within a session and capped at 256. Explicit submission and task authorization must remain in the bridge, outside model output.

## Optional extensions and integration gates, not new MVP blockers

- Registered callbacks receive only shallow object validation (`index.js:43-45`), not JSON Schema enforcement. README explicitly assigns schema validation, authorization and frozen task binding to the callback. Any future mutation registration must implement these checks and bridge-level idempotency before being enabled. Do not interpret a displayed `inputSchema` as enforced validation.
- In-flight optional tool callbacks have no execution deadline or abort signal; transport close does not stop them (`index.js:45,51-52`). An inline reproduction confirmed a callback completed after close. This is documented and has no current effect with empty tools. Future mutating callbacks need independent lifetime/authorization checks and cancellation semantics; do not claim socket closure cancels a task.
- The adapter has no maximum ready-session lifetime/idle deadline. The bridge must bound live session count, lifetime and retained audio/event bytes. WebSocket close is requested rather than synchronously guaranteeing socket teardown; this is normal but should be accounted for in server cleanup limits.
- Deduplication is keyed only by RPC ID (`index.js:33-50`), so a reused ID with different arguments receives the earlier response. This avoids a second invocation but does not detect conflicting payloads. Reject conflicting IDs if optional state-changing tools are introduced; preserve cross-session request IDs at the bridge.
- Live device registration/authentication, STT, stopped-session final transcript delivery, provider reconnect behavior and Opus playback remain unverified. Six transport-fixture tests do not establish live platform readiness.

## Verification

- `npm test` in `packages/voice`: **6 passed, 0 failed**.
- Read-only inline Node reproductions: pre-hello tool calls = 1; synchronous ready-close throws `resolveConnect is not a function`; an optional callback can complete after close.
- No credentials or audio were sent to a live endpoint; no implementation files changed.

Verdict: no P0/P1 identified for the default empty-tools adapter. Fix the ready-close lifecycle defect and gate optional tools on hello readiness. Keep task mutations out of model tools for the MVP and complete real-device voice verification before claiming integration readiness.
