# Voice authorization and close follow-up

Date: 2026-10-23. Reviewer: `/root/mac_v1`, independent of the coordinator's voice implementation. This report is the reviewer's only authored file for this follow-up. Implementation/test files and Git remain unchanged by the reviewer.

Reviewed location: the integration worktree, HEAD `1df3f123a4b98a9f873fbed58932a81d3e28b4e6` plus the dirty source snapshot below. This is a targeted follow-up to `phone-demo-voice-execution.md`, not a new review of the reviewer's Mac implementation.

## Finding

### P2: Closing cancels the only cleanup timer and permanently consumes session capacity

Location: `apps/integration/voice.mjs:29`, `apps/integration/voice.mjs:69`, `apps/integration/voice.mjs:103`.

The new close cleanup calls `clearTimeout(entry.timer)` but leaves the closed entry in `sessions`. The cancelled timer contains the only per-entry `sessions.delete(entry.id)` call. Request tombstones are pruned after their retention window, but the session map is never pruned elsewhere. With the default limit, 32 manually closed, revoked or failed sessions eventually prevent all subsequent recordings until process restart; the advertised retry after the retention window cannot succeed.

Reproduced without source changes using a controlled provider, `ttlMs:15`, `maxEntries:1`: create a recording, DELETE it, wait 30 ms beyond its original TTL, advance the fixture clock 600001 ms beyond the replay tombstone window, then create a different request ID. Result:

```json
{"scenario":"closed-session-after-ttl-and-replay-window","status":429,"message":"Recording history is full; retry after the retention window","providers":1}
```

Minimum fix: preserve the original expiry cleanup, or explicitly retire closed session entries while retaining the independent bounded replay tombstone and the intended DELETE replay semantics. Add a regression that new recordings become possible after both session and tombstone retention expire.

Status: reproduced in the initial follow-up snapshot, then resolved by the coordinator and independently rechecked below.

## Original findings

- Original P1, revoke during slow create: resolved in the reviewed source. The handler reauthorizes the owner after consuming the create body (`voice.mjs:52`), before replay or allocation. The new actual HTTP regression uses the production Mac service/server, revokes while the partial body is pending and verifies 401 with zero provider creations.
- Original P2, old draft/PCM polling after close: resolved in the reviewed source. Close clears event payloads and draft/decoder state (`voice.mjs:28`); the closed check now precedes event polling (`voice.mjs:129`). The new regression verifies polling receives 409 and later tools reject access.
- Additional continuation checks reauthorize owner and recheck closed/stopped state after waiting for replay/readiness/audio reads. The original task mutation boundary remains outside voice tools.

The two requested original defects were addressed in the initial follow-up snapshot. Its new capacity regression was subsequently fixed and independently rechecked below.

## Actual verification

Local macOS, Node `v26.0.0`, controlled providers only:

```sh
node --test packages/voice/test/*.test.js apps/integration/test/*.test.mjs
# 24 passed, 0 failed, 0 skipped/cancelled; exit 0
```

The additional close/retention probe above returned 429 as reported. Its clock advance is a local fixture technique, not live elapsed-time evidence. No Linx credentials/audio or cloud provider was used. Native/device/outdoor gates remain unverified; the coordinator's separately reported real Codex smoke was not rerun for this focused follow-up.

## Reviewed SHA-256 snapshot

```text
1ec291d76542bf9e70874af8cfcf34f3510fe92fc0ac4eb564f3b86b48cd8fa6  apps/integration/voice.mjs
95ee216868f069874c47a287b5af5c88675e15f4a092b8862ff0b37952a81646  apps/integration/test/voice-authorization.test.mjs
ead99c169660c61107216748b40e426420a4ea40e75ee7799f70b988cc399f32  apps/integration/test/voice-v1.test.mjs
0edd1678fdc782bb86128ad8c43f708eaa7663a85e05b220ad3e4682492102db  apps/integration/test/voice.test.mjs
25dc26a99e42bbcc9b0622461cf9501608716e66a8a6f50bad7c076aff959837  packages/voice/src/index.js
9637a17cc8235d1a51bb9891383ed284ab16d0b900a2667d7e4534e1db00524b  packages/voice/src/audio.js
1ed356eed676a726382ebff9be46c087234f3227a71ab2d4db2b74c4c675f077  apps/integration/voice-tools.mjs
defe6e6e350fb58be827208a406ac092d2fa32e8c6d3d336c39cacde799aa8bb  apps/integration/runtime.mjs
7ce07fa40ee2af48e0221ebd619392fbcb96d159faadb181f116b2c844a433f0  apps/integration/cli.mjs
5a3c8b6ca7ded51ac712b111905e7e0c926ffa01dea3967d23950486660d77c3  docs/contract.md
```

## Final targeted recheck

The coordinator removed the `clearTimeout(entry.timer)` call, preserving the original expiry path that removes the closed session, and added a retention/capacity regression using actual local HTTP. The reviewer reran only the affected suite, as requested:

```sh
node --test apps/integration/test/voice-v1.test.mjs
# 5 passed, 0 failed, 0 skipped/cancelled; exit 0
```

The new test verifies a closed session no longer blocks a new recording after session expiry and the replay retention window. Original close/draft/audio, tool authorization, frozen-target and cursor cases remain green in that suite. No open finding remains from this targeted follow-up. This result does not expand the live/device/outdoor evidence described above.

Final changed-file SHA-256 values, superseding those two entries in the initial snapshot:

```text
3205027658ef928b57ceb91cad822f6ce7a940c38696af719b0c6c24f3919553  apps/integration/voice.mjs
0d209c64c85e42ce98c5649ce38ed5c0e7f979b9f0659cfd648c7c0686157fd9  apps/integration/test/voice-v1.test.mjs
```
