# Workspace conversation UI review

Reviewer: coordinator, independent of gateway_impl. Refs #124.
Snapshot: index.html SHA256
`fb3d77a35e84a84264af9256b07674fff0c4e2ab3198325609dc74b1b63f5dbc`.

Inspected the actual page diff, request paths, state guards, history rendering,
polling, mutation deduplication and synthetic browser fixture. No blocking
finding in this increment. All task-derived text is inserted using textContent;
list summaries retain full task data and selected-detail reads reject late or
older versions. Delayed mutations preserve edited text and current navigation.
Continuation sends one request to the existing task with current revision.

Executed locally: `node --test apps/server/test/workspace-conversations.test.mjs
apps/server/test/project-task-tabs.test.mjs apps/server/test/voice-composer.test.mjs
apps/server/test/http-server.test.mjs`: 38 passed, 0 failed. This review does
not substitute for the separate browser/platform review or live deployment.

Dependencies and residual limits: direct-submit backend #126 must precede
production use. Login currently combines authentication with loading projects;
the requested independent login and server/Mac selector are the next distinct
increment. Project creation and device MCP are not implemented by this PR.

## Recovery follow-up

The second review reproduced a lost response after execution: a newer polled
revision changed the continuation fingerprint and could send a duplicate turn.
execution_target_ui fixed the page and added three regressions, including an
actual lost acknowledgement after commit and edited-input recovery. Coordinator
inspected the final diff and reran the same focused command: 41 passed.
Final index.html SHA256:
`ab937c4fb26fa75b0e5efeec86966b13e8a527cc35436ea3e06b1d0924421609`.
No remaining blocking finding. Recovery reuses the original request and payload
regardless of newer task revisions. A visible composer action reconciles that
request while preserving edits. This action recovers transport uncertainty;
ordinary sends still execute directly. PR #133 supplies the merged backend.
