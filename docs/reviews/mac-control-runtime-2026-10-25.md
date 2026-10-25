# Control runtime independent reviews

Issue: Refs #98. Source/fixture evidence, 2026-10-25.

The coordinator owns runtime, adapter, private configuration, HTTP hooks and UI.
gateway_impl implemented the separate WSS transport. Reviewers mac_agent_probe,
linx_audit and gateway_impl independently inspected the integration source.
The coordinator and mac_agent_probe independently reviewed the WSS source.
No reviewer implemented the component whose verdict they provided.

Resolved findings and regression evidence:

- One total RPC deadline; lost submit/poll/reconcile receipts remain unknown.
  Inner business request IDs are unchanged; outer transport IDs are distinct.
- URL parsing errors cannot retain private tokens. Files use trusted ancestors,
  nofollow nonblocking opens and same-descriptor checks/reads.
- Shutdown bounds all resource cleanup concurrently and destroys raw pre-TLS
  sockets. Ingress has a 128 connection cap and 10 second TLS handshake deadline.
- MCP readiness requires connected state, rather than configured/connecting.
- Project RPC failures do not mislabel server or Mac transport as offline.
- Unknown write recovery preserves safe IDs and 32 keyed pending writes across
  reload; periodic reads cannot overwrite them. Preparatory read failures carry
  no mutation recovery ID and cannot falsely report a write completed.
- WSS authentication, frames, async queues and retiring handles are bounded.
  A 45 second authenticated idle deadline reclaims partitioned connections.

Reviewed WSS source SHA-256:
90314524e0a88370c76d3c9ad655aed83259260243ab2fe11055ed790b5f8f59.
The final integration verdicts are spec/quality PASS for the reviewed fixture
scope, with no unresolved actionable findings. mac_agent_probe independently
ran 27/27 control/WSS tests and a full-page recovery VM probe. gateway_impl
independently ran focused integration tests and reproduced the fixed HTTP/UI
cases. The coordinator ran all 149 server tests, focused coverage and policy.
AI reviews do not constitute human GitHub approval or live user acceptance.

Real Codex model execution, deployment, phone and Linx audio are separate gates.
