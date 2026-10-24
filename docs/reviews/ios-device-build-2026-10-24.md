# Native device delivery tooling review (Issue #44)

Implementer: `/root/ios_device_delivery`. Independent reviewers: root architect and `/root/linx_onboarding`. Source commit `4bd9b97`, base original master `d47cc0c`; master README/onboarding subsequently integrated without changing the four reviewed files. Reviews inspect tooling, not an actual native build.

Reviewed SHA-256:

```text
apps/ios/Scripts/device-build.sh
d4f02b99edd102ac25579292d921b81deb50b27f5d926ab91b530fb0a6b797b1
apps/ios/Scripts/device-build-tests.py
3489f6e0eaf29cd1c9be7e7c8af8f99ec669ac9e33b5479fd2bba142ffd2a776
apps/ios/README.md
194f810a4800d072ad0df37565717f666b7a18aa5dc99c24f9cd711bbd0663f1
docs/verification/ios-device-delivery.md
fe7bf495c4f662861c277ae368ceff57b308580ecf87e26767290098a6d568fc
```

Finding resolved: P1 app provisioning/bundle/identity/team settings were global xcodebuild arguments and could propagate to the local SwiftPM library. Native Xcode was unavailable to prove an actual build error; source scope was incorrect. The fix writes JSON-quoted values only to the staged VoxCode app settings block. No app-specific CLI signing overrides remain, original package/test configuration stays unchanged. A new regression failed on old behavior and passes after the fix. Both reviewers found no remaining actionable issue in this snapshot.

Implementer, root and independent reviewer each ran the permanent `python3 apps/ios/Scripts/device-build-tests.py`:9 controlled scenarios pass. They cover read-only preflight, paths with spaces,15-second tool termination, wrong generator/CA/profile rejection before archive, preserve existing output, archive65 preserves log/no export, reject simulator metadata, and app-only signing/retained pipeline output. OpenSSL parses a public system-root fixture; Apple commands/signatures/archive/IPA are substitutes. These outputs are never installable Apple artifacts or real signing evidence.

`bash -n`, embedded/test Python3.9 AST syntax, local documentation links and `git diff --check` passed. Actual `bash apps/ios/Scripts/device-build.sh preflight` exits1 with seven missing/invalid prerequisites and iPhone SDK check blocked by CLT-only selection. No native archive/export/install or remote action occurred.

Runbook retains PR35 Draft/exact-base-head core coverage and native XCTest, approved public CA/leaf relationship, signing/provisioning/phone eligibility, actual iPhone installation, live Linx and cellular/company-Mac Codex acceptance. Source review and controlled tool fixtures close no native/device/cloud/outdoor gate. Coordinator root README/progress integration states these same limits.
