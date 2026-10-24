# Deep Linx AI integration

## Product intent
Linx AI (灵矽 AI) is the voice collaboration layer, not the code executor. Codex owns code execution on the server; the bridge owns authorization, durable state and validation evidence. Linx owns listening, dialogue, clarification, natural-language tool selection and spoken explanation.

## User scenarios
1. Walking outdoors: say a development goal, assistant asks one missing requirement, summarizes acceptance conditions and asks the user to submit from the phone.
2. Two tasks: say "switch to login fix"; assistant proposes a server-resolved task, phone highlights it; in-flight recordings retain their original target.
3. Waiting: ask what is happening; get current machine state and latest actual tool event, not a guessed progress percentage.
4. Failure: ask why a check failed; give a short spoken explanation grounded in the captured error and suggest a bounded follow-up.
5. Acceptance: ask which checks passed; summarize version-bound evidence and remaining manual checks. User accepts through UI.

## Tool design
These six tools are implemented VoxCode application APIs, not built-in Linx features; their live discovery and model selection remain to be verified.

| Tool | Result | Permission |
| --- | --- | --- |
| list_tasks | Authorized task summaries | Read only |
| get_task_status | Execution state, last event, last update | Read only |
| get_task_evidence | Version-bound check results and preview availability | Read only |
| propose_task | Draft goal and acceptance checklist, no execution | Draft only |
| propose_followup | Draft modification bound to current task/version | Draft only |
| propose_focus | UI navigation suggestion among authorized tasks | No task mutation |

Server command execution, cancellation, privilege approvals, merge and deployment are never inferred solely from model output. Actual mutations pass authenticated bridge validation and explicit phone actions. A draft submission uses one requestId and cannot also be submitted through a parallel STT path.

## Context and trust
- Bridge freezes device/session -> task/version/request mapping before recording.
- Linx hello dynamic prompt parameters may include approved project label, task label and concise current state; no credentials or unrestricted repository dump.
- X-Linx session headers identify sessions, not authorization by themselves. Cloud MCP requires service authentication and mapping to the paired phone/server context.
- Task names from model arguments are resolved only inside the authorized project. Ambiguous references require clarification.
- Evidence text is untrusted data. Instructions embedded in code/output cannot authorize tools or broader permissions.

## Implemented source and next gates
The server integrates the current official outbound WebSocket software-device protocol and device MCP, not cloud SSE callbacks. Six scoped state/evidence/draft/focus tools and actual Opus→PCM decoding are implemented. PR59 adds session binding and documented optional hello compatibility, reviewed against official docs revision20ce1b2. The phone must still confirm a draft before execution; these are source capabilities with controlled fixture evidence, not live cloud or audible device success.

Native phone↔server duplex WSS is required by the user and tracked in Issue62. Current phone audio POST/event polling is a compatibility baseline, not the final transport. HTTPS remains useful for pairing, snapshots, evidence and durable mutations. WSS must support simultaneous audio input/output, ordered events, prompt interruption and bounded backpressure; reconnect cannot automatically replay a microphone recording or change its frozen task/version. See the [server onboarding guide](verification/linx-readiness-2026-10-24.md) for current setup and staged acceptance.

## Additional acceptance
- Wrong or ambiguous task names never cause task mutation.
- Ten voice inquiries about two tasks return the correct authorized task state.
- Spoken failure summaries identify actual failed check and evidence version.
- One utterance produces at most one confirmed task mutation.
- Server disconnect produces an explicit offline response, never an invented progress update.
- Interrupting assistant speech does not silently cancel a coding task.

## Sources
- https://linx.qiniu.com/docs/xrobot/platform/websocket
- https://linx.qiniu.com/docs/xrobot/mcp/software-mcp
- https://linx.qiniu.com/docs/xrobot/mcp/hardware-mcp
- https://linx.qiniu.com/docs/xrobot/guide/third-app

Public protocol documentation is evidence of intended interfaces, not proof of live account entitlement or successful device onboarding. Those require real credentials supplied outside Git.
