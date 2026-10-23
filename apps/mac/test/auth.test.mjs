import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createService } from "../service.mjs";
test("revokes one device without losing tasks or other device and persists only verifiers", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-revoke-`);
  const s = createService({ project: tmpdir(), dataDir });
  const first = s.pair(s.pairCode),
    second = s.pair(s.pairCode);
  assert.throws(() => s.authorize(first), /unauthenticated/);
  s.mutate("create", { requestId: "task", title: "Task", prompt: "Work" });
  s.revoke(first);
  assert.throws(() => s.authorize(`Bearer ${first}`), /unauthenticated/);
  assert.equal(s.authorize(`Bearer ${second}`), second);
  assert.equal(s.list().length, 1);
  const state = readFileSync(`${dataDir}/state.json`, "utf8");
  assert.ok(!state.includes(first) && !state.includes(second));
  await s.close();
});
test("session expires and notifies authorization change listeners", async () => {
  const s = createService({
    project: tmpdir(),
    dataDir: mkdtempSync(`${tmpdir()}/vox-session-expiry-`),
    sessionTtlMs: 10,
  });
  let changed = 0;
  const remove = s.onAuthorizationChange(() => changed++);
  const token = s.pair(s.pairCode);
  await new Promise((r) => setTimeout(r, 30));
  assert.throws(() => s.authorize(`Bearer ${token}`), /unauthenticated/);
  assert.ok(changed > 0);
  remove();
  await s.close();
});
