# Private Linx software-device helper review (Issue #42)

Base: master `d47cc0c2b67cf44f712229d16e7150ce43da12e7`. Implementation source commit `81b8f18`; latest master README integration followed without changing the four reviewed implementation/module files. Implementer: `/root/linx_onboarding`. Independent reviewers: root architect/coordinator and `/root/product_manager`; neither authored helper source. Both found no remaining actionable issue after malformed-response corrections.

Exact reviewed SHA-256:

```text
packages/voice/tools/onboard.mjs
45c479ef03f99908e6190311d6a7957dab2aaf40ba660e7f79d8229326f32ee0
packages/voice/tools/onboard-lib.mjs
0863f8e10d63d1757e6e6771a0c32a9df5fe2eec9b484da23fc69d17cee6b47a
packages/voice/test/onboard.test.js
fecc68f05b0a56a1384c41bfec0334a04a5f7587a8026203611b85fd0b2be0f5
packages/voice/README.md
d6f23f9da179a94284e1742699a15d12e4af3698e643a77719ea03c734544247
```

Reviewed boundaries: persistent locally administered unicast MAC/UUID; owned0700 private directory and0600 single-link files; symlink/no-clobber protection; fixed HTTPS endpoints; ten-second per-request deadline and64KiB response cap; no redirects/firmware/retry; official WS default mapped only to its documented WSS destination; activation code only by explicit interactive terminal output; token persisted only in private runtime env. Normal JSON/errors disclose no identity/token/code/raw response. Configured never implies cloud or speech success.

Validation on Node26.0.0/macOS arm64:

- Implementer and both reviewers independently ran `node --test packages/voice/test/onboard.test.js`:18/18 pass,0 failed/skipped.
- Coordinator installed locked root/voice/Relay dependencies in isolated worktree then `npm test`:191/191 pass,0 failed/skipped; `node --test packages/voice/test/*.test.js apps/integration/test/*.test.mjs`:44/44 pass. The implementer's earlier broader attempt failed imports before dependencies were installed; it is not counted as a passing run.
- Both tool `node --check`, local documentation links and `git diff --check` passed. Script tooling is outside runtime coverage source scope; existing runtime files and coverage policy unchanged.
- RED/GREEN malformed cases include wrong scalar identity/code types and null/scalar websocket objects; a null websocket plus pending activation was initially accepted and now rejects. Outbound HTTPS is blocked process-wide in the final tests, including a regression for omitted injection.

Evidence correction: an early default-HTTPS-wrapper test ran before its injected request implementation was supported, attempting one malformed synthetic official OTA request with a fixture string Device-Id and empty object body. No actual user device identity/token/account resource was supplied, and no enrollment or successful cloud response was established. This mistake is explicitly retained; the milestone does not claim zero network attempts. All subsequent wrapper/activation tests use controlled transports under default-deny HTTPS.

Actual user intelligent-agent setup, software-device permissions/board support, binding/token retrieval, authenticated voice handshake, real STT/MCP/TTS and signed iPhone cellular/company-Mac acceptance remain open. The helper does not create agents or bind them in a user's account. Source review is not cloud/device acceptance.
