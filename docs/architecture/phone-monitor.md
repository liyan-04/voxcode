# Paired-phone operational monitoring (Issue #25)

The phone is the first monitoring surface. The existing native app and Mac aggregate monitor avoid an additional Grafana/Prometheus deployment during the two-day delivery. An optional later exporter can consume these fixed aggregates; it is not a dependency of the control loop.

## Contract

Authenticated `GET /api/monitor` traverses Relay and Connector to the fixed loopback Mac origin. Existing Mac session authorization and loopback checks stay in place. Add the exact route to the shared allowlist, without query parameters. Public `/api/health` is not a monitor authentication substitute. Invalid/revoked/machine-key credentials never return monitor content. Offline, timeout and rejected requests retain existing HTTP errors; the Relay never invents an authorized offline snapshot.

The Mac snapshot retains `generatedAt`, `uptimeSeconds`, `executionLimit`, `maxTasks`, `activeExecutions`, `recoveryRequired`, `counts` and `memory`. Add readiness `{codexAvailable:boolean,voiceConfigured:boolean}`. Counts use the fixed queued/running/waiting_approval/waiting_input/stopping/interrupted/failed/completed/accepted keys; completed excludes accepted. Readiness means executable/configuration presence, not authenticated model or live speech success.

On a successful monitor response only, Relay adds optional `relay`:

```json
{"connected":true,"uptimeSeconds":45,"inFlight":1,"requestsTotal":12,"responsesTotal":10,"errorsTotal":2,"timeoutsTotal":0,"latencySamples":12,"latencyP50Ms":5.2,"latencyP95Ms":15.1}
```

Counters are process-lifetime HTTP aggregates for this Relay's single configured machine. Completed request durations cover Relay HTTP ingress through response finish (including request upload and connector/Mac work); they are not model runtime, speech recognition latency or network RTT. Durations use monotonic time, fixed-size last-128 storage; report null percentile values with zero samples. Fixed keys only, no per-path/identity/content labels. In-flight is sampled pending connector requests and may include the monitor itself. `requestsTotal` counts each HTTP response finish once, including public health/pair, invalid-route/auth denial, offline and authorized requests. `responsesTotal` counts finished HTTP <400; `errorsTotal` counts finished HTTP >=400, so requestsTotal = responsesTotal + errorsTotal. `timeoutsTotal` is the 504 subset of errorsTotal. Client-aborted unfinished responses need not be counted. Requests arriving after a restart start fresh; no historical availability claim.

The phone decodes Mac fields and optional readiness/relay for backward compatibility. It shows task counts/slots/recovery, readiness, transport counters and timestamps. Phone-measured monitor roundtrip is separately labeled. A failed read keeps the last successful snapshot visibly stale/unknown and uses a generic monitor error; no raw server error is rendered in this view. Reset on pairing identity, unpair and simulation changes; reject late responses from a previous identity or older request. Do not make monitor failure clear an otherwise successful task snapshot.

The status page polls at most once every five seconds only while visible and the scene is active; manual refresh is allowed without overlapping calls. No background mode or notifications. Simulation explicitly says simulation and voice unconfigured; it cannot be used as live evidence. Freshness older than 15 seconds, failed reads or inactive connection must be visually distinguished from current data.

## Data and acceptance boundaries

No prompts, code, audio, private paths, task IDs, tokens, raw exceptions or credentials enter this endpoint. Existing RSS/heap represent the Mac Node bridge process only, not total Mac/Codex resources. No invented availability percentage, speech error rate or estimated task progress. Optional future Grafana panels: Relay resource health, connector connectivity/reconnects, fixed request duration/error buckets; live voice connect/STT/draft/TTS/abort measures require explicit instrumentation and live evidence first.

Server acceptance: real loopback Mac/Relay/Connector HTTP tests prove paired success, invalid/revoked/machine-key denial, offline/timeout handling, exact allowlist, bounded aggregates and absence of content leakage. Native/core acceptance: wire decoding, null/optional data, freshness and identity lifecycle; source parse checks are not an iPhone build. Two independent reviews per component. Signed iPhone, live Linx and cellular/company-network checks remain separate.
