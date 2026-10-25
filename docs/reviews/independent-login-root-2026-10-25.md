# Independent login coordinator review

Refs #131. Reviewer: coordinator, independent of execution_target_ui.
Page SHA256: `852a9ce57611badfad9b0573e4896a13dc8fd0697046df227e5d603f776b0496`.

PASS for this isolated change. Inspected the actual delta against merged
conversation UI. Successful login establishes authentication and closes the
dialog before executor/project discovery; workspace discovery catches its own
errors. Existing-cookie discovery uses the authenticated non-RPC inventory.
A generation prevents a stale 401 from invalidating a later successful login.

Coordinator ran the six new page regressions with conversation, task tabs,
voice composer and current HTTP tests: 48 passed, 0 failed. The additional
HTTP continuation test comes from merged master. Author separately checked
390px and 320px real Chromium fixtures; this reviewer did not repeat those
screenshots. These are synthetic/local checks, not physical phone evidence.

The inventory endpoint requires backend Issue #128 before deployment. Server
or Mac executor unavailability must remain a workspace state. Execution-target
selection and device-scoped caches are a separate implementation milestone.
