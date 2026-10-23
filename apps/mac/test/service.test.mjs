import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createService } from "../service.mjs";
const setup = () =>
  createService({
    project: tmpdir(),
    dataDir: mkdtempSync(`${tmpdir()}/vox-test-`),
    executor: ({ signal }) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      ),
    prepareWorktree: (_, id) => `${tmpdir()}/${id}`,
  });
test("pairing throttles; unauthorized requests fail", async () => {
  const s = setup();
  assert.throws(() => s.authorize(""), /unauthenticated/);
  for (let i = 0; i < 5; i++) assert.throws(() => s.pair("bad"), /invalid/);
  assert.throws(() => s.pair(s.pairCode), /throttled/);
  await s.close();
});
test("pairing code expires", async () => {
  const s = createService({
    project: tmpdir(),
    dataDir: mkdtempSync(`${tmpdir()}/vox-pair-`),
    pairTtlMs: 1,
    executor: ({ signal }) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      ),
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.throws(() => s.pair(s.pairCode), /invalid/);
  await s.close();
});
test("deduplicates durable mutations, rejects stale versions and isolates two slots", async () => {
  const s = setup();
  s.configure({ requestId: "two-slots", executionLimit: 2 });
  const a = s.mutate("create", { requestId: "a", title: "A", prompt: "one" });
  assert.deepEqual(
    s.mutate("create", { requestId: "a", title: "A", prompt: "one" }),
    a,
  );
  assert.deepEqual(
    s.mutate("create", { prompt: "one", title: "A", requestId: "a" }),
    a,
  );
  assert.throws(
    () => s.mutate("create", { requestId: "a", title: "B", prompt: "two" }),
    /conflict/,
  );
  s.mutate("create", { requestId: "b", title: "B", prompt: "two" });
  const c = s.mutate("create", { requestId: "c", title: "C", prompt: "three" });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.active.size, 2);
  assert.equal(s.get(c.id).status, "queued");
  assert.equal(new Set([...s.active.values()].map((x) => x.cwd)).size, 2);
  assert.throws(
    () =>
      s.mutate(
        "messages",
        { requestId: "d", version: 99, prompt: "bad" },
        a.id,
      ),
    /stale/,
  );
  s.mutate("cancel", { requestId: "e", version: 0 }, a.id);
  assert.equal(s.get(a.id).status, "stopping");
  await s.close();
});
test("approval is version bound, single use and cancelled approvals are invalid", async () => {
  const s = setup();
  const t = s.mutate("create", { requestId: "a", title: "A", prompt: "one" });
  await new Promise((r) => setTimeout(r, 10));
  let decision;
  s.requestApproval(
    t.id,
    { command: "echo ok", cwd: tmpdir() },
    (v) => (decision = v),
  );
  const a = s.get(t.id).approval;
  assert.throws(
    () =>
      s.mutate(
        "approval",
        { requestId: "x", version: 1, decision: "accept" },
        t.id,
        a.id,
      ),
    /stale/,
  );
  s.mutate(
    "approval",
    { requestId: "y", version: 0, decision: "accept" },
    t.id,
    a.id,
  );
  assert.equal(decision, "accept");
  assert.throws(
    () =>
      s.mutate(
        "approval",
        { requestId: "z", version: 0, decision: "accept" },
        t.id,
        a.id,
      ),
    /blocked/,
  );
  s.requestApproval(t.id, { command: "echo again", cwd: tmpdir() }, () => {});
  s.mutate("cancel", { requestId: "c", version: 0 }, t.id);
  assert.equal(s.get(t.id).approval, null);
  await s.close();
});
test("real Git worktrees isolate files and cancellation frees a slot only after executor settles", async () => {
  const project = mkdtempSync(`${tmpdir()}/vox-git-`);
  const git = (...args) =>
    execFileSync("git", ["-C", project, ...args], { stdio: "pipe" });
  git("init");
  writeFileSync(`${project}/file.txt`, "original");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "init",
  );
  let running = 0,
    max = 0;
  const paths = [];
  const s = createService({
    project,
    dataDir: mkdtempSync(`${tmpdir()}/vox-data-`),
    executor: ({ task, cwd, signal }) =>
      new Promise((resolve) => {
        running++;
        max = Math.max(max, running);
        paths.push(cwd);
        writeFileSync(`${cwd}/file.txt`, task.title);
        signal.addEventListener(
          "abort",
          () =>
            setTimeout(() => {
              running--;
              resolve();
            }, 10),
          { once: true },
        );
      }),
  });
  s.configure({ requestId: "two-slots", executionLimit: 2 });
  const a = s.mutate("create", { requestId: "a", title: "A", prompt: "one" });
  s.mutate("create", { requestId: "b", title: "B", prompt: "two" });
  const c = s.mutate("create", { requestId: "c", title: "C", prompt: "three" });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(paths.length, 2);
  assert.equal(readFileSync(`${project}/file.txt`, "utf8"), "original");
  assert.equal(readFileSync(`${paths[0]}/file.txt`, "utf8"), "A");
  s.mutate("cancel", { requestId: "cancel", version: 0 }, a.id);
  assert.equal(s.get(c.id).status, "queued");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(paths.length, 3);
  assert.equal(s.get(a.id).status, "interrupted");
  assert.equal(max, 2);
  await s.close();
});
test("expired approval declines operation and cannot be consumed", async () => {
  const s = createService({
    project: tmpdir(),
    dataDir: mkdtempSync(`${tmpdir()}/vox-expiry-`),
    executor: ({ signal }) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      ),
    prepareWorktree: (_, id) => `${tmpdir()}/${id}`,
    approvalTtlMs: 10,
  });
  const t = s.mutate("create", { requestId: "t", title: "T", prompt: "one" });
  await new Promise((r) => setTimeout(r, 10));
  let decision;
  s.requestApproval(t.id, {}, (d) => (decision = d));
  const id = s.get(t.id).approval.id;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(decision, "decline");
  assert.equal(s.get(t.id).approval, null);
  assert.throws(
    () =>
      s.mutate(
        "approval",
        { requestId: "late", version: 0, decision: "accept" },
        t.id,
        id,
      ),
    /blocked/,
  );
  await s.close();
});
