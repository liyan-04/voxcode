import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createService } from "../service.mjs";

const bridgeFixture = fileURLToPath(
  new URL("./fixtures/crash-bridge.mjs", import.meta.url),
);
const recoveryCommand = fileURLToPath(
  new URL("../recover.mjs", import.meta.url),
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Fixture condition timed out");
    await delay(10);
  }
}

test("SIGKILL restart quarantines orphaned executions and queued work until explicit local recovery", async () => {
  const project = mkdtempSync(`${tmpdir()}/vox-crash-project-`);
  const dataDir = mkdtempSync(`${tmpdir()}/vox-crash-data-`);
  execFileSync("git", ["-C", project, "init"], { stdio: "pipe" });
  execFileSync(
    "git",
    [
      "-C",
      project,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ],
    { stdio: "pipe" },
  );
  const bridge = spawn(process.execPath, [bridgeFixture, project, dataDir], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const started = new Map();
  const groups = [];
  let recovered;
  bridge.on("message", (message) => {
    if (message.type === "ready") started.set(message.taskId, message.cwd);
  });
  try {
    await until(() => started.size === 2);
    for (const cwd of started.values()) {
      await until(() => existsSync(`${cwd}/heartbeat`));
      groups.push(JSON.parse(readFileSync(`${cwd}/pids.json`)).parent);
    }
    const exited = once(bridge, "exit");
    bridge.kill("SIGKILL");
    await exited;
    for (const group of groups)
      assert.doesNotThrow(() => process.kill(group, 0));
    const heartbeats = [...started.values()].map((cwd) =>
      readFileSync(`${cwd}/heartbeat`, "utf8"),
    );
    await delay(60);
    for (const [i, cwd] of [...started.values()].entries())
      assert.notEqual(readFileSync(`${cwd}/heartbeat`, "utf8"), heartbeats[i]);

    let dispatched = 0;
    recovered = createService({
      project,
      dataDir,
      executor: () => {
        dispatched++;
      },
    });
    await delay(30);
    assert.equal(
      dispatched,
      0,
      "restart must not dispatch queued work over orphaned groups",
    );
    assert.equal(recovered.active.size, 0);
    assert.equal(
      recovered.list().filter((task) => task.status === "interrupted").length,
      2,
    );
    const taskId = started.keys().next().value;
    assert.match(
      recovered.events(taskId).events.at(-1).message,
      /unconfirmed|quarantin/i,
    );
    assert.throws(
      () =>
        recovered.mutate(
          "messages",
          { requestId: "resume", version: 0, prompt: "again" },
          taskId,
        ),
      { status: 503, code: "unavailable" },
    );
    assert.throws(
      () =>
        recovered.mutate("create", {
          requestId: "new",
          title: "New",
          prompt: "again",
        }),
      { status: 503, code: "unavailable" },
    );
    await recovered.close();
    recovered = undefined;
    // Only the test's known fixture groups are terminated; production recovery
    // must never trust persisted process IDs as signal targets.
    for (const group of groups) process.kill(-group, "SIGKILL");
    await delay(80);
    assert.throws(() =>
      execFileSync(process.execPath, [recoveryCommand], {
        env: {
          ...process.env,
          VOXCODE_PROJECT: project,
          VOXCODE_DATA: dataDir,
        },
        stdio: "pipe",
      }),
    );
    assert.equal(
      JSON.parse(readFileSync(`${dataDir}/state.json`)).unconfirmedExecutions
        .length,
      2,
      "recovery without explicit cleanup confirmation must preserve quarantine",
    );
    execFileSync(
      process.execPath,
      [recoveryCommand, "--confirm-executions-stopped"],
      {
        env: {
          ...process.env,
          VOXCODE_PROJECT: project,
          VOXCODE_DATA: dataDir,
        },
        stdio: "pipe",
      },
    );
    for (const cwd of started.values())
      assert.ok(existsSync(`${cwd}/heartbeat`));
    recovered = createService({
      project,
      dataDir,
      executor: () => {
        dispatched++;
      },
    });
    await until(() => dispatched === 1);
  } finally {
    if (bridge.exitCode === null && bridge.signalCode === null)
      bridge.kill("SIGKILL");
    for (const cwd of started.values()) {
      const group = JSON.parse(readFileSync(`${cwd}/pids.json`)).parent;
      try {
        process.kill(-group, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    await recovered?.close();
  }
});

test("legacy running snapshots remain quarantined across repeated restarts", async () => {
  const dataDir = mkdtempSync(`${tmpdir()}/vox-legacy-recovery-`);
  writeFileSync(
    `${dataDir}/state.json`,
    JSON.stringify({
      project: realpathSync(tmpdir()),
      tasks: { old: { id: "old", status: "running", approval: null } },
      events: {},
      requests: {},
      sessions: [],
    }),
  );
  for (let i = 0; i < 2; i++) {
    const service = createService({ project: tmpdir(), dataDir });
    try {
      assert.throws(
        () =>
          service.mutate("create", {
            requestId: `new-${i}`,
            title: "New",
            prompt: "again",
          }),
        { status: 503, code: "unavailable" },
      );
    } finally {
      await service.close();
    }
  }
});
