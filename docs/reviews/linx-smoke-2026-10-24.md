# Linx HTTP smoke tooling review (Issue #43)

Implementer: `/root/linx_smoke`; independent reviewers: root architect and `/root/linx_onboarding`. Original base `d47cc0c`, source commit `87fcc24`. Latest master onboarding/device-tooling/README integrated without changing the four reviewed files.

Exact source snapshots (SHA-256):

```text
scripts/smoke-linx.mjs
4daad1211a8c7cf83c2fe2a304f4ec7422a67e24f1d579845fe8dd28f2c2ec78
scripts/lib/linx-smoke.mjs
3bed8879eb03b315dc2a6cc9a114fd499d95a134206886144d2f5423f2b41529
scripts/test/linx-smoke.test.mjs
d00ae65cf3cd2d48ccc577f22836d154c356de46512203160e497a9c90175bbb
docs/verification/linx-smoke.md
b28130ac96c09796300cc8935d2123146bb383d94be4cfc86c2d891a2e98f6fe
```

Review findings and resolutions:

- P1: array-valued event.type coerced to an observed-counter key while skipping strict string payload branches, so fabricated categories could yield passed:true without actual STT/draft/audio. Independent reviewer reproduced locally; fixed with string-type guard and malformed array/object/scalar regressions. RED then GREEN recorded.
- P2: even-length base64 alone accepted PCM larger than actual decoder frames. Bound by negotiated16/24kHz120ms; tests cover exact upper bound and+2bytes for both rates, RED then GREEN.
- Root input review required regular files without symlink/FIFO blocking. O_NOFOLLOW/O_NONBLOCK plus fstat and bounded reads now reject them before HTTP. Original happy fixture expected2 chunks for6402bytes at3200-byte blocks; corrected to3 with total/size invariants.

Validation on Node26.0.0/macOS arm64: final focused `node --test scripts/test/linx-smoke.test.mjs`:14/14 pass,0fail/skip; both production `node --check` and `git diff --check` pass. Coordinator full `npm test` on integrated master-derived source:205/205 pass,0fail/skip;42 local README/readiness/smoke/progress links exist. Initial focused run8/9 failed its chunk-count assertion; it is retained as a corrected failure, not counted as passed.

Reviewed behavior includes literal loopback-only HTTP origin, environment bearer/no secret arguments, caller-declared synthetic raw16kHz PCM, frozen null task target, paced upload, finite response/event/cursor/deadline bounds, no task mutations, replay of identical uncertain create only for cleanup, and independent bounded abort/delete on error or signal. Errors/reports omit raw input/output, IDs, secrets and private paths. CLI import/help performs no HTTP.

Evidence is controlled local HTTP. No real Linx credential/provider request, recording or Codex turn was used for this slice. Configured/ready/event observations cannot attest provider identity or semantic correctness; full L3 tool behavior, audible phone speech, signed installation and cellular/company-Mac remain separate gates. Existing runtime source/coverage policy unchanged; new script tooling has focused behavioral regressions.
