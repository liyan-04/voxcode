# QUP master publishing review — 2026-10-26

Issue: Refs #129. Reviewed independently by `/root/review_upload_flow` after
the final source edits, from worktree base `bde7697f7bc166282855d4e73b7512ad9571859b`.
The reviewer made no source, Git, credential or service changes.

Reviewed source hashes:

```text
96102567af429fd26115e66c095702be3fef79721e28c057fb0bd99e249f6469  publish.sh
128acea9a45c2da3eadf4ebd831e48dbe1dc21e83deaeeee51afbcc5481832a7  scripts/control/upload-master.mjs
9c04584b36f95bd52aba69f8d575e93cc99c4d72a4e6b1421eeb2668d72646d5  scripts/test/control-upload-master.test.mjs
f5024a4ff58b2d8e98d76fc85c64a7c451be95b0471c540f263469673ecb5185  scripts/test/control-entry.test.mjs
04e13b7d3a6f8e196c728a07aa2d3bc157ae29a117c7db4ec711a3277b446689  scripts/control/package.mjs
4f1a49df765665f50aa1402cf9b39bd3937589c62f2e436917e205e268a33a6f  scripts/control/common.mjs
388f27bd426e00ef7f64fa780e30df2cf064847a3b355ea774402da76d7883cc  scripts/control/linux.mjs
```

The review confirmed that publishing fetches `origin/master`, requires a full
`FETCH_HEAD` commit, compares the packager manifest revision, re-reads and
re-hashes the archive before QUP, resolves relative QUP paths before changing
directory, rejects QUP output without an HTTPS URL, and returns the source ref,
revision, digest and URL. Tests cover all of those boundaries. A hand-built Git
bundle was also rejected by the control archive reader with `incorrect header
check`, so a Git bundle cannot be mistaken for a control bundle.

Validation performed:

```text
node --test scripts/test/control-upload-master.test.mjs scripts/test/control-entry.test.mjs
12 passed, 0 failed
npm test
499 tests, 498 passed, 0 failed, 1 skipped (pre-existing native-owned fixture)
node --check scripts/control/upload-master.mjs
sh -n publish.sh
git diff --check
```

The latest real QUP invocation also succeeded for the fetched master revision
`bde7697f7bc166282855d4e73b7512ad9571859b` with digest
`355784cccc8f59b3de9882ffa0a539974c8ede40656fec7cddab577504dac59c` and URL
`http://qupfile.cloudvdn.com/voxcode-control-20261026-129.bundle.gz`.

One residual P1 depends on the desired enforcement boundary: lifecycle update
validates archive format, digest and revision, but an archive does not carry
proof of its Git remote. Explicit rollback of an older installed release must
remain possible, so the publishing script and handoff documentation require an
operator to compare the printed revision with `origin/master` and `HEAD` in the
trusted controller checkout before update. A topic or stale bundle must stop at
that manual gate. This review does not claim live vm6, phone, Codex, Linx or
microphone acceptance.
