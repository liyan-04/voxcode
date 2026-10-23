# Phone-demo voice and execution integration review

Date: 2026-10-23. Reviewer: `/root/mac_v1`, independent of the coordinator's voice/integration/runtime/benchmark implementation. This review changes only this report; it does not approve the reviewer's own Mac implementation.

Base: `cd81e20a4925deb7ddaab2b1d37391939166d258` (`codex/phone-demo`), with the uncommitted working-tree snapshot recorded below. Findings and line numbers refer to that snapshot. Later implementation changes require targeted follow-up.

## Findings

### P1: Revoking a phone during a slow create request still starts its provider session

Location: `apps/integration/voice.mjs:47`, `apps/integration/voice.mjs:98`, `apps/integration/voice.mjs:108`.

The Mac HTTP server authorizes the request before entering the handler (`apps/mac/server.mjs:44`), then voice creation awaits the request body. Revocation during that await runs the subscription, but there is no session entry yet for it to close. After the body arrives, creation never reauthorizes the owner and starts a Linx session using the Mac's configured identity.

Reproduced against the actual `createServer` and `createService`, using a controlled provider: send a valid bearer and a partial JSON create body, wait until the handler subscribes, call `service.revoke(token)`, then finish the body. Observed:

```json
{"scenario":"real-http-revoke-during-create","status":200,"providerSessions":1,"providerClosedBeforeCleanup":0}
```

The revoked phone can consume the configured provider identity and keep the global single-recording gate occupied until TTL expiry, preventing another paired phone from recording. The tool guard still rejects revoked authorization; this reproduction did not demonstrate task mutation or task-data access after revocation.

Minimum fix: reauthorize the frozen owner immediately after reading/parsing the create body, before replay handling or entry allocation. Keep the existing authorization-change subscription for revocation while connection establishment is pending. Add a regression with the request-body/revoke interleaving through the authenticated HTTP server.

Status: open in reviewed snapshot.

### P2: Closing a session leaves its old draft and PCM payloads available through polling

Location: `apps/integration/voice.mjs:25`, `apps/integration/voice.mjs:122`.

`close(entry)` clears the draft map and decoder but retains the event array, which contains cloned drafts and base64 PCM. The events branch executes before the `entry.closed` check, so an authenticated owner can still poll these payloads after DELETE. This conflicts with `docs/contract.md:56`, which says closing expires associated tools, drafts and audio.

A read-only handler fixture created a draft and an audio frame, closed the session, then fetched events with `after=0`. Observed:

```json
{"afterClose":{"status":200,"eventTypes":["ready","draft","audio"]}}
```

Retention is bounded and another owner still receives 404; this is a lifecycle/contract defect, not a demonstrated cross-owner disclosure. Minimum fix: remove draft/audio payloads when closing, or reject closed-session polling while preserving an explicit terminal-state/error mechanism and coherent cursor behavior. Add a regression that no closed-session event response contains draft or PCM data.

Status: open in reviewed snapshot.

## Checks and evidence

Environment: local macOS, Node `v26.0.0`. All provider sessions in this review were controlled fixtures; no Linx credentials, recordings or cloud sessions were used.

Commands actually run:

```sh
node --test packages/voice/test/*.test.js apps/integration/test/*.test.mjs
# 22 passed, 0 failed, 0 skipped/cancelled

node scripts/benchmark.mjs --output /private/tmp/voxcode-voice-review-benchmark.json
# exit 0; local-fixture report

git diff --check -- packages/voice apps/integration scripts/benchmark.mjs scripts/smoke-real-codex.mjs docs/contract.md
# exit 0
```

The benchmark exercised 24 managed tasks, maximum four active controlled executions, 23 completed tasks and one confirmed cancellation. It checked the fifth task queued, stopping retained a slot, and replay did not execute another turn. API measurements recorded 24 create samples, 60 list samples and 60 status samples with zero unexpected responses. This measures loopback bridge/scheduler overhead with temporary directories and a gated executor; it does not measure Git worktree setup, real Codex concurrency, Linx, TLS, native UI or cellular latency.

Additional inline, source-preserving probes reproduced the two findings. An initial combined probe reproduced the revoke race, then its second fixture used string stream chunks instead of buffers and failed with 400; that fixture construction was corrected and the close/event result above was reproduced. No implementation or test file was changed.

