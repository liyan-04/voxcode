# Independent review B — Issue #108

Reviewer: /root/inspect_mcp, independent of implementers. Read-only review on 2026-10-25. Source HEAD a119ac3 plus active browser changes in /private/tmp/voxcode-108-voice-mcp-closure.

## Scope and result

Reviewed voice-tools.mjs, voice-provider.mjs, voice-transport.mjs, control-runtime.mjs, execution-targets.mjs, task-submission.mjs, packages/voice/src/index.js, browser voice-client.mjs, page result handlers, and focused tests. No remaining P0/P1 found in the inspected snapshot. The earlier reviewer A server corrections are effective: mutation dispatch is guarded at each task-submission boundary, post-mutation reads select the retained original requestId turn, unknown stays unknown, and output is byte bounded. Browser now keeps nonterminal work alive through result queries and waits for queued playback after terminal speech.

## P2 observation

An already-admitted voice session rechecks frozen project/task ownership and its original expiresAt, but does not revalidate membership in createHttpServer's sessions map. That map can revoke the oldest login through maxSessions eviction. An evicted HTTP session therefore loses HTTP access but its already-open voice connection can still invoke tools until its original expiry or the five-minute voice limit. This pre-existing upgrade authorization model now protects mutation tools too. Recommended follow-up: supply a live session revalidation callback, check it inside authorizeTool before mutation, and add an admitted-then-revoked-session regression. This is bounded to an already-authorized socket and does not enable an unauthenticated upgrade, cross-owner or cross-target access; classify P2 unless immediate session revocation is a release requirement.

## MCP API and lifecycle

The SDK tools registry schema is {name, description, inputSchema, invoke}; it directly responds on the same authenticated device websocket to initialize, tools/list, tools/call, wrapping actual tool return values in MCP text content. Supplying provider tools is the correct native device MCP path. Global cloud MCP mutations remain disabled. Config promptContext populates hello.agent_params.custom_replace_prompt; it is replacement-variable data, not a generic instruction override. The newly saved formal assistant prompt must independently allow these native tools, as the coordinator verified.

The mutation tool returns actual retained turn output or explicit running/unknown/error status. Querying is bounded and can continue on the same socket; the browser and transport impose a roughly three-minute tail and the full voice session is bounded to five minutes. Tasks outlasting those limits require a later query capture/page inspection, not automatic execution replay. Physical microphone playback remains an independent device gate.

## Commands and results

- node --test apps/server/test/voice-tools.test.mjs apps/server/test/voice-provider.test.mjs apps/server/test/voice-transport.test.mjs apps/server/test/voice-client.test.mjs apps/server/test/voice-composer.test.mjs — 91 passed, 0 failed.
- node --test packages/voice/test/session.test.js apps/server/test/control-runtime.test.mjs — 26 passed, 0 failed.

These are local fixture/integration checks, not real Linx/Codex or physical phone evidence. No live provider calls, cloud changes or deployment actions were performed by this reviewer.

Browser snapshot SHA256: voice-client.mjs 6eedd19d9b46c496900d494f89fbd6d86cf7237372e9037a22eb3685feaf08c8; index.html 14ab4b4e9110db430c6de9fd4b9b06ea9e1e8f0f2346c22bf285a3075499e17c.
Server snapshot SHA256: voice-tools.mjs 778401a9e2e2f685ed56ef8987677e3cc76232ad4d9d39e5f6052025408418b0; provider 4dee625c528d0f4c0a08149d694de0943b87e209e0811fd3e66d9ded31705def; transport a42bc2545816fdbb6a085f099fd6320022afd2361784067c81def7869a6f3b17; runtime ec4f1ee169a8c564b376c0d1f3a193bd7d1cc9b7c0cca96a81a9a063547aa568.

## Prior artifacts, useful but not full-loop acceptance

- /private/tmp/formal-browser-isolated-voice-smoke.mjs: synthetic PCM, direct real Linx device session, explicitly tools:[] and old SDK import. Useful audio sender pattern only; must not be cited as new MCP closure.
- /private/tmp/formal-browser-isolated-voice-private-T17dhE/linx-voice.json: private formal voice configuration source; never publish contents or copy credentials into reports.
- /private/tmp/voxcode-deployed-voice-result.json: prior deployed ASR plus separate draft/confirm test; records noAutomaticTask:true, explicitDraftAndConfirm:true, receivedBytes:0, physicalPhone:false. Does not prove native tools or audible output.
- /private/tmp/voxcode-linx-live-test/codex-mcp-report.json: older independent MCP tools proof; explicitly notes text protocol trigger and unavailable CLI authentication at that time. Not current formal page evidence.
- /private/tmp/voice108-initial.wav and /private/tmp/voice108-followup.wav: coordinator's new synthetic speech artifacts, ready for the new live harness; do not label as human microphone recordings.

## Targeted rereview — final revision 351fb1c

Reviewed commit 351fb1cc435b1c0a419a05a90c4f18d326b0a495 and reran `node --test apps/server/test/voice-transport.test.mjs`: 22 passed, 0 failed. The P2 session-eviction observation above is resolved: transport retains the authenticated upgrade request and authorizeTool calls the live authorizeUpgrade(req) again, requiring the same owner and a live expiry before re-resolving frozen context. The regression explicitly admits a phone capture, revokes its login, and proves tool authorization is false. No unresolved finding remains from this review.

Final transport SHA256: d11df98b4344fb490b8b9968b853fd4447696619c18147bb399c21f909e3f2f3. Other reviewed source hashes remain as recorded above. This closes source review only; real deployed Linx/Codex/phone evidence remains independently required.
