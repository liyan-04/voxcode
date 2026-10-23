import { createService } from "../../service.mjs";
import { runCodex } from "../../codex.mjs";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./app-server.mjs", import.meta.url));
const service = createService({
  project: process.argv[2],
  dataDir: process.argv[3],
  executor: (options) =>
    runCodex({
      ...options,
      command: process.execPath,
      args: [fixture],
      terminationGraceMs: 40,
      onEvidence: (...evidence) => {
        options.onEvidence(...evidence);
        process.send({
          type: "ready",
          taskId: options.task.id,
          cwd: options.cwd,
        });
      },
    }),
});
for (let i = 0; i < 3; i++)
  service.mutate("create", {
    requestId: `task-${i}`,
    title: `Task ${i}`,
    prompt: "cancel",
  });
