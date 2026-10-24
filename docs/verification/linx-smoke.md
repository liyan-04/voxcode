# Linx HTTP smoke client (Issue #43)

Current transport boundary: this is a server-local diagnostic client. It does not verify the required native phone↔server duplex WSS channel (Issue62); the currently merged phone still uses HTTP audio/events pending that implementation.

This client fills the engineering smoke-client gap in [the Linx onboarding guide](linx-readiness-2026-10-24.md). It uses the existing authenticated server Bridge voice HTTP routes. It does not onboard a device, capture a microphone, play audio, submit Codex tasks, approve operations, accept results, or prove the complete phone demonstration.

## Operator prerequisites

- Node >=22 and an already running server integration bridge with authorized Linx configuration. Use a dedicated synthetic test agent/project; voice tools can read the paired project's existing task state. The operator must authorize this session before invoking the command.
- Obtain the bridge's existing pairing bearer through the authorized local pairing flow. Store it as `VOXCODE_SESSION_TOKEN` in the process environment or a private environment file with mode 600. Do not paste a bearer into chat, an Issue, a shell argument or a report. The client never reads the Linx device credentials and does not create pairing sessions itself.
- Set `VOXCODE_BRIDGE_URL=http://127.0.0.1:8787` if needed (this is the default). Only literal `127.0.0.1` or `[::1]` HTTP origins are accepted. DNS names, redirects, credentials in URLs, query strings and remote origins are rejected. This client is for the server loopback bridge; Relay/TLS and phone duplex WSS (Issue62) testing are separate gates.
- Supply an existing **synthetic** raw PCM file: signed 16-bit little-endian, 16 kHz, mono, no WAV header, nonempty, even byte length, at most 1,920,000 bytes (60 seconds). A non-secret synthetic spoken request for a new task draft is useful; silence cannot establish STT/draft readiness. The file must be regular and must not be a symlink or FIFO. `--synthetic` attests both content and format: raw bytes do not self-describe the actual sample rate, channels or synthetic provenance.

For example, place only the bridge origin and existing paired bearer in a private operator-created environment file outside version control, then run:

```sh
node --env-file=/absolute/private/smoke.env scripts/smoke-linx.mjs \
  --input /absolute/private/synthetic-request.pcm --synthetic
```

The paths above are placeholders. Do not commit the private env file or PCM. Loading a Node env file is explicit operator action; the script does not discover credentials or search private paths. `node scripts/smoke-linx.mjs --help` and module import do not read input, open a recording or make HTTP requests.

## Behavior and bounded cleanup

The client reads `/api/health`, then creates exactly one frozen `{taskId:null,version:null}` voice recording with a random requestId. `voiceConfigured` means configuration presence only. It uploads 3,200-byte PCM blocks (100 ms) with 100 ms pacing, sends stop, and polls the voice events endpoint with the returned sequence cursor. It never calls a task endpoint or confirms a returned draft.

Defaults are a 90-second work deadline, a 10-second request timeout, 180 polls at 500 ms intervals, and a 2-second timeout for each cleanup request. CLI overrides are `--deadline-ms` (1–120000), `--request-timeout-ms` (1–15000), and `--max-polls` (1–600). The work deadline includes HTTP, upload pacing and polling after the bounded regular-file read. Responses are capped at 2 MiB, event batches at 256 entries, input at 60 seconds, and sequence order/gaps are validated. No automatic retry follows 401 or 429; reduce invocation rate and wait for the bridge/provider retention or rate limit before another operator attempt.

Success, failure, SIGINT and SIGTERM all lead to bounded abort followed by DELETE, using cleanup requests independent of the cancelled work signal. A failed abort does not prevent DELETE. If a create response is lost, times out or is invalid, the same requestId/body is replayed once solely to recover a session identifier for cleanup; no audio is uploaded after that recovery. Cleanup may therefore add up to three request timeouts (reconcile, abort, DELETE) beyond the work deadline. Unknown session identity or failed cleanup is explicitly reported; the server's configured voice-session TTL remains the fallback. The script cannot guarantee cleanup after SIGKILL, process crash, network loss or permission revocation.

## Interpreting the redacted report

The command emits one fixed-schema JSON report and exits 0 only after ready, nonempty STT, a valid new-task draft and valid PCM audio have been observed and abort/DELETE are confirmed. Otherwise it exits 1. Reports contain only fixed categories, booleans and event counts. They never include bearer values, transcripts, audio, prompts, raw errors/responses, private paths or target/session IDs. Errors use categories such as `unauthorized`, `rate_limited`, `service_unavailable`, `provider_error`, `timeout`, `poll_limit`, `invalid_response` and `cleanup_failed`.

| Report field | What it establishes | What remains open |
| --- | --- | --- |
| `readiness.voiceConfigured` | Bridge configuration presence | Linx authorization or successful conversation |
| `stages.handshake:observed` | Supported output metadata plus a ready event through HTTP | Independent attestation of the bridge's actual provider |
| `stages.stt:observed` | A nonempty STT text payload was received | Human correctness check of the synthetic request |
| `stages.draft:observed` | A structurally valid, unexpired null-target draft was received | Draft content quality or execution; this client never submits it |
| `stages.audio:observed` | Nonempty, valid base64 even-length PCM within the bridge's 120 ms decoded-frame limit at the negotiated 16/24 kHz rate was received | Audible speech, semantic quality or iPhone playback |
| `stages.tools:manual_required` | No full L3 claim is made | MCP negotiation, tool selection, actual-state comparison and A-to-B frozen-target behavior |
| `observed.draft` / `observed.focus` | Visible draft/focus event counts | Complete read-tool execution traces; the HTTP API does not expose those traces |

`evidence:local_http` and `provider:not_independently_verified` are intentional. A controlled server can emit the same response schema, so a successful report alone cannot certify real Linx. A future authorized live record must name the actual bridge/provider environment and revision separately, while retaining only the redacted report. Full L3, device playback, signed installation and outdoor server/VPN transport remain distinct manual/live/device/outdoor acceptance gates.

## Verification evidence

Source base: `origin/master` at `d47cc0c`; local Node v26.0.0, macOS arm64. No actual Linx/cloud requests, credentials, recordings or Codex turns were used for implementation verification.

```sh
node --test scripts/test/linx-smoke.test.mjs
node --check scripts/lib/linx-smoke.mjs
node --check scripts/smoke-linx.mjs
git diff --check
```

The controlled loopback HTTP suite covers the happy route/target/chunk flow, 401/429 without retries, provider errors, closed sessions, missing observations, poll bounds, deadline/interrupt cleanup, uncertain create reconciliation, invalid/oversized/nonregular inputs, redirects, response size/stall bounds, malformed events/drafts/audio/cursors, cleanup failure, and help/import/no-leak behavior. Independent-review regressions reject array/object/scalar event types before property lookup and enforce the decoded PCM 120 ms frame bound at both supported output rates. The array-type and oversized-frame fixtures were each observed failing before their fixes. Fixture success does not prove live Linx success. See the implementer handoff for the fresh command totals and final content hashes used for review.

The fixture suite deliberately uses synthetic private markers in error bodies, transcripts, drafts, audio and IDs and asserts that returned/CLI reports omit them. It does not assert the absence of secrets from Node's pre-script environment-file diagnostics; operators must keep their env-file invocation and paths private.
