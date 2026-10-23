import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "../server.mjs";
test("HTTP auth, pairing, scoped tasks, persisted replay and cursor", async () => {
  const options = {
    project: tmpdir(),
    dataDir: mkdtempSync(`${tmpdir()}/vox-http-`),
    executor: ({ signal }) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      ),
    prepareWorktree: (_, id) => `${tmpdir()}/${id}`,
  };
  let app = createServer(options);
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${base}/api/tasks`)).status, 401);
  const paired = await fetch(`${base}/api/pair`, {
    method: "POST",
    body: JSON.stringify({ code: app.service.pairCode }),
  }).then((r) => r.json());
  const headers = { authorization: `Bearer ${paired.sessionToken}` };
  const body = JSON.stringify({
    requestId: "persistent",
    title: "Task",
    prompt: "Do work",
  });
  const original = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers,
    body,
  }).then((r) => r.json());
  assert.ok(original.task.id);
  assert.equal(
    (
      await fetch(`${base}/api/tasks/${original.task.id}/cancel`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId: "stale", version: 33 }),
      })
    ).status,
    409,
  );
  const events = await fetch(`${base}/api/tasks/${original.task.id}/events`, {
    headers,
  }).then((r) => r.json());
  assert.ok(events.cursor > 0);
  await app.close();
  app = createServer(options);
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const replay = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers,
    body,
  }).then((r) => r.json());
  assert.deepEqual(replay, original);
  const current = await fetch(`${base}/api/tasks/${original.task.id}`, {
    headers,
  }).then((r) => r.json());
  assert.equal(current.task.status, "interrupted");
  await app.close();
});
test("HTTP unpair revokes only authenticated session and closes voice authorization", async () => {
  const app = createServer({
    project: tmpdir(),
    dataDir: mkdtempSync(`${tmpdir()}/vox-http-revoke-`),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const first = app.service.pair(app.service.pairCode),
    second = app.service.pair(app.service.pairCode);
  let change = 0;
  app.service.onAuthorizationChange(() => change++);
  const headers = { authorization: `Bearer ${first}` };
  assert.equal(
    (await fetch(`${base}/api/unpair`, { method: "POST", headers })).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/tasks`, { headers })).status, 401);
  assert.equal(
    (
      await fetch(`${base}/api/tasks`, {
        headers: { authorization: `Bearer ${second}` },
      })
    ).status,
    200,
  );
  assert.ok(change > 0);
  await app.close();
});
