# Issue #108: authenticated browser voice MCP closure

## Design and ownership

The coordinator owns the session tools, provider, transport and runtime. A separate browser implementer owns the client lifecycle and page feedback. Two reviewers inspect the integrated snapshot independently. Base: `fe0d921`.

The authenticated `/ws/voice` capture creates its own Linx device socket and bounded tool registry. The server injects execution target, owner, device, project and selected task; the model can supply only the instruction. Target membership and capture lifetime are rechecked at each mutation boundary. The existing direct submission service preserves CLI approval policy, revision checks and durable request deduplication. Global cloud MCP mutations remain disabled because that transport has no authenticated capture correlation.

One capture admits one mutation identity. Repeated identical calls share its receipt; changed instructions conflict. Unknown outcomes retain the original identity and operation ID and never replay automatically. Result lookup matches the submitted turn's request ID, preventing a previous or later turn from masquerading as this capture's result.

The browser retains the voice socket and output AudioContext through MCP execution, actual result and Linx TTS. Transcription in MCP mode is a visible transcript, never a second submission or composer draft. Recording stop releases microphone tracks but keeps output playback. Voice abort/disconnect closes only voice; it does not roll back or cancel admitted Codex work. A capture has a bounded 180-second result window; longer tasks remain queryable in the task page.

## Implementation and validation plan

- Add failing regressions for bound execution, continuation, replay, unknown outcomes, revoked captures and result correlation; implement `voice-tools.mjs` through the existing task submission service.
- Inject tools into `voice-provider.mjs`; preserve empty-tool ASR fallback. Forward readiness and bounded result events through `voice-transport.mjs`, and construct tools from the frozen execution target in `control-runtime.mjs`.
- Extend `public/voice-client.mjs` and the page to wait for real results and play PCM, preserving fallback transcription. Verify no STT double submission, cross-target navigation or audio resource leak.
- Run focused tests, full Node tests, coverage and browser fixture. Resolve both independent reviews before integration.
- Merge a reviewed PR to master. Stage a pinned gateway-only release on the authorized vm6 service with strict TLS, listener ownership check, private-config preservation and rollback. Do not restart the Mac agent.
- Verify synthetic speech through the formal HTTPS/WSS entry, real Linx device MCP, paired Mac CLI action, same-session continuation and returned TTS/PCM. Independently inspect the resulting file/check evidence.

## Evidence boundaries

Fixture tests exercise authorization and lifecycle but do not establish live provider or CLI success. Synthetic speech through the deployed endpoint proves the service route; it does not prove a person's phone microphone or audible speaker output. Desktop Codex chat synchronization is outside this CLI execution delivery. Live and human acceptance results will be appended after they occur.
