# Device gateway independent reviews

Issue: Refs #96. Evidence: source review and local fixture, 2026-10-25.

Reviewed source SHA-256:

- device-store.mjs: ede6c3118064d28a3be63a19a4aacc19a11a51a32bfec574e5e297e3ae51a9b5
- device-gateway.mjs: 10b6cd0b6c0164073b6f8ca1874b9a1c712de4eb6212fa37cd52787700a4f3a0

The coordinator reviewed ownership, authenticated connection replacement,
reserve-before-send, durable request identity, expiry, unknown outcomes and
raw RPC results. Findings about owner replacement, result identity, protocol
alignment, expired read records and admission limits were fixed and covered
by focused regressions. The final source passes this review.

Independent reviewer linx_audit inspected the source and its revisions without
implementing it. Its findings were bounded pending admission (P2), missing
directory fsync (P2), and stale receipt promotion to current device state (P2).
The final re-review confirms all addressed: bounded ingress and priority close,
file/rename/directory durability with fail-closed uncertainty, operation evidence
separate from current heartbeat snapshots, and strictly newer observation time.
It also reviewed read-record reclamation retaining write deduplication. Verdict:
spec and quality pass for the fixture scope; no remaining blocking finding.

Coordinator rerun: 26/26 focused tests, c8 lines 99.21%, branches 84.34%.
Full server suite and policy results are recorded in the component evidence.
AI reports are independent source reviews, not human GitHub approvals or user
acceptance. Listener, TLS, real Mac execution, phone and live Linx remain separate
integration gates; this PR does not claim those capabilities have been deployed.
