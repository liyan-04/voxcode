# Phone operational monitoring implementation plan

Goal: display trustworthy operational aggregates in the existing native app.
Architecture: forward the existing authenticated Mac monitor through Relay, enrich successful responses with bounded fixed transport metrics, and add an independently refreshed native status view.
Spec: docs/architecture/phone-monitor.md. Parent #25; server #29; iOS #30; voice evidence #27.

- [ ] Server developer in 29-relay-monitor: add failing real-loopback tests for paired /api/monitor, invalid/machine/revoked token rejection, offline and metric semantics. Add allowlist route, Mac readiness, bounded monotonic Relay aggregates after authorization. Run focused and full server tests. No public metrics route, production dependencies or shared contract edits.
- [ ] iOS developer in 30-ios-monitor: add core model/freshness tests before implementation, decode optional readiness/relay and null percentiles, implement isolated monitoring refresh with binding/request epochs, clear on identity changes. Add visible-active five-second status page and labeled simulation. Run Swift core tests and source parsing; native lifecycle tests where possible. Do not claim SDK/device build without Xcode.
- [ ] Coordinator: inspect diffs, run fresh component/policy/coverage checks, publish Draft milestone PRs to master with real Issue linkage and annotated next-version tags. Obtain two independent reviews per component; resolve findings and revalidate affected changes. Merge only exact reviewed ready heads, then separately verify merge before retiring heads.
- [ ] Voice verifier: rerun adapter/integration fixture tests and write explicit live-evidence/runbook report. No credential values, device identifiers or recordings in artifacts. Keep #27 open if real-provider criteria remain unmet.
