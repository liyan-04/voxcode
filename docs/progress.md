# Progress and verification

## 2026-10-23: initialization
- Remote liyan-04/voxcode verified empty via gh repo view; cloned under workspace.
- Node v26.0.0; codex-cli 0.154.0 available.
- xcodebuild unavailable: selected directory is CommandLineTools; no Xcode in /Applications.
- User authorized parallel development and two expert reviews per component.
- User selected native iOS explicitly; no PWA substitution.
- Three implementers dispatched in parallel: apps/mac, apps/ios, packages/voice; coordinator owns shared integration and records.
- No implementation acceptance claimed. Native build/signing remains blocked by absent Xcode.

## 2026-10-23: parallel implementation and first fixes
- Three source components implemented: native SwiftUI client, Mac task bridge, Linx protocol adapter. Remote relay/connector added after user made outdoor operation core.
- Mac tests cover auth expiry/revocation, durable request replay, two worktrees, cancellation ownership, approvals and bounded evidence.
- iOS core checks reached 27 assertions; syntax/plist checks pass. No actual iOS build/signing/device validation.
- Voice adapter 9 tests; relay 13 tests; integrated voice 4 tests after replay/capacity fixes.
- Root npm test: 43 passed, 0 failed. These are local/fixture tests, not real Linx/model/device verification.
- Prior reviews: two for iOS, two for voice, first Mac/security and relay/security. Independent second Mac/relay reviews in progress; do not label all review gates complete.
- Read-only bili-xs8 check: 9899 showed no TCP listener. Subsequent JumpServer auth refresh failed HTTP403. No remote write/deployment performed.
- Trusted public TLS endpoint still needed. User supplied public IP:9899 and chose to provide another server/domain.
- Requirements audit records actual product gaps, particularly native build, live voice, continuous Codex context and phone preview.

## 2026-10-23: proposal review before further implementation
- User requested a written proposal first and confirmation before continuing. Source edits, live integration and deployment are paused; existing work is retained.
- Product proposal: docs/product-proposal.zh-CN.md. It covers outdoor native control, Linx dialogue/tools, continuous owned Codex sessions, two-task routing, real preview/evidence, acceptance, resources and a two-day plan.
- Two independent reviewers were assigned document-only mobile/product and architecture/Linx reviews. No new source fix or live delivery is claimed during this pause.
- Both document-only reviews are complete: docs/reviews/proposal-mobile.md and docs/reviews/proposal-architecture.md. Their recommendations were incorporated into the proposal; user scope confirmation and live verification remain pending.
- Latest full local Node run before the pause: 48 passed, 0 failed. This does not certify native installation, real Linx speech, real Codex model edits or outdoor access.

## 2026-10-23: HTTP/IP and concurrency clarification
- User has HTTP + IP only, not a domain or existing HTTPS, and rejected a fixed maximum of two concurrent tasks.
- Revised design proposes project-managed TLS at the same IP:9899 with IP-SAN certificate and explicit iOS/Mac trust. No pre-existing HTTPS or domain is required from the user. Same-origin preview requires strictly separate preview and control authorization.
- Revised task proposal separates at least 20 managed tasks from four default execution slots, configurable 1–8, with queuing. Four-way real execution becomes the proposed acceptance target; eight-way performance is not claimed.
- Read-only architecture/mobile follow-up recorded in docs/reviews/network-and-concurrency-followup.md. Only proposal/decision/status documents changed; source, engineering rules, tests and deployment remain paused until confirmation.
