import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let mode;
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize")
    send(
      process.argv[2] === "init-error"
        ? { id: message.id, error: { message: "fixture initialize denied" } }
        : { id: message.id, result: {} },
    );
  if (message.method === "thread/start")
    send({ id: message.id, result: { thread: { id: "thread" } } });
  if (message.method === "turn/start") {
    mode = message.params.input[0].text;
    send({ id: message.id, result: { turn: { id: "turn" } } });
    if (mode === "cancel") {
      process.on("SIGTERM", () => {});
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'import {writeFileSync} from "node:fs";process.on("SIGTERM",()=>{});setInterval(()=>writeFileSync("heartbeat",String(Date.now())),10)',
        ],
        { stdio: "ignore" },
      );
      writeFileSync(
        "pids.json",
        JSON.stringify({ parent: process.pid, child: child.pid }),
      );
      send({
        method: "item/completed",
        params: { item: { type: "agentMessage", text: "ready" } },
      });
    } else if (mode === "invalid-json") {
      process.stdout.write("invalid json\n");
    } else if (mode === "error") {
      send({
        method: "turn/completed",
        params: {
          turn: { status: "failed", error: { message: "fixture turn failed" } },
        },
      });
    } else if (mode === "file-approval") {
      send({
        id: 900,
        method: "item/fileChange/requestApproval",
        params: {
          itemId: "file",
          grantRoot: "/outside",
          reason: "write files",
        },
      });
    } else if (mode === "command-approval") {
      send({
        id: 901,
        method: "item/commandExecution/requestApproval",
        params: {
          command: "echo hello",
          cwd: process.cwd(),
          reason: "run command",
        },
      });
    } else if (mode === "environment") {
      writeFileSync(
        "child-env.json",
        JSON.stringify({
          bridgeConfigPresent: Object.hasOwn(process.env, "VOXCODE_TEST_TOKEN"),
          voiceConfigPresent: Object.hasOwn(process.env, "LINX_TEST_TOKEN"),
          gitConfigPresent: Object.hasOwn(process.env, "GIT_TEST_CONFIG"),
          pathPresent: !!process.env.PATH,
          homePresent: !!process.env.HOME,
          codingConfigPreserved: process.env.VOX_TEST_CODING === "allowed",
        }),
      );
      send({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      });
    } else {
      writeFileSync("created.txt", "new visible source\n");
      writeFileSync(".env", "SECRET=must-not-be-evidence\n");
      send({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      });
    }
  }
  if (message.id === 900 || message.id === 901) {
    writeFileSync("decision.json", JSON.stringify(message));
    send({
      method: "turn/completed",
      params: { turn: { status: "completed" } },
    });
  }
});
