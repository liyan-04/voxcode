# Browser Voice UI Reviews

Refs #112. Implementer: mac_agent_probe. Reviewers: coordinator and linx_audit.
AI source review and synthetic browser evidence do not constitute phone acceptance.

## Coordinator

Reviewed the client, AudioWorklet, composer integration and frozen draft handling.
Requested guards preventing voice start during a pending create, and preventing
submission of the matching draft during recording/recognition. Both are fixed
with focused composer regressions. Independently ran the final 33/33 client,
composer and existing HTTP tests; no actionable findings remain.

## Linx/backend review

Initial review found two P2 issues: hiding the document retained the microphone,
and an old asynchronous abort could overwrite the state of a replacement capture.
The final revision aborts on hidden and guards abort completion by capture
generation. The reviewer independently reran 33/33 tests and verified both fixes.

Reviewed production SHA256 values:

```text
b2206abcae8b2b9095fb02d86adea2d9c2681fc9f3d62fe557e896deaa8fa98f  apps/server/public/index.html
8460a53e1a67ef77644ee1f2fd6ee4cb986dc58a82603522cdb1b6bf27b3c28a  apps/server/public/voice-client.mjs
fe53c86c944582dabfb41c64d51d7ff077fa098656c1f03bec6112d5b249cafd  apps/server/public/voice-worklet.js
```

## Browser evidence

Real Chromium/AudioWorklet with fake microphone passed desktop 1440x900, mobile
390x844 and landscape 844x390. The fixture observed exact 640-byte PCM frames,
frozen project/task drafts, permission denial, abort, hidden/pagehide cleanup,
and zero task POSTs or page errors. Screenshots were inspected. This proves the
browser implementation with synthetic media; live Linx, physical microphone,
phone Safari and deployed voice-to-confirmed-Mac execution remain separate gates.
