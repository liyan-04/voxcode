# Execution Target UI

Issue: #131. The current milestone adds the execution target selector and
target isolation on base `db9841a`, which includes the frozen login milestone.
The login-only history below records the earlier reviewed increment.

Environment: local macOS arm64, Node.js v26.0.0, bundled Playwright Chromium.
Evidence: actual page JavaScript with controlled HTTP/DOM dependencies, and
synthetic browser/HTTP fixtures. No real Mac Agent, Codex or provider operation
was used. Base: `049f695` plus the coordinator-supplied frozen #124 recovery
repair; existing #124 verification files are preserved.

## Behavior

- A successful POST `/api/login` immediately marks the page as logged in,
  clears the password, closes the login modal and releases the login button.
  Project discovery runs independently; a pending or failed workspace load
  cannot be reported as a password/login error.
- Existing-session discovery uses authenticated GET `/api/execution-targets`.
  It starts without waiting for health, device or project requests, so a
  stopped Mac Agent cannot prevent session restoration. There is no fallback
  that treats an RPC-backed project/device response as proof of login.
- Requests capture the current authentication generation. An old 401 returned
  after a newer successful login cannot clear the newer authenticated state.
  A current unauthorized response still expires the session normally.
- Invalid credentials keep the modal open, preserve the entered password for
  correction and display a password error. Workspace failures appear only in
  the workspace feedback surface.

At the historical login-only milestone, the page still used its default
executor and connection polling. Selector, voice context and persisted request
identity were added in the current milestone described below. Restoring an
existing session and target readiness depend on #128 providing authenticated
inventory without Mac RPC; installed-service integration remains a coordinator
responsibility.

## Validation

Six new regressions first ran against the old page and all failed. They cover
pending projects after successful login, project failure after login,
inventory-only session discovery with unavailable Mac/project APIs, rejected
inventory without project/device fallback, a late old 401, and invalid
credentials. The implementation then passed all six.

```sh
node --test apps/server/test/execution-target-ui.test.mjs apps/server/test/workspace-conversations.test.mjs apps/server/test/project-task-tabs.test.mjs apps/server/test/voice-composer.test.mjs apps/server/test/http-server.test.mjs
```

Result: 47 passed, 0 failed/cancelled/skipped. The preexisting #124 loss-of-
acknowledgement recovery regressions remain included and pass.

```sh
VOXCODE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
VOXCODE_PLAYWRIGHT_EXECUTABLE=/absolute/path/to/chromium-headless-shell \
VOXCODE_EXECUTION_TARGET_FIXTURE_OUTPUT=/private/tmp/execution-target-login-131 \
node apps/server/test/execution-target-browser.fixture.mjs
```

The actual browser run used the installed bundled Playwright module and
Chromium headless shell, with approved sandbox escalation. Mobile 390x844
and narrow 320x740 both passed. The server fixture rejects Mac/device/project
requests while authenticated inventory stays local and responsive. A held
project request proves the login modal closes before discovery completes;
after it returns 503, the page remains logged in. A reload restores the same
Cookie session via inventory without another login POST. Invalid-password,
pending-project, failed-project and restored-session screenshots were saved.
Failed-project and restored-session layout bounds are within each viewport,
with no horizontal document overflow or page errors. Mobile failed-project,
narrow restored-session and narrow invalid-password screenshots were visually
inspected.

Artifacts outside the repository:

- `/private/tmp/execution-target-login-131-results.json`
- `/private/tmp/execution-target-login-131-{mobile,narrow}-{invalid-password,projects-pending,projects-failed,session-restored}.png`

## Selector Milestone

The first viewport now contains a Mac Codex / Server Codex select and its
current readiness. Mac remains the default. Authenticated inventory is the
only source for configured, online and available state; health polling cannot
make an executor ready. An offline Mac does not disable the selector or an
available Server. An unconfigured option is disabled and visibly labeled.

