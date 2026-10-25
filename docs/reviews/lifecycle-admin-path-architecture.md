# Issue #150 architecture review — PASS

Reviewed checkout: `/private/tmp/voxcode-150-lifecycle-admin-path`.
Issue: https://github.com/liyan-04/voxcode/issues/150

No actionable findings or P0/P1 blocker in this minimal lifecycle PATH fix.

The production change adds only the fixed system directories `/usr/sbin` and `/sbin` to the runner's default PATH, resulting in `/usr/sbin:/usr/bin:/sbin:/bin`. The default environment remains PATH-only: it does not spread `process.env`, accept ambient PATH entries, or introduce inherited credentials. Existing explicit caller options and environment overrides retain their prior precedence.

Linux preflight can now resolve the outer `runuser` command while retaining the inner service-user `env -i` boundary and service-UID preflight checks. Lifecycle ordering is unchanged. macOS absolute command paths and explicit environments are unchanged; npm staging still uses its own isolated environment.

The two new tests meaningfully exercise real child-process executable lookup and the resulting child environment. The lookup test selects Linux `runuser` or macOS `sysctl`, confirms the `/usr/sbin` executable, and resolves it through the default runner without performing an administrative operation. The environment test checks the exact four PATH segments and PATH-only environment, allowing macOS's runtime-injected `__CF_USER_TEXT_ENCODING`.

Independent verification on macOS: `node --test scripts/test/control-runner.test.mjs` exited 0; 2 passed, 0 failed, 0 cancelled, 0 skipped. Frozen source hashes were rechecked when writing this report:

```text
4f1a49df765665f50aa1402cf9b39bd3937589c62f2e436917e205e268a33a6f  scripts/control/common.mjs
75c4c7074e40bee2fc3670c2d6d1b6cb45a094c9e2ddb485b65dcb8064088ed8  scripts/test/control-runner.test.mjs
```

The deployment owner separately supplied vm6 evidence that the old PATH produced ENOENT and that `runuser` is `/usr/sbin/runuser` (root-owned, mode 755), plus focused 38/38 and policy 114-pass/1-opt-in-skip results. Those Linux/live and broader-suite checks were not independently rerun by this reviewer. The test's supported-platform assumptions include `/usr/bin/which` and the selected `/usr/sbin` tool; the supplied vm6 evidence covers the actual deployment lookup, so this is not a blocker. Deployment and voice acceptance remain separate.

This reviewer changed only this report and did not modify source, tests, Git state, or live services.
