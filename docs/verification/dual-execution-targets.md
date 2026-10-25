# Dual execution targets

Refs #128. The authenticated control runtime exposes
`GET /api/execution-targets` using synchronous cached readiness. Login and this
inventory do not wait for either executor. Inventory includes the fixed `mac`
and `server` entries, configured/online/available flags and observation time.

Project/task routes accept a single `executionTarget=mac|server` query value;
omitting it preserves the Mac default. Each request captures one adapter and
project registry before membership checks. Equal IDs on different targets do
not share results, mutations or execution identities. Unknown, repeated or
injected targets fail without selecting a fallback.

An operator may configure `serverTaskSocket` as the canonical private Unix
socket of a separately provisioned task service. The gateway remains a control
identity and does not launch Codex. Missing configuration reports the server
target as unconfigured; a failed socket does not disable Mac or authentication.
Do not point this option at an arbitrary/public socket or run Codex as root or
the web identity. Existing paired Mac configuration remains valid.

Voice context resolves project/task membership on the frozen target and retains
the authenticated owner and operator-configured execution identity. This does
not enable device MCP execution; that capability remains a separate gate.

Direct submissions retain their original request identity across ambiguous
mutation replies and post-mutation result-read errors. HTTP returns 409
`outcome_unknown`; an explicit retry must reuse the original payload and ID.
No automatic replay or successful-execution claim is added.

Coordinator integration on master `9038762`: focused 59/59 and full coverage
collection 394/394 tests passed. Independent routing and final uncertainty
reviews are in `docs/reviews/dual-target-*.md`. These are local controlled
HTTP/Unix RPC checks. Page selection, provisioning, live Codex/Linx and physical
phone acceptance remain distinct from this source milestone.
