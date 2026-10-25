# Issue150 independent deployment review

Result: **no blocking findings**, limited to these reviewed file hashes in `/private/tmp/voxcode-150-lifecycle-admin-path`:

- `scripts/control/common.mjs`: `4f1a49df765665f50aa1402cf9b39bd3937589c62f2e436917e205e268a33a6f`.
- `scripts/test/control-runner.test.mjs`: `75c4c7074e40bee2fc3670c2d6d1b6cb45a094c9e2ddb485b65dcb8064088ed8`.

The production change is one line: default sanitized PATH gains fixed `/usr/sbin` and `/sbin`, becoming `/usr/sbin:/usr/bin:/sbin:/bin`. This resolves the observed gateway ENOENT for bare `runuser`, which was independently confirmed at `/usr/sbin/runuser` with root-owned0755 metadata. No runtime environment or caller PATH is inherited. No local/user/relative/current-directory entry is introduced. Existing explicit options, subprocess limits/error handling, canonical tool ownership checks, unit/process/listener checks, lifecycle transaction/rollback and credential isolation are unchanged. This modifies controller subprocess lookup, not the installed gateway service's environment or the Mac task runtime.

The new tests exercise actual child-process PATH lookup without invoking the administrative command: `/usr/bin/which` resolves `runuser` on Linux or `sysctl` on macOS, then an absolute Node child confirms only the sanitized PATH is present (with the standard macOS CF encoding variable excluded). The Linux branch is appropriate to the confirmed vm6 location; this review's actual execution used macOS, not a remote Linux service.

Executed read only:

```sh
node --test /private/tmp/voxcode-150-lifecycle-admin-path/scripts/test/control-runner.test.mjs
```

Observed **2passed,0failed,0skipped**, exit0. Source/test hashes re-read after execution were unchanged. Full lifecycle suites are the coordinator's separate validation; this review does not claim they were rerun here. No source/worktree edit, Git mutation, SSH, service operation or live deployment was performed for this review.

Deployment may resume only using the reviewed merged exact controller revision. Existing formal adoption of5e is already recorded, so continue with status and exactb853 update; do not re-adopt or use a现场PATH override. Fresh canonical lease/flock and observed current-release identity remain required. Live voice/model/phone evidence is separate.
