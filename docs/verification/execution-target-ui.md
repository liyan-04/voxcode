# Execution Target UI: Login Milestone

Issue: #131. This first milestone changes authentication only. The coordinator
will allocate the target selector and target isolation work separately after
this capability is reviewed and integrated.

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

The page still uses its existing default executor and connection polling.
This increment adds no selector, target switching, voice context changes or
pending-request persistence. Those remain the next #131 milestone, including
target-scoped identities across reload. Login success is independent of the
new inventory endpoint; restoring an existing session depends on #128 making
that authenticated endpoint available without Mac RPC. The coordinator must
integrate that backend dependency before claiming session-restoration support
for an installed service.

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

`git diff --check` passed. Independent review, backend integration, source
publication, installed-service verification and physical-phone acceptance
remain coordinator gates. No backend, Git state, credentials, installed
services or live processes were changed by this implementer.
