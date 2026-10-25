# Issue 137 Independent Architecture Review

Disposition: **PASS** for the bounded owned-installation restart capability. No actionable findings identified.

Reviewed the frozen four files in `/private/tmp/voxcode-137-mac-restart`: the launchctl helper, restart entry, tests and verification document. The two implementation hashes independently match the coordinator freeze.

The entry restricts operations to the two fixed installed LaunchAgents, canonical trusted paths, unchanged manifest/runtime/configuration bytes, exact job arguments and the executing Node interpreter's canonical path/hash. Job inspection checks UID, command and process birth identity. Unknown labels and changed registrations fail before service mutations. Raw launchctl diagnostics, inherited environment values and private configuration contents are not emitted by the CLI; events contain bounded phase/label/timing/PID/attempt fields.

An owned stop receipt is required before bootstrapping an absent job. Stop completion requires both job disappearance and disappearance of the original process identity; a missing launchd job alone is insufficient. Bootstrap retries are limited to the specific observed error 5 diagnostic, checked within a deadline, while other failures stop immediately. Repeated starts reuse an already running owned job.

Restart serializes through a separate private kernel guard, refuses active or quarantined tasks, stops Agent before task and checks task activity again after Agent stops. Task/RPC readiness precedes Agent startup. Rollback restores task/RPC/Agent order, verifies the unchanged installation and reports `rollbackConfirmed` explicitly. A task admitted during the stop gate is preserved while Agent access is restored. A configured idle voice provider is correctly independent of task startup readiness.

Independently executed:

```sh
node --test scripts/test/mac-launchctl.test.mjs
```

Result: **15 passed, 1 skipped**, zero failed/cancelled, exit 0. The skipped opt-in test creates an isolated real launchd job; I did not run it or operate on installed services. The reviewed tests exercise delayed unload and PID exit, bounded error 5 retries, ownership refusal, task admission/refusal, duplicate operations, rollback success/failure and guard release. The author's observed isolated launchd timing and installed read-only status are documented evidence, not independently rerun here.

## Delivery Boundary

There is no hidden claim that #122 installer integration is complete. `restart-mac.mjs` deliberately verifies an unchanged existing installation and does not switch source, plists or releases. The reusable stop/wait/start helper can support future activation work, but activation ownership transitions, installer wiring and their integration acceptance remain separate work. Publishing this as an in-place restart capability is consistent with the actual implementation and documentation; claiming completed release activation from this patch alone would exceed its scope.

## Reviewed SHA256

```text
495740a9e6e6417c4c3698a4849d9eb27ee58d1ad94d1f6ad3ca379f744ece0f scripts/control/mac-launchctl.mjs
9fb33f08019fce0cc558bd82bab65c9eb672c703febbcb16b739de71f034f4c4 scripts/control/restart-mac.mjs
75883b353a6808a28ffc0b89361448b176dab03bea77cb01fe0641203bda3315 scripts/test/mac-launchctl.test.mjs
77328ea7b0dca3182a15943649ea68b1af4b7309138b4d9258a2f1c9949e4a42 docs/verification/mac-restart.md
```

No source, tests, Git or live services were changed; only this allocated report was written.
