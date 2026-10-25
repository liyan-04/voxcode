# Issue 128 Independent Architecture Review

Disposition: **PASS** for the frozen dual execution target backend. No actionable findings identified.

Reviewed worktree: `/private/tmp/voxcode-128-dual-execution-targets`.
Implementation handoff: `/private/tmp/voxcode-dual-target-report.md`.
Reviewer: `architecture_refresh`, independent of implementation owner `linx_audit`.

## Scope And Conclusions

Reviewed the execution target module, configuration, runtime composition, HTTP routing, corresponding tests, and existing private task RPC and voice context contracts. The nine Issue 128 owned files match the frozen handoff hashes below.

- Target selection accepts only the fixed `mac` and `server` IDs. An omitted selector defaults to `mac`; duplicate, empty, unknown and malformed selectors fail before task effects. No cross-target fallback was found.
- Each protected project/task request resolves one target before awaiting membership checks and uses its request-local adapter and project registry throughout. Identical IDs on different targets do not select a shared global active target.
- Direct submission helpers are cached by fixed target ID and receive the same immutable target, producing distinct stable confirmation identities. Mutation body allowlists reject injected target, device, owner and path fields.
- Login does not call either executor. Authenticated inventory reads synchronous readiness caches; Mac and server refresh independently. An absent optional operator-configured server socket does not prevent gateway startup.
- Voice project/task membership resolves through the selected target and returns frozen context with fixed operator-selected device identity and authenticated user identity. Neither browser nor model selects an arbitrary owner, device or path.
- Legacy health remains Mac-oriented for compatibility. The new inventory reports target readiness. This bounded backend work does not claim UI selection, provisioning or device MCP execution.

## Independent Verification

The following command was run in the frozen worktree and passed **46/46**, with zero failures, cancellations or skipped tests, exit 0:

```sh
node --test apps/server/test/execution-targets-http.test.mjs apps/server/test/task-submission.test.mjs apps/server/test/http-server.test.mjs apps/server/test/control-runtime.test.mjs apps/server/test/control-config.test.mjs apps/server/test/execution-targets.test.mjs
```

`git diff --check` passed with exit 0.

An additional in-memory probe used actual modules and real local HTTP, separate adapters and project registries, and identical project/task IDs. It suspended a Mac membership read across an await, completed a concurrent server request, and then resumed the Mac request. Both returned their own target's output. Login invoked zero adapters. Encoded duplicate `%65xecutionTarget`, null-suffixed and duplicate-empty selectors returned 400 without additional adapter calls. Recorded result:

```json
{"concurrentSameIdIsolation":true,"distinctAdapterAndRegistry":true,"loginAdapterCalls":0,"encodedDuplicateAndMalformedSelectorsRejectedBeforeEffects":true,"calls":["mac:task","mac:project","server:task","server:project"]}
```

## Frozen File Identity

All nine hashes were independently recomputed and matched the handoff:

```text
ef5fa484c88e681b18db4b3e3088b230841b0bc68682f0fae2b496e2ae7e0d84 apps/server/execution-targets.mjs
fe2ccda54c9817aa69d6e74721496414d30b938fd59a709de691f77411ff93a2 apps/server/test/execution-targets.test.mjs
a30e7bfee493dbe6223cff7150832f434ebf99f88297206e49c2db0a58a73a26 apps/server/control-config.mjs
d837dbd56380eb18115dea2801788a8872d9e01c09da012970d980d219278d06 apps/server/test/control-config.test.mjs
29aaddeefe41769f8bf44a1180b9d3cb59cce44958019bfb81ecaa343925613a apps/server/control-runtime.mjs
760f6ef1615ad5f149097a7845b3bb769f53891c1a016bda0aeab6e413b97db1 apps/server/test/control-runtime.test.mjs
4f69c7f872e733cd15d88231f4c6c8eb97a5e4e6a172ce46afbb19f8f69ede1c apps/server/http-server.mjs
eec8df77e3c1f33168b5decf41a96a79189045d8f612402a80ac542344656bc9 apps/server/test/http-server.test.mjs
b3891e8c41793013e2bb3aae7e6d45d19298885c0779bcbe256638c2cc81831e apps/server/test/execution-targets-http.test.mjs
```

## Integration And Acceptance Boundaries

The worktree includes the Issue 126 helper and its older ten-test dependency snapshot. Coordinator integration must use the PR 133 base, `9d2402a1873fb085ded6a8ecee2f10552c468d0f`, preserve the two additional helper tests already merged on master, and revalidate the integrated tree. Those dependency files are not part of the nine Issue 128 owned files.

This review verified fixtures and local services only. It did not verify a real model, Linx connection, physical phone, deployment or Linux executor provisioning. UI target selection and isolation, live acceptance and device MCP execution remain separate work. No implementation or test files, Git state, deployment or live services were changed by this reviewer.
