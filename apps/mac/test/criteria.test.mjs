import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createService } from "../service.mjs";

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));
function setup(
  executor = () => {},
  dataDir = mkdtempSync(`${tmpdir()}/vox-criteria-`),
) {
  return createService({
    project: tmpdir(),
    dataDir,
    prepareWorktree: (_, id) => `${tmpdir()}/${id}`,
    executor,
  });
}
function create(s, criteria) {
  return s.mutate("create", {
    requestId: "create",
    title: "Page",
    prompt: "Build the page",
    ...(criteria === undefined ? {} : { criteria }),
  });
}

test("manual criteria gate acceptance and persist version-bound evidence and immutable acceptance snapshots", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-criteria-snapshot-`);
  let s = setup(() => {}, dataDir);
  try {
    const task = create(s, [
      { text: "Form validates", required: true },
      { text: "Check colors", required: false },
    ]);
    await delay();
    const current = s.get(task.id);
    assert.equal(current.criteria[0].verification, "manual");
    assert.equal(current.criteria[0].status, "unverified");
    assert.throws(
      () =>
        s.mutate("accept", { requestId: "unverified", version: 0 }, task.id),
      { status: 409 },
    );
    const criterionId = current.criteria[0].id;
    assert.throws(
      () =>
        s.mutate(
          "criterion",
          { requestId: "stale", version: 1, decision: "pass" },
          task.id,
          criterionId,
        ),
      { status: 409 },
    );
    assert.throws(
      () =>
        s.mutate(
          "criterion",
          { requestId: "unknown", version: 0, decision: "pass" },
          task.id,
          "missing",
        ),
      { status: 404 },
    );
    const failed = s.mutate(
      "criterion",
      {
        requestId: "fail",
        version: 0,
        decision: "fail",
        note: "No validation",
      },
      task.id,
      criterionId,
    );
    assert.equal(failed.criteria[0].status, "failed");
    assert.throws(
      () => s.mutate("accept", { requestId: "failed", version: 0 }, task.id),
      { status: 409 },
    );
    const body = {
      requestId: "pass",
      version: 0,
      decision: "pass",
      note: "Empty form is rejected",
    };
    const passed = s.mutate("criterion", body, task.id, criterionId);
    assert.deepEqual(s.mutate("criterion", body, task.id, criterionId), passed);
    const evidence = passed.evidence.find(
      (item) => item.id === passed.criteria[0].evidenceIds[0],
    );
    assert.equal(evidence.version, 0);
    assert.equal(evidence.value, "Empty form is rejected");
    const accepted = s.mutate(
      "accept",
      { requestId: "accept", version: 0 },
      task.id,
    );
    assert.equal(accepted.acceptance, "accepted");
    assert.equal(accepted.acceptanceSnapshot.version, 0);
    assert.equal(accepted.acceptanceSnapshot.criteria[0].status, "passed");
    const followup = s.mutate(
      "messages",
      { requestId: "followup", version: 0, prompt: "Adjust the layout" },
      task.id,
    );
    assert.equal(followup.version, 1);
    assert.equal(followup.acceptanceSnapshot, null);
    assert.equal(followup.criteria[0].id, criterionId);
    assert.equal(followup.criteria[0].version, 1);
    assert.equal(followup.criteria[0].status, "unverified");
    assert.deepEqual(followup.criteria[0].evidenceIds, []);
    assert.equal(accepted.acceptanceSnapshot.criteria[0].version, 0);
    await delay();
    await s.close();
    s = setup(() => {}, dataDir);
    assert.deepEqual(
      s.mutate("accept", { requestId: "accept", version: 0 }, task.id),
      accepted,
    );
    assert.deepEqual(s.get(task.id).criteria, followup.criteria);
  } finally {
    await s.close();
  }
});

test("criteria validate before changing execution input and default to one required manual condition", async () => {
  const s = setup();
  try {
    for (const criteria of [
      [],
      Array(13).fill({ text: "x" }),
      [{ text: " " }],
      [{ text: "x".repeat(501) }],
      [{ text: "ok", required: "yes" }],
      null,
    ])
      assert.throws(() => create(s, criteria), { status: 400 });
    const task = create(s);
    assert.equal(task.criteria.length, 1);
    assert.equal(task.criteria[0].required, true);
    assert.throws(
      () =>
        s.mutate(
          "criterion",
          { requestId: "early", version: 0, decision: "pass" },
          task.id,
          task.criteria[0].id,
        ),
      { status: 409 },
    );
    await delay();
    assert.throws(
      () =>
        s.mutate(
          "messages",
          {
            requestId: "bad-followup",
            version: 0,
            prompt: "change",
            criteria: [],
          },
          task.id,
        ),
      { status: 400 },
    );
    assert.equal(s.get(task.id).version, 0);
    assert.throws(
      () =>
        s.mutate(
          "criterion",
          { requestId: "bad-decision", version: 0, decision: "automatic" },
          task.id,
          task.criteria[0].id,
        ),
      { status: 400 },
    );
    const next = s.mutate(
      "messages",
      {
        requestId: "replacement",
        version: 0,
        prompt: "change",
        criteria: [{ text: "New condition" }],
      },
      task.id,
    );
    assert.equal(next.criteria[0].text, "New condition");
    assert.notEqual(next.criteria[0].id, task.criteria[0].id);
    await delay();
  } finally {
    await s.close();
  }
});

test("trusted failed check evidence cannot be overridden by manual pass even after bounded evidence eviction", async () => {
  const s = setup(({ task, onEvidence }) => {
    if (task.version !== 0) return;
    onEvidence("test", "Unit checks", "one assertion failed", {
      status: "failed",
      command: "npm test",
      exitCode: 1,
      artifactId: "build-1",
      injected: "drop",
    });
    for (let i = 0; i < 12; i++)
      onEvidence("note", "More output", "x".repeat(16000));
  });
  try {
    const task = create(s);
    await delay();
    assert.equal(s.get(task.id).status, "completed");
    s.mutate(
      "criterion",
      { requestId: "manual", version: 0, decision: "pass" },
      task.id,
      task.criteria[0].id,
    );
    assert.throws(
      () =>
        s.mutate("accept", { requestId: "not-accepted", version: 0 }, task.id),
      { status: 409 },
    );
    s.mutate(
      "messages",
      { requestId: "fix", version: 0, prompt: "Fix the failing check" },
      task.id,
    );
    await delay();
    s.mutate(
      "criterion",
      { requestId: "manual-fixed", version: 1, decision: "pass" },
      task.id,
      task.criteria[0].id,
    );
    assert.equal(
      s.mutate("accept", { requestId: "accepted", version: 1 }, task.id)
        .acceptance,
      "accepted",
    );
  } finally {
    await s.close();
  }
});

test("trusted publication metadata is bounded, version-bound and absent from unsafe public task fields", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-metadata-`);
  const s = setup(({ onEvidence, onSession, onPreview }) => {
    onSession({ threadId: "private-thread", turnId: "private-turn" });
    onEvidence("test", "Check", "ok", {
      status: "passed",
      command: "x".repeat(10000),
      exitCode: 0,
      artifactId: "artifact-1",
      injected: "drop",
    });
    onEvidence("note", "Codex response", "Actual final summary");
    onPreview({ artifactId: "artifact-1", path: "/preview/artifact-1/" });
  }, dataDir);
  try {
    const task = create(s);
    await delay();
    const current = s.get(task.id);
    assert.equal(current.summary, "Actual final summary");
    assert.deepEqual(current.preview, {
      artifactId: "artifact-1",
      version: 0,
      path: "/preview/artifact-1/",
    });
    assert.equal(current.previewUrl, "/preview/artifact-1/");
    assert.equal(current.evidence[0].status, "passed");
    assert.equal(current.evidence[0].exitCode, 0);
    assert.equal(current.evidence[0].artifactId, "artifact-1");
    assert.ok(current.evidence[0].command.length <= 4200);
    assert.equal(current.evidence[0].injected, undefined);
    for (const response of [
      current,
      ...s.list(),
      s.mutate("create", {
        requestId: "create",
        title: "Page",
        prompt: "Build the page",
      }),
    ]) {
      assert.equal(response.worktree, undefined);
      assert.equal(response.codexThreadId, undefined);
      assert.equal(response.codexTurnId, undefined);
    }
    const privateTask = JSON.parse(readFileSync(`${dataDir}/state.json`)).tasks[
      task.id
    ];
    assert.equal(privateTask.codexThreadId, "private-thread");
    assert.equal(privateTask.codexTurnId, "private-turn");
    s.mutate(
      "messages",
      { requestId: "next", version: 0, prompt: "change" },
      task.id,
    );
    assert.equal(s.get(task.id).preview, null);
    await delay();
  } finally {
    await s.close();
  }
});

test("invalid preview publication fails instead of exposing an arbitrary path", async () => {
  for (const publication of [
    { artifactId: "artifact", path: "/preview/artifact/../secret" },
    { artifactId: "artifact", path: "/preview/other/" },
    { artifactId: "../secret", path: "/preview/../secret/" },
  ]) {
    const s = setup(({ onPreview }) => onPreview(publication));
    try {
      const task = create(s);
      await delay();
      assert.equal(s.get(task.id).status, "failed");
      assert.equal(s.get(task.id).preview, null);
      assert.equal(s.get(task.id).previewUrl, null);
    } finally {
      await s.close();
    }
  }
});
