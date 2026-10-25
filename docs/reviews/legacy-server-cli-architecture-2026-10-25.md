# Issue 139 Independent Architecture Review

Disposition: **PASS** for the frozen four-path legacy server CLI retirement. No actionable findings identified.

Reviewed Issue #139, the coordinator's handoff, repository rules, the absent `scripts/server/cli.mjs`, the complete retained deployment tests, `apps/server/DEPLOY.md` and `docs/verification/legacy-server-cli-retirement.md`. The three existing files match the supplied freeze hashes. The deleted entry's independently fetched base SHA256 matches its handoff tombstone.

## Scope And Dependencies

Repository searches find no remaining source/config import of `scripts/server/cli.mjs`. Its remaining path mentions identify the retirement or historical deployment review. The active deployment document withdraws package/upload/deploy/start/stop/restart/status/logs/rollback guidance, explicitly says the old package subcommand loses its CLI entry and does not invent a replacement from unpublished #122 work. Retained programmatic helpers are accurately described as modules rather than supported current deployment commands. Links distinguish the historical `/opt/voxcode` services from the current `/srv/voxcode-control` runtime.

Using read-only GitHub base blobs/tree data for `fe0d921`, I independently confirmed that `bundle.mjs`, `package.mjs`, `remote.mjs`, `vm6-password.exp`, `apps/server/server-cli.mjs` and `task-cli.mjs` are byte-identical to the base. All existing `docs/reviews/` files and `docs/progress.md` are also unchanged. The retired entry is absent, with no replacement launcher added by the reviewed paths.

## Test Preservation

Compared the actual test source with its base. All fourteen tests retaining their names have byte-identical test blocks. Three CLI-related cases become two module cases: the SSH/parser case retains its safeRoot/parseConfig checks, the lifecycle/parser case retains its complete journal filtering/redaction checks, and the solely runCli upload/deploy orchestration case is removed. The count changes from seventeen to sixteen for that explained removal. The test file remains active without skips.

Bundle allowlists/hashes, production packaging, escaping/symlink/lock rejection, temporary npm staging, atomic activation, failed-health restoration, rollback/shared state, both service identities/cgroups, strict local HTTPS/IP identity, blocked execution defaults, identity/config preflight, lifecycle ownership and synthetic Expect secret handling are preserved. Removing tests for the deleted SSH command constructor does not remove the separate strict TLS, ownership or retained password-helper protections.

## Independent Verification

```sh
node --test scripts/test/server-deploy.test.mjs
npm run test:policy
```

Results: **16/16** focused and **61/61** policy passed, zero failed/cancelled/skipped, both exit 0. Fixtures exercised real temporary archives/npm installation and local HTTPS. They do not establish live vm6 deployment, device or provider acceptance. The implementer's 399-test Node run and 41-test Mac/control run are documented handoff evidence; I did not repeat them because this second review was allocated focused/policy verification.

No worktree source, tests, Git state, credentials or live services were changed by this reviewer. The only write was this allocated report; test fixtures used disposable temporary repositories/files and local listeners.

## Reviewed SHA256

```text
3107171874b041004b3a3e66aa5f124ad916a794f51ef5009367fd7fd16c66ae scripts/test/server-deploy.test.mjs
8200640da8117a87482e7092a265923459d3d9ccc8080303eef7549f1aa078e2 apps/server/DEPLOY.md
a1d80612a48c98caac4777ca3919074f75b94cba16bc7d1d39da79e81b3b8b9b docs/verification/legacy-server-cli-retirement.md
```

Deletion tombstone: `scripts/server/cli.mjs` absent; base SHA256 `4e57a8cc14695999ba888deec72acb1ae5b5cac04fbc0b31caf4982d8c965e26`.
