# Decisions and optimization log

Record concise rationale, considered alternatives, evidence and consequences. This is not a private chain-of-thought transcript.

## D001: Own execution sessions
Use Codex sessions created by the Mac service. Desktop session takeover is unverified and can introduce competing control. Cost: existing desktop chats are not initially manageable.

## D002: Two-day scope
Initially one project and two independent tasks. Outdoor remote mode superseded LAN-only scope in D005. The user subsequently rejected the two-task concurrency limit; see D008. Defer automatic merge/publish and voice rollback.

## D003: Native iOS selected
User explicitly selected a native iOS installable app after PWA/native clarification. Use SwiftUI and native audio capture. Xcode is not installed here, so source/core tests can proceed but simulator, signing and device installation require an Xcode environment. Cost: native delivery has a toolchain gate; do not substitute a PWA silently.

## D004: Durable snapshots before streaming complexity
Use authenticated polling and persisted snapshots/events for initial task progress. Cost: bounded polling latency; upgrade to streaming only if measurements justify it.

## Optimization backlog
- Measure voice/STT and task-event latency before optimizing.
- Add APNs only after foreground and reconnect pass.
- Add preview reverse proxy only with strict task-to-port authorization.
- Add cross-project task dependencies and integration only after isolation passes.

## D005: Outdoor remote access is core
User requires iPhone on cellular with company Mac elsewhere. Add an encrypted public relay and outbound Mac connection with separate machine credential and phone pairing. The user later clarified HTTP + IP only; D009 supersedes the earlier assumption of a user-provided domain/TLS endpoint. Deployment and real network checks remain delivery gates.

## D006: Voice drafts before mutation
Initial voice path produces editable STT and requires phone submission. Deep Linx integration adds read-only and draft tools first; no duplicate model-triggered and transcript-triggered execution. Cost: first demo is less conversational, but target routing and duplicate prevention are verifiable.

## D007: Confirm revised proposal before resuming
On 2026-10-23 the user requested the proposal first and implementation only after agreement. Pause source edits, live integration and deployment; preserve existing work. docs/product-proposal.zh-CN.md is the review draft, covering concrete phone workflows, delivery boundaries, Linx tools, session continuity, preview and acceptance. Proposed scope is not user approval and must not be recorded as delivered behavior.

## D008: Separate task capacity from execution concurrency
The user rejected a fixed maximum of two concurrent tasks. Revised proposal: at least 20 unarchived tasks in the mobile list, four execution slots by default, configurable 1–8, with queued work beyond the configured limit. One active turn per task; stopping and pending Codex approval retain their slot. Lowering the limit affects future dispatch only. Four real parallel tasks become the proposed acceptance target; eight-way runtime performance remains a separate measurement. This updates the design proposal only; existing code and engineering rules must be revised together after confirmation.

## D009: HTTP + IP is the available resource, not a domain requirement
The user has HTTP + public IP, without existing HTTPS or a domain. Proposed route: project-managed TLS on the same IP:9899, an IP-SAN certificate issued by a dedicated private CA, and explicit client trust/pinning for iOS and Mac. iOS 17+ supports IP-specific ATS exceptions; strictly validate identity in both URLSession and WKWebView and refuse plaintext at the app level. Domainless TLS is possible but not yet verified here. Same-origin preview is allowed with independent task/version preview credentials and native-only API bearer; cookie scope alone is not the authorization boundary. Public plaintext HTTP is technically configurable but is not the remote-control baseline. Deployment remains paused and the occupied-port stop rule remains binding.
