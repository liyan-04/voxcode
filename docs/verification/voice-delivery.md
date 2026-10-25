# Voice delivery M1 verification

Issue #153 M1 adds an authoritative `task.progress` receipt to the authenticated
voice execution path. Once task admission and the first task read return a
frozen `executionTarget`, `projectId`, `taskId`, `requestId`, `status` and
`revision`, the server sends a bounded progress event before waiting for the
long-running tool result. The browser validates the capture and request
identity, opens that actual task when the original target view is still active,
and uses the authenticated task detail GET for subsequent state.

The progress event accepts only nonterminal task states (`draft`, `queued`,
`running`, `cancelling`). Terminal output remains in `tool.result`; rejected
and unknown mutation outcomes do not manufacture a progress receipt. Optional
progress fields are limited to bounded `title`, `error` and `exitCode` values.
Arguments, prompts, tokens and raw provider payloads are never forwarded.

## Local and fixture evidence

All checks below ran in `/private/tmp/voxcode-153-voice-delivery` on the M1
implementation snapshot. They use controlled adapters and browser/provider
fixtures; they do not establish Linx, Codex, phone, cellular, deployment or
live execution success.

```text
node --test apps/server/test/voice-tools.test.mjs \
  apps/server/test/voice-client.test.mjs \
  apps/server/test/voice-composer.test.mjs \
  apps/server/test/voice-transport.test.mjs \
  apps/server/test/voice-provider.test.mjs \
  packages/voice/test/*.test.js
136 passed, 0 failed
```

The focused coverage includes early admission before a bounded result wait,
single-mutation replay, rejected/unknown outcomes, frozen target and
capture/request identity checks, old navigation isolation, bounded progress
fields, and transport rejection after abort or context mismatch.

After installing the repository's existing locked dependencies in the isolated
worktree, the complete repository command also passed:

```text
npm test
500 passed, 0 failed, 1 skipped (pre-existing owned-fixture skip)
```

The browser fixture was run with the bundled Playwright Chromium entry and
headless shell for desktop, mobile and landscape viewports. It passed with
zero page errors and zero task POSTs. Its progress capture negotiated
`writeReady=true`, received nonzero PCM output, opened the real fixture task
before the terminal result, and requested its authenticated task detail. The
same fixture retains the existing draft, abort, hidden-page, pagehide and
permission-denial checks.

## Remaining gates

The M1 source and fixture evidence does not prove a live Linx `tools/list` or
`tools/call`, real Mac execution, same-task continuation, physical phone audio,
or deployment. Continuous realtime conversation, overlapping input/output,
barge-in and the bounded per-utterance lifecycle remain the next milestone.
