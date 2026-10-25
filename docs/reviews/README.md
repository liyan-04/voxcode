# Review ledger

Each implementation component needs two reviewers independent of its implementer. Review reports state revision/snapshot, scope, severity, evidence, fixes and residual risk. Do not label a component approved before resolving P0/P1 findings. AI reports are not human GitHub approvals or user acceptance.

## Current phone-demo gates

Reports retain their original findings and targeted resolutions. Source review, CI,
signed-device tests and outdoor acceptance are separate gates. The historical
initial reviews below apply only to their original snapshots.

| Component | Reviewer 1 | Reviewer 2 | Resolution |
| --- | --- | --- | --- |
| Phone client | [Platform](phone-demo-ios-platform.md), `/root/architecture_review` | [Execution/client](phone-demo-ios-execution.md), `/root/mac_v1` | Original findings and equal-time replay follow-up resolved in source5c2b9a7; exact-source native CI39988267625 passed |
| Mac executor | [Independent fixes](phone-demo-mac-independent.md), `/root/architecture_review` | [Client/recovery](phone-demo-mac-client.md), `/root/ios_v1` | Sourcef4114f2, both independent full74/74; original authorization/approval and UTF-8 findings resolved |
| Relay | [Security](phone-demo-relay-security.md), `/root/mac_v1` | [Client](phone-demo-relay-client.md), `/root/ios_v1` | Sourcede8fc2d; both targeted follow-ups and LinuxNode22 CI passed |
| Linx voice/integration | [Execution](phone-demo-voice-execution.md) / [follow-up](phone-demo-voice-followup.md), `/root/mac_v1` | [Independent tools/runtime](phone-demo-voice-independent.md), `/root/architecture_review` | Sourcebdd7f29; authorization/close/TTL/criteria findings resolved; independent26/26 |
| Preview (deferred) | not scheduled | not scheduled | Outside the first phone-demo scope; review required if resumed |

## Repository policy

| Scope | Correctness/security | Collaboration/process | Resolution |
| --- | --- | --- | --- |
| Commit/PR and multi-agent policy | [report](policy-security.md) | [report](policy-workflow.md) | Three P2 findings fixed and rereviewed; local policy tests 13/13. Remote CI tracked in docs/progress.md. |

## Phone-demo scope and architect role

Two independent document-only [reviews](phone-demo-scope.md) cover the historical scope reduction and architect coordination rules. Three findings were fixed; both targeted rereviews reported no residual findings or conflicts. These checks do not approve the implementations above. The dated ARCH-003 checkpoint was historical integration evidence and has been removed from the current architecture entry points. The original Relay security reviewer was unavailable for final Mac follow-up; an independent platform/security reviewer completed it. The iOS reviewer reported the voice criteria defect, then final second voice review was reassigned to that independent reviewer while iOS closed its own fixes. Implementers did not approve their own components.

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
