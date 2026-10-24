# M2: Relay transport milestone

- Task: RELAY-002; implementer: `/root/relay_v1`; Git coordinator: `/root`.
- Base: `a352757`, `codex/phone-demo-contracts` (PR #2, depends on #1).
- Independent worktree: `.worktrees/relay`; branch: `codex/relay-phone-demo`.
- Scope: `apps/relay/**`, `scripts/create-local-tls.mjs`.

The relay serves HTTPS/WSS on one port with TLS 1.2 or later. The outbound Mac connector validates a configured CA, peer IP and expiry. Exact authenticated routes forward settings, criteria and voice abort; monitor and generated-site preview are excluded. Media has an independent capacity cap so cancellation, approvals and status retain capacity. The total deadline includes request-body reading.

The certificate helper exports public PEM/DER client anchors, uses a checked IPv4 SAN, requires a new ignored directory and protects private keys. No production certificate or key is included. The coordinator pinned `ws` to 8.22.0 after the implementation handoff; the dependency audit reported zero vulnerabilities.

## Verification

Coordinator reran `cd apps/relay && npm test` after that pin on 2026-10-23: 28 passed, zero failures/skips (Node 26/OpenSSL, local fixtures). Includes valid/unknown CA, incorrect IP, expired certificates, CLI TLS, slow-body deadline, media saturation, exact authenticated routes and handshake shutdown. `git diff --check` passed before commit.

Deferred preview tests remain under `test/deferred/` and are excluded from the phone-demo suite. They describe unimplemented future scope and are not reported as passing.

## Remaining Gates

Two independent component reviews and CI coverage are pending; publish as Draft. Public deployment, real company-network reachability, signed iPhone trust and outdoor verification remain unperformed. Deployment remains deferred by the user. When resumed, first check `bili-xs8:9899` and stop if occupied.
