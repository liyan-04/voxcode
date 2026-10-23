import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { runCodex } from "./codex.mjs";
export class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
const copy = (x) => structuredClone(x);
const text = (x, max = 32000) =>
  typeof x === "string" && x.trim() && x.length <= max;
const MAX_TASKS = 32,
  MAX_REQUESTS = 128,
  MAX_EVENTS = 64,
  MAX_APPROVALS_PER_EXECUTION = 16;
const MAX_EVIDENCE_BYTES = 65536;
const RECOVERY_MESSAGE =
  "Execution stop is unconfirmed; scheduling is quarantined until the local operator verifies cleanup and runs apps/mac/recover.mjs --confirm-executions-stopped.";
function bounded(value, limit) {
  const bytes = Buffer.from(String(value));
  return bytes.length > limit
    ? bytes.subarray(0, limit).toString("utf8") + "\n[truncated]"
    : bytes.toString("utf8");
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function createService(options) {
  const project = realpathSync(options.project),
    dataDir = resolve(options.dataDir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "state.json");
  let state = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { project, tasks: {}, events: {}, requests: {}, sessions: [] };
  // Legacy reusable bearer persistence is retired; existing phones must pair again.
  state.sessions ??= [];
  delete state.tokens;
  if (state.project !== project)
    throw new Error("Stored project differs from selected project");
  state.unconfirmedExecutions ??= [];
  if (!Array.isArray(state.unconfirmedExecutions))
    throw new Error(
      "Invalid execution ownership record; local recovery required",
    );
  // Include old snapshots that predate the durable execution sentinel.
  for (const t of Object.values(state.tasks))
    if (
      ["running", "waiting_approval", "stopping", "waiting_input"].includes(
        t.status,
      ) &&
      !state.unconfirmedExecutions.includes(t.id)
    )
      state.unconfirmedExecutions.push(t.id);
  let recoveryRequired = state.unconfirmedExecutions.length > 0;
  const active = new Map(),
    approvals = new Map();
  let closed = false;
  const authorizationListeners = new Set();
  const digest = (token) => createHash("sha256").update(token).digest("hex");
  const notifyAuthorizationChange = () => {
    for (const listener of authorizationListeners) listener();
  };
  function expireSessions() {
    const count = state.sessions.length;
    state.sessions = state.sessions.filter((s) => s.expiresAt > Date.now());
    if (count !== state.sessions.length) {
      save();
      notifyAuthorizationChange();
    }
  }
  const expiryTimer = setInterval(
    expireSessions,
    Math.min(options.sessionTtlMs ?? 60000, 60000),
  );
  expiryTimer.unref();
  const save = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const event = (id, type, message) => {
    const e = (state.events[id] ??= []);
    e.push({
      seq: (e.at(-1)?.seq ?? 0) + 1,
      taskId: id,
      type,
      message: bounded(message, 1024),
      createdAt: new Date().toISOString(),
    });
    if (e.length > MAX_EVENTS) e.splice(0, e.length - MAX_EVENTS);
    save();
  };
  for (const id of state.unconfirmedExecutions) {
    const t = state.tasks[id];
    if (t) {
      t.status = "interrupted";
      t.approval = null;
      t.summary = RECOVERY_MESSAGE;
      event(t.id, "interrupted", RECOVERY_MESSAGE);
    }
  }
  const get = (id) => state.tasks[id] ?? fail(404, "unknown");
  const update = (t, status) => {
    t.status = status;
    t.updatedAt = new Date().toISOString();
    save();
  };
  const prepare =
    options.prepareWorktree ??
    ((_, id) => {
      const cwd = join(dataDir, "worktrees", id);
      mkdirSync(join(dataDir, "worktrees"), { recursive: true });
      execFileSync(
        "git",
        ["-C", project, "worktree", "add", "--detach", cwd, "HEAD"],
        { stdio: "pipe", env: gitEnv() },
      );
      return cwd;
    });
  function pump() {
    if (closed || recoveryRequired) return;
    for (const t of Object.values(state.tasks)) {
      if (active.size >= 2) break;
      if (t.status !== "queued") continue;
      const controller = new AbortController();
      const entry = { controller, cwd: null, approvalsRequested: 0 };
      active.set(t.id, entry);
      // Persist before preparing a worktree or spawning anything. Only verified
      // executor settlement clears this record; restart never implies teardown.
      state.unconfirmedExecutions.push(t.id);
      update(t, "running");
      entry.done = Promise.resolve()
        .then(async () => {
          entry.cwd = t.worktree ?? prepare(project, t.id);
          t.worktree = entry.cwd;
          save();
          event(
            t.id,
            "started",
            "Codex execution started in isolated worktree.",
          );
          await (options.executor ?? runCodex)({
            task: copy(t),
            cwd: entry.cwd,
            signal: controller.signal,
            onEvent: (type, message) => event(t.id, type, message),
            onEvidence: (kind, label, value) => {
              t.evidence.push({
                kind,
                label: bounded(label, 512),
                value: bounded(value, 16384),
                version: t.version,
              });
              let bytes = Buffer.byteLength(JSON.stringify(t.evidence));
              while (bytes > MAX_EVIDENCE_BYTES && t.evidence.length > 1) {
                t.evidence.shift();
                t.summary = "Earlier evidence omitted by retention limit.";
                bytes = Buffer.byteLength(JSON.stringify(t.evidence));
              }
              save();
            },
            onApproval: (details, reply) =>
              requestApproval(t.id, details, reply),
          });
          if (controller.signal.aborted) update(t, "interrupted");
          else update(t, "completed");
        })
        .catch((e) => {
          entry.ownershipUnresolved = !!e.ownershipUnresolved;
          if (entry.ownershipUnresolved) recoveryRequired = true;
          update(
            t,
            entry.ownershipUnresolved
              ? "stopping"
              : controller.signal.aborted
                ? "interrupted"
                : "failed",
          );
          event(t.id, "error", e.message);
        })
        .finally(() => {
          approvals.get(t.id)?.reply("decline");
          approvals.delete(t.id);
          t.approval = null;
          if (!entry.ownershipUnresolved) {
            active.delete(t.id);
            state.unconfirmedExecutions = state.unconfirmedExecutions.filter(
              (id) => id !== t.id,
            );
          }
          save();
          pump();
        });
    }
  }
  function requestApproval(id, details, reply) {
    const t = get(id);
    const execution = active.get(id);
    if (!execution || t.status === "stopping") {
      reply("decline");
      return;
    }
    if (approvals.has(id)) {
      reply("decline");
      return;
    }
    if (execution.approvalsRequested >= MAX_APPROVALS_PER_EXECUTION) {
      reply("decline");
      event(
        id,
        "approval_declined",
        "Operation declined: this execution's approval allowance is exhausted.",
      );
      return;
    }
    execution.approvalsRequested++;
    t.approval = {
      id: randomUUID(),
      command: bounded(details.command ?? "", 4096),
      cwd: bounded(details.cwd ?? "", 4096),
      description: bounded(
        details.description ?? "Codex requests authorization",
        4096,
      ),
      version: t.version,
    };
    const entry = {
      reply,
      expires: Date.now() + (options.approvalTtlMs ?? 120000),
    };
    approvals.set(id, entry);
    setTimeout(() => {
      if (approvals.get(id) !== entry) return;
      approvals.delete(id);
      t.approval = null;
      reply("decline");
      update(t, "running");
      event(
        id,
        "approval_expired",
        "Operation approval expired and was declined.",
      );
    }, options.approvalTtlMs ?? 120000).unref();
    update(t, "waiting_approval");
    event(id, "approval", t.approval.description);
  }
  const pairCode = options.pairCode ?? randomBytes(6).toString("hex");
  const expires = Date.now() + (options.pairTtlMs ?? 300000);
  let attempts = [];
  function pair(code, peer = "local") {
    attempts = attempts.filter((a) => a.at > Date.now() - 60000);
    if (attempts.length >= 256) fail(429, "throttled");
    if (attempts.filter((a) => a.peer === peer).length >= 5)
      fail(429, "throttled");
    attempts.push({ peer, at: Date.now() });
    if (
      Date.now() > expires ||
      typeof code !== "string" ||
      code.length !== pairCode.length ||
      !timingSafeEqual(Buffer.from(code), Buffer.from(pairCode))
    )
      fail(400, "invalid");
    const token = randomBytes(32).toString("base64url");
    expireSessions();
    if (state.sessions.length >= 32) fail(429, "throttled");
    const now = Date.now();
    state.sessions.push({
      id: randomUUID(),
      verifier: digest(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: now + (options.sessionTtlMs ?? 7 * 86400000),
    });
    save();
    return token;
  }
  function authorize(header) {
    const token =
      typeof header === "string"
        ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header)?.[1]
        : undefined;
    expireSessions();
    if (!token || !state.sessions.some((s) => s.verifier === digest(token)))
      fail(401, "unauthenticated");
    return token;
  }
  function revoke(token) {
    const verifier = digest(token);
    state.sessions = state.sessions.filter((s) => s.verifier !== verifier);
    save();
    notifyAuthorizationChange();
  }
  function mutate(action, b, id, approvalId) {
    if (!b || !text(b.requestId, 128)) fail(400, "invalid");
    const fingerprint = JSON.stringify(canonical([action, id, approvalId, b]));
    const previous = state.requests[b.requestId];
    if (previous) {
      if (
        JSON.stringify(canonical(JSON.parse(previous.fingerprint))) !==
        fingerprint
      )
        fail(409, "conflict");
      return copy(previous.task);
    }
    if (recoveryRequired && ["create", "messages"].includes(action))
      fail(503, "unavailable", RECOVERY_MESSAGE);
    // Each admitted approval can save one decision beyond the ordinary budget.
    // The per-execution allowance bounds this reserve, like cancellation.
    if (
      !["cancel", "approval"].includes(action) &&
      Object.keys(state.requests).length >= MAX_REQUESTS
    )
      fail(429, "throttled");
    let t;
    if (action === "create") {
      if (Object.keys(state.tasks).length >= MAX_TASKS) fail(429, "throttled");
      if (!text(b.title, 200) || !text(b.prompt)) fail(400, "invalid");
      const now = new Date().toISOString();
      t = {
        id: randomUUID(),
        title: b.title,
        prompt: b.prompt,
        status: "queued",
        acceptance: "pending",
        version: 0,
        createdAt: now,
        updatedAt: now,
        summary: "",
        previewUrl: null,
        evidence: [],
        approval: null,
      };
      state.tasks[t.id] = t;
    } else {
      t = get(id);
      if (!Number.isInteger(b.version) || b.version !== t.version)
        fail(409, "stale");
      if (action === "messages") {
        if (!text(b.prompt)) fail(400, "invalid");
        if (active.has(id) || t.status === "queued") fail(409, "conflict");
        t.prompt = b.prompt;
        t.version++;
        t.acceptance = "pending";
        t.approval = null;
        update(t, "queued");
      } else if (action === "cancel") {
        if (t.status === "stopping") return copy(t);
        if (["completed", "failed", "interrupted"].includes(t.status))
          fail(409, "conflict");
        approvals.get(id)?.reply("decline");
        approvals.delete(id);
        t.approval = null;
        active.get(id)?.controller.abort();
        update(t, active.has(id) ? "stopping" : "interrupted");
      } else if (action === "accept") {
        if (t.status !== "completed") fail(409, "conflict");
        t.acceptance = "accepted";
      } else if (action === "approval") {
        const a = approvals.get(id);
        if (
          !a ||
          !t.approval ||
          t.approval.id !== approvalId ||
          a.expires < Date.now() ||
          t.status !== "waiting_approval"
        )
          fail(409, "conflict");
        if (!["accept", "decline"].includes(b.decision)) fail(400, "invalid");
        approvals.delete(id);
        t.approval = null;
        update(t, "running");
        a.reply(b.decision);
      } else fail(404, "unknown");
    }
    t.updatedAt = new Date().toISOString();
    state.requests[b.requestId] = { fingerprint, task: copy(t) };
    save();
    event(
      t.id,
      action,
      action === "create" ? "Task queued." : `Task ${action} received.`,
    );
    queueMicrotask(pump);
    return copy(t);
  }
  save();
  queueMicrotask(pump);
  return {
    pairCode,
    pair,
    authorize,
    revoke,
    sessions: () =>
      state.sessions.map(({ id, createdAt, expiresAt }) => ({
        id,
        createdAt,
        expiresAt,
      })),
    revokeSession: (id) => {
      state.sessions = state.sessions.filter((s) => s.id !== id);
      save();
      notifyAuthorizationChange();
    },
    revokeAll: () => {
      state.sessions = [];
      save();
      notifyAuthorizationChange();
    },
    onAuthorizationChange: (listener) => {
      authorizationListeners.add(listener);
      return () => authorizationListeners.delete(listener);
    },
    mutate,
    recovery: () => ({
      required: recoveryRequired,
      taskIds: [...state.unconfirmedExecutions],
    }),
    requestApproval,
    active,
    get: (id) => copy(get(id)),
    list: () => Object.values(state.tasks).map(copy),
    events: (id, after = 0) => {
      get(id);
      const e = state.events[id] ?? [];
      return {
        events: e.filter((x) => x.seq > after),
        cursor: e.at(-1)?.seq ?? 0,
      };
    },
    async close() {
      closed = true;
      clearInterval(expiryTimer);
      for (const a of active.values()) a.controller.abort();
      await Promise.allSettled([...active.values()].map((a) => a.done));
      save();
      if (active.size)
        throw new Error(
          "Owned execution termination unresolved; stop remains unconfirmed.",
        );
    },
  };
}
export function gitEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(GIT|LINX|VOXCODE)_/i.test(key),
    ),
  );
}
