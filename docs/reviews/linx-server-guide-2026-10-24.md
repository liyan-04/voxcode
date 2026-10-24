# Issue61 independent guide review

Reviewer: /root/linx_onboarding. Read-only review of four changed docs in codex/61-linx-server-guide, source base9236039. No repository edits, Git mutations, account operation, enrollment, voice upload or provider/model call.

Result: no P0/P1/P2. Recommend documentation integration after coordinator checks and the other independent review. Optional P3: docs/linx-product-design.md tool section still introduces the table as proposed application APIs while the implementation section now accurately records six implemented tools; changing the lead-in to application APIs would remove minor ambiguity, without changing behavior.

## Scope and findings

- Native phone↔server duplex WSS is explicitly a user requirement tracked as Issue62, still pending implementation/acceptance. Current phone audio HTTP POST/event polling and current server-local HTTP smoke remain clearly identified. WSS server-side Linx capability/PR59 is not presented as phone WSS delivery.
- WSS audio/events future behavior preserves explicit phone confirmations, frozen recording task/version, request replay and interruption boundaries. Voice abort does not imply Codex task cancellation; completed execution is separate from approval and user acceptance.
- Server software device uses outbound authenticated Linx WSS with device/端侧 MCP. Cloud SSE GET/mcp POST/mcp/message remains separate/unimplemented; X-Linx headers are correlation and not authorization. No unimplemented public callback URL is requested.
- User resource preparation asks only a dedicated test agent, tool-capable model/Chinese voice, role/intent configuration and binding entry; do not disclose activation codes/tokens/identifiers/screenshots. Controls are qualified by actual account availability. Web preview success is not software-device/phone proof.
- Current onboarding commands match code: fixed identity init/status, explicit interactive activate --show-code requiring stdin/stderrTTY, private0700/0600, no overwrite/re-registration/firmware download, configured presence only and generic bounded errors. Commands use dedicated normal server user, actual paths outside source/project, no symlink directories and no tokens in arguments. Existing runtime command is accurately labeled old development entry that prints pairing code and must not run in service logs; Issue55 safe entry is pending review.
- Two env-file startup is supported by Node; machine key and device token remain separate. Existing Relay9899 ownership must be verified, unknown/unrelated listener untouched, Bridge remains loopback. SameUID file-read risk and separate Relay key ownership are explicit.
- L1-L5 distinguish actual handshake/STT/drafts/tools, no pre-confirm execution, actual task/evidence, signed phone duplexWSS and same-build cellular/VPN. Input-only optional hello cannot falsely pass audio-requiring smoke. PR59 exact211/50 fixture evidence is attributed to its source milestone, and historical26 count is not current success.

## Independent checks

- Read all four final docs and full diff, actual onboarding library, voice-tools, integration entry, smoke behavior and PR59 review evidence.
- Compared console URL and intent/save/reconnect wording against actual official guide-agent-config.md at pinned20ce1b29a1bdff575a4c3317689bae30a7e08535. Confirmed prompt placeholder syntax/agent_params.custom_replace_prompt against pinned WebSocket docs. Independently fetched public pinned guide/quick-start.md, confirming xrobo.qiniu.com console and device code binding; cached /private/tmp/voxcode-61-quick-start.md. No console/account call.
- All relative Markdown targets in four docs resolve locally.
- npm run test:policy: PASS45/45, no failures/skips, macOSarm64 Node26.0.0. No new implementation tests warranted for these doc-only edits.
- git diff --check: PASS.
- Independently computed final four hashes below; snapshot /private/tmp/voxcode-61-independent-snapshot.json.

## Reviewed hashes

- `README.md`: `adc0ddc43704ba0cfd1c620d485fb164038618c4bbdf1e8025338a79d78cf59e`
- `docs/verification/linx-readiness-2026-10-24.md`: `ca66805ddbce0b62178dedde4ef725ffed856395b9f7463079a94a7bbba924d8`
- `docs/verification/linx-smoke.md`: `dd3dc3c72b18226b3f3f20fc4d38bad86893d16e63786f80a11222dbe955bb46`
- `docs/linx-product-design.md`: `d8b397700e66fa1ddb25971cbb80232214affc1f3651e6198ba04f35b1489892`

Linux/Node22, real authorized Linx/Codex, intended remote TLS, phoneWSS implementation, signed device/audio and cellular/VPN remain unverified gates. This is an AI source/document review, not human approval or product acceptance.

## Second independent document review
Reviewer `/root/product_manager` independently inspected all four documents at base9236039 against actual onboarding/integration code and the current pinned official docs, including fresh public quick-start/OTA. No P0/P1/P2. All39 local links exist; UTF-8/newline/whitespace checks pass. Reviewed source preserves current HTTP vs required future phone WSS/Issue62, server-only credentials, private ordinary-user setup, terminal-only activation, software-device permissions and open live/device gates. No account/provider call or source/Git mutation by reviewer.

One optional P3 from the first reviewer was corrected afterward: the product tool introduction now calls the six scoped tools implemented application APIs and explicitly keeps live discovery/model selection unverified; no behavior changed. Coordinator independently checked39 links and offline helper init/status in a disposable private directory, observing initialized/unconfigured and0600 identity without any activation/network request.

The guide's commands reference merged source tooling. Issue55 server package and Issue62 phone duplex WSS remain clearly pending. This review does not prove a real enrollment, native build, WSS client or deployment.
