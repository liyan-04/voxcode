import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createService } from "../service.mjs";

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));
test("service persists private identity before work and resumes the same worktree after restart", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-continuity-`);
  let prepared = 0;
  const seen = [];
  const options = {
    project: tmpdir(),
    dataDir,
    prepareWorktree: (_, id) => {
      prepared++;
      return `${tmpdir()}/${id}`;
    },
    executor: ({ task, cwd, onSession }) => {
      seen.push({ threadId: task.codexThreadId, cwd });
      onSession({ threadId: "owned-thread" });
      assert.equal(
        JSON.parse(readFileSync(`${dataDir}/state.json`)).tasks[task.id]
          .codexThreadId,
        "owned-thread",
      );
      onSession({ threadId: "owned-thread", turnId: `turn-${task.version}` });
    },
  };
  let s = createService(options);
  try {
    const task = s.mutate("create", {
      requestId: "create",
      title: "Task",
      prompt: "work",
    });
    await delay();
    await s.close();
    s = createService(options);
    s.mutate(
      "messages",
      { requestId: "followup", version: 0, prompt: "again" },
      task.id,
    );
    await delay();
    assert.equal(seen[0].threadId, undefined);
    assert.equal(seen[1].threadId, "owned-thread");
    assert.equal(seen[1].cwd, seen[0].cwd);
    assert.equal(prepared, 1);
    assert.equal(s.get(task.id).status, "completed");
  } finally {
    await s.close();
  }
});

test("unknown dispatch blocks follow-up durably and is never automatically replayed", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-uncertain-`);
  let dispatches = 0;
  const options = {
    project: tmpdir(),
    dataDir,
    prepareWorktree: (_, id) => `${tmpdir()}/${id}`,
    executor: () => {
      dispatches++;
      throw Object.assign(new Error("Codex turn dispatch outcome is unknown"), {
        dispatchUncertain: true,
      });
    },
  };
  let s = createService(options);
  try {
    const task = s.mutate("create", {
      requestId: "create",
      title: "Task",
      prompt: "work",
    });
    await delay();
    assert.equal(s.get(task.id).status, "interrupted");
    assert.match(s.get(task.id).summary, /unknown|reconcil/i);
    assert.equal(s.settings().recoveryRequired, true);
    assert.throws(
      () =>
        s.mutate(
          "messages",
          { requestId: "followup", version: 0, prompt: "again" },
          task.id,
        ),
      { status: 503 },
    );
    await s.close();
    s = createService(options);
    await delay();
    assert.throws(
      () =>
        s.mutate(
          "messages",
          { requestId: "followup", version: 0, prompt: "again" },
          task.id,
        ),
      { status: 503 },
    );
    assert.equal(dispatches, 1);
  } finally {
    await s.close();
  }
});

test("crashed pending dispatch remains blocked after process-cleanup quarantine is cleared", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-pending-dispatch-`);
  writeFileSync(
    `${dataDir}/state.json`,
    JSON.stringify({
      project: realpathSync(tmpdir()),
      sessions: [],
      requests: {},
      events: {},
      unconfirmedExecutions: [],
      tasks: {
        old: {
          id: "old",
          title: "Old",
          prompt: "work",
          version: 0,
          status: "interrupted",
          codexThreadId: "owned-thread",
          codexDispatchState: "pending",
        },
      },
    }),
  );
  let dispatches = 0;
  const s = createService({
    project: tmpdir(),
    dataDir,
    executor: () => dispatches++,
  });
  try {
    assert.equal(s.settings().recoveryRequired, true);
    assert.throws(
      () =>
        s.mutate(
          "messages",
          { requestId: "followup", version: 0, prompt: "again" },
          "old",
        ),
      { status: 503 },
    );
    await delay();
    assert.equal(dispatches, 0);
  } finally {
    await s.close();
  }
});
