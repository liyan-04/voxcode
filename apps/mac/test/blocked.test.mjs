import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createService } from "../service.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail("Task did not settle");
}
function fixture(t, extra = {}) {
  const directory = mkdtempSync(`${tmpdir()}/vox-blocked-`);
  const service = createService({
    project: tmpdir(),
    dataDir: directory,
    prepareWorktree: (_, id) => `${directory}/${id}`,
    executor: ({ task, signal }) => {
      if (task.title === "Held")
        return new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      if (task.title === "Failed") throw new Error("Fixture failure");
    },
    ...extra,
  });
  t.after(async () => {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const state = () => readFileSync(`${directory}/state.json`, "utf8");
  function blocked(action, body, taskId, resourceId) {
    const before = state();
    assert.throws(() => service.mutate(action, body, taskId, resourceId), {
      status: 409,
      code: "blocked",
    });
    assert.equal(
      state(),
      before,
      "Business rejection must not change persisted task, events or replay state",
    );
    assert.equal(
      Object.hasOwn(JSON.parse(state()).requests, body.requestId),
      false,
    );
  }
  const create = (title, requestId = title) =>
    service.mutate("create", { requestId, title, prompt: "Work" });
  return { service, state, blocked, create };
}

test("running and queued follow-ups are blocked without recording a mutation", async (t) => {
  const { service, create, blocked } = fixture(t);
  service.configure({ requestId: "single-slot", executionLimit: 1 });
  const held = create("Held");
  await until(() => service.get(held.id).status === "running");
  const queued = create("Queued");
  for (const task of [held, queued])
    blocked(
      "messages",
      { requestId: `followup-${task.id}`, version: 0, prompt: "Next" },
      task.id,
    );
  assert.equal(service.get(held.id).status, "running");
  assert.equal(service.get(queued.id).status, "queued");
});

for (const status of ["completed", "failed", "interrupted"])
  test(`terminal ${status} cancellation is blocked without changing task or replay state`, async (t) => {
    const { service, create, blocked } = fixture(t);
    const task = create(status === "failed" ? "Failed" : "Done");
    if (status === "interrupted")
      service.mutate(
        "cancel",
        { requestId: "initial-cancel", version: 0 },
        task.id,
      );
    await until(() => service.get(task.id).status === status);
    blocked("cancel", { requestId: "terminal-cancel", version: 0 }, task.id);
  });

test("early acceptance and criterion decisions are blocked without adding evidence", async (t) => {
  const { service, create, blocked } = fixture(t);
  const task = create("Held");
  await until(() => service.get(task.id).status === "running");
  blocked("accept", { requestId: "early-accept", version: 0 }, task.id);
  blocked(
    "criterion",
    { requestId: "early-criterion", version: 0, decision: "pass" },
    task.id,
    task.criteria[0].id,
  );
});

test("required criteria and trusted failures block acceptance without changing its snapshot", async (t) => {
  const { service, create, blocked } = fixture(t, {
    executor: ({ onEvidence }) =>
      onEvidence("test", "Checks", "Failed", {
        status: "failed",
        command: "fixture",
        exitCode: 1,
      }),
  });
  const task = create("Done");
  await until(() => service.get(task.id).status === "completed");
  blocked("accept", { requestId: "unverified-accept", version: 0 }, task.id);
  service.mutate(
    "criterion",
    { requestId: "manual", version: 0, decision: "pass" },
    task.id,
    task.criteria[0].id,
  );
  blocked("accept", { requestId: "failed-check-accept", version: 0 }, task.id);
});

test("wrong and expired approval identities are blocked without an additional executor decision", async (t) => {
  const { service, create, blocked } = fixture(t, { approvalTtlMs: 10 });
  const task = create("Held"),
    decisions = [];
  await until(() => service.get(task.id).status === "running");
  service.requestApproval(task.id, { command: "fixture" }, (decision) =>
    decisions.push(decision),
  );
  const approvalId = service.get(task.id).approval.id;
  blocked(
    "approval",
    { requestId: "wrong-approval", version: 0, decision: "accept" },
    task.id,
    "wrong",
  );
  assert.deepEqual(decisions, []);
  await until(() => decisions.length === 1);
  assert.deepEqual(decisions, ["decline"]);
  blocked(
    "approval",
    { requestId: "expired-approval", version: 0, decision: "accept" },
    task.id,
    approvalId,
  );
  assert.deepEqual(decisions, ["decline"]);
});

test("idempotency fingerprint and cross-budget collisions remain conflict and preserve the original replay", async (t) => {
  const { service, create, state } = fixture(t);
  const original = create("Done", "identity");
  await until(() => service.get(original.id).status === "completed");
  service.configure({ requestId: "setting-identity", executionLimit: 1 });
  const before = state();
  for (const operation of [
    () => create("Different", "identity"),
    () => service.configure({ requestId: "identity", executionLimit: 2 }),
    () => create("Different", "setting-identity"),
    () =>
      service.configure({ requestId: "setting-identity", executionLimit: 2 }),
  ]) {
    assert.throws(operation, { status: 409, code: "conflict" });
    assert.equal(state(), before);
  }
  assert.deepEqual(create("Done", "identity"), original);
});
