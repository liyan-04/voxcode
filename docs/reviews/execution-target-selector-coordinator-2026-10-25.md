# Execution target selector coordinator review

Issue: #131. Reviewer: root coordinator, independent of execution_target_ui.
Disposition: PASS for the integrated selector source and narrow conflict repair.

Reviewed base `fe0d921`, integrated snapshot `9475435` and the repaired page
SHA256 `3d964a15b801f621b56ef5480c8179fce24983674941191680cd99bbaaa287bd`.
The voice client hash is
`97bf367f650a03d56a29e7ebd1072b6bc51d304209ca590d3a5f44928b28d806`.
The final page-test hash is
`3d03601e6a4db930a229c3aa80eed0dd831c233d61a71d742821527f1a8df3ae`.

## Review

Checked request-local target capture, workspace state and storage separation,
late callback guards, login independence, legacy Mac-only storage migration,
pre-dispatch persistence and exact uncertain-request replay. Switching targets
does not dispatch a turn. Unconfigured targets are disabled; availability comes
from authenticated inventory, not a generic health response. Existing HTTP
authorization tests retain their assertions.

The independent architecture review's metadata conflict finding is resolved:
only typed HTTP 409 revision_conflict clears the known-rejected record. The next
explicit operation uses refreshed metadata and a new identity. Ambiguous errors
retain the original payload. Cleanup persistence failure restores that identity
after either success or rejection. No unresolved actionable finding remains.

## Verification

Coordinator independently ran the six-file focused command in
`docs/verification/execution-target-ui.md`: 93/93 passed, exit 0. Repeated the
complete serial suite with `node --test --test-concurrency=1 --test-reporter=dot
scripts/test/*.test.mjs apps/server/test/*.test.mjs packages/voice/test/*.test.js`:
414 cases passed, exit 0. `git diff --check` passed.

The final real Chromium fixture passed with errors=[] at desktop 1440x900,
mobile 390x844, narrow 320x740 and landscape 844x390. Login offline/discovery
checks also passed at both mobile widths. The coordinator reran it after the
repair and visually inspected the narrow recovery screenshot. Results and
screenshots are `/private/tmp/voxcode-131-final-browser-*`. This is controlled
HTTP/browser evidence, not physical-phone or provider acceptance.

Serial coverage collection used the exact fe0d921 baseline and the final source
with identical concurrency. Gate passed: changed runtime lines 3/3 and branches
20/20; overall lines 2282/2326 unchanged, branches 2431/2813 versus 2427/2809
increased. HTML page behavior is covered by the focused regressions/browser
fixtures; inline HTML is outside the runtime coverage instrumenter's scope.
The gate must be rerun against the final committed head before publishing.

## Limits

This adds selection and isolation; it does not provision the server executor,
create projects or synchronize native Codex sessions. Installed gateway and
physical-phone acceptance are separate from these local checks. No installed
Mac service or credentials were changed during this review.
