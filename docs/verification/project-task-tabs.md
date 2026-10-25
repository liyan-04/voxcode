# Project-selected task tabs

Issue: #118. Date: 2026-10-25. Owner: mac_agent_probe. Evidence: local and fixture only.

## Behavior and decisions

- Each enabled project's explicit checkbox controls whether all its tasks appear in the top strip under the current active/archive/trash classification. The old 20-opened-task cap is removed.
- First use selects all enabled projects. The origin-local `localStorage` key `voxcode:tab-projects` persists explicit choices, including `[]`. Opening a project or task does not change those choices. Newly added projects do not silently join an already saved selection.
- Actual task tabs come from task data. They have no individual close action, since that would conflict with showing every matching selected task. New-task and new-child draft tabs keep their existing close action and saved input. Draft tabs precede the recency-sorted task set and appear in the active classification.
- Task ordering uses descending `lastConversationAt`, with `createdAt` as the only legacy fallback. Finite numeric milliseconds and ISO strings are accepted; invalid/missing values fall back to creation time, then zero. Ties use ascending task ID, then project ID. `updatedAt`, opening, reading, polling and archive metadata do not change recency.
- Backend issue #114 supplies the real conversation timestamps. This UI change does not create timestamps or change backend/RPC state.
- The single horizontal strip has previous/next controls and a count of actual tasks. Each arrow moves immediately to the adjacent task boundary, bounded by the scroll endpoints. Full title/project/parent context is available in the tab button's accessible name and title.
- Project/task/child IDs, per-target session drafts and the voice target frozen at recording start remain intact. An unchecked project's currently viewed task or recording target stays the current target.

## Regression investigation

The first browser run found a long task skipped by a viewport-fraction scroll step. Scroll snapping exposed a second failure: on a 390px viewport, the existing four-second polling render rebuilt the tab nodes during smooth movement and canceled it. Instrumentation observed `6353 -> 6366 -> render -> 6353` at approximately eight seconds, while the next control remained enabled. Adjacent-boundary synchronous scrolling removes both the skipped-boundary problem and the pending animation that polling could cancel. Temporary tracing was removed; failure diagnostics retain scroll geometry.

The focused arrow regression was observed failing before the fix (`216 !== 171`) and passing afterward. The initial eight feature regressions had also been observed failing before implementation.

## Commands and results

Environment: macOS Darwin arm64, Node.js v26.0.0. The existing pinned server dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund --cache /private/tmp/codex-118-npm-cache` in `apps/server`; no dependency metadata changed.

```sh
node --test apps/server/test/project-task-tabs.test.mjs apps/server/test/voice-composer.test.mjs apps/server/test/http-server.test.mjs
```

Result: 26/26 passed (9 project-tab, 2 voice-composer, 15 HTTP/UI regressions).

```sh
VOXCODE_PLAYWRIGHT_MODULE=/Users/liyan2026mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs VOXCODE_PLAYWRIGHT_EXECUTABLE=/Users/liyan2026mac/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell node apps/server/test/project-task-tabs-browser.fixture.mjs
```

Result: exit 0. Four viewports passed: 1440x900 desktop, 390x844 phone, 320x740 narrow phone, 844x390 landscape. Each reached all 40 active long-title tasks with the actual arrow buttons. The fixture also checks checkbox persistence/reload, all visibility classifications, recency refresh, preserved draft text and voice transcript delivery to the original Alpha draft after unchecking Alpha and navigating to Beta. It observed 107 real AudioWorklet PCM frames from browser fake media, zero task POSTs and zero browser errors.

Geometry assertions check no outer document overflow, header/tab/workspace separation, and the whole composer and voice control within the viewport. In short landscape, the fixture scrolls the existing conversation container to the composer before checking its complete visibility. It does not assert that all conversation content and the composer fit simultaneously in 390px height.

Artifacts outside Git: `/private/tmp/project-task-tabs-118-results.json` and `/private/tmp/project-task-tabs-118-{desktop,mobile,narrow,landscape}-{first,overflow,final}.png`. Desktop, mobile, narrow and landscape screenshots were visually inspected. These paths are machine-local reproducible artifacts, not deployment evidence.

Additional checks: `node --check` for both new test files; inline JavaScript parsed/executed by the VM and Chromium; `git diff --check` and `git diff --no-index --check /dev/null <new-file>` for each added file.

## Remaining gates

Two independent reviews and coordinator integration remain required. No Git mutation, PR, deployment, real microphone, actual Linx provider, actual Codex execution, Safari/iPhone device or outdoor network validation was performed by this worker. The fixture uses synthetic tasks and loopback HTTP/WebSocket responses; it proves local browser behavior only.
