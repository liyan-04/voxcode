# Review ledger

Each component needs two independent reviews. Review reports state scope, severity, evidence, fixes and residual risk. Do not label a component approved before resolving P0/P1 findings.

| Component | Reviewer 1 | Reviewer 2 | Resolution |
| --- | --- | --- | --- |
| Phone client | pending | pending | pending |
| Mac executor | pending | pending | pending |
| Linx voice | pending | pending | pending |

## Prior design review findings
- No naked App Server exposure; local stdio plus authenticated bridge.
- Freeze voice target at recording start and deduplicate requests.
- Worktrees do not isolate ports or database state.
- Cancellation is asynchronous, never rollback.
- Approvals, completion and acceptance are independent.
- iOS background connections are not reliable; snapshot resync is mandatory.
- Phone preview and evidence must bind task/version.
- Actual AirPlay compliance requires organizer confirmation and receiver test.