All project, task, task result and operation requests capture one
`executionTarget` query value. Target workspaces own their projects, task
snapshots, selection, tabs, checkbox preferences, drafts and pending actions.
Generation guards discard stale project/list/detail successes and failures.
Delayed mutations update only their original workspace and cannot clear or
replace input on the other target, even when project and task IDs match.

Session storage keys include the target for drafts, navigation, tabs, pending
requests and unknown operations. Checkbox preferences are likewise scoped in
local storage. Mac reads the earlier unscoped keys as a migration fallback,
including unknown operations with their original operation IDs; Server never
reads those legacy records. Clearing a migrated draft removes both
representations. The selected executor is restored from session storage.

Each mutation saves its complete payload and requestId before dispatch. A
storage failure blocks dispatch. Reload restores saved requests as uncertain;
recovery replays the exact original payload while retaining later edited
input. Unknown-operation lookup and reconciliation keep their captured target.
Voice capture freezes `executionTarget`; omitted legacy voice context defaults
to Mac. A late transcript is saved only to its original target's draft.

The existing unit/browser harnesses now supply inventory and validate the
single target query while preserving their earlier workflow assertions. Their
fixtures and authentication assertions were retained; no backend behavior was
changed in this worktree.

### Selector Validation

The initial selector regressions failed against the login-only page. The final
focused run includes a regression that first reproduced stale old-target
workspace failures overwriting current feedback, then passed after correction.

```sh
node --test apps/server/test/execution-target-ui.test.mjs apps/server/test/workspace-conversations.test.mjs apps/server/test/project-task-tabs.test.mjs apps/server/test/voice-composer.test.mjs apps/server/test/http-server.test.mjs apps/server/test/voice-client.test.mjs
```

Final result: 90 passed, 0 failed/cancelled/skipped. This includes 15 page
regressions, legacy unknown-operation migration, frozen voice context
validation and the existing loss-of-
acknowledgement recovery tests. A broader server-suite attempt stopped on
missing local `ws` dependencies, with 208 passing tests and 7 import failures;
the pinned offline dependencies were subsequently installed without metadata
changes. The coordinator owns final integrated full-suite validation.

The selector browser fixture passed at 1440x900, 390x844, 320x740 and 844x390.
It checks offline-Mac to Server selection, explicit unconfigured state,
identical IDs with separate input and checkbox preferences, restored target
state, delayed mutation isolation and uncertain-request recovery after reload.
Lost acknowledgement uses a committed HTTP response followed by an aborted
browser response, and recovery proves one execution with the original identity.
No target change itself executes a task. All recorded geometry checks passed
without horizontal overflow, overlapping recovery/send controls or page errors.
Mobile/narrow login scenarios also pass. Narrow unconfigured, mobile Server
and landscape recovery screenshots were visually inspected.

The existing conversation browser fixture also passed all four viewports,
including direct send, retained history, selected-task polling, actual lost
acknowledgement, original-request recovery and preserved edited input.

Selector and conversation artifacts outside the repository:

- `/private/tmp/execution-target-selector-131-results.json`
- `/private/tmp/execution-target-selector-131-{desktop,mobile,narrow,landscape}-{mac-offline,recovery,server,unconfigured}.png`
- `/private/tmp/execution-target-selector-131-{mobile,narrow}-{invalid-password,projects-pending,projects-failed,session-restored}.png`
- `/private/tmp/execution-target-131-conversations-results.json`

Browser runs use the invocation shown above with the corresponding output
prefix and the installed bundled Playwright/Chromium paths. The last source
edits guard stale error/button state, use a target-scoped action key, describe
recovered archive payloads and restore legacy Mac unknown-operation records;
the focused unit run was repeated after those edits. The recorded four-
viewport browser run precedes these final small changes.

Independent final review, publication, backend integration, installed-service
verification and physical-phone acceptance remain coordinator gates. No
backend, credentials, Git operations or installed services were changed by
this implementer.
