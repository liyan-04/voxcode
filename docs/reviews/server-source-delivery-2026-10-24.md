# Issue55 independent source/package review

Reviewer: /root/linx_onboarding (not an Issue55 implementer). Read-only review; no repository edits, staging, commits, switches or deployment/provider calls. Controlled disposable fixture repositories were created and removed for reproductions.

Final result: no remaining P0/P1/P2 in reviewed component. The exact source snapshot is `/private/tmp/voxcode-55-alias-snapshot.json`, SHA256 `8fbe62d5a2cd3bf7f3116326214b4aee85c0f8ee5add8b31c6ce20bd3175f7af`. All eight source hashes independently matched. Coordinator-owned package.json/coverage policy integration is separate from this component conclusion.

## Findings and resolutions

1. P2, scripts/build-server-package.mjs Git reads: local `git replace A B` caused a bundle labeled revision A to contain B bytes. Independently reproduced before fix with manifestRecordsOriginal:true and archivedReplacement:true. All builder Git commands now use --no-replace-objects. Actual commit and blob replacement regressions passed; source blobs and manifest remain from A. Resolved.

2. P1, apps/server/preflight.mjs data path: a 0700 private leaf below a non-sticky group/world-writable ancestor could be renamed/replaced despite preflight ok. Independently reproduced with0777 ancestor. Final canonical ancestor traversal permits only root/currentUID ownership, rejects group/other write except root-owned sticky temporary ancestors;0700 immediate parent/existing data remain required.0777/0775/currentUID1777 negatives and trusted0755/rootsticky positives passed. Resolved.

3. P1 continuation, preflight/CLI path alias: canonical checking alone was bypassed by shared0777/selected→trusted0700 parent because old CLI followed resolve(original env) again. Independently reproduced report.ok:true with retargetable original runtime path. Final preflight privately retains canonical project/data in WeakMap keyed by successful report; CLI passes those exact paths. New actual CLI/runtime regression retargets project and data aliases at the dynamic runtime-import boundary, verifies original state/project used, alternate data absent, and logs redacted. Failed/copied reports cannot retrieve paths; data is frozen and omitted from report JSON/spreading. Resolved.

## Final verification

`npm_config_cache=/private/tmp/voxcode-55-npm-cache node --test --test-concurrency=1 apps/server/test/*.test.mjs scripts/test/server-package.test.mjs`: independently PASS19/19 on macOS arm64 Nodev26.0.0. Log `/private/tmp/voxcode-55-independent-alias-review.log`. Includes root/node denial, secret redaction, bounded tool probes, TTY pairing restriction, occupied-port listener preservation, actual strict local TLS lifecycle, alias pinning, ancestor permissions, exact allowlist/revision/lock archives, commit/blob replacements, source symlink/overwrite refusal, offline unpack/install/runtime auth401 and cleanup.

`git diff --check`: PASS on final review snapshot. Eight hashes rechecked against manifest.

Initial reviewer broad15 suite had14pass/1 controlled Codex --version timeout; isolated preflight rerun passed. Subsequent serialized18 suite and final19 suite passed; no failure hidden. Final test discovery/shared policy has been updated by coordinator, but this reviewer did not claim full230 reexecution or exact-commit formal coverage gate.

## Scope assessment

Nonroot start is mandatory; ordinary logs omit pairing code and explicit flag requires stderrTTY before startup. Runtime reuses loopback Bridge/strict WSS connector, does not start/replace Relay, install dependencies or kill unknown PIDs. Cleanup and shutdown errors remain generic; README preserves manual ownership checks, quarantine, source-only rollback and sameUID/ACL/root/target concurrency limitations. Archive reads only committed regular allowlisted blobs, excludes private env/key/CA/.git/dependencies/test state, records revision and file hashes and refuses overwrite. Installer remains explicit locked manual npmci. No stronger isolation or live model claim is made.

Linux/Node22, actual credentials/real Codex or Linx, remote TLS ownership, signed iPhone and cellular/VPN remain open acceptance gates. Local tests are fixture/local evidence only.

