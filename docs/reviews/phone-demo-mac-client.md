# REVIEW-MAC-2: Phone client contract and recovery review

Reviewer: `/root/ios_v1`, independent of the Mac implementation. Date: 2026-10-24. Status: complete for the source snapshot below; no unresolved actionable findings from this review.

## Findings and resolution

### Resolved P2: UTF-8 split across HTTP chunks corrupts confirmed instructions

Originally reproduced against pre-MAC-004 Mac source `c40e1d684eb0fbbf26dd3696c2c34be545965d63`. `apps/mac/server.mjs` concatenated each request Buffer directly into a JavaScript string. Node decodes each Buffer separately, so a Chinese codepoint split after its first UTF-8 byte became replacement characters before JSON parsing. A synthetic authenticated loopback request for prompt `请修复中文分片`, split inside the first character, returned HTTP 200 with `���修复中文分片`; the equality assertion failed. The server could therefore execute and durably replay text different from the phone's confirmed instruction. This was an independently observed failure, reported to the coordinator and implementer before remediation.

Fix `fecd68f12c1dec4254e7379436fc6543143fe081` accumulates bounded Buffer chunks and performs one UTF-8 decode after concatenation (`apps/mac/server.mjs:25`). Raw bytes, rather than decoded string bytes, enforce the 65,536-byte bound. I inspected the fix and independently ran the final regression suite. `apps/mac/test/body.test.mjs` passes Chinese title/prompt/criterion splits in create and follow-up requests, exact saved retry responses, exact-limit bodies and one-byte-over-limit rejection. Resolved in the reviewed snapshot.

No new P0/P1/P2/P3 issue was identified in the final snapshot. This conclusion covers the inspected client/server contract and local fixture behavior; it is not live/device acceptance.

## Reviewed snapshot and scope

- Mac source commit: `f4114f2d63178161e182013231a77e01d519f261` (MAC-005), including MAC-004 `fecd68f12c1dec4254e7379436fc6543143fe081`.
- Read-only worktree HEAD: `4b25828636c5299f973f07ba6ce4122f99c39065`; the later commit changes a review report only. `git diff --exit-code f4114f2 HEAD -- apps/mac` exited 0, confirming identical Mac content.
- Inspected `apps/mac/{server,service,codex,evidence}.mjs`, relevant fixtures/tests and `apps/mac/README.md`; compared behavior with the shared phone contracts and the iOS request/pending-submission model. No Mac source, tests, configuration, Git state or deployment was changed by this reviewer. The only new artifact is this report in the iOS worktree.

## Contract checks

