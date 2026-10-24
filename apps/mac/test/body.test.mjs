import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "../server.mjs";

async function fixture(t) {
  const directory = mkdtempSync(`${tmpdir()}/vox-http-body-`);
  const app = createServer({
    project: tmpdir(),
    dataDir: directory,
    prepareWorktree: (_, id) => `${directory}/${id}`,
    executor() {},
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    app.server.closeAllConnections();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const token = app.service.pair(app.service.pairCode);
  async function post(path, bytes, cuts = []) {
    let upload;
    const incoming = once(app.server, "request");
    const response = new Promise((resolve, reject) => {
      upload = request(
        {
          hostname: "127.0.0.1",
          port: app.server.address().port,
          path,
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "content-length": bytes.length,
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
      upload.flushHeaders();
    });
    const [req] = await incoming;
    let start = 0;
    for (const end of [...cuts, bytes.length]) {
      const received = once(req, "data");
      upload.write(bytes.subarray(start, end));
      await received;
      start = end;
    }
    upload.end();
    return response;
  }
  return { app, post };
}

const splitCharacters = (bytes, values) =>
  values
    .flatMap((value) => {
      const start = bytes.indexOf(Buffer.from(value));
      assert.ok(start >= 0);
      return [start + 1, start + 2];
    })
    .sort((a, b) => a - b);

test("split UTF-8 task titles, prompts and criteria survive create, follow-up and exact retries", async (t) => {
  const { app, post } = await fixture(t);
  const input = {
    requestId: "create-chinese",
    title: "中文标题",
    prompt: "请修复中文分片",
    criteria: [{ text: "验收中文结果" }],
  };
  const bytes = Buffer.from(JSON.stringify(input));
  const created = await post(
    "/api/tasks",
    bytes,
    splitCharacters(bytes, [input.title, input.prompt, input.criteria[0].text]),
  );
  assert.equal(created.status, 200);
  assert.equal(created.body.task.title, input.title);
  assert.equal(created.body.task.prompt, input.prompt);
  assert.equal(created.body.task.criteria[0].text, input.criteria[0].text);
  assert.deepEqual(await post("/api/tasks", bytes), created);
  for (
    let i = 0;
    app.service.get(created.body.task.id).status !== "completed";
    i++
  ) {
    assert.ok(i < 100, "Task did not complete");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const followup = {
    requestId: "followup-chinese",
    version: 0,
    prompt: "继续改进结果",
    criteria: [{ text: "确认改进结果" }],
  };
  const nextBytes = Buffer.from(JSON.stringify(followup));
  const path = `/api/tasks/${created.body.task.id}/messages`;
  const updated = await post(
    path,
    nextBytes,
    splitCharacters(nextBytes, [followup.prompt, followup.criteria[0].text]),
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.task.prompt, followup.prompt);
  assert.equal(updated.body.task.criteria[0].text, followup.criteria[0].text);
  assert.deepEqual(await post(path, nextBytes), updated);
});

test("JSON body limit counts raw bytes even when UTF-8 codepoints cross chunks", async (t) => {
  const { app, post } = await fixture(t);
  const value = JSON.stringify({
    requestId: "byte-limit",
    executionLimit: 1,
    marker: "请",
  });
  const bytes = Buffer.from(
    value + " ".repeat(65536 - Buffer.byteLength(value)),
  );
  const accepted = await post(
    "/api/settings",
    bytes,
    splitCharacters(bytes, ["请"]),
  );
  assert.equal(accepted.status, 200);
  assert.equal(app.service.settings().executionLimit, 1);
  const oversized = Buffer.concat([bytes, Buffer.from(" ")]);
  const rejected = await post("/api/settings", oversized);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, "invalid");
});
