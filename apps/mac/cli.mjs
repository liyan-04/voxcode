import { resolve } from "node:path";
import { createServer } from "./server.mjs";
const project = process.env.VOXCODE_PROJECT;
if (!project)
  throw new Error("Set VOXCODE_PROJECT to the authorized Git project");
const host = process.env.VOXCODE_HOST ?? "127.0.0.1";
if (
  !["127.0.0.1", "::1", "localhost"].includes(host) &&
  process.env.VOXCODE_TRUSTED_HTTPS !== "1"
)
  throw new Error(
    "LAN binding requires VOXCODE_TRUSTED_HTTPS=1 and a trusted HTTPS reverse proxy",
  );
const app = createServer({
  project: resolve(project),
  dataDir: resolve(process.env.VOXCODE_DATA ?? ".voxcode-data"),
});
if (app.service.recovery().required)
  console.error(
    "Execution quarantine active: previous task processes may still be running. New execution is unavailable. Stop the bridge, verify task process cleanup, then run apps/mac/recover.mjs --confirm-executions-stopped with the same VOXCODE_PROJECT and VOXCODE_DATA. Worktree edits are retained.",
  );
app.server.listen(Number(process.env.VOXCODE_PORT ?? 8787), host, () => {
  console.log(`VoxCode listening on ${host}:${app.server.address().port}`);
  console.log(
    `Local recovery: kill -USR2 ${process.pid} revokes all phone sessions without deleting tasks.`,
  );
  console.log(
    `Local project pairing code (expires in 5 minutes): ${app.service.pairCode}`,
  );
});
process.on("SIGUSR2", () => {
  app.service.revokeAll();
  console.log(
    "All phone sessions revoked; task history retained. Pair again with the local code if still valid, or restart for a fresh code.",
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => app.close().then(() => process.exit()));
