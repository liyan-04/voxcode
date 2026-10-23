# Decisions and optimization log

Record concise rationale, considered alternatives, evidence and consequences. This is not a private chain-of-thought transcript.

## D001: Own execution sessions
Use Codex sessions created by the Mac service. Desktop session takeover is unverified and can introduce competing control. Cost: existing desktop chats are not initially manageable.

## D002: Two-day scope
One project, two independent tasks, LAN only. Defer remote internet access, automatic merge/publish and voice rollback. Cost: narrower product, lower integration risk.

## D003: Native iOS selected
User explicitly selected a native iOS installable app after PWA/native clarification. Use SwiftUI and native audio capture. Xcode is not installed here, so source/core tests can proceed but simulator, signing and device installation require an Xcode environment. Cost: native delivery has a toolchain gate; do not substitute a PWA silently.

## D004: Durable snapshots before streaming complexity
Use authenticated polling and persisted snapshots/events for initial task progress. Cost: bounded polling latency; upgrade to streaming only if measurements justify it.

## Optimization backlog
- Measure voice/STT and task-event latency before optimizing.
- Add APNs only after foreground and reconnect pass.
- Add preview reverse proxy only with strict task-to-port authorization.
- Add cross-project task dependencies and integration only after isolation passes.
