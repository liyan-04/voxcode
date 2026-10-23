# Independent Mac platform and protocol review

Reviewer: independent expert 2, inspecting another implementer's code. Date: 2026-10-23.
Scope: `apps/mac`, `AGENTS.md`, design/contract/plan and the earlier `mac-security.md`. No implementation changes or commits. Tests use local fixtures; no model turn or live provider request was made.

## Findings

1. **P1 - Abrupt bridge termination loses ownership of still-running task processes.** `apps/mac/codex.mjs:35-40` starts detached process groups, but `apps/mac/service.mjs:139-147` retains their ownership only in memory. Startup at `service.mjs:102-115` changes active tasks to `interrupted` without stopping or accounting for the existing processes; `pump()` can then run queued tasks and a follow-up can reuse the same worktree. Reproduction: launched the actual service and actual Codex adapter with the existing `cancel` subprocess fixture, waited for its descendant heartbeat, killed only the bridge with SIGKILL, and reopened the same data directory. Result: `heartbeatContinuesAfterBridgeKilled=true`, `appServerAlive=true`, `recoveredStatus=interrupted`, `recoveredActiveSlots=0`. Thus restart can exceed two real executions and allow simultaneous writes in a resumed task's worktree. The reviewer explicitly killed the leftover fixture process group afterward. Persist recoverable ownership information with process-identity checks, or retain a durable unclean-execution quarantine that blocks new execution/worktree reuse until local recovery confirms termination. Cover abrupt death plus restart, not only graceful cancellation. The README claim that restart interrupts active execution is currently stronger than the implementation.

2. **P2 - The mutation quota prevents decisions on already-running approvals.** The blanket check at `apps/mac/service.mjs:298-303` exempts only cancellation. After 128 saved mutations, `approval` receives 429 even for a currently displayed valid approval, so the user cannot explicitly accept or decline it; the timer eventually declines it instead. Reproduced with two created tasks and 126 valid acceptance mutations on the completed task, followed by a command approval on the still-running task: `{approvalRejected:{status:429,code:throttled},actualDecision:decline,status:running}`. Reserve bounded decision capacity for work already admitted, and reject new work early enough to preserve that capacity. Test acceptance and decline at the quota, including replay. Cancellation remains available as documented.

No P0 identified. P1 must be resolved before claiming restart-safe execution or readiness for unattended remote control.

## Prior Security Findings

| Earlier finding | Verification and resolution |
| --- | --- |
| P1 credentials cannot be revoked | Resolved for the Mac API: SHA-256 verifiers, per-session records, seven-day default expiry, per-device revoke, authenticated unpair and local revoke-all exist. Auth and HTTP tests pass. Integrated voice must subscribe to authorization changes and close retained sessions; this report does not certify that integration. |
| P1 cancellation releases execution ownership early | Resolved for graceful cancellation in the supported POSIX process group: TERM, bounded grace, KILL, direct child close and group disappearance are awaited; service holds/quarantines the slot and awaits shutdown. Real subprocess/descendant regression passes. Abrupt bridge death remains the distinct P1 above. Deliberately detached descendants and arbitrary runtime ports remain unsupported. |
| P1 file-change approval omits scope | Resolved by failing closed: every `item/fileChange/requestApproval` receives `decline` and an explicit event. Fixture regression passes. No claim of supported file-write elevation is warranted. |
| P1 final evidence omits new files | Resolved for successful runs: final Git status plus tracked diffs and untracked source contents are captured after process shutdown, with filtering and truncation labels. New-file/secret-name/symlink regression passes. Failed and cancelled runs do not collect the final snapshot because the adapter exits through the rejection path. |
| P2 unbounded persistent events/evidence | Substantially resolved: 32 tasks, bounded evidence/events and 128 normal mutations impose an explicit stop-and-archive quota. Tests verify truncation, event cursor continuity and cancellation capacity. The approval-cap regression above remains. Worktree disk growth and per-stdio-message memory are not covered by these JSON retention bounds. |

## Protocol and Isolation Checks

- Installed `codex --version` reports `codex-cli 0.154.0`. Inspected the already-generated `/tmp/voxcode-schema` JSON schemas. `initialize`, `thread/start` (`approvalsReviewer`, `sandbox`, `ephemeral`) and `turn/start` (`workspaceWrite`, writable roots, network disabled and both temporary-directory exclusions) use the installed schema's names and types. Command/file decision strings `accept` and `decline` match the response schemas. Initialization and thread creation smoke are documented by the implementer, not independently repeated here.
- Each execution owns one stdio App Server and one selected worktree. Real Git worktree tests verify original-project preservation and separate task files. The sandbox is workspace-write, not a read-isolation boundary or full OS container; ports, databases, global configuration and deliberately daemonized resources are not isolated by a worktree.
- The installed command approval schema also permits `kind: writeStdin` and `networkApprovalContext`; the adapter projects all such requests to command/cwd/reason. These variants lack focused fixture coverage. Keep them disabled or explicitly represent their semantics before claiming support. Unsupported interactive method names otherwise receive a protocol error.
- Requests correlate JSON-RPC IDs, fail request/initialization errors and reject non-completed turns. No installed-version real model turn, end-to-end two-task execution or real approval was verified by this review. Fixture tests do not establish those gates.
- Saved replays are durable and JSON-property-order independent; version checks, approval single-use/expiry and distinct acceptance state are covered. There is no automatic merge or exposed preview filesystem endpoint; `previewUrl` remains null. Follow-ups start new ephemeral Codex threads and retain the worktree rather than conversational context.

## Verification

- `node --test apps/mac/test/*.test.mjs`: **17 passed, 0 failed**.
- Controlled inline Node crash/restart reproduction using the actual service, actual adapter and repository fixture: confirmed the P1 above; leftover fixture group was explicitly killed.
- Controlled inline Node mutation-cap/approval reproduction using an injected executor: confirmed 429 then timed decline.
- No implementation files changed. This review file is the only authored repository artifact.

Verdict: the earlier security fixes materially improve the component, but unclean-restart ownership remains a blocking P1. Real Codex turns, voice authorization lifecycle, authenticated remote relay, preview and iPhone delivery remain separate integration gates.
