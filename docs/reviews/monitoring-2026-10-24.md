# Monitoring milestone review and evidence — 2026-10-24

Issue #40 records evidence; parent #25 remains open until native monitor checks and delivery gates close. Source merges are not product acceptance.

## Server / Relay (#29, PR #36)

Final reviewed runtime revision `aa9bc1f59ada04f05bdfa9acf6e83b01c3697b56`; final published head `5d67004cc9b19bba4a5135cb2724db8fffe25442` only additionally merges current master docs. Merged at `9b46aeb96d20440059e896b2493ee155842c1eb2`, tag VoxCode1.0.13. Author `/root/monitor_design_review`; readiness followup authored by root. Two independent final reviewers `/root/cleanup_reconcile_review` and `/root/master_ancestry_audit` inspected actual source and found no remaining actionable issue. AI reviews are not human GitHub approvals.

Findings resolved:
- Package fixed-file list omitted new monitor.mjs. Extracted import/start failed with ERR_MODULE_NOT_FOUND before fix; new runtime test starts the actual extracted Relay and verifies unauthenticated monitor401. Package tests5/5 independently reproduced.
- Per-monitor synchronous codex--version could block cancellation/approvals. Replaced with one async cached startup sample,2second timeout/SIGKILL/4KiB output bound. Actual slow shell executable regression verifies settings response while probe waits, timeoutfalse, one sample reused and revoked waiting token401. Post-await authorization and current snapshot generation preserve security. Removed unused synchronous helper; no remaining callers. Initial500ms deadline proved flaky during process startup and was increased to2seconds; final suite passed.
- Counter relationship made explicit: finished requests = successful(<400) + errors(>=400);504 is a subset. Fixed last128 monotonic samples, no content labels. Monitor enrichment follows Mac authorization and fixed-field projection; malformed successes and raw errors do not leak upstream content.

Fresh final local Node26/macOS checks: `node scripts/coverage.mjs collect-node --output <local-output>` ran full173/173, zero failure/skip. Line coverage2150/2317, branch1097/1311; baseline2089/2258 and1050/1261. Exact code gate vs master runtime baseline: changed76/76 lines and44/48 branch arms; no overall decrease. Baseline checkout532b6e7 and PR-base eb67f5d have identical runtime sources, differing only in docs. Focused final Mac/Relay/package17/17 independently reproduced. Failed intermediate coverage run is not counted as success. Whitespace and actual PR metadata checks passed.

Local install archive: `voxcode-relay-0.1.0-monitor.tar.gz`, SHA256 `50615c3eed6eb79036140ff76f00501f645238333a7a02f97e161617a1a568f6`; built with current Relay source, bundled ws and monitor module, no credentials. Local private artifact retained by coordinator. No remote deployment, service replacement or public success occurred.

## iPhone (#30, PR #35 — Draft)

Author `/root/cleanup_reconcile_review`. Reviewed Swift revision376e9ee, aligned topic04faa14 incorporates merged server without changing Swift. Independent technical reviews root and `/root/monitor_design_review` found no actionable source issue. PM `/root/product_manager` requested actionable recovery wording; fixed without falsely saying every task is stopped. MonitorView hash64feeaff71ccd58594bb7888256126cbaeb0f83018d8d10b15a28779ed8d8ccc.

Local evidence:6core assertion checks,3Session lifecycle assertion checks with platform shims; source/test parse and six existing core runner groups passed. Root independently reran6+3 and parsing; second technical reviewer independently parsed7changed files. Cases cover optional extensions/null percentiles, no overlapping reads, identity resets/late responses, stale retention/generic failure, task state independence, visible+active5second polling and explicit simulation.

**Unavailable:** current machine selects CommandLineTools and has no full iOS SDK/Xcode. Standard SwiftPM attempts fail in manifest/module-cache environment; implementer additionally observed missing XCTest after local cache workaround. Temporary assertion runners/shims are not native XCTest, SDK build or coverage. No passing Swift core baseline/change coverage, signed App or device run is claimed. Therefore PR35 remains Draft; source reviews do not waive the existing coverage/native gates. Full Xcode/signing setup is a real delivery dependency.

## Product, documentation and Linx

PR37 merged PM positioning and PM/architect/developer/coordinator collaboration at b64cda6. Independent root/architecture review; three core outdoor scenarios retain native/public/real-Codex/Linx requirements. PR38 merged architect README/script ownership at25736ae; PM and architecture reviews corrected deployment-deferred language, duplicate Connector instructions and stale Mac monitor sentence. Root/module README consistency and build/package/rollback checks are now milestone duties.

PR39 merged [Linx onboarding/evidence](../verification/linx-readiness-2026-10-24.md) at e311a13.26fixture/local tests passed; actual cloud STT/tools/TTS and audible iPhone output remain unverified. User confirmed test resources are not ready. User checkpoint: create test agent and verify device binding entry; engineering owns secret-safe software OTA/provisioning and real-voice smoke tooling. No raw recordings/token/IDs enter evidence. Configuration presence is never a live success signal.

## Remaining priorities and ownership

1. Architect: full Xcode/signing environment for actual App build, native tests/coverage and iPhone installation; keep PR35Draft until its code gates run.
2. User+engineer: Linx test-agent/device onboarding, followed by real handshake/STT/draft/TTS/abort evidence.
3. Architect/deployment owner: authenticated liyan-server access, exact public-IP mapping and vacant9899 check, fixed-IP TLS/private trust, Relay deployment preserving existing services. Prior SSH/public failure is not deployment success.
4. PM+architect: same signed build on cellular controls company Mac Codex, returns current-version diff/checks, safe multi-task/approval/retry/cancel and manual acceptance. No simulator/local result closes this gate.

Merged remote heads were retired only after explicit MERGED/full-SHA checks; active native branch and all dirty local worktrees/private artifacts remain preserved. master stays default/protected with PR-only integration and disabled unavailable Actions.
