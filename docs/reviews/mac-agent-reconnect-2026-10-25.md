# Mac Agent Reconnect Reviews

Refs #119. Base `de10f5b02c5deca06c42a8c1b9e02d04d76850f5`.
Author gateway_impl; independent reviewers coordinator and linx_audit.

Both reviewers inspected the one-line production change and real child-process
regressions. Each independently ran `node --test apps/mac-agent/test/*.test.mjs`:
28/28 passed, zero failures/skips/cancellations. No actionable findings remain.
The pending retry owns process lifetime; explicit close clears it and releases
the owned ledger lock. Existing backoff and strict WSS tests remain green.

Reviewed SHA256:

```text
70f160a43c6d60350c07045900cc73aff2d71418662fdd5d60182467885d05e2  apps/mac-agent/agent.mjs
71e678222bb595a9fdfc35de2091db2a089ba2bbd3eb7f6839fcc943c6536c2d  apps/mac-agent/test/reconnect-process.test.mjs
817e14e592ca1ded641e9b901a829ca27762ed0788f1544e31b70cf366c92146  docs/verification/mac-agent-reconnect-lifetime.md
```

The configured repository coverage scope excludes `apps/mac-agent`; changed
coverage there is N/A. This component is verified by its focused positive and
negative process/network/lock tests. No coverage threshold or scope was changed.
AI source review does not constitute user acceptance or installed recovery.

The coordinator separately observed the installed original PID had exited and
preserved its private stale lock after stopping only the owned launchd Agent.
Task service and task data were retained. Installing the reviewed source and
confirming actual paired-Mac reconnect remain deployment checks.
