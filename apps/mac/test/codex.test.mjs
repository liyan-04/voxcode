import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCodex } from "../codex.mjs";
const fixture = fileURLToPath(
  new URL("./fixtures/app-server.mjs", import.meta.url),
);
function repository() {
  const cwd = mkdtempSync(`${tmpdir()}/vox-adapter-`);
  for (const args of [
    ["init"],
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ],
  ])
    execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
  return cwd;
}
function execute(cwd, mode, extra = {}) {
  return runCodex({
    cwd,
    task: { prompt: mode },
    signal: new AbortController().signal,
    onEvent() {},
    onEvidence() {},
    onApproval() {
      throw new Error("Unexpected approval");
    },
    command: process.execPath,
    args: [fixture],
    terminationGraceMs: 40,
    ...extra,
  });
}
test("adapter waits for cancellation termination and kills its owned process group", async () => {
  const cwd = repository(),
    controller = new AbortController();
  let ready;
  const started = new Promise((resolve) => (ready = resolve));
  const run = execute(cwd, "cancel", {
    signal: controller.signal,
    onEvidence: () => ready(),
  });
  await started;
  const pids = JSON.parse(readFileSync(`${cwd}/pids.json`));
  await new Promise((r) => setTimeout(r, 80));
  controller.abort();
  await assert.rejects(run, /Cancelled/);
  assert.throws(() => process.kill(pids.parent, 0), { code: "ESRCH" });
  const heartbeat = readFileSync(`${cwd}/heartbeat`, "utf8");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(readFileSync(`${cwd}/heartbeat`, "utf8"), heartbeat);
});
test("adapter marks denied termination as unresolved ownership", async () => {
  const originalKill = process.kill;
  let group;
  process.kill = (pid, signal) => {
    if (pid < 0 && signal === "SIGTERM") {
      group = pid;
      throw Object.assign(new Error("Fixture termination denied"), {
        code: "EPERM",
      });
    }
    return originalKill(pid, signal);
  };
  try {
    await assert.rejects(execute(repository(), "new"), {
      ownershipUnresolved: true,
    });
  } finally {
    process.kill = originalKill;
    if (group) {
      try {
        process.kill(group, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      for (let i = 0; i < 100; i++) {
        try {
          process.kill(group, 0);
        } catch (error) {
          if (error.code === "ESRCH") break;
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.throws(() => process.kill(group, 0), { code: "ESRCH" });
    }
  }
});
test("adapter rejects failed turns after terminating server", async () => {
  await assert.rejects(execute(repository(), "error"), /fixture turn failed/);
});
test("adapter rejects request errors and malformed protocol without leaking child ownership", async () => {
  await assert.rejects(
    execute(repository(), "unused", { args: [fixture, "init-error"] }),
    /fixture initialize denied/,
  );
  await assert.rejects(
    execute(repository(), "invalid-json"),
    /Unexpected token/,
  );
});
test("adapter fails closed for file approvals with unrepresentable changes/scope", async () => {
  const cwd = repository();
  await execute(cwd, "file-approval");
  const response = JSON.parse(readFileSync(`${cwd}/decision.json`));
  assert.equal(response.result.decision, "decline");
});
test("command approval displays command and forwards one explicit decision", async () => {
  const cwd = repository();
  let seen;
  await execute(cwd, "command-approval", {
    onApproval: (details, reply) => {
      seen = details;
      reply("accept");
    },
  });
  assert.equal(seen.command, "echo hello");
  assert.equal(seen.cwd, realpathSync(cwd));
  assert.equal(
    JSON.parse(readFileSync(`${cwd}/decision.json`)).result.decision,
    "accept",
  );
});
test("final evidence includes new files without reading secret or symlink content", async () => {
  const cwd = repository();
  const outside = mkdtempSync(`${tmpdir()}/vox-outside-`);
  writeFileSync(`${outside}/outside.txt`, "OUTSIDE_SECRET");
  symlinkSync(`${outside}/outside.txt`, `${cwd}/linked.txt`);
  const evidence = [];
  await execute(cwd, "new", {
    onEvidence: (kind, label, value) => evidence.push({ kind, label, value }),
  });
  const values = JSON.stringify(evidence);
  assert.match(values, /new visible source/);
  assert.match(values, /created.txt/);
  assert.doesNotMatch(values, /must-not-be-evidence/);
  assert.doesNotMatch(values, /OUTSIDE_SECRET/);
  assert.match(values, /symlink/i);
});

test("adapter child excludes bridge and voice configuration while preserving coding environment", async () => {
  const cwd = repository();
  const names = [
    "VOXCODE_TEST_TOKEN",
    "LINX_TEST_TOKEN",
    "GIT_TEST_CONFIG",
    "VOX_TEST_CODING",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = "fixture-marker";
    process.env.VOX_TEST_CODING = "allowed";
    await execute(cwd, "environment");
    assert.deepEqual(JSON.parse(readFileSync(`${cwd}/child-env.json`)), {
      bridgeConfigPresent: false,
      voiceConfigPresent: false,
      gitConfigPresent: false,
      pathPresent: true,
      homePresent: true,
      codingConfigPreserved: true,
    });
  } finally {
    for (const [name, value] of previous)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});

const protocol = (cwd) =>
  readFileSync(`${cwd}/protocol.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
test("durable thread identity is saved before dispatch and follow-up resumes it with the same permissions", async () => {
  const cwd = repository();
  const sessions = [];
  await execute(cwd, "new", {
    onSession: async (session) => {
      if (!session.turnId) {
        assert.equal(
          protocol(cwd).some((m) => m.method === "turn/start"),
          false,
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      sessions.push(session);
    },
  });
  assert.deepEqual(sessions, [
    { threadId: "thread" },
    { threadId: "thread", turnId: "turn" },
  ]);
  const started = protocol(cwd).find((m) => m.method === "thread/start");
  assert.equal(started.params.ephemeral, false);
  await execute(cwd, "new", {
    task: { prompt: "new", codexThreadId: "thread" },
    onSession: (session) => sessions.push(session),
  });
  const messages = protocol(cwd);
  assert.equal(messages.filter((m) => m.method === "thread/start").length, 1);
  const resumed = messages.find((m) => m.method === "thread/resume");
  assert.equal(resumed.params.threadId, "thread");
  for (const name of ["cwd", "approvalPolicy", "approvalsReviewer", "sandbox"])
    assert.equal(resumed.params[name], started.params[name]);
  const turns = messages.filter((m) => m.method === "turn/start");
  assert.deepEqual(turns[1].params.sandboxPolicy, {
    type: "workspaceWrite",
    writableRoots: [cwd],
    networkAccess: false,
    excludeSlashTmp: true,
    excludeTmpdirEnvVar: true,
  });
  assert.equal(turns[1].params.cwd, cwd);
  assert.equal(turns[1].params.threadId, "thread");
});

test("unavailable resume never creates a replacement thread or dispatches a new turn", async () => {
  const cwd = repository();
  await assert.rejects(
    execute(cwd, "new", {
      task: { prompt: "new", codexThreadId: "missing-thread" },
      args: [fixture, "resume-error"],
    }),
    /fixture thread unavailable/,
  );
  const methods = protocol(cwd).map((m) => m.method);
  assert.ok(methods.includes("thread/resume"));
  assert.equal(methods.includes("thread/start"), false);
  assert.equal(methods.includes("turn/start"), false);
});

test("lost turn dispatch response is reported as uncertain after owned process teardown", async () => {
  await assert.rejects(
    execute(repository(), "new", {
      args: [fixture, "turn-timeout"],
      requestTimeoutMs: 500,
    }),
    {
      dispatchUncertain: true,
    },
  );
});

test("command failures carry structured trusted evidence rather than a successful prose claim", async () => {
  const evidence = [];
  await execute(repository(), "command-failure", {
    onEvidence: (kind, label, value, details) =>
      evidence.push({ kind, label, value, details }),
  });
  const failure = evidence.find((e) => e.details?.command === "npm test");
  assert.ok(failure);
  assert.equal(failure.details.status, "failed");
  assert.equal(failure.details.exitCode, 1);
  assert.equal(failure.value, "assertion failed");
});

test("resume history and foreign completion notifications cannot complete the new owned turn", async () => {
  await assert.rejects(
    execute(repository(), "error", {
      task: { prompt: "error", codexThreadId: "thread" },
      args: [fixture, "stale-events"],
    }),
    /fixture turn failed/,
  );
});
