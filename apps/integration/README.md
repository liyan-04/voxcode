# Mac runtime and voice integration

Run from the repository root after installing locked root, `packages/voice` and
`apps/relay` dependencies. `VOXCODE_PROJECT` selects an authorized Git checkout;
`npm start` starts the bridge on loopback port 8787 and prints a short-lived pairing
code. `VOXCODE_DATA` can select a separate private state directory.

To enable the outbound connector, configure all of `VOXCODE_RELAY_URL` (WSS),
`VOXCODE_MACHINE_ID`, `VOXCODE_MACHINE_KEY` and, for the private CA,
`VOXCODE_TLS_CA` (public PEM file path). The bridge remains on loopback; the
runtime closes both bridge and connector together. See `apps/relay/README.md`.

Real voice additionally requires all three supported device onboarding values:
`LINX_TOKEN`, `LINX_DEVICE_ID`, `LINX_CLIENT_ID`. `LINX_WS_URL` optionally overrides
the documented WSS endpoint. Keep credentials on the Mac; never include them in
the phone, repository or logs. Without voice configuration the task bridge still
works and voice endpoints explicitly report unavailable.

The authenticated voice service freezes the recording target/version, supplies
documented prompt context, registers read-only state/evidence and draft/focus tools,
and returns bounded decoded PCM with ordered events. The phone edits and confirms
a draft before any task dispatch. Abort stops speech output, not Codex execution.
Closed or revoked sessions cannot return retained audio/drafts or invoke tools.

## Verification

`node --test packages/voice/test/*.test.js apps/integration/test/*.test.mjs` checks
the adapter, actual Opus decoding, scoped tools, lifecycle/authorization and unified
loopback runtime with controlled dependencies. `node scripts/benchmark.mjs --output
coverage/benchmark.json` checks 24 managed tasks, four slots, replay, cancellation
and API timing using a gated fixture executor. It does not measure real model,
voice, TLS, native UI or outdoor latency.

`node scripts/smoke-real-codex.mjs` separately creates a temporary Git project,
runs two real model turns, verifies both file contents and the persisted owned
thread, and cleans up. It requires an available authenticated local Codex runtime.
Real Linx, signing and outdoor acceptance remain separate gates; deployment is
deferred.
