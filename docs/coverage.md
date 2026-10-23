# Unit coverage gates

Policy: `config/coverage-policy.json`. Enforcement: `.github/workflows/verify.yml` and `scripts/coverage.mjs`.

## Pull request requirements

- Changed executable lines: at least 80% covered. Changed branch arms: at least 70% covered when the language/toolchain emits branch data. Branch arms are associated with their reported source line.
- Overall line and branch percentages must not decrease from the PR base. Compare unrounded covered/total counts, not rounded display values. No fixed percentage is invented for existing code.
- Node services and Swift core are evaluated separately. Passing one cannot compensate for failing the other.
- Missing, malformed or incomplete reports, missing coverage for a changed source file, failed tests and missing baseline/comparison revisions cannot pass the gate. A zero denominator is explicitly N/A, never 100%.
- Test the actual PR head against the exact PR base SHA, using the same coverage tool/runtime for both checkouts. CI produces the baseline each run; a contributor cannot supply a more favorable saved baseline file.

Node uses pinned `c8`/V8 with `--all`, including unimported files under `apps/mac`, `apps/relay`, `apps/integration` and `packages/voice/src`. Test/fixture and dependency directories are excluded. Scripts/CI tooling are outside the runtime percentage but have their own checker regression tests.

Swift uses `swift test --enable-code-coverage` and `llvm-cov` on `VoxCodeCore`. Generated files and test sources are excluded by the source scope. SwiftUI, microphone hardware, signing and real-device interaction remain separate acceptance gates. If the Swift toolchain emits no branch records, CI reports branches as N/A; it cannot claim a measured 70% Swift branch score. Swift core line coverage remains enforced.

PR checks enforce thresholds and baseline non-regression. Push/manual runs collect coverage and run tests; comparison gates require PR base/head metadata. Coverage artifacts and machine-readable gate decisions are retained for seven days, with a table in the job summary. Upload runs even after failures when reports exist.

## Critical behavior and evidence

Authorization, task/workspace isolation, mutation replay, asynchronous cancellation and frozen recording targets require positive and negative regression cases. Reviewers verify these scenarios from behavior, not test names or a percentage alone. Benchmark, live Codex/Linx, signed iPhone and outdoor connectivity results do not count as unit coverage and must be reported separately.

## Local commands

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix packages/voice
npm ci --ignore-scripts --prefix apps/relay
npm run test:coverage:node
npm run test:coverage:swift
```

The Swift command requires the macOS Xcode test toolchain. To reproduce the PR gate, collect each revision in separate checkouts and run the head's `scripts/coverage.mjs check` with `--language`, `--report`, `--baseline`, `--root`, `--base-root`, `--base`, `--head` and `--output`. The checker fails if any comparison input is missing; a local collection alone is not a passing PR gate.

Coverage rules are repository policy. Changing thresholds, exclusions or collection/checking code requires explicit review. GitHub required-check settings must include the verification jobs to prevent merging a failed check; this implementation does not change repository protection settings.