| Area | Inspection and independently executed fixture evidence |
| --- | --- |
| Authorization at mutation | `server.mjs:54`, `:74`, `:101` reauthorize after the asynchronous body read and immediately before synchronous settings/task mutations. Revocation/expiry while each of settings, create, follow-up, cancel, approval, criterion and accept bodies is paused yields `401 unauthenticated` without the requested effect. Unpair is immediate and per-device; bearer verifiers, rather than bearer secrets, persist. |
| Rejection versus uncertainty | MAC-005 uses `409 blocked` for business preconditions before task/evidence/replay changes (`service.mjs:608`, `:624`, `:631`, `:651`, `:677`). Focused tests compare complete persisted state bytes and absence of the rejected request ID. True fingerprint and cross-budget collisions remain `409 conflict` (`:542`, `:545`, `:557`, `:565`). `400 invalid` and `409 stale` checks precede effects. Auth/recovery/quota failures remain distinct and cannot certify an earlier lost response's outcome. |
| Immutable replay | Successful task/settings responses are persisted and copied before response; equivalent JSON property order preserves identity, changed payloads conflict, and exact retries return the original response after later task changes/restart or quota exhaustion. Old replay snapshots can be older than a fresh list; clients must apply their response ownership/version checks. |
| Task and approval identity | Current task version gates follow-up, cancel, approval, criterion and acceptance. Command approvals require owned thread and dispatched turn before phone exposure (`codex.mjs:175`); pre-response requests are bounded until dispatch identity is known. Foreign, old, missing-identity and rejected-dispatch approvals decline; callback acceptance rechecks ownership and settled/aborted state. Decisions arriving after completion cannot authorize a command. Unrepresentable file escalation remains declined. |
| Acceptance and evidence | Manual criteria record version-bound evidence; required failures and sticky trusted failed checks block acceptance, including after evidence eviction. Follow-up preserves omitted conditions while resetting verification, acceptance and preview metadata. Private worktree/thread/turn fields are omitted from public task and saved replay responses. Bounded source evidence uses canonical-path/symlink checks and explicit omission labels. |
| Scheduler and cancellation | Default four/configurable 1-8 slots, at least 20 queued/active/completed tasks, one active turn per task, approval/stopping slot retention and bounded replay reserve are exercised. Repeated stopping cancellation is an intentional no-effect response without extra replay storage, documented in the README; I did not reclassify that policy as a new finding. |
| Recovery and monitoring | Same worktree/thread continuity survives clean restart. Lost dispatch and unconfirmed process teardown remain explicit durable reconciliation/quarantine states; cancellation never implies rollback. Loopback-only authenticated monitor excludes task contents and returns bounded aggregates. These checks do not prove live Codex execution or automatic teardown of escaped/daemonized descendants. |

## Independent verification

Environment: local arm64 macOS, supported minimum-runtime family Node `v22.23.4` from the temporary cached runtime. This review does not rely on the implementer's Node 26 test result.

Executed from the Mac worktree:

```sh
/private/tmp/voxcode-node22-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --version
/private/tmp/voxcode-node22-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --test apps/mac/test/*.test.mjs
git diff --exit-code f4114f2 HEAD -- apps/mac
```

Actual full-suite result: **74 tests, 74 pass, 0 fail, 0 cancelled, 0 skipped**, exit 0; reported duration 3149.240792 ms. These use real loopback HTTP, service persistence, Git worktrees and controlled subprocess/executor fixtures. Source status after execution remained unchanged; only pre-existing untracked review reports were present in the Mac worktree.

## Content fingerprints

SHA-256 values independently recorded from the reviewed tree:

```text
5355baba155e700b2ad8bfc1f0e67f590d20c9f288f6d8447968c7a0517cfcd3  apps/mac/server.mjs
d44703fbf7f213794448fd5c5bf395097b11af9a8c677d27a3999c25d01dbfb1  apps/mac/service.mjs
5746c879befd65765cf197dae81ae175fba7bfd132e7acc7c3d69a5c368e4158  apps/mac/codex.mjs
d87ab0952d168092ee5f18721f1cdc82ce2de7bb1fbade516336ffee9f516269  apps/mac/evidence.mjs
b5075275f0d4ec56e62829892ae3bf56bf991032011e5b830030e60b17e790e5  apps/mac/test/body.test.mjs
0b813482cec6a2d1c35cd7f3f42167199a131077d96d35fb2e89f9196c40be7d  apps/mac/test/authorization.test.mjs
e0b529e9590e9426192bf0bbc3eb2991938608bf02970c4a1691d056d5d6a539  apps/mac/test/blocked.test.mjs
b0674bca39961fde94348a67d1efed69705cd7d77796fca294c5c7b997ae3585  apps/mac/test/codex.test.mjs
```

## Remaining gates

Exact integration CI/coverage remains coordinator-owned. A real Codex edit plus same-thread follow-up, four real parallel model tasks, Linx voice, fixed-IP private-CA iOS trust, microphone/audible playback, signing/device installation, native navigation and outdoor cellular/company-Mac connectivity remain unverified by this report. The bridge's documented single-process persistence, no-fsync power-loss limit, bounded retention and deliberate recovery requirements remain operational constraints. Deployment is deferred. This AI review is neither a human GitHub approval nor user acceptance.
