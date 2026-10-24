# Standalone server runtime implementation plan

> Execute using subagent-driven-development. Coordinator owns integration files; workers own their assigned components.

Goal: connect reviewed HTTP/MCP/project RPC components into an independently deployable HTTPS runtime without changing the historical CLI entry.

Spec: docs/architecture/current.md. Node22; phone browser only; Codex CLI task identity separate from Web/MCP/TLS identity. Runtime never starts App Server, Relay or Connector. Provider voice and all MCP mutations remain disabled until trustworthy voice Context association is verified.

- [ ] Add `test/server-runtime.test.mjs` proving root/missing config rejection, private file checks, TLS origin/cert matching, protected task socket/UID and redacted preflight. Observe expected missing-module/test failure before implementation.
- [ ] Implement `runtime-config.mjs` to load only fixed private configuration, enforce HTTPS/IP SAN/valid certificate dates and separate task socket owner, keep secrets in a WeakMap behind redacted preflight results.
- [ ] Implement `runtime.mjs` with task RPC client, HTTP HTTPS server, MCP status/read tools and outgoing proxy. Reject every MCP task mutation at dispatch; status reports real RPC readiness, revision and independent proxy/voice state. Close Web/proxy only; task systemd owns execution shutdown.
- [ ] Implement `server-cli.mjs preflight|start`, bounded shutdown and redacted startup errors. No secrets in argv/output. Preserve legacy cli/preflight and their existing tests.
- [ ] Validate real local TLS requests, login→project→draft→confirm/cancel and WS proxy fixture. Run Node22 tests, syntax and diff checks, then publish independent Draft PR with explicit dependencies #84/#85/#86/#89. Do not stage copied component dependency files.
- [ ] Deployment worker integrates exact new files into the package and dual services, ownership/credential boundaries and start/stop/restart/status/rollback commands. Coordinator validates actual bundle and publishes script PR/README before vm6 live activation.
