# Mac execution contract and shared protocol review

Issue: #93. Scope: `packages/control-protocol/index.mjs`, its test, `AGENTS.md`, Mac control architecture and implementation plan. The coordinator authored this change. Reviewers `/root/linx_audit` and `/root/gateway_impl` did not implement these files.

## Findings and resolutions

- P1: RPC envelope and payload could name different targets. Network `task_rpc` now rejects top-level project/task/revision fields; only the validated RPC arguments define the target. A regression failed before the fix and passes after it.
- P2: `open_project` unnecessarily required an existing task. It now requires only project identity and rejects redundant task/version fields.
- P2: RemoteTaskAdapter was referenced without ownership or tests. The composition task now allocates its implementation and explicit fourteen-method forwarding/offline/unknown tests to the coordinator.
- P3: Voice context owner naming and old server execution prose were inconsistent. The design now uses ownerId for voice context, a Mac execution authority and a server relay.
- P3: Date.parse accepted non-ISO timestamps. The shared validator now requires canonical UTC millisecond timestamps; documentation examples match that format.

Linx reviewer confirmed the four initial findings addressed in a targeted static re-review. Gateway reviewer found no remaining P0/P1/P2 code findings; its timestamp and stale-document observations were fixed as above. AI review evidence is not human GitHub approval or device acceptance.

## Validation

macOS arm64, Node.js 26, local/fixture: `node --test packages/control-protocol/test/protocol.test.mjs` passed 5/5. `c8 --reporter=text` measured 100% lines and 85.22% branches for the shared protocol. `git diff --check` passed. The existing policy baseline passed 62/62. No real Mac execution, Linx, TLS deployment or phone acceptance is established by this contract PR.
