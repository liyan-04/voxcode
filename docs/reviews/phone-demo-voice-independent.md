# Independent voice and Mac runtime implementation review

Reviewer: independent security/platform reviewer, not the voice/tools/audio/runtime implementer. Date: 2026-10-24.

Reviewed revision: **c47ab5330d6738836e55eb6c83890fcac5691155**, verified integration HEAD. `git diff bdd7f29 -- apps/integration packages/voice` was empty: the reviewed voice/runtime source includes the criteria-inheritance fix. Unrelated dirty review documents were excluded and left untouched.

Scope: all six Linx tools, frozen owner/task/version, proposal-only effects, PCM output decode/events/cursors, authorization across asynchronous boundaries, close/expiry/replay retention, and unified Mac startup/shutdown. No implementation or Git changes; only this report was written.

## Findings

**No new actionable P0-P3 findings identified in this scope at the reviewed revision.** The older voice review findings are addressed by the current implementation and the independently executed fixture suite. This is not a live provider, signed-device or outdoor acceptance result.

## Independently inspected boundaries

### Tools and task identity

- `apps/integration/voice-tools.mjs:18-35` applies closed/expiry/current owner authorization before each registered invocation and rejects unknown argument keys at runtime. Required values are checked in each handler rather than trusting advertised JSON Schema alone.
- The six tools are `list_tasks`, `get_task_status`, `get_task_evidence`, `propose_task`, `propose_followup`, `propose_focus` (`voice-tools.mjs:51-71`). None calls service mutation, approval, acceptance, shell or filesystem execution. The three proposal tools only emit a bounded draft/focus suggestion; execution requires the separate explicit phone confirmation path.
- Existing-task reads/follow-ups enforce the frozen task ID and version (`voice-tools.mjs:23-27,36-45`). A new-task session may read authorized project tasks but cannot propose a follow-up to an arbitrary target. Listing metadata is intentionally project-wide. This is one authorized selected project, not per-task multi-user ACLs.
- Draft text/conditions/counts and lifetime are bounded, task/version are server-owned, and follow-up inheritance copies only `{text, required}` (`voice-tools.mjs:8-15,39-47`). Previous criterion IDs, status and evidence do not silently pass a new version. Explicit invalid/null conditions reject.
- `packages/voice/src/index.js:35-65,85-90` gates MCP on validated hello readiness, bounds request IDs/fingerprints/counts and rejects conflicting retry payloads. The ready promise is settled before the consumer callback, fixing the earlier synchronous-close exception. Generic tool errors do not reveal provider exceptions.

### Authorization and lifecycle

- Shared Mac HTTP authentication precedes the handler. `apps/integration/voice.mjs:52` reauthorizes after create-body upload; lines 60-63 and 121-124 reauthorize/check closed state after connection/replay waits. Audio similarly rechecks owner/closed/stopped after body reading (`lines 151-160`). Synchronous read/control paths run after the shared HTTP check; tools independently reauthorize.
- Authorization-change subscription closes affected owner sessions (`voice.mjs:33-39`). Close shuts provider and decoder, clears draft/audio/event payloads and records an independent bounded-lifetime replay tombstone (`lines 25-30`). Closed polling is rejected before events can be returned (`lines 126-135`). Revoked or expired sessions cannot leave tools authorized merely because their callbacks were previously registered.
- Retained requests and session counts are bounded, one physical device has one active recording, input PCM has per-chunk/alignment and aggregate 60-second bounds, and session TTL remains scheduled even after explicit close (`voice.mjs:56,69-73,103-107,151-161`). The original session expiry deletes closed entries; tombstones are pruned on subsequent creates. This fixes the earlier permanent-capacity leak while preserving a finite ten-minute request replay window. Idempotency is not promised after that retained window.
- Handler shutdown unsubscribes authorization listeners, closes sessions/decoders, clears timers and maps (`voice.mjs:166-170`). Audio abort stops provider output and its decoder, without cancelling a coding task (`lines 140-145`). It also ends this voice input session; callers should not continue uploading to an aborted session.

### Audio and events

- `packages/voice/src/audio.js:3-18` accepts only mono 16/24 kHz PCM/Opus, bounds packet/output duration to 120 ms, copies raw PCM, and deletes the pinned Opus codec once on close. The local codec test encodes actual synthetic Opus packets and verifies nonzero signed PCM of the expected length; it does not establish compatibility with live Linx framing or audible iOS output.
- Negotiated decoder metadata is exposed as PCM only after successful setup (`voice.mjs:77-88`). Invalid decode closes the voice session through a generic error. Wire Opus is not relabelled as playable PCM without decoding.
- Events have monotonic per-session sequence IDs, bounded text/state/payload retention, a 256-event/1 MiB history, owner binding and an explicit `409 cursor_expired` on an evicted gap (`voice.mjs:90-100,126-135`). TTS abort metadata is retained. Aborted/closed sessions cannot append further audio; old draft/audio data is cleared on close.

### Unified runtime

- `apps/integration/runtime.mjs:5-10` validates the local port and rejects partial remote configuration. It binds the bridge to loopback, constructs an outbound connector pointing only at that actual bridge port, and passes explicit CA material into the connector (`lines 18-29`). It does not expose App Server directly.
- Shutdown is idempotent and sequences connector, voice handler and app close; startup failures in the guarded phase invoke the same cleanup (`runtime.mjs:13-16,30`). Tests verify actual local HTTP/WebSocket start/stop and no surviving listener after invalid connector setup.
- CLI (`apps/integration/cli.mjs:5-23`) rejects partial Linx configuration, uses server-side environment references and only logs status/local pairing instructions. No private credential file or live environment value was opened in this review. TLS deployment and process supervision remain operational gates outside these fixture checks.

## Verification actually executed

```text
node --test packages/voice/test/*.test.js apps/integration/test/*.test.mjs
26 passed, 0 failed, 0 skipped/cancelled; exit 0
```

Execution was local macOS/Node v26 using controlled provider/socket fixtures and loopback HTTP/WebSocket. The suite independently exercised partial-body revocation with the production Mac service/server; six tool registration and frozen proposals; criteria inheritance/edits; owner/closed/revoked access; expiry/tombstone/capacity; PCM/TTS/cursor behavior; actual Opus encode/decode; handshake/cleanup/deduplication; and runtime start/stop/configuration failure.

Reviewed the earlier `phone-demo-voice-execution.md` and `phone-demo-voice-followup.md` as history, then inspected source/tests independently. Their old P1 create-revocation race and P2 post-close payload/capacity defects are not open in this revision. Previous optional-tool safety limits do not imply automatic cancellation/rollback; the current integrated registry contains only synchronous reads/proposals.

No live Linx onboarding/authentication/STT/tool negotiation, real provider audio, native microphone/playback, signed iPhone or cellular/company-network path was executed. The separately reported real Codex smoke was not rerun for this review. Passing these 26 checks closes only the reviewed local fixture boundary, not the end-to-end demonstration gates.
