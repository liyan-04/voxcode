import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "../server.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail("Task did not settle");
}

async function fixture(t, expiring) {
  const directory = mkdtempSync(`${tmpdir()}/vox-http-authorization-`);
  const gates = new Map();
  const app = createServer({
    project: tmpdir(),
    dataDir: directory,
    sessionTtlMs: expiring ? 200 : 60000,
    prepareWorktree: (_, id) => `${directory}/${id}`,
    executor({ task }) {
      if (task.title === "Blocked")
        return new Promise((resolve) => gates.set(task.id, resolve));
    },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const release of gates.values()) release();
    app.server.closeAllConnections();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    app,
    token: app.service.pair(app.service.pairCode),
    base: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function scenario(service, name) {
  if (name === "settings")
    return {
      path: "/api/settings",
      body: { requestId: "pending", executionLimit: 1 },
      verify: () => assert.equal(service.settings().executionLimit, 4),
    };
  if (name === "create")
    return {
      path: "/api/tasks",
      body: { requestId: "pending", title: "Unauthorized", prompt: "Work" },
      verify: () => assert.equal(service.list().length, 0),
    };
  const blocked = ["cancel", "approval"].includes(name);
  const task = service.mutate("create", {
    requestId: "initial",
    title: blocked ? "Blocked" : "Completed",
    prompt: "Initial prompt",
  });
  await until(
    () => service.get(task.id).status === (blocked ? "running" : "completed"),
  );
  const path = `/api/tasks/${task.id}`;
  const body = { requestId: "pending", version: 0 };
  if (name === "messages")
    return {
      path: `${path}/messages`,
      body: { ...body, prompt: "Unauthorized follow-up" },
      verify: () => {
        assert.equal(service.get(task.id).version, 0);
        assert.equal(service.get(task.id).prompt, "Initial prompt");
      },
    };
  if (name === "cancel")
    return {
      path: `${path}/cancel`,
      body,
      verify: () => assert.equal(service.get(task.id).status, "running"),
    };
  if (name === "approval") {
    const decisions = [];
    service.requestApproval(
      task.id,
      { command: "fixture command", cwd: tmpdir() },
      (decision) => decisions.push(decision),
    );
    const approvalId = service.get(task.id).approval.id;
    return {
      path: `${path}/approvals/${approvalId}`,
      body: { ...body, decision: "accept" },
      verify: () => {
        assert.deepEqual(decisions, []);
        assert.equal(service.get(task.id).status, "waiting_approval");
        assert.equal(service.get(task.id).approval.id, approvalId);
      },
    };
  }
  const criterionId = task.criteria[0].id;
  if (name === "criterion")
    return {
      path: `${path}/criteria/${criterionId}`,
      body: { ...body, decision: "pass" },
      verify: () =>
        assert.equal(service.get(task.id).criteria[0].status, "unverified"),
    };
  service.mutate(
    "criterion",
    { requestId: "verified", version: 0, decision: "pass" },
    task.id,
    criterionId,
  );
  return {
    path: `${path}/accept`,
    body,
    verify: () => assert.equal(service.get(task.id).acceptance, "pending"),
  };
}

for (const reason of ["revoked", "expired"])
  for (const action of [
    "settings",
    "create",
    "messages",
    "cancel",
    "approval",
    "criterion",
    "accept",
  ])
    test(`${reason} session cannot finish a pending ${action} mutation`, async (t) => {
      const { app, token, base } = await fixture(t, reason === "expired");
      const operation = await scenario(app.service, action);
      const body = JSON.stringify(operation.body);
      const entered = once(app.server, "request");
      let upload;
      const response = new Promise((resolve, reject) => {
        upload = request(
          `${base}${operation.path}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          async (res) => {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            resolve({
              status: res.statusCode,
              body: JSON.parse(Buffer.concat(chunks)),
            });
          },
        );
        upload.on("error", reject);
        upload.write(body.slice(0, 5));
      });
      await entered;
      if (reason === "revoked") app.service.revoke(token);
      else await delay(240);
      assert.equal(
        (
          await fetch(`${base}/api/tasks`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
        401,
      );
      upload.end(body.slice(5));
      const result = await response;
      assert.equal(result.status, 401);
      assert.equal(result.body.error.code, "unauthenticated");
      operation.verify();
    });
