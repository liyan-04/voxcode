import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "../server.mjs";

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));
async function fixture(t, extra = {}) {
  const { beforeClose = () => {}, ...serverOptions } = extra;
  const app = createServer({
    project: tmpdir(),
    dataDir: mkdtempSync(`${tmpdir()}/vox-http-v1-`),
    prepareWorktree: (_, id) => `${tmpdir()}/${id}`,
    executor() {},
    ...serverOptions,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    beforeClose();
    await app.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const token = app.service.pair(app.service.pairCode);
  const call = async (path, body, authorized = true) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: authorized ? { authorization: `Bearer ${token}` } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { app, call, token };
}

test("settings HTTP is authenticated and validates version-independent durable replay", async (t) => {
  const { call } = await fixture(t);
  assert.equal((await call("/api/settings", undefined, false)).status, 401);
  assert.equal(
    (
      await call(
        "/api/settings",
        { requestId: "unauthorized", executionLimit: 1 },
        false,
      )
    ).status,
    401,
  );
  const initial = await call("/api/settings");
  assert.equal(initial.status, 200);
  assert.equal(initial.body.executionLimit, 4);
  assert.equal(initial.body.maxExecutionLimit, 8);
  assert.equal(initial.body.maxTasks, 32);
  assert.equal(initial.body.activeExecutions, 0);
  for (const executionLimit of [0, 9, 1.5, "2"])
    assert.deepEqual(
      await call("/api/settings", { requestId: "invalid", executionLimit }),
      {
        status: 400,
        body: { error: { code: "invalid", message: "invalid" } },
      },
    );
  const body = { requestId: "setting", executionLimit: 1 };
  const saved = await call("/api/settings", body);
  assert.equal(saved.body.executionLimit, 1);
  await call("/api/settings", { requestId: "later", executionLimit: 8 });
  assert.deepEqual(await call("/api/settings", body), saved);
  assert.equal((await call("/api/settings")).body.executionLimit, 8);
  assert.equal(
    (await call("/api/settings", { ...body, executionLimit: 2 })).status,
    409,
  );
});

test("manual criteria HTTP gates current-version acceptance and preserves exact replay", async (t) => {
  const { call } = await fixture(t);
  const created = await call("/api/tasks", {
    requestId: "task",
    title: "Task",
    prompt: "work",
    criteria: [{ text: "Inspect the result" }],
  });
  const task = created.body.task;
  const path = `/api/tasks/${task.id}`;
  const criterion = `${path}/criteria/${task.criteria[0].id}`;
  await delay();
  assert.equal(
    (
      await call(
        criterion,
        { requestId: "no-auth", version: 0, decision: "pass" },
        false,
      )
    ).status,
    401,
  );
  assert.equal(
    (await call(`${path}/accept`, { requestId: "unverified", version: 0 }))
      .status,
    409,
  );
  assert.equal(
    (
      await call(criterion, {
        requestId: "stale",
        version: 1,
        decision: "pass",
      })
    ).body.error.code,
    "stale",
  );
  assert.equal(
    (
      await call(criterion, {
        requestId: "invalid",
        version: 0,
        decision: "approve",
      })
    ).status,
    400,
  );
  const failed = await call(criterion, {
    requestId: "fail",
    version: 0,
    decision: "fail",
  });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.task.criteria[0].status, "failed");
  assert.equal(
    (await call(`${path}/accept`, { requestId: "failed", version: 0 })).status,
    409,
  );
  const body = {
    requestId: "pass",
    version: 0,
    decision: "pass",
    note: "Checked actual result",
  };
  const saved = await call(criterion, body);
  assert.equal(saved.body.task.criteria[0].status, "passed");
  assert.deepEqual(await call(criterion, body), saved);
  assert.equal(
    (await call(criterion, { ...body, decision: "fail" })).status,
    409,
  );
  const accepted = await call(`${path}/accept`, {
    requestId: "accept",
    version: 0,
  });
  assert.equal(accepted.body.task.acceptance, "accepted");
  assert.equal(accepted.body.task.acceptanceSnapshot.version, 0);
  const followup = await call(`${path}/messages`, {
    requestId: "next",
    version: 0,
    prompt: "Refine it",
  });
  assert.equal(followup.body.task.criteria[0].status, "unverified");
  assert.equal(followup.body.task.version, 1);
  await delay();
  assert.equal(
    (await call(criterion, { requestId: "old", version: 0, decision: "pass" }))
      .status,
    409,
  );
  for (const suffix of [
    "criteria",
    `criteria/${task.criteria[0].id}/extra`,
    "accept/extra",
    "events/extra",
  ])
    assert.equal(
      (
        await call(`${path}/${suffix}`, {
          requestId: `bad-${suffix}`,
          version: 1,
          decision: "pass",
        })
      ).status,
      404,
    );
});

test("monitor HTTP returns exact bounded aggregates, distinguishes accepted and never leaks task contents", async (t) => {
  const pending = new Map();
  const { app, call, token } = await fixture(t, {
    beforeClose: () => {
      for (const resolve of pending.values()) resolve();
    },
    executor: ({ task, onEvidence, onSession }) => {
      onSession({ threadId: "PRIVATE_THREAD", turnId: "PRIVATE_TURN" });
      onEvidence("note", "PRIVATE_LABEL", "PRIVATE_OUTPUT");
      if (task.title === "PRIVATE_FAILED") throw new Error("PRIVATE_ERROR");
      if (task.title.startsWith("PRIVATE_BLOCK"))
        return new Promise((resolve) => {
          pending.set(task.id, resolve);
        });
    },
  });
  assert.equal((await call("/api/monitor", undefined, false)).status, 401);
  let monitor = await call("/api/monitor");
  assert.equal(monitor.status, 200);
  assert.deepEqual(monitor.body.counts, {
    queued: 0,
    running: 0,
    waiting_approval: 0,
    waiting_input: 0,
    stopping: 0,
    interrupted: 0,
    failed: 0,
    completed: 0,
    accepted: 0,
  });
  const make = async (title) =>
    (
      await call("/api/tasks", {
        requestId: title,
        title,
        prompt: "PRIVATE_PROMPT",
      })
    ).body.task;
  const accepted = await make("PRIVATE_ACCEPTED");
  await delay();
  await call(`/api/tasks/${accepted.id}/criteria/${accepted.criteria[0].id}`, {
    requestId: "manual",
    version: 0,
    decision: "pass",
  });
  await call(`/api/tasks/${accepted.id}/accept`, {
    requestId: "accept",
    version: 0,
  });
  await make("PRIVATE_COMPLETED");
  await make("PRIVATE_FAILED");
  await delay();
  await call("/api/settings", { requestId: "two", executionLimit: 2 });
  const running = await make("PRIVATE_BLOCK_RUNNING");
  const waiting = await make("PRIVATE_BLOCK_WAITING");
  await make("PRIVATE_QUEUED");
  app.service.requestApproval(
    waiting.id,
    { command: "PRIVATE_COMMAND", cwd: "PRIVATE_PATH" },
    () => {},
  );
  await call(`/api/tasks/${running.id}/cancel`, {
    requestId: "cancel",
    version: 0,
  });
  monitor = await call("/api/monitor");
  assert.deepEqual(
    Object.keys(monitor.body).sort(),
    [
      "generatedAt",
      "uptimeSeconds",
      "executionLimit",
      "maxTasks",
      "activeExecutions",
      "recoveryRequired",
      "counts",
      "memory",
    ].sort(),
  );
  assert.equal(monitor.body.executionLimit, 2);
  assert.equal(monitor.body.activeExecutions, 2);
  assert.equal(monitor.body.counts.waiting_approval, 1);
  assert.equal(monitor.body.counts.stopping, 1);
  assert.equal(monitor.body.counts.queued, 1);
  assert.equal(monitor.body.counts.failed, 1);
  assert.equal(monitor.body.counts.completed, 1);
  assert.equal(monitor.body.counts.accepted, 1);
  assert.ok(Number.isFinite(Date.parse(monitor.body.generatedAt)));
  assert.ok(monitor.body.uptimeSeconds >= 0);
  assert.ok(
    Number.isInteger(monitor.body.memory.rssBytes) &&
      monitor.body.memory.rssBytes > 0,
  );
  assert.ok(
    Number.isInteger(monitor.body.memory.heapUsedBytes) &&
      monitor.body.memory.heapUsedBytes > 0,
  );
  const encoded = JSON.stringify(monitor.body);
  assert.doesNotMatch(encoded, /PRIVATE_|worktree|codexThreadId|codexTurnId/);
  assert.ok(!encoded.includes(token));
  assert.ok(!encoded.includes(accepted.id));
  app.service.revoke(token);
  assert.equal((await call("/api/monitor")).status, 401);
});
