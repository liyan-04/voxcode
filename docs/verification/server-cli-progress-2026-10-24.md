# Server CLI checkpoint

Product: VoxCode is a voice-controlled Code Agent with an HTTP management UI. All execution runs on vm6 using Codex CLI, not App Server. Brand: 灵矽.

## Evidence

- SSH vm6 identity and installed Codex CLI 0.162.1 verified in this session.
- No public HTTP/HTTPS listener was present during inspection. Existing Hermes loopback service is unrelated and must not be reused as MCP evidence.
- Independent component snapshot: `apps/server/` in branch `codex/server-cli-integration`.
- `node --test apps/server/test/*.test.mjs`: 16 tests passed (local fixture, substituted child process); no live Codex/MCP/mobile acceptance inferred.
- CLI: draft creation and separate confirmation; fixed configured root; JSON event parsing; cancellation and restart-state tests.
- MCP: authenticated POST handler, method/schema validation, available-tool discovery, server-side write authorization.
- HTTP: password login, origin checks, bounded expiring sessions, task routes and minimal static page.

## Pending gates

- Two independent reviews and fixes before publication/deployment.
- Real CLI invocation and failure/cancellation validation on disposable vm6 workspace.
- Runtime entry point, shutdown, TLS and systemd configuration.
- xrobo outbound WebSocket MCP registration; public inbound HTTP is not proven necessary for this proxy route.
- Server-side 灵矽 voice SDK integration and actual mobile voice round trip.
- Usable phone task confirmation, status/result view and cancellation UI.
- Task isolation, recovery reconciliation, durable request deduplication and real diff/check evidence.

## Collaboration

Coordinator alone performs Git mutations. Original dirty checkout preserved. Component snapshots migrated to an isolated integration worktree before further changes. Reviewers are independent of component implementers.
