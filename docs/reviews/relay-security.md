# Relay security and integrated voice review

Reviewer: independent security/correctness reviewer 1. Date: 2026-10-23.
Scope: `apps/relay` and authenticated `apps/integration/voice.mjs`. No implementation edits; fixture tests only, no live deployment.

## Findings

1. **P1 — The outbound connector cannot detect a silent network blackhole.** `apps/relay/connector.mjs:50-65` configures a handshake timeout and reconnects only on `close`; it has no post-open ping/pong or receive-idle watchdog. The relay has a server-side heartbeat (`apps/relay/relay.mjs:88`), but a termination frame/TCP close need not reach a Mac across a blackholed connection. The Mac can remain locally OPEN, never reconnect, and leave remote operation unavailable after sleep/network changes until the process is restarted or the OS eventually detects failure. Add a connector-side bounded heartbeat deadline that terminates the stale socket and enters existing reconnect logic; clear timers on close/shutdown. Test silent loss without a close event, plus recovery and shutdown. This finding is established by lifecycle inspection; no real network partition test was executed.

2. **P2 — Expiry forgets recording idempotency and permits replay as a new recording.** `apps/integration/voice.mjs:65-69` deletes both the expired session and its request-ID record. An old POST replay then passes the cache check at lines 41-46 and starts a fresh provider session. Reproduction with `ttlMs:30`: identical owner/requestId/target returned 200 twice, different session IDs and two provider connects, rather than an expired-request conflict. Preserve a bounded tombstone long enough for the documented retry window; expired recording IDs should require a new recording request ID. This is a recording lifecycle bug, not duplicate coding-task execution: model tools are explicitly empty.

3. **P2 — Retained closed voice sessions have no count/byte cap.** `apps/integration/voice.mjs:20-24,53-69,91` retains closed entries, session objects and event buffers until the original TTL. The one-active-session check at line 52 does not count closed sessions. A rapid create/delete or failed-provider retry loop can retain an unbounded number during that window; each session can retain 256 events with up to 32000 text characters (`lines 57-61`). Add a total retained-entry/byte limit, release heavy session/event resources promptly, and keep only bounded replay tombstones. Existing owner checks prevent cross-owner reads but do not supply resource bounds. Bound single-event state fields as well if arbitrary provider state is retained.

## Relay authentication and confinement checks

- The connector requires a configured machine ID and high-entropy-format key. WebSocket upgrade verifies both, compares the key in constant time after byte-length validation, and rejects a second connector rather than replacing it (`relay.mjs:54-62`). A public phone request cannot establish a machine connection using its phone token.
- Protected HTTP routes require a syntactically valid phone bearer token; validity is deliberately enforced again by the Mac bridge. The machine key is explicitly rejected as a phone token. Do not describe relay syntax validation as independent phone authorization. This design is appropriate while the relay host is trusted and the bridge checks every protected request.
- The connector independently repeats the exact route/method/query/content-type allowlist (`connector.mjs:20-31`). IDs exclude dots, encoded separators and traversal characters (`protocol.mjs:14-33`); destinations are fixed to a loopback HTTP origin. The path cannot supply an alternate host or arbitrary local URL. No SSRF or general proxy route was identified.
- Only Authorization and allowed Content-Type reach the fixed bridge; machine credentials are used only in WSS handshake headers. Redirects are disabled. Status logs avoid tokens and payloads. A trusted TLS reverse proxy remains a deployment requirement; the relay itself serves HTTP and its host setting can expose it if misconfigured.
- Response request IDs are random and bound to the active connector. Unsolicited responses terminate the socket; late/duplicate IDs cannot complete another request. Pending HTTP requests fail on disconnect, and reconnect does not replay mutations.
- Request/response/frame sizes, 32 in-flight requests, 128 TCP connections, request/header deadlines and pairing/health rates are present. Connector request deadlines cover response-body reads. Limits are adequate MVP safeguards, though invalid syntactic phone tokens still consume a bounded round trip to the Mac for rejection.
- Preview is not implemented or tunneled. The allowlist does not expose project files, arbitrary ports or App Server. Live mobile-accessible preview remains a separate acceptance gate.

## Integrated voice authorization checks

- Shared Mac HTTP authorization precedes the voice handler. Entry ownership uses the authenticated session identity (`voice.mjs:26,39,53,84-85`); another phone cannot read, stop, delete or upload to a known session ID.
- New recordings validate the explicit target task version and bind owner/requestId/fingerprint; duplicate active requests share the ready promise. No implicit current-task lookup or model-selected task mutation occurs.
- `sessionFactory` receives `tools: []` (`voice.mjs:72`), so optional model tool weaknesses do not grant coding operations here. Only selected STT/TTS/status fields are retained; binary output and MCP payloads are discarded.
- PCM size/alignment, 60-second aggregate upload budget, one active device session and two-minute expiry are implemented. Stop and delete are idempotent within retained lifetime. Final task submission must still retain the phone's frozen task/version/requestId; this handler does not submit tasks itself.
- Expiry currently removes the session immediately after emitting its error, so later polling receives 404 rather than the expiry explanation. Clients should treat missing/expired sessions as terminal, and any UX adjustment should preserve bounded storage.

## Verification

- `npm test` in `apps/relay`: **11 passed, 0 failed**; actual local HTTP/WebSocket fixture round trips.
- `node --test apps/integration/test/*.test.mjs`: **3 passed, 0 failed**.
- Read-only inline HTTP reproduction: identical voice recording request after TTL created a second session (200, new ID, two provider connects).
- Base64 decoder accepted valid 32000, 128000, 256000, 1048576 and 2097152-byte payloads without an exception.
- No live trusted TLS deployment, outdoor iPhone, company-network partition, real Linx authentication/STT or task preview was verified.

Verdict: no authentication bypass, machine spoofing or forwarding SSRF found in this scope. Fix connector liveness detection before claiming reliable remote operation; fix voice expiry replay and retained-session bounds before sustained use. Existing unit/local integration success is not live deployment evidence.
