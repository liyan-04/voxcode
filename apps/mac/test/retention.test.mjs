import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createService } from "../service.mjs";
test("evidence/events are bounded with monotonic cursors; cancellation stays available at mutation cap", async () => {
  const s = createService({
    project: tmpdir(),
    dataDir: mkdtempSync(`${tmpdir()}/vox-limits-`),
    prepareWorktree: (_, id) => `${tmpdir()}/${id}`,
    executor: ({ task, signal, onEvidence, onEvent }) => {
      if (task.title === "Block")
        return new Promise((r) =>
          signal.addEventListener("abort", r, { once: true }),
        );
      for (let i = 0; i < 12; i++)
        onEvidence("note", `output ${i}`, "x".repeat(20000));
      for (let i = 0; i < 80; i++) onEvent("step", `step ${i}`);
    },
  });
  const t = s.mutate("create", {
      requestId: "done",
      title: "Done",
      prompt: "one",
    }),
    block = s.mutate("create", {
      requestId: "block",
      title: "Block",
      prompt: "two",
    });
  await new Promise((r) => setTimeout(r, 30));
  const task = s.get(t.id);
  assert.ok(Buffer.byteLength(JSON.stringify(task.evidence)) < 65536);
  assert.match(task.summary, /omitted/);
  assert.match(task.evidence.at(-1).value, /truncated/);
  const events = s.events(t.id);
  assert.equal(events.events.length, 64);
  assert.ok(events.cursor > 64);
  assert.equal(s.events(t.id, events.cursor).events.length, 0);
  s.mutate(
    "criterion",
    { requestId: "manual", version: 0, decision: "pass" },
    t.id,
    task.criteria[0].id,
  );
  for (let i = 0; i < 125; i++)
    s.mutate("accept", { requestId: `accept-${i}`, version: 0 }, t.id);
  assert.throws(
    () =>
      s.mutate("create", {
        requestId: "over-limit",
        title: "No",
        prompt: "no",
      }),
    /throttled/,
  );
  assert.equal(
    s.mutate("cancel", { requestId: "cancel", version: 0 }, block.id).status,
    "stopping",
  );
  await s.close();
});

test("bounded pending approval decisions accept and decline at the mutation cap with durable replay", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-approval-limits-`);
  let s = createService({
    project: tmpdir(),
    dataDir,
    prepareWorktree: (_, id) => `${tmpdir()}/${id}`,
    executor: ({ task, signal }) =>
      task.title === "Block"
        ? new Promise((resolve) =>
            signal.addEventListener("abort", resolve, { once: true }),
          )
        : undefined,
  });
  try {
    const done = s.mutate("create", {
      requestId: "done",
      title: "Done",
      prompt: "one",
    });
    const block = s.mutate("create", {
      requestId: "block",
      title: "Block",
      prompt: "two",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    s.mutate(
      "criterion",
      { requestId: "manual", version: 0, decision: "pass" },
      done.id,
      done.criteria[0].id,
    );
    for (let i = 0; i < 125; i++)
      s.mutate("accept", { requestId: `accept-${i}`, version: 0 }, done.id);
    const saved = [];
    for (let i = 0; i < 16; i++) {
      let decision;
      s.requestApproval(block.id, { command: "echo ok" }, (value) => {
        decision = value;
      });
      const approvalId = s.get(block.id).approval.id;
      const body = {
        requestId: `decision-${i}`,
        version: 0,
        decision: i % 2 ? "decline" : "accept",
      };
      const result = s.mutate("approval", body, block.id, approvalId);
      assert.equal(decision, body.decision);
      assert.deepEqual(
        s.mutate("approval", body, block.id, approvalId),
        result,
      );
      assert.throws(
        () =>
          s.mutate(
            "approval",
            { ...body, requestId: `reuse-${i}` },
            block.id,
            approvalId,
          ),
        { status: 409, code: "conflict" },
      );
      saved.push({ body, approvalId, result });
    }
    let overBudget;
    s.requestApproval(block.id, { command: "echo extra" }, (value) => {
      overBudget = value;
    });
    assert.equal(
      overBudget,
      "decline",
      "each execution must have bounded reserved approval capacity",
    );
    assert.equal(s.get(block.id).approval, null);
    await s.close();
    s = createService({ project: tmpdir(), dataDir });
    for (const { body, approvalId, result } of saved)
      assert.deepEqual(
        s.mutate("approval", body, block.id, approvalId),
        result,
      );
  } finally {
    await s.close();
  }
});
