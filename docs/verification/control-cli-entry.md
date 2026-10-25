# Control CLI symlink entry verification

Issue: [#111](https://github.com/liyan-04/voxcode/issues/111).
Base revision: `1728a4ee9872719b551f4de1667cdd6e115fa840`.
Environment: local macOS arm64, Node `v26.0.0`, 2026-10-25.

## Behavior

The CLI compares canonical filesystem paths for its invoked entry and module.
Executing through a release-directory `current` symlink or a file symlink now
enters the same startup block as a direct invocation. An absent or unresolvable
argv entry leaves module imports quiet. Configuration validation, redacted
errors, runtime startup, and signal cleanup retain their existing behavior.

## Regression evidence

Before the implementation change, the new subprocess test failed: direct
`preflight` with a nonexistent private configuration exited 1, while the
directory-symlink invocation exited 0 with no output. The import regression
already passed.

After the change, actual Node subprocesses exercise direct, directory-symlink,
and file-symlink `preflight` entries. Each exits 1, produces no stdout, and emits
only the generic startup error on stderr without the private configuration path.
A separate subprocess imports the module with invalid private configuration and
exits 0 with no stdout or stderr. Subprocesses have a 10-second timeout and a
bounded output buffer; temporary symlinks are removed after the test.

Commands run from `apps/server`:

```sh
node --test test/control-cli.test.mjs
# Before fix: 2 passed, 1 failed (symlink entry returned 0 instead of 1).

node --test test/control-cli.test.mjs test/control-config.test.mjs
# After fix: 4 passed, 0 failed.

node --test test/control-cli.test.mjs test/control-config.test.mjs test/control-runtime.test.mjs
# After dependency installation: 9 passed, 0 failed.
```

The first broader runtime run could not load the Mac Agent's `ws` dependency.
The existing pinned `ws` 8.22.0 was installed in `apps/server` and
`apps/mac-agent` using `npm ci --ignore-scripts --no-audit --no-fund` with a
temporary npm cache. No dependency metadata changed. The final broader run
includes the existing local HTTPS/WSS/private Mac RPC fixture.

## Limits

These are local subprocess and runtime fixtures. No deployment, live Linux
listener, paired user device, or outdoor acceptance was performed here. The
coordinator owns independent reviews, Git operations, and live verification.
