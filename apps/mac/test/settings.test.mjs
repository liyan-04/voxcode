import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createService } from "../service.mjs";

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));
function setup(extra = {}) {
  return createService({
    project: tmpdir(),
    dataDir: mkdtempSync(`${tmpdir()}/vox-settings-`),
    prepareWorktree: (_, id) => `${tmpdir()}/${id}`,
    executor: ({ signal }) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      ),
    ...extra,
  });
}

test("all admitted tasks retain waiting approvals and stopping turns", async () => {
  const releases = new Map();
  const s = setup({
    executor: ({ task }) =>
      new Promise((resolve) => releases.set(task.id, resolve)),
  });
  try {
    const tasks = Array.from({ length: 24 }, (_, i) =>
      s.mutate("create", {
        requestId: `task-${i}`,
        title: `Task ${i}`,
        prompt: "work",
      }),
    );
    await delay();
    assert.deepEqual(s.settings(), {
      executionLimit: 4,
      maxExecutionLimit: 8,
      maxTasks: 32,
      activeExecutions: 24,
      queuedTasks: 0,
      recoveryRequired: false,
    });
    s.requestApproval(tasks[0].id, { command: "echo ok" }, () => {});
    s.mutate("cancel", { requestId: "cancel", version: 0 }, tasks[1].id);
    await delay();
    assert.equal(s.get(tasks[0].id).status, "waiting_approval");
    assert.equal(s.get(tasks[1].id).status, "stopping");
    assert.equal(s.get(tasks[4].id).status, "running");
    s.configure({ requestId: "lower", executionLimit: 1 });
    assert.equal(s.active.size, 24);
    for (const task of tasks.slice(0, 3)) releases.get(task.id)();
    await delay();
    assert.equal(s.active.size, 21);
    assert.equal(s.get(tasks[4].id).status, "running");
    s.configure({ requestId: "raise", executionLimit: 8 });
    await delay();
    assert.equal(s.active.size, 21);
    assert.equal(s.get(tasks[11].id).status, "running");
  } finally {
    const closing = s.close();
    for (const resolve of releases.values()) resolve();
    await closing;
  }
});

test("request IDs are literal dictionary keys and remain globally unique across separate replay budgets", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-literal-ids-`);
  let s = setup({ dataDir, executor() {} });
  try {
    const body = { requestId: "__proto__", executionLimit: 2 };
    const saved = s.configure(body);
    assert.equal(saved.executionLimit, 2);
    assert.deepEqual(s.configure(body), saved);
    assert.throws(
      () =>
        s.mutate("create", {
          requestId: "__proto__",
          title: "Duplicate",
          prompt: "work",
        }),
      { status: 409 },
    );
    const taskBody = {
      requestId: "constructor",
      title: "Task",
      prompt: "work",
    };
    const task = s.mutate("create", taskBody);
    assert.deepEqual(s.mutate("create", taskBody), task);
    assert.throws(
      () => s.configure({ requestId: "constructor", executionLimit: 1 }),
      { status: 409 },
    );
    assert.throws(() => s.get("toString"), { status: 404 });
    await delay();
    await s.close();
    s = setup({ dataDir, executor() {} });
    assert.deepEqual(s.configure(body), saved);
    assert.deepEqual(s.mutate("create", taskBody), task);
  } finally {
    await s.close();
  }
});

test("settings validate integer limits and persist exact replay independently of task mutation capacity", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-settings-replay-`);
  let s = setup({ dataDir, executor() {} });
  try {
    for (const executionLimit of [0, 9, 1.5, "2", null])
      assert.throws(
        () =>
          s.configure({ requestId: `bad-${executionLimit}`, executionLimit }),
        { status: 400 },
      );
    assert.throws(() => s.configure({ executionLimit: 2 }), { status: 400 });
    const first = s.configure({ requestId: "settings-0", executionLimit: 2 });
    assert.equal(first.executionLimit, 2);
    for (let i = 1; i < 128; i++)
      s.configure({ requestId: `settings-${i}`, executionLimit: 3 });
    assert.throws(
      () => s.configure({ requestId: "settings-over", executionLimit: 1 }),
      { status: 429 },
    );
    assert.deepEqual(
      s.configure({ executionLimit: 2, requestId: "settings-0" }),
      first,
    );
    assert.throws(
      () => s.configure({ requestId: "settings-0", executionLimit: 1 }),
      { status: 409 },
    );
    const task = s.mutate("create", {
      requestId: "new-task",
      title: "Task",
      prompt: "work",
    });
    await delay();
    for (let i = 0; i < 127; i++)
      (s.mutate(
        "messages",
        { requestId: `message-${i}`, version: i, prompt: "work" },
        task.id,
      ),
        await delay());
    assert.throws(
      () =>
        s.mutate(
          "messages",
          { requestId: "message-over", version: 127, prompt: "work" },
          task.id,
        ),
      { status: 429 },
    );
    await s.close();
    s = setup({ dataDir, executor() {} });
    assert.equal(s.settings().executionLimit, 3);
    assert.deepEqual(
      s.configure({ requestId: "settings-0", executionLimit: 2 }),
      first,
    );
    assert.equal(
      s.settings().executionLimit,
      3,
      "saved replay must not reapply an old setting",
    );
  } finally {
    await s.close();
  }
});
