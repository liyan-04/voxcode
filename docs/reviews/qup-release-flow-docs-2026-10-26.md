# QUP release flow documentation review — 2026-10-26

Issue: Refs #129. Reviewed independently by `/root/review_release_docs` after
the final source edits, from worktree base `bde7697f7bc166282855d4e73b7512ad9571859b`.
The reviewer made no source, Git, credential or service changes.

Reviewed documentation and entry-point hashes:

```text
a369ea3b99cb11dfedca296782af52e8be4d4bc99e6ee525e176a265d03ac5c5  README.md
0a267470f4c59e84ae68ee84f66ef9d0d0c34c3440eac4373149ad27626dc7c0  docs/deployment/control-lifecycle.md
96102567af429fd26115e66c095702be3fef79721e28c057fb0bd99e249f6469  publish.sh
f5024a4ff58b2d8e98d76fc85c64a7c451be95b0471c540f263469673ecb5185  scripts/test/control-entry.test.mjs
```

The final text distinguishes the five lifecycle shell entries from the separate
workstation-only `publish.sh` handoff. It explains that the handoff fetches and
packages the exact `origin/master` commit, records the digest and QUP URL, and
requires a service-host comparison against `origin/master` and `HEAD` before an
archive reaches lifecycle update. The wrapper help and the documented options
agree. The documentation does not claim that an archive itself proves its Git
remote provenance.

Validation performed:

```text
npm test
499 tests, 498 passed, 0 failed, 1 skipped (pre-existing native-owned fixture)
node --test scripts/test/control-upload-master.test.mjs scripts/test/control-entry.test.mjs
12 passed, 0 failed
node --check scripts/control/upload-master.mjs
sh -n publish.sh
git diff --check
```

No P0/P1 documentation defect remains when the documented manual provenance
gate is part of the release procedure. The remaining operational risk is the
same deliberate boundary: explicit rollback remains supported, while topic or
stale standalone bundles require the operator to stop before update. This review
does not establish live TLS, vm6, Mac Agent, Server Codex, phone, Linx or
microphone acceptance.