## Reviewed file hashes

- `apps/server/README.md`: `8a34a18f25ea88abbdedaf6f9ae927e41394e335171669980eb45862a68c017e`
- `apps/server/cli.mjs`: `cdd861617f2537cae3459a64242b5025394503bb79281afb4156a6c509283a0f`
- `apps/server/preflight.mjs`: `97e7b3aff31e2acbde62f905e5579961591b95d4a8fb8b4db20ce935a88d6bdc`
- `apps/server/test/cli.test.mjs`: `c570261402d950e8b3c64ba4ee40bf42b851369935820868bf399637e23e7f92`
- `apps/server/test/fixtures/environment.mjs`: `114cf2ff90bc01527e1724115291ef9a65a88a6295040644159ce5af5a044755`
- `apps/server/test/preflight.test.mjs`: `f3501bda7bf513d6c9085379ab61f7da327e67095a616c6632228984d5cb9581`
- `scripts/build-server-package.mjs`: `e2cdd2521b4bf2493d1b68a1b7f63be32bfe07b5c3a5818672f56827e2173a2e`
- `scripts/test/server-package.test.mjs`: `95fb62aa8431d6f079ef2c9e2e2d0dea6c301703635fe760988ab97388cabe0a`

## Second independent review and shared integration

Reviewer `/root/product_manager` reviewed implementation ee4a7a88f08f2db81d85d4a8759ad905e37a26ed plus the coordinator's package.json, coverage policy and documentation. No P0/P1/P2. Independent19/19 targeted tests passed on macOSarm64/Node26, including actual CLI canonical alias pinning, private ancestry, Git replace, strict TLS lifecycle, occupied listener preservation, source-only install and auth401. The three shared changes add root server-test discovery and runtime coverage scope, with unchanged thresholds. The final97e7f8f commit removes one trailing fixture blank line only; runtime bytes remain identical.

Coordinator independently collected full exact head runtime coverage with root server discovery:230/230 passed. Exact base92360390831869c114231f6b1901aaa9b3b7b8b1 was checked out detached in a clean retained review worktree; collection211/211 passed with identical Node26/c8. The formal committed-head gate for97e7f8f3405da7f23e539513380ed12cc3098281 passed: changed runtime148/149 lines99.33%,151/158 branches95.57%; overall2157/2324→2307/2473 lines92.81→93.29%,1133/1341→1292/1505 branches84.49→85.85%. Builder is outside runtime policy as scripts tooling; its separately measured line coverage100% and branch87.50% meets the same numerical thresholds.

```sh
node scripts/coverage.mjs check --language node --report /private/tmp/voxcode-55-coordinator-runtime-coverage/lcov.info --baseline /private/tmp/voxcode-55-exactbase-coverage/lcov.info --base-root /Users/liyan2026mac/Documents/ChatGPT/1024/voxcode/.worktrees/57-linx-current --base 9236039 --head 97e7f8f3405da7f23e539513380ed12cc3098281 --output /private/tmp/voxcode-55-formal-gate
```

Actual committed source archive built successfully with node scripts/build-server-package.mjs at97e7f8f; archive SHA2568a8009a44609797d1afa14626f7e9ad683cbb683901bed3c87c3d0f30376dbc1. It is a source/runtime bundle, not an iPhone installer, automatic server install, onboarding-helper package or deployed service. The19 targeted fixtures include extracted locked offline install and actual loopback runtime startup; no real providers were called. No phone WSS stream is implemented here (Issue62).

The first staged whitespace check revealed a trailing blank line in a new fixture; it was corrected in a follow-up commit and final full-diff check passed. The branch's first base coverage command could not fast-forward a squash-merged topic; no merge/reset occurred, and the coordinator explicitly checked out exact9236039 before the authoritative collection. Earlier topic report was not substituted as exact PR base.

Two independent source reviews recommend integration. Reports do not certify Linux, live providers, signed iPhone or outdoor acceptance. No GitHub Actions or external automatic approval success is claimed.
