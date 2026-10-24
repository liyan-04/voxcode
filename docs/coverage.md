# Unit coverage gates

Policy: `config/coverage-policy.json`. Local enforcement: `scripts/coverage.mjs` and the coordinator's recorded validation. GitHub Actions enforcement is disabled because the repository account's Actions billing quota is unavailable.

## Pull request requirements

- Changed executable lines: at least 80% covered. Changed branch arms: at least 70% covered when the language/toolchain emits branch data. Branch arms are associated with their reported source line.
- Overall line and branch percentages must not decrease from the PR base. Compare unrounded covered/total counts, not rounded display values. No fixed percentage is invented for existing code.
- Node services and Swift core are evaluated separately. Passing one cannot compensate for failing the other.
- Missing, malformed or incomplete reports, missing coverage for a changed source file, failed tests and missing baseline/comparison revisions cannot pass the gate. A zero denominator is explicitly N/A, never 100%.
- Test the actual PR head against the exact PR base SHA, using the same coverage tool/runtime for both checkouts. The coordinator produces the baseline locally for each review; a contributor cannot supply a more favorable saved baseline file.

Node uses pinned `c8`/V8 with `--all`, including unimported files under `apps/mac`, `apps/relay`, `apps/integration`, `apps/server` and `packages/voice/src`. Root `npm test` discovers the server tests alongside the existing suites. Test/fixture and dependency directories are excluded. Scripts/CI tooling are outside the runtime percentage but have their own checker regression tests; the server source-package builder additionally has a focused coverage report.

Swift uses `swift test --enable-code-coverage` and `llvm-cov` on `VoxCodeCore`. Generated files and test sources are excluded by the source scope. SwiftUI, microphone hardware, signing and real-device interaction remain separate acceptance gates. If the Swift toolchain emits no branch records, the local report records branches as N/A; it cannot claim a measured 70% Swift branch score. Swift core line coverage remains enforced.

For each PR, the coordinator runs the threshold and baseline comparison locally with the exact PR base/head revisions and records the machine-readable result in the PR or progress log. Coverage artifacts are local evidence unless explicitly attached to the review. No GitHub Actions status is treated as a passing or failing product gate.

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

The Swift command requires the macOS Xcode test toolchain. To reproduce the local PR check, collect each revision in separate checkouts and run the head's `scripts/coverage.mjs check` with `--language`, `--report`, `--baseline`, `--root`, `--base-root`, `--base`, `--head` and `--output`. The checker fails if any comparison input is missing; the coordinator records the result in the PR.

Coverage rules are repository policy. Changing thresholds, exclusions or collection/checking code requires explicit review. Branch protection still requires pull requests and review; it does not rely on unavailable Actions status checks.
