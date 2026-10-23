# VoxCode MVP design

Status: user confirmed continuation of [the revised product proposal](product-proposal.zh-CN.md) on 2026-10-23. Implementation resumed; deployment remains deferred. Existing implementation evidence and remaining gaps are recorded separately.

## Goal
Within two days demonstrate independent development tasks controlled from an iPhone, executed by local Mac Codex, inspected through real results, and accepted by the user. The revised proposal targets at least 20 managed tasks, four default execution slots and configurable 1–8 slots, following the user's rejection of the original two-slot limit. Linx AI handles voice recognition and interaction. AirPlay mirrors the Mac workspace using the system feature.

## Boundaries
- One Mac, one explicitly selected Git project. Proposed configurable execution slots replace the original fixed two-slot design after user confirmation; current source still requires corresponding changes.
- Client is native iOS SwiftUI, explicitly selected by user. Xcode and signing are required for device delivery; Mac development execution remains Codex.
- Own Codex sessions only; no promise of taking over active Desktop IDE sessions.
- Outdoor iPhone -> company Mac is a core requirement. Available resource is HTTP + IP:9899; no domain or existing HTTPS is required from the user. Revised proposal adds project-managed IP-SAN TLS with explicit client trust and Mac-initiated outbound WSS; iOS URLSession and WKWebView trust require separate validation. Deployment remains deferred. Native microphone permission is required; local-network permission applies to local debugging.
- No automatic merge, publish, arbitrary shell endpoint, general remote desktop or voice-based privilege approval.
- Real voice and real Codex modes must be clearly separated from fixtures used in tests.

## Components
1. Phone client: pairing, task list/detail, frozen voice target, editable transcript, evidence, approvals and acceptance.
2. Mac bridge: authorization, persistent tasks/events, idempotent commands, scheduling, isolated worktrees, Codex adapter and controlled preview access.
3. Voice adapter: server-side Linx device WebSocket, PCM input, STT/TTS events and narrowly scoped task tools. Device registration and production credentials require real verification.
4. Public relay: authenticated outbound Mac connector, strict HTTP API forwarding, deadlines and offline handling; never expose Codex App Server. Preview forwarding requires a separately authorized implementation before remote preview can be claimed.

## State
Execution: queued, running, waiting_input, waiting_approval, stopping, interrupted, failed, completed.
Acceptance: pending or accepted, separate from execution. Accepted evidence is version-bound and invalid after further edits.
No synthetic progress percentage. Natural-language phases are explanatory only.

## Security
Mac bridge binds to loopback by default. Remote access requires explicit configuration, authenticated pairing and authenticated encryption. The revised proposal uses TLS on the existing IP with explicit trust, not a required user-supplied domain or public-CA certificate. Never expose Codex App Server directly. Provider credentials are not returned to the phone or committed. Requests and approvals bind task identity and version. Tests must cover unauthorized and stale mutations. Design changes remain pending user confirmation before source edits.

## Sources and uncertainty
- https://developers.openai.com/codex/app-server/ : structured Codex integration; installed-version schema requires verification.
- https://linx.qiniu.com/docs/xrobot/platform/websocket : device headers, hello, PCM/Opus, STT/TTS.
- https://linx.qiniu.com/docs/xrobot/mcp/software-mcp : cloud tool integration and session headers.
- https://linx.qiniu.com/docs/xrobot/mcp/hardware-mcp : tools over device connection.
- Existing desktop conversation ownership, live Linx registration, TTS decoding and AirPlay acceptance remain explicit verification gates.

## Delivery assessment
Read docs/requirements-audit.md before calling this design delivered. Its architecture fits the stated direction, but source modules do not replace real native installation, trusted remote connectivity, live Codex/Linx execution or a phone-visible preview. docs/research/competitors-mobile.md establishes that remote voice dispatch and natural voice dialogue already overlap competitors; the proposed differentiator is a verifiable criteria-to-evidence acceptance flow, still to be demonstrated.
