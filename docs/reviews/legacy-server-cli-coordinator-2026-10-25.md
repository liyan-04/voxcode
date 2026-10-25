# Legacy server CLI retirement coordinator review

Issue: #139. Reviewer: root coordinator, independent of execution_target_ui.
Disposition: PASS. Integrated base: `2cdfa1f`.

Inspected the full removal, active documentation and retained test diff. The only
source consumer imported parseArgs/transport/runCli in the deployment test file.
All removed assertions belong to the deleted command parser/orchestration entry.
Mixed safeRoot/parseConfig and journal redaction assertions remain. Bundle hashes,
archive rules, production npm staging, strict HTTPS/IP, service/cgroup ownership,
identity preflight, atomic activation and rollback tests remain executable.

Protected bundle/package/remote/password helper and application runtime entries
are unchanged. Documentation withdraws all old CLI commands and states that the
package subcommand has no replacement CLI in this milestone. Current gateway and
historical service layouts are distinguished. Prior review/progress evidence is
preserved. No active dangling import or supported command remains.

Root independently ran the deployment tests before and after master integration:
16/16 passed, exit 0. The architect independently reran the same suite and policy
tests. No actionable finding remains. The test count drops by one only for the
deleted entry's upload/deploy orchestration case; the combined file has no skips.
No installed services, private configuration or rollback artifacts were touched.

Frozen SHA256:

After integration onto2cdfa1f, coordinator also ran the complete serial suite:
`node --test --test-concurrency=1 --test-reporter=dot scripts/test/*.test.mjs
apps/server/test/*.test.mjs packages/voice/test/*.test.js`, exit 0, with the
expected opt-in Mac launchd fixture skip. The retired CLI search returned no
active source/import/command match outside the explicit retirement/history docs.

```text
3107171874b041004b3a3e66aa5f124ad916a794f51ef5009367fd7fd16c66ae scripts/test/server-deploy.test.mjs
8200640da8117a87482e7092a265923459d3d9ccc8080303eef7549f1aa078e2 apps/server/DEPLOY.md
a1d80612a48c98caac4777ca3919074f75b94cba16bc7d1d39da79e81b3b8b9b docs/verification/legacy-server-cli-retirement.md
```

This cleanup changes no application executable source. Fixture checks do not
establish live deployment, provider/model or physical-phone acceptance.
