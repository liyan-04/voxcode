# Historical shared contract v1

This file is coordinator-owned. Implementers propose changes before changing a shared field.

> The current contract is [phone/mac/Linx current architecture](architecture/phone-mac-linx-current.md) and [Mac Agent control](architecture/mac-agent-control.md). The route sketch below is retained for historical compatibility evidence; do not add new code from it without reconciling it with the current target/context contract and the actual control runtime.

Current delivery scope: phone browser → server VoxCode → selected server-local or paired Mac execution target. Project, task, subtask and voice operations must carry `executionTarget`; historical native-phone and Relay-specific routes below do not define the current UI.

Historical deployment note: the old server-only/Relay path below is superseded by the selected execution target in [phone/mac/Linx current architecture](architecture/phone-mac-linx-current.md). Linx device-MCP, target binding and Mac Agent authentication are defined by the current architecture and control contract.

## Phone duplex WSS

Historical phone duplex design: the removed `/api/stream` and Relay-specific transport were an earlier proposal. Current voice and device-MCP boundaries are defined by [mac-agent-control.md](architecture/mac-agent-control.md) and [phone-mac-linx-current.md](architecture/phone-mac-linx-current.md).

## HTTP
All `/api/*` except health and pair require `Authorization: Bearer <sessionToken>`.
JSON errors: `{ "error": { "code": "string", "message": "string" } }`.

- GET /api/health -> `{name:"VoxCode", version:"0.1.0", codexAvailable:boolean, voiceConfigured:boolean}`; no secrets.
- POST /api/pair `{code:string}` -> `{sessionToken:string}`. Expiring local pairing code, rate limited.
- GET /api/settings -> `Settings` (authenticated).
- GET /api/monitor -> `MonitorSnapshot` (authenticated; fixed loopback Mac origin, optionally forwarded through the paired Relay/Connector).
- POST /api/settings `{requestId,executionLimit}` -> `Settings`; durable replay, integer 1–8. Default four. Lowering does not stop existing turns.
- GET /api/tasks -> `{tasks:Task[]}`.
- POST /api/tasks `{requestId,title,prompt}` -> `{task:Task}`. Selected server project only.
- GET /api/tasks/:id -> `{task:Task}`.
- GET /api/tasks/:id/events?after=N -> `{events:Event[],cursor:number}`. Polling is sufficient for MVP.
- POST /api/tasks/:id/messages `{requestId,prompt,version}` -> `{task:Task}`; never retarget implicitly.
- POST /api/tasks/:id/cancel `{requestId,version}` -> `{task:Task}`.
- POST /api/tasks/:id/accept `{requestId,version}` -> `{task:Task}`; completed only.
- POST /api/tasks/:id/approvals/:approvalId `{requestId,version,decision:"accept"|"decline"}` -> `{task:Task}`.
- POST /api/tasks/:id/criteria/:criterionId `{requestId,version,decision:"pass"|"fail",note?}` -> `{task:Task}`; manual criteria only, completed current version. Reject accept while required criteria remain failed/unverified.

Settings: `{executionLimit:integer,maxExecutionLimit:8,maxTasks:32,activeExecutions:integer,queuedTasks:integer,recoveryRequired:boolean}`.
MonitorSnapshot: `{generatedAt:ISODate,uptimeSeconds:number,executionLimit:integer,maxTasks:32,activeExecutions:integer,recoveryRequired:boolean,counts:{queued,running,waiting_approval,waiting_input,stopping,interrupted,failed,completed,accepted},memory:{rssBytes:integer,heapUsedBytes:integer}}`. Counts are nonnegative integers; completed excludes accepted tasks. Use actual task-state names from design.md for the counts, including zero values. These are current aggregates, not durable throughput counters. Do not include task IDs/titles, prompts, paths, raw events, credentials or per-task labels. The native status page obtains this JSON through existing paired authorization. Add optional `readiness:{codexAvailable:boolean,voiceConfigured:boolean}` (presence/configuration only, never proof of a successful live model/voice session) and Relay-only optional `relay:{connected:boolean,uptimeSeconds:number,inFlight:integer,requestsTotal:integer,responsesTotal:integer,errorsTotal:integer,timeoutsTotal:integer,latencySamples:integer,latencyP50Ms:number|null,latencyP95Ms:number|null}`. Relay adds its metrics only after a successful authorized Mac monitor response and projects the fixed Mac fields. Counters restart with Relay: requestsTotal counts finished HTTP responses including public/rejected/offline requests, responsesTotal counts <400, errorsTotal counts >=400, timeoutsTotal counts504. Durations use monotonic ingress-to-finish times over the last128 finished HTTP requests; they are not speech/model/network-only latency. Offline requests return existing errors. The phone retains stale/unknown labeling on failure and clears metrics on identity/simulation changes. See [current architecture](architecture/phone-mac-linx-current.md).
Create/follow-up bodies may additionally include `criteria:[{text:string,required?:boolean}]` (1–12 items, text <=500 characters). Omitted create criteria produces one manual criterion: confirm the requested result against evidence. Omitted follow-up criteria carries forward the prior conditions with unverified status for the new version.

