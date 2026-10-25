# Workspace conversations: first UI increment

Issue: #124. Related backend: #114. Worktree base: `fe51a88`.
Environment: local macOS arm64, Node.js v26.0.0, Playwright Chromium.
Evidence class: local unit tests and synthetic browser/HTTP fixtures only.

## Approved behavior

The user's latest instruction, "不要搞草稿确认逻辑，直接执行", supersedes the
earlier #124 brief's draft/confirm UI. New tasks and terminal-task follow-ups
have a single Send action. The page makes one POST to `/api/tasks` or
`/api/tasks/:id/continue`; it does not chain a second confirm request in
JavaScript. The coordinator supplies the backend behavior that starts the
execution as part of that submission. The UI accepts running or completed
full task responses and preserves the existing task/session identity.

Opening a previously saved, unexecuted task never starts it. Its explicit
"执行任务" action calls the existing confirm endpoint with the current
revision and request ID. Text added to its composer remains saved separately;
the UI refuses to append that text to the pending instruction. This is a
compatibility action for existing tasks, not a new confirmation workflow.

## Changes

- Render every retained turn's prompt and output. Show actual bounded event
  fields from the full task: command, command output, exit code, file-change
  paths/status and UTC timestamps. All event content is inserted as text.
  Agent prose is not promoted into a collected check or Diff.
- List summaries refresh navigation without replacing the selected full
  detail. The existing visible-page polling now also fetches the selected
  task. Overlapping detail reads for the same target share one request;
  changed targets and older execution/metadata versions reject late results.
- Continuation requires the selected task/project, a terminal completed,
  failed or cancelled status, a saved UUID and a current revision. Archived,
  deleted, quarantined, busy and stale tasks preserve input and cannot send.
- Pending sends disable repeat submission and voice startup. Explicit legacy
  execution is also guarded against duplicate in-flight dispatch. Existing
  mutation identities are reused for unchanged retries after network
  uncertainty and target switches. No automatic mutation retry is added.
- Delayed results update their own task without changing the current target.
  Only unchanged source text is cleared after success. Edited source text,
  other-target text and frozen voice callbacks retain their original target.
- Current running tasks have a stop action in the conversation, including
  narrow/mobile layouts. Scrolling historical messages survives polling;
  current output follows the end only when already near the end.

## Validation

The first new focused run had 8 expected failures and 4 existing-behavior
passes. Failures reproduced summary replacement, missing history/events,
disabled continuation, absent legacy execution wording, concurrent dispatch,
and overlapping reads. After implementation:

```sh
node --test apps/server/test/workspace-conversations.test.mjs apps/server/test/project-task-tabs.test.mjs apps/server/test/voice-composer.test.mjs apps/server/test/http-server.test.mjs
```

Result: 38 passed, 0 failed. Full `npm test` in `apps/server`: 242 passed,
0 failed. The first full run lacked ignored `ws` dependencies in the Mac
Agent and voice SDK modules; after their pinned `npm ci --ignore-scripts`,
the complete suite passed. Package metadata was not changed.

```sh
VOXCODE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
VOXCODE_PLAYWRIGHT_EXECUTABLE=/absolute/path/to/chromium-headless-shell \
node apps/server/test/workspace-conversations-browser.fixture.mjs
```

The actual run used the installed bundled Playwright module and Chromium
headless shell. macOS denied Chromium's bootstrap port in the outer sandbox;
the same local synthetic fixture was rerun with approved sandbox escalation.
Desktop 1440x900, phone 390x844, narrow 320x740 and landscape 844x390 all passed.
The short landscape check scrolls the existing conversation surface to the
composer, matching its existing behavior under limited height.

Browser checks cover same-session single-request send, all retained turns,
full detail after list summaries, actual selected-task polling, long command
and file path wrapping, execution stop, stable retry identity, a delayed
response after switching projects, and explicit-only legacy task execution.
There were no page errors or horizontal document overflow. Screenshots were
visually inspected for the mobile running state; geometry checks cover all
four sizes.

Local artifacts, outside the repository:

- `/private/tmp/workspace-conversations-124-results.json`
- `/private/tmp/workspace-conversations-124-{desktop,mobile,narrow,landscape}-running.png`
- `/private/tmp/workspace-conversations-124-{desktop,mobile,narrow,landscape}-final.png`

`git diff --check` passed.

## Limits And Handoff

This increment changes only the page, new focused UI tests/browser fixture,
and this verification record. It does not change HTTP/service/RPC/protocol,
the frozen #114/#121 sources, installed services, credentials, provider
configuration or Git state. Backend direct-send integration, independent
reviews, merging, deployed Mac/CLI workflow, real provider voice and physical
phone acceptance remain coordinator work. The synthetic HTTP fixture models
the approved direct-send contract; it does not prove that the base checkout's
older backend already implements it. Project registration/selection UI is the
next separate increment and is not included here.
