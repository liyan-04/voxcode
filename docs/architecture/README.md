# Architecture documentation

The supported architecture is documented in [current.md](current.md). It
describes the current `apps/server` boundary, its protected Unix-socket task
runtime, the server HTTP/MCP modules, and the capabilities that still require
composition or live acceptance.

The current product contract is [voice-code-workspace-contract.md](voice-code-workspace-contract.md).
It defines the browser voice workspace, the shared HTTP/MCP task domain, the
server-side Linx boundary, and the Codex CLI adapter. [task-state-and-history.md](task-state-and-history.md)
defines the task/session/history storage boundary and its planned evolution.
[voice-code-delivery-ledger.md](voice-code-delivery-ledger.md) records dated
delivery evidence and open verification gates; it is evidence, not a claim
that every target capability is shipped.

[development-practices.md](development-practices.md) and
[cleanup-policy.md](cleanup-policy.md) contain repository workflow rules.
They do not define runtime behavior.

Documents for the retired Mac, Relay, native iOS, old phone-monitoring,
historical handoffs, and the superseded phone-demo execution design were
removed from this directory. Historical review records under `docs/reviews/`
may still mention those snapshots; they are audit evidence rather than current
architecture instructions.