## Shapes
Task: `{id,title,prompt,status,acceptance,version,createdAt,updatedAt,summary,previewUrl,evidence,approval}`.
Additional v1 fields: `criteria:Criterion[]`, `acceptanceSnapshot:null|{version,acceptedAt,criteria}`, `preview:null|{artifactId,version,path}`. Codex thread/turn IDs may be stored privately; do not expose worktree paths or transport credentials.
Criterion: `{id,text,required,verification:"manual",status:"unverified"|"passed"|"failed",evidenceIds:string[],version}`. Manual confirmation creates version-bound note evidence. Evidence entries have stable `id`; trusted executor may attach `{status:"passed"|"failed",command,exitCode,artifactId}`. No model prose automatically passes criteria.
Dates are ISO-8601 strings. `previewUrl` and `approval` nullable; `summary` string; `evidence` array.
Evidence: `{kind:"test"|"screenshot"|"diff"|"note",label,value,version}`. No fabricated tests.
Approval: `{id,command,cwd,description,version}`. Single use, invalidated by cancellation.
Event: `{seq,taskId,type,message,createdAt}`. Persisted by bridge; cursor monotonically increases per task.
Task status and acceptance enums follow design.md. Version is a nonnegative integer bumped whenever execution input changes; client sends the snapshot version.
Errors use 400 invalid, 401 unauthenticated, 403 denied, 404 unknown, 409 stale/blocked/conflict, 429 throttled, 503 unavailable.
For task mutations, `409 blocked` means a business precondition rejected this request before side effects (for example, failed required checks or an expired approval). The client may clear that pending attempt while preserving the user's edits. `409 conflict` denotes a request-ID/payload identity conflict and remains uncertain; retain the original request ID and payload for reconciliation. Unknown errors, timeouts and server failures must not clear uncertain submissions. Clients talking to an older server that returns `conflict` for business rejection remain conservative.

## Trusted executor callbacks

`runCodex({task,cwd,signal,onEvent,onEvidence,onApproval,onSession?})` resumes `task.codexThreadId` when present, otherwise starts a durable owned thread. `onSession({threadId,turnId?})` persists identity before/after turn dispatch. Same task never runs concurrent turns; unavailable thread recovery fails explicitly instead of silently starting a new thread.
`onEvidence(kind,label,value,details?)` may attach the bounded structured fields above. `onPreview({artifactId,path})` from a trusted post-execution pipeline sets task/version preview; path must be `/preview/<artifactId>/` and the published artifact immutable. Cancellation and unresolved ownership remain enforced across the entire executor pipeline.

## Preview

- POST /api/tasks/:id/preview-session `{version}` authenticates with the phone bearer. Requires completed matching task/version with a published artifact. Returns `{path,expiresAt}` plus a Secure/HttpOnly/SameSite=Strict preview cookie scoped to the artifact path. Does not return a control bearer to content.
- GET /preview/:artifactId/* authenticates only the scoped preview cookie against its owner session, task and version. Controls never accept that cookie. No redirects or arbitrary upstream path/port selection. Fixed static SPA artifacts only; no backend/WS/HMR/Service Worker.
- Gateway and connector relay only these exact preview routes and safe response headers, with separate preview concurrency/body budgets. Relay forwards preview cookies without granting API authorization. Native app installs the scoped cookie in isolated WebView storage. A shared fixed-IP origin is permitted under these identity boundaries.

## Voice v1 additions

Voice-create response adds `outputFormat:null|{format:"pcm",sample_rate:16000|24000,channels:1}` and truthful `outputSupported`; receiving wire audio does not prove native playback. The Mac decodes negotiated provider Opus using pinned opusscript before returning signed int16 little-endian PCM to the phone. Events include ready/TTS/STT plus `{type:"audio",seq,data:<base64 PCM frame>}` with retained frame boundaries, and `{type:"draft",seq,draft:VoiceDraft}` / `{type:"focus",seq,taskId}`. TTS stop events preserve `is_aborted` when supplied. Use bounded polling batches, explicit 409 `cursor_expired` errors, and never replay old audio into a new recording epoch. Abort stops output for this voice session; the client discards queued playback immediately. Recording start also clears playback to prevent feedback.
VoiceDraft: `{id,taskId:null|string,version:null|integer,title,prompt,criteria:[{text,required}],expiresAt}`. Stored per voice session/owner; only proposes work. Client edits/explicitly confirms using standard task mutation with a persistent request ID. STT and MCP draft share one composer; no automatic mutation from tools. Registered tools: list_tasks, get_task_status, get_task_evidence, propose_task, propose_followup, propose_focus, all schema/size/owner/version checked server-side.
Voice session also accepts authenticated POST `/api/voice/sessions/:id/abort` (empty JSON) to stop provider speech without cancelling Codex. Closing/revoking expires all associated tools/drafts/audio. Short-lived prompt context uses documented hello.agent_params placeholders only; no arbitrary prompt fields or provider credentials are exposed.

## Voice adapter module (ESM, Node >=22)
`createLinxSession({config,onEvent,WebSocketImpl?})` returns `{connect(),sendAudio(buffer),startListening(),stopListening(),abort(),close()}`.
config: `{url,token,deviceId,clientId}`. onEvent receives `{type:"stt",text}` / `{type:"tts",state,text?}` / `{type:"audio",data}` / `{type:"error",message}` / `{type:"ready"}` / `{type:"mcp",payload}`.
Use 16kHz mono PCM signed int16 little-endian input; server hello defines output format. Voice module owns wire protocol, not task authorization.
HTTP voice endpoint integration will be owned by coordinator after adapter review. Phone recording freezes `{taskId,version,requestId}`; bridge retains mapping, model output cannot select another task.
