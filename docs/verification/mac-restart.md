# Owned Mac Restart

Publication integration: source fast-forwarded to master `5e01b5d`; the four
frozen implementation/test/doc inputs were preserved. Both independent reviews
pass under `docs/reviews/mac-restart-*-2026-10-25.md`. Coordinator focused checks
passed 15 with one opt-in skip. Complete serial Node/policy/voice suite passed
with exit 0 after installing all declared locked module dependencies. Earlier
missing-dependency attempts are not passing evidence. Application coverage scope
excludes these control scripts. Installed repeat restart is still a separate gate.

Issue: #137. Source base: `90387623026b978bf00f3292683e1820c91df14e`.
This entry restarts the two already installed VoxCode LaunchAgents. It does not
install code, change plists, switch releases, modify private configuration, or
restart the server gateway. It has no dependency on the unpublished #122 tools.

```sh
node scripts/control/restart-mac.mjs status
node scripts/control/restart-mac.mjs restart
```

The optional `--root /absolute/installation` must identify the existing canonical
installation. Labels and LaunchAgent paths cannot be supplied by a caller. The
default root is `~/Library/Application Support/VoxCodeControl`. Run with the same
Node interpreter already used by the installed services and as their non-root
GUI account. The supported manifest is the exact merged-source install manifest;
an unaudited legacy snapshot must be upgraded through its existing deployment
procedure first.

## Behavior

The entry checks the private manifest, all recorded source hashes, private
registry and Agent configuration, plists, job arguments, process UID and process
start time. The legacy Homebrew Node alias is pinned to the currently executing
interpreter's canonical path and bytes; global Homebrew permissions are untouched.
This preserves the existing interpreter trust boundary, not a new UID isolation
boundary. No inherited launchctl environment or raw command diagnostics are logged.

A dedicated private kernel guard serializes restarts. It reuses the merged Agent
lock primitive with a separate restart identity and files, never the Agent ledger
or its guard. It checks available/idle/not-quarantined task RPC before stopping,
stops Agent before task, and checks task activity again after disconnecting Agent.
It waits for both job disappearance and the original process identity to disappear.
PID checks never send signals; only exact owned launchd labels receive bootout.

Task starts first, its private RPC must become ready, and then Agent starts. An
already running owned job is reused. A bootstrap retry requires a successfully
completed owned stop, an absent job, unchanged registration, exit code5 and the
observed `Bootstrap failed: 5: Input/output error` diagnostic. Other errors fail
immediately. Each transition has a15-second deadline and bounded command calls.
Events report only label, phase, elapsed time, attempt count and observed PID.

Failure attempts to restore the original running registrations in task/RPC/Agent
order and verifies the unchanged installation. If a task starts during the stop
gate, it is preserved while Agent access is restored. Rollback success is explicit;
an unconfirmed stop or rollback remains an error. No lock, socket, guard, history
or state is deleted to force startup. A configured voice provider may be `idle`;
provider/TTS session readiness is not a task-service startup gate.

## Observed Evidence

During the2026-10-25 release, immediate bootstrap after bootout returned error5.
The first temporary deployment script checked job disappearance but did not wait
for the original PID. Its immediate rollback bootstrap also failed. Later explicit
bootstrap restored both services; the deployment retry with both exit waiting and
bounded bootstrap retry succeeded. The original failed attempt did not record
precise process exit timing, so error5 alone does not prove one unique OS cause.

The real isolated launchd fixture reproduced the relevant asynchronous boundary:
bootout returned while the original process was still alive. Its two SIGTERM-delay
cycles reached verified job disappearance plus PID exit after1236ms and1258ms;
replacement startup took69ms. This proves that a successful bootout command or a
missing job alone is insufficient. It does not claim deterministic reproduction of
the production error5; repeated error5 handling is covered by controlled fixtures.

```sh
node --test scripts/test/mac-launchctl.test.mjs
VOXCODE_TEST_LAUNCHD=1 node --test scripts/test/mac-launchctl.test.mjs
```

The second command creates only a uniquely named `io.voxcode.restart-fixture.*`
job in a private temporary directory, waits for its processes, and removes it.
It never operates on the installed task/Agent labels. Deterministic regressions
cover delayed unload, delayed PID exit, bounded repeated bootstrap errors,
nontransient errors, unknown labels, changed registrations, active-task refusal,
duplicate start/restart, rollback and configured voice idle.

Installed read-only `status` passed against exact9038762, both owned jobs and two
registered projects, with activeTasks0 and quarantined false. Existing task/Agent
PIDs36100/36114 were not restarted for this source change. A real repeat restart
of those services remains a separate post-review idle-gated acceptance step.

The earlier gateway activation also used an incorrect `voiceProviderState=ready`
gate immediately after restart, triggering a needless rollback. It was corrected
to configured voice with idle/ready; no credential or voice configuration change
was required. Physical phone and provider-session evidence remain separate.
