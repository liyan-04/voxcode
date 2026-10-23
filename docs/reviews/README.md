# Review ledger

Each implementation component needs two reviewers independent of its implementer. Review reports state revision/snapshot, scope, severity, evidence, fixes and residual risk. Do not label a component approved before resolving P0/P1 findings. AI reports are not human GitHub approvals or user acceptance.

## Current implementation-v1 gates

Historical initial reviews below are evidence for their original snapshots only. In-progress v1 changes need fresh reviews; the pending rows do not imply the historical reports are missing.

| Component | Reviewer 1 | Reviewer 2 | Resolution |
| --- | --- | --- | --- |
| Phone client v1 | pending | pending | incomplete native integration |
| Mac executor v1 | pending | pending | incomplete scheduling/session changes |
| Relay v1 | pending | pending | TLS/preview work pending |
| Linx voice/integration v1 | pending | pending | tools/audio work pending |
| Preview v1 | pending | pending | implementation pending |

## Repository policy

| Scope | Correctness/security | Collaboration/process | Resolution |
| --- | --- | --- | --- |
| Commit/PR and multi-agent policy | [report](policy-security.md) | [report](policy-workflow.md) | Three P2 findings fixed and rereviewed; local policy tests 13/13. Remote CI tracked in docs/progress.md. |

## Historical initial reports

- iOS: [protocol](ios-protocol.md), [platform](ios-platform.md).
- Mac: [security](mac-security.md), [platform](mac-platform.md).
- Voice: [security](voice-security.md), [platform](voice-platform.md).
- Relay: [security](relay-security.md), [platform](relay-platform.md).
- Shared integration: [follow-up](integration-followup.md).

## Prior design review findings
- No naked App Server exposure; local stdio plus authenticated bridge.
- Freeze voice target at recording start and deduplicate requests.
- Worktrees do not isolate ports or database state.
- Cancellation is asynchronous, never rollback.
- Approvals, completion and acceptance are independent.
- iOS background connections are not reliable; snapshot resync is mandatory.
- Phone preview and evidence must bind task/version.
- Actual AirPlay compliance requires organizer confirmation and receiver test.
