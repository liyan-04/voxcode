# Shared contract v0

This file is coordinator-owned. Implementers propose changes before changing a shared field.

## HTTP
All `/api/*` except health and pair require `Authorization: Bearer <sessionToken>`.
JSON errors: `{ "error": { "code": "string", "message": "string" } }`.

- GET /api/health -> `{name:"VoxCode", version:"0.1.0", codexAvailable:boolean, voiceConfigured:boolean}`; no secrets.
- POST /api/pair `{code:string}` -> `{sessionToken:string}`. Expiring local pairing code, rate limited.
- GET /api/tasks -> `{tasks:Task[]}`.
- POST /api/tasks `{requestId,title,prompt}` -> `{task:Task}`. Selected server project only.
- GET /api/tasks/:id -> `{task:Task}`.
- GET /api/tasks/:id/events?after=N -> `{events:Event[],cursor:number}`. Polling is sufficient for MVP.
- POST /api/tasks/:id/messages `{requestId,prompt,version}` -> `{task:Task}`; never retarget implicitly.
- POST /api/tasks/:id/cancel `{requestId,version}` -> `{task:Task}`.
- POST /api/tasks/:id/accept `{requestId,version}` -> `{task:Task}`; completed only.
- POST /api/tasks/:id/approvals/:approvalId `{requestId,version,decision:"accept"|"decline"}` -> `{task:Task}`.

## Shapes
Task: `{id,title,prompt,status,acceptance,version,createdAt,updatedAt,summary,previewUrl,evidence,approval}`.
Dates are ISO-8601 strings. `previewUrl` and `approval` nullable; `summary` string; `evidence` array.
Evidence: `{kind:"test"|"screenshot"|"diff"|"note",label,value,version}`. No fabricated tests.
Approval: `{id,command,cwd,description,version}`. Single use, invalidated by cancellation.
Event: `{seq,taskId,type,message,createdAt}`. Persisted by bridge; cursor monotonically increases per task.
Task status and acceptance enums follow design.md. Version is a nonnegative integer bumped whenever execution input changes; client sends the snapshot version.
Errors use 400 invalid, 401 unauthenticated, 403 denied, 404 unknown, 409 stale/conflict, 429 throttled, 503 unavailable.

## Voice adapter module (ESM, Node >=22)
`createLinxSession({config,onEvent,WebSocketImpl?})` returns `{connect(),sendAudio(buffer),startListening(),stopListening(),abort(),close()}`.
config: `{url,token,deviceId,clientId}`. onEvent receives `{type:"stt",text}` / `{type:"tts",state,text?}` / `{type:"audio",data}` / `{type:"error",message}` / `{type:"ready"}` / `{type:"mcp",payload}`.
Use 16kHz mono PCM signed int16 little-endian input; server hello defines output format. Voice module owns wire protocol, not task authorization.
HTTP voice endpoint integration will be owned by coordinator after adapter review. Phone recording freezes `{taskId,version,requestId}`; bridge retains mapping, model output cannot select another task.
