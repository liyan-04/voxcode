import { readFileSync, writeFileSync, renameSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

if (
  process.argv.length !== 3 ||
  process.argv[2] !== "--confirm-executions-stopped"
)
  throw new Error(
    "Stop the bridge, verify all previous task processes have stopped, then run with --confirm-executions-stopped. This command does not terminate processes or roll back edits.",
  );
if (!process.env.VOXCODE_PROJECT)
  throw new Error("Set VOXCODE_PROJECT to the authorized Git project");
const project = realpathSync(process.env.VOXCODE_PROJECT);
const file = join(
  resolve(process.env.VOXCODE_DATA ?? ".voxcode-data"),
  "state.json",
);
const state = JSON.parse(readFileSync(file, "utf8"));
if (state.project !== project)
  throw new Error("Stored project differs from selected project");
const unconfirmed = new Set(state.unconfirmedExecutions ?? []);
for (const task of Object.values(state.tasks))
  if (
    ["running", "waiting_approval", "stopping", "waiting_input"].includes(
      task.status,
    )
  )
    unconfirmed.add(task.id);
for (const id of unconfirmed) {
  const task = state.tasks[id];
  if (!task) continue;
  task.status = "interrupted";
  task.approval = null;
  task.summary =
    "Local operator confirmed execution cleanup; worktree edits are retained.";
  task.updatedAt = new Date().toISOString();
}
state.unconfirmedExecutions = [];
writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
renameSync(`${file}.tmp`, file);
console.log(
  `Cleared execution quarantine for ${unconfirmed.size} task(s) after operator confirmation. No processes were signaled and no worktree edits were reverted. Queued tasks may execute when the bridge restarts.`,
);