Source checks found the following intended boundaries present:

- Registered tools are restricted to task reads, draft proposals and focus suggestions; none calls task mutation, operation approval or acceptance.
- Tool invocation checks session lifetime and current authorization. Target-specific tools enforce the frozen task/version. Draft criteria/text have runtime validation and bounded sizes.
- MCP request IDs are bounded, deduplicated and reject conflicting payloads. Tools do not execute before a validated hello.
- Negotiated Opus is decoded with pinned `opusscript`; PCM copies, frame alignment/size bounds, decoder cleanup, ordered event sequence numbers and cursor-gap errors are covered.
- Abort suppresses subsequent provider audio and closes its decoder. Historical audio remains in the log, but the inspected native `PCMPlayer.stop()` suppresses later enqueueing in that playback epoch; no separate audible-replay finding is asserted here.
- Runtime binds the bridge to loopback, validates partial relay configuration and closes app/connector resources in its tested startup/shutdown paths. Error messages from the voice adapter and tools are generic and do not forward provider exception details.
- The benchmark labels its dependencies and limitations, and the smoke script verifies real filesystem results on both turns and checks continuity of the owned thread ID.

No additional P0/P1 was identified in the inspected adapter, tools, audio decoder, runtime, CLI or benchmark code. The two open findings above mean this snapshot is not a clean review pass.

## Unverified gates

The coordinator separately reported a successful `live-local` run of `node scripts/smoke-real-codex.mjs`: two real turns, verified file contents and the same owned thread. This reviewer inspected that script but did not rerun the live probe or independently observe its provider execution.

Real Linx onboarding/STT/tool negotiation/draft/audio, audible native playback, signed iPhone execution, four real parallel Codex tasks, and outdoor cellular/company-Mac operation were not verified here. The 22 fixture/local checks and benchmark cannot establish those gates. Deployment, Git mutation, component source modification and Mac implementation review were outside this assignment.

## Reviewed SHA-256 snapshot

```text
25dc26a99e42bbcc9b0622461cf9501608716e66a8a6f50bad7c076aff959837  packages/voice/src/index.js
9637a17cc8235d1a51bb9891383ed284ab16d0b900a2667d7e4534e1db00524b  packages/voice/src/audio.js
a6c01293b57618a59a5726038d386401d2714e3c5b0c62e0a538169a3f382696  packages/voice/test/audio.test.js
139bb090498e8d4c04efee21330b0d0134ddb8d19024c6275948c844356f38dc  packages/voice/test/session.test.js
5ec3ee2a9bbac67cfff44197cbf7a65ecdf73e5c9194f784c6f37af7ed14b647  packages/voice/package.json
cc3b60a060e1e01fc640090238f3e51e4ed493dbf4e306ee189f9f623f72e5ca  packages/voice/package-lock.json
96fdd56edc16cd3c3fa4db8536cd25de20ecebd6fa703d9cdb3901935a1854c4  apps/integration/voice.mjs
1ed356eed676a726382ebff9be46c087234f3227a71ab2d4db2b74c4c675f077  apps/integration/voice-tools.mjs
defe6e6e350fb58be827208a406ac092d2fa32e8c6d3d336c39cacde799aa8bb  apps/integration/runtime.mjs
7ce07fa40ee2af48e0221ebd619392fbcb96d159faadb181f116b2c844a433f0  apps/integration/cli.mjs
26781a24b003d27ee2e1545e0771ce752b1238a79cbd21fbce1276970a4821d9  apps/integration/test/runtime.test.mjs
53734d4fcefdc7bbf22da82837e28efb7b38152896fea1e51e4551bdef10fbae  apps/integration/test/voice-v1.test.mjs
0edd1678fdc782bb86128ad8c43f708eaa7663a85e05b220ad3e4682492102db  apps/integration/test/voice.test.mjs
1fe2b97a0d6678c6f97315d7079e15cb95f282a57806c21d85c82ee9909da3cd  scripts/benchmark.mjs
49693f026391572b9d4fe1f5e4a3c7f1d9e336f6d2bd64dffb69a0d5335f1957  scripts/smoke-real-codex.mjs
5a3c8b6ca7ded51ac712b111905e7e0c926ffa01dea3967d23950486660d77c3  docs/contract.md
```
