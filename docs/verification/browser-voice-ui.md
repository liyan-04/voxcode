# Browser voice input

Issue: Refs #112. Evidence: local synthetic fixtures, 2026-10-25.

The existing phone composer can record through browser microphone permission,
Web Audio and an AudioWorklet. It sends mono 16 kHz signed little-endian PCM in
640-byte / 20 ms frames to authenticated same-origin `/ws/voice`. The browser
requires the `session.ready` and matching `capture.ready` handshake before audio
uplink. It does not retry or replay audio, and does not play TTS output.

Recording freezes the project, task or new-child target and its local draft key.
Switching the displayed project/task does not move the recording target. Partial
recognition is a preview; matching final events replace the candidate. A final
is appended once to the original saved composer input after the stop acknowledgement
and final recognition tail. It does not create, confirm or execute a task. Existing
text and edits in the newly selected target remain intact. Explicit draft creation
and execution confirmation retain their existing boundaries.
Submitting the frozen draft is blocked while its recording/recognition is active;
other targets remain selectable. A pending task creation blocks new recordings.

The browser stops automatically after 29 seconds or 1450 frames, leaving margin
below the server's 30-second / 1500-frame budget. Startup is limited to 15 seconds,
the post-stop recognition tail to 20 seconds, WebSocket buffering to 64 KiB and
transcript candidates to 4000 characters. If only a pre-stop final is available,
it is retained until the bounded tail expires; provider errors commit nothing.
Permission failures, invalid format, socket failure/backpressure, worklet failure,
cancel, hidden visibility and pagehide release tracks, worklet nodes/ports,
AudioContext and socket. Delayed cleanup of an older cancelled capture cannot
overwrite the status of a newly started capture.
Microphone permission granted after cancellation is also released immediately.
Health `voiceAvailable` indicates configuration capability, not a live ASR check.

## Commands And Results

Use Node >=22 and the pinned `apps/server` dependencies:

```sh
node --test apps/server/test/voice-client.test.mjs
node --test apps/server/test/voice-composer.test.mjs
node --check apps/server/public/voice-client.mjs
node --check apps/server/public/voice-worklet.js
node --check apps/server/test/voice-browser.fixture.mjs
git diff --check
```

Focused voice suites: 33/33 pass (31 client, 2 composer). Coverage includes frozen context, exact PCM and
worklet output, latest-final ordering before/after stop, cancellation, late
permission, permission denial, backpressure, startup/tail/frame/time bounds,
provider failure, maximum identifier length, default same-origin WSS resolution,
synchronous AudioContext close failure, immediate processor-error cleanup,
delayed abort/new-session ordering, matching-target submit guards and voice-start
guards during pending creation. Existing HTTP/composer regression suite: 14/14.
Additional client cases validate malformed events/negotiation, foreign origins,
unsafe targets, audio clipping and continuity across frame/callback boundaries.
VM worklet tests identify the real source filename for accurate coverage.

After integration on backend master
`96e18ce0dc3252713ce1736b8247ca4f190de180`, root c8 collection ran
**319/319 tests**, with zero failures/skips/cancellations. Overall line coverage
is 2088/2132 (97.94%) and branch coverage 2108/2482 (84.93%), both above the
exact base's 1955/1999 (97.80%) and 1919/2270 (84.54%).

Run the standalone real-browser fixture with an installed Playwright module and
Chromium executable, without real microphone hardware or provider credentials:

```sh
VOXCODE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
VOXCODE_PLAYWRIGHT_EXECUTABLE=/absolute/path/to/chromium \
node apps/server/test/voice-browser.fixture.mjs
```

The fixture serves the real composer/client/worklet on a loopback ephemeral port,
uses Chromium fake media with real AudioContext/AudioWorklet execution, and mocks
HTTP/WebSocket services. A visible simulation banner labels all screenshots.
Desktop 1440x900, mobile 390x844 and landscape 844x390 pass. Each viewport verifies
frozen project/task selection, preservation of both old and current drafts,
exact 640-byte audio frames, pre-stop candidate followed by final tail, cancel
ignoring late final, pagehide resource release and actual browser permission
denial via Permissions-Policy. There are zero task POSTs and zero page errors.
It also dispatches a controlled hidden visibility event and confirms real browser
tracks/AudioContexts close while the saved input is preserved. This checks the
handler lifecycle; actual phone operating-system background behavior remains open.
Submitting the form during recording produces no task POST.
Document dimensions match the viewport; short landscape content scrolls within
the conversation while the recording stop control remains reachable.

Default generated evidence is `/private/tmp/voice-ui-112-results.json` plus
`/private/tmp/voice-ui-112-{desktop,mobile,landscape}-{recording,final}.png`.
`VOXCODE_VOICE_FIXTURE_OUTPUT` can select another output prefix. The fixture closes
its browser, WebSocket server and TCP sockets on success and failure.

## Limits Of Evidence

This is local synthetic browser evidence. It does not certify real microphone
quality, phone Safari support, deployed HTTPS/WSS or authentication, real Linx
ASR/TTS, actual Codex execution, or outdoor acceptance. Provider correlation and
server routing must be reviewed and verified in the separate backend component.
No real credentials, external voice requests or task mutations were used here.
