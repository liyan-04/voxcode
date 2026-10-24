# Issue57 independent protocol/security review

Reviewer: /root/ios_server (not an Issue57 implementer). Read-only source review; no source or Git mutations.
Date/environment: 2026-10-24, macOS arm64, Node26.0.0.
Base: d710d7cb4d005715856509c559857be34621b59d.
Worktree: /Users/liyan2026mac/Documents/ChatGPT/1024/voxcode/.worktrees/57-linx-current.
Scope: all four files from /private/tmp/voxcode-57-freeze.json, actual diff plus integration consumers (voice.mjs, voice-tools.mjs, decoder), tests and all5 cached pinned official protocol documents.

## Snapshot

- packages/voice/src/index.js: c1ad34b1b9c7b433380d99de4afa161426093758cc2693c5b58e82d41e5072fb
- packages/voice/test/session.test.js: 37cc209708a92488b4338f3ed069f5a372e37158a63570d475a6105b069c3cf0
- packages/voice/README.md: 63cda5a200c9186cabe467d28b5a1ef78d9b2e6d9dcc484c8a4b15bad7e9bfb7
- apps/integration/test/headless-server.test.mjs: 9a103cc336d527633d84e3d13afa214447547f9ddb89500e0bbeefebda98544b

Hashes independently computed and matched the frozen manifest.

## Findings

P0: none. P1: none. P2: none. No actionable regression found in this snapshot.

Protocol/security conclusions with checked lines:

- index.js:89–93 accepts absent audio_params without inventing a decoder/output sample rate, and defaults only omitted channels to documented mono when explicit format/rate exist. Supplied null/malformed/unsupported metadata closes. This agrees with official websocket.md:366 (audio_params optional), 548–558 (abbreviated reply without channels), 635–642 (mono and16/24k). Integration voice.mjs:74–87 begins outputSupported:false/outputFormat:null and drops binary until decoder exists; composed regression:198–209 exercises input-only/draft success with no output/error.
- index.js:27,90,94–97 checks supplied session IDs before STT/TTS/MCP dispatch; malformed/conflicting bound IDs close without exposing supplied identifiers. Missing IDs are accepted for official hardware-MCP initialize/list/call examples, which omit outer session_id; absent hello ID remains unbound rather than adopting later metadata. Session lifetime is per authenticated socket, so compatibility behavior does not retarget a VoxCode recording.
- index.js:44,65–66 sends both immediate protocol errors and asynchronous success/error replies through the same bound control helper. State is checked after await, so a pending tool result cannot emit on a session closed by a conflict. Existing closed/owner/target/version guards in voice-tools.mjs remain intact. No new tool can dispatch code, grant approval or accept results.
- index.js:76–79 preserves authenticated WSS, explicit provider headers, no redirects and existing1MiB payload bounds. No callback routes, cloud-SSE auth assumptions, credentials on phone, unsafe TLS or audio hardware dependency added.
- headless-server.test.mjs:43–53 owns temp/transport cleanup; 122–162 checks auth before provider creation, duplicate draft/no auto execution and actual Opus; 164–180 exercises real temporary worktree/controlled stdio and same thread; 182–209 exercises abort/delete, conflicting-session teardown and new input-only recording. HTTP/WS loopback and injected provider/model are clearly fixture/local; no remote TLS or real-cloud conclusion.

## Independent verification

- node --test packages/voice/test/session.test.js apps/integration/test/headless-server.test.mjs: exit0,17/17,0fail/skip.
- node --test packages/voice/test/*.test.js apps/integration/test/*.test.mjs: exit0,50/50,0fail/skip.
- git diff --check: exit0.
- Independently fetched public raw files at official qiniu/Xrobot-docs commit20ce1b29a1bdff575a4c3317689bae30a7e08535 and compared byte-for-byte to cached files. All5 match:
  platform/websocket.md SHA2564e7852d0ffa910059ee668bfda6b8bb381a7ab85e665fb51b7e44ba4f887c97f
  mcp/hardware-mcp.md SHA256fb9493ec95b013cfbb30471c67cd0a7416c21748def9f739724b88cf43e08b60
  mcp/software-mcp.md SHA2560d5354f3851a10f577819a6272b7b7e136aae9fc7540524242b917029968045f
  guide/third-app.md SHA25633414968357ee2c4ab97d39bcd45dfa6d26b884ea3f3e3cb7487611f141da6d8
  guide/agent-config.md SHA2563862152b76e6b597275d5b105ba3f0c2ccd2c8102f328d9addd912743d8880de
- Reviewed implementer coverage snapshot/evidence but did not independently recollect full coverage or run formal committed-head check; coordinator owns exact-commit gate.

## Recommendation and limits

Recommend source integration after the other independent review and coordinator's exact-commit policy/coverage checks. This review supplies no human GitHub approval or product acceptance. Actual Node22/Linux, authenticated Linx enrollment/hello/STT/tools/TTS, real model execution, strict remote TLS, audible phone output, signed-device and cellular+VPN gates remain open. Local fixtures do not establish provider optional-field behavior in production.

## Second independent review: product and contract

Reviewer `/root/product_manager` reviewed implementation commit `a5ed5ec1259a33ca5035cc51415d456846978525` and independently recomputed the four SHA-256 values above. No P0/P1/P2 findings. Independent `node --test packages/voice/test/*.test.js apps/integration/test/*.test.mjs` passed50/50 with no failures/skips on macOS arm64/Node26. The reviewer inspected the adapter, composition test, unchanged voice/tool consumers and all five pinned official documents. Recording ownership, immutable task/version target, explicit confirmation, replay, follow-up, abort/revocation and credential boundaries remain intact. Cloud correlation headers are not authorization and no callback listener was introduced. This reviewer did not recollect full coverage or run live/device checks.

## Coordinator integration verification

Coordinator `/root` independently reran the17 session/composition tests, verified the four frozen hashes against committed source and ran the formal coverage checker using the successful211-test head report and205-test exact-base report. Base is `d710d7cb4d005715856509c559857be34621b59d`; implementation head is `a5ed5ec1259a33ca5035cc51415d456846978525`.

```sh
node scripts/coverage.mjs check --language node --report /private/tmp/voxcode-57-coverage-head-retry/lcov.info --baseline /private/tmp/voxcode-57-coverage-base-retry/lcov.info --base-root /private/tmp/voxcode-57-base-2eyoixzj --base d710d7cb4d005715856509c559857be34621b59d --head a5ed5ec1259a33ca5035cc51415d456846978525 --output /private/tmp/voxcode-57-committed-gate
```

Gate passed: changed13/13 executable lines100%,22/23 branches95.65%; overall lines2150/2317→2157/2324 (92.79→92.81%), branches1097/1311→1133/1341 (83.68→84.49%). Source hashes identify exactly the tested bytes; subsequent review/progress records do not change executable source. `git diff --check` and actual published PR metadata policy passed.

The first full-coverage run had an existing macOS cancellation probe `kill EPERM` (210/211); an unchanged-source retry passed211/211. Failed evidence is retained and is not used for the passing gate. Base coverage used an exact archive; its initial missing `.git` prevented four ignore-policy checks, then a disposable local `git init` enabled205/205. Neither workaround altered application code or verification thresholds.

Both independent source reviews recommend integration. Implementation agent `/root/linx_onboarding` did not self-review. AI source reviews are not human GitHub approvals, real-provider proof or product acceptance. Linux/Node22, real provider setup, trusted remote TLS, signed iPhone and cellular+VPN remain open.
