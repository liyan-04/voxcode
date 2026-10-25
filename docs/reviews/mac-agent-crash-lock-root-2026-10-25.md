# Crash-safe Agent lock coordinator review

Refs #121. Reviewer: coordinator, independent of gateway_impl.
Reviewed source SHA256: agent.mjs
`babf2090dfe20ac48d42737f4a7918e37cf6092677c72411a2e7d4a117184751`,
ledger-lock.mjs
`983ba8b4043e04abad539b05afa6f11d47d2e903c439a4152b1008132581f48d`.

No blocking finding. The private persistent guard file is held through a kernel
lock and never unlinked during release. PID metadata is diagnostic for the new
format; legacy metadata migration remains conservative for a live process or
EPERM. File ownership, permissions, link count, device/inode and lock-helper
identity are checked before use. Ledger writes assert that the held guard and
metadata remain the expected files, failing closed before command dispatch.

The coordinator reran `npm test` in apps/mac-agent: 35 passed, 0 failed;
`git diff --check` passed and all five implementation/test/document hashes
match the independently reviewed snapshot. Real local process tests include
one-winner acquisition, stopped-owner exclusion, graceful and SIGKILL recovery,
legacy live/dead owners, helper failure and guard replacement. This is macOS
local evidence, not Linux or installed-service migration evidence. The second
independent review and extra process probes are recorded separately.
