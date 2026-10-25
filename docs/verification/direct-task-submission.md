# Direct task submission

Refs #126. The production control runtime composes the existing durable create or
continuation mutation with execution, so one browser submission executes its
instruction without a second confirmation action. Generic HTTP embedders retain
their existing default unless they explicitly enable `directSubmissions`.

Execution identities bind the selected target, mutation kind, task and original
request identity. Initial execution always references revision 1; continuation
references exactly the submitted revision plus 1. Retrying an old submission
cannot execute a later turn. Executor authorization, revision checks, request
deduplication and native Codex permissions continue to apply.

Busy/offline/unknown responses retain bounded task/submission recovery identities
without returning executor exception details. No automatic mutation is performed
by page load. A persisted legacy draft can still use its explicit execution API.

Local verification: `node --test apps/server/test/task-submission.test.mjs
apps/server/test/http-server.test.mjs` passed 26 tests. The real local HTTPS/WSS
Agent/private Unix RPC integration in `control-runtime.test.mjs` verifies the
production route executes once and a replay causes no second adapter write.
These are fixture and local protocol checks, not real model, Linx, phone or
deployed acceptance evidence. Two independent reviews and production deployment
are recorded separately.

Final coordinator boundary checks added two regression groups for malformed
submissions, missing task identities and changed ownership. The unchanged
implementation passed 34 combined helper/HTTP/runtime tests. Scoped c8 coverage
compared the three touched runtime modules against `f28553f`: changed lines
54/54 (100%), changed branches 74/79 (93.67%), overall lines 95.83% to 96.77%
and branches 84.45% to 86.70%. `scripts/coverage.mjs check` passed with both
LCOV reports and exact comparison revisions. Policy tests: 62 passed.
The two independent reviews cover the exact unchanged implementation hashes;
their original 32-test runs precede these test-only additions.
