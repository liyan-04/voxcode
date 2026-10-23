import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { gitEnv } from "./service.mjs";
import { collectRepositoryEvidence } from "./evidence.mjs";

export function codexAvailable() {
  try {
    return /codex-cli/.test(
      execFileSync("codex", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return false;
  }
}

// Each App Server starts a new, owned process group. Group signals never target
// the bridge's process group or another desktop Codex session.
export async function runCodex({
  task,
  cwd,
  signal,
  onEvent,
  onEvidence,
  onApproval,
  command = "codex",
  args = ["app-server", "--listen", "stdio://"],
  terminationGraceMs = 1000,
  requestTimeoutMs = 30000,
}) {
  if (signal.aborted) throw new Error("Cancelled");
  const child = spawn(command, args, {
    cwd,
    env: gitEnv(),
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const pending = new Map();
  let next = 0,
    threadId,
    turnId,
    settled = false,
    resolveDone,
    rejectDone,
    resolveClosed;
  const closed = new Promise((resolve) => (resolveClosed = resolve));
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});
  function finish(error) {
    if (settled) return;
    settled = true;
    error ? rejectDone(error) : resolveDone();
  }
  function rejectPending(error) {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  }
  const send = (message) => {
    if (!child.stdin.destroyed)
      child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  child.stdin.on("error", (error) => finish(error));
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex timeout: ${method}`));
      }, requestTimeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      send({ id, method, params });
    });
  child.on("error", (error) => {
    finish(error);
    rejectPending(error);
  });
  child.on("exit", (code) => {
    const error = new Error(`Codex exited (${code})`);
    rejectPending(error);
    if (!settled) finish(error);
  });
  child.on("close", () => resolveClosed());
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined && !message.method) {
        const p = pending.get(message.id);
        pending.delete(message.id);
        if (p)
          message.error
            ? p.reject(new Error(message.error.message))
            : p.resolve(message.result);
        return;
      }
      if (message.id !== undefined && message.method) {
        if (message.method === "item/commandExecution/requestApproval") {
          const p = message.params ?? {};
          if (
            signal.aborted ||
            typeof p.command !== "string" ||
            !p.command.trim() ||
            Buffer.byteLength(p.command) > 4096 ||
            Buffer.byteLength(String(p.cwd ?? cwd)) > 4096
          )
            send({ id: message.id, result: { decision: "decline" } });
          else
            onApproval(
              {
                command: p.command ?? "",
                cwd: p.cwd ?? cwd,
                description: p.reason ?? message.method,
              },
              (decision) => send({ id: message.id, result: { decision } }),
            );
        } else if (message.method === "item/fileChange/requestApproval") {
          // 0.154.0 sends itemId/reason/grantRoot here, without changes/content.
          // The phone contract cannot accurately represent this write scope.
          send({ id: message.id, result: { decision: "decline" } });
          onEvent(
            "approval_declined",
            "File-write escalation declined: requested changes and write scope cannot be fully represented.",
          );
        } else {
          send({
            id: message.id,
            error: {
              code: -32601,
              message:
                "Unsupported interactive request; use a follow-up task message.",
            },
          });
        }
        return;
      }
      const params = message.params ?? {};
      if (message.method === "turn/started") turnId = params.turn?.id;
      if (message.method === "item/completed") {
        const item = params.item ?? {};
        if (item.type === "agentMessage")
          onEvidence("note", "Codex response", item.text ?? "");
        else if (item.type === "commandExecution")
          onEvidence(
            "note",
            `Command exit ${item.exitCode ?? "unknown"}: ${item.command ?? ""}`,
            item.aggregatedOutput ?? "",
          );
        onEvent("item", item.type ?? "item");
      }
      if (message.method === "turn/diff/updated")
        onEvidence("diff", "Codex turn diff", params.diff ?? "");
      if (message.method === "turn/completed") {
        const status = params.turn?.status;
        finish(
          status === "completed"
            ? null
            : new Error(params.turn?.error?.message ?? `Turn ${status}`),
        );
      }
      if (message.method === "error")
        onEvent(
          "codex_error",
          params.message ?? params.error?.message ?? "Codex reported an error",
        );
    } catch (error) {
      finish(error);
    }
  });
  const abort = () => {
    if (threadId && turnId)
      request("turn/interrupt", { threadId, turnId }).catch(() => {});
    const error = new Error("Cancelled");
    finish(error);
    rejectPending(error);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await request("initialize", {
      clientInfo: { name: "voxcode", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    });
    send({ method: "initialized", params: {} });
    if (signal.aborted) throw new Error("Cancelled");
    const thread = await request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      ephemeral: true,
    });
    threadId = thread.thread.id;
    const turn = await request("turn/start", {
      threadId,
      input: [{ type: "text", text: task.prompt }],
      cwd,
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: false,
        excludeSlashTmp: true,
        excludeTmpdirEnvVar: true,
      },
    });
    turnId = turn.turn.id;
    if (signal.aborted) abort();
    await done;
  } finally {
    signal.removeEventListener("abort", abort);
    rejectPending(new Error("Codex stopped"));
    const killGroup = (signalName) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signalName);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    try {
      killGroup("SIGTERM");
      // Keep the slot even if the direct child exits first: descendants may still
      // belong to the group and must receive the bounded escalation as well.
      await delay(terminationGraceMs);
      killGroup("SIGKILL");
      await closed;
      const deadline = Date.now() + 2000;
      while (child.pid) {
        try {
          process.kill(-child.pid, 0);
        } catch (error) {
          if (error.code === "ESRCH") break;
          throw error;
        }
        if (Date.now() >= deadline)
          throw new Error(
            "Owned process group termination could not be confirmed; execution slot quarantined.",
          );
        await delay(20);
      }
    } catch (error) {
      // Signal failures are just as uncertain as a disappearance timeout.
      throw Object.assign(error, { ownershipUnresolved: true });
    } finally {
      lines.close();
    }
  }
  if (signal.aborted) throw new Error("Cancelled");
  collectRepositoryEvidence(cwd, onEvidence);
}
