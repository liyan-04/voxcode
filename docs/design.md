# VoxCode MVP design

## Goal
Within two days demonstrate two independent development tasks controlled from an iPhone, executed by local Mac Codex, inspected through real results, and accepted by the user. Linx AI handles voice recognition and interaction. AirPlay mirrors the Mac workspace using the system feature.

## Boundaries
- One Mac, one explicitly selected Git project, two execution slots.
- Client is native iOS SwiftUI, explicitly selected by user. Xcode and signing are required for device delivery; Mac development execution remains Codex.
- Own Codex sessions only; no promise of taking over active Desktop IDE sessions.
- Local network initially. Native app requires microphone and local-network permissions. Remote transport must protect credentials; any temporary LAN-only exception must be explicit and documented.
- No automatic merge, publish, arbitrary shell endpoint, general remote desktop or voice-based privilege approval.
- Real voice and real Codex modes must be clearly separated from fixtures used in tests.

## Components
1. Phone client: pairing, task list/detail, frozen voice target, editable transcript, evidence, approvals and acceptance.
2. Mac bridge: authorization, persistent tasks/events, idempotent commands, scheduling, isolated worktrees, Codex adapter and controlled preview access.
3. Voice adapter: server-side Linx device WebSocket, PCM input, STT/TTS events and narrowly scoped task tools. Device registration and production credentials require real verification.

## State
Execution: queued, running, waiting_input, waiting_approval, stopping, interrupted, failed, completed.
Acceptance: pending or accepted, separate from execution. Accepted evidence is version-bound and invalid after further edits.
No synthetic progress percentage. Natural-language phases are explanatory only.

## Security
Mac bridge binds to loopback by default. Remote access requires explicit configuration, authenticated pairing and trusted HTTPS. Never expose Codex App Server directly. Credentials are not returned to the phone or committed. Requests and approvals bind task identity and version. Tests must cover unauthorized and stale mutations.

## Sources and uncertainty
- https://developers.openai.com/codex/app-server/ : structured Codex integration; installed-version schema requires verification.
- https://linx.qiniu.com/docs/xrobot/platform/websocket : device headers, hello, PCM/Opus, STT/TTS.
- https://linx.qiniu.com/docs/xrobot/mcp/software-mcp : cloud tool integration and session headers.
- https://linx.qiniu.com/docs/xrobot/mcp/hardware-mcp : tools over device connection.
- Existing desktop conversation ownership, live Linx registration, TTS decoding and AirPlay acceptance remain explicit verification gates.
