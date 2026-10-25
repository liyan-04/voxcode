# Owned Mac restart coordinator review

Issue: #137. Reviewer: root coordinator, independent of the implementer.
Disposition: PASS for the frozen bounded in-place restart entry.
Integrated source base: `5e01b5d`. Implementation SHA256:

```text
495740a9e6e6417c4c3698a4849d9eb27ee58d1ad94d1f6ad3ca379f744ece0f scripts/control/mac-launchctl.mjs
9fb33f08019fce0cc558bd82bab65c9eb672c703febbcb16b739de71f034f4c4 scripts/control/restart-mac.mjs
75883b353a6808a28ffc0b89361448b176dab03bea77cb01fe0641203bda3315 scripts/test/mac-launchctl.test.mjs
```

Reviewed manifest/source/plist/config pinning, fixed owned labels, interpreter
identity, process birth identity, absent-job plus old-process-exit stop gate,
bounded diagnostic-specific bootstrap retries and separate kernel guard.
The restart refuses active/quarantined tasks, stops Agent before task, checks
idle again, starts task/RPC before Agent and explicitly verifies rollback.
It never deletes runtime locks or prints raw launchctl environment/diagnostics.
No actionable finding remains in this in-place restart scope.

Coordinator independently ran `node --test scripts/test/mac-launchctl.test.mjs`:
15 passed, one opt-in real launchd test skipped, exit 0. The author's opt-in
16/16 isolated launchd evidence is documented but not counted as root's run.
The root previously ran installed read-only status against exact9038762;
installed repeat restart remains a post-merge fresh-idle acceptance check.
No user task was stopped by this review.

The application coverage policy excludes scripts/control; no new application
coverage percentage is claimed. The complete suite initially lacked declared ws
and voice packages in this isolated checkout. Dependencies were installed from
existing locks before the final integrated rerun; the initial attempt is not a
passing validation result.

Final integrated complete serial Node/policy/voice run passed with exit 0 after
installing server, voice and Mac Agent locked dependencies. The sole opt-in
launchd fixture remains skipped in the coordinator run. No test was disabled.

This is an in-place restart tool, not source activation or proof that #122
installer integration is complete. Its owned-stop receipt and helper instance
must be reused by the future reviewed deployment transaction. No temporary
129 activation script is made a supported entry point by this change.
