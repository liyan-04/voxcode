import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const mode = process.argv[2];
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let started = false,
  decision,
  completed = false;
if (["late-decision", "early-rejected"].includes(mode))
  process.on("SIGTERM", () => {});
function complete() {
  if (!started || !decision || completed) return;
  completed = true;
  send({
    method: "turn/completed",
    params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
  });
}
function approval(kind = mode) {
  send({
    id: 900,
    method: "item/commandExecution/requestApproval",
    params: {
      ...(kind === "missing-identity"
        ? {}
        : {
            threadId: kind.startsWith("foreign") ? "foreign-thread" : "thread",
            turnId: kind === "old-turn" ? "old-turn" : "turn",
          }),
      command: "fixture command",
      cwd: process.cwd(),
    },
  });
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "thread/resume") {
    if (mode.endsWith("before-dispatch")) approval();
    send({ id: message.id, result: { thread: { id: "thread" } } });
  }
  if (message.method === "turn/start") {
    started = true;
    const respond = () => {
      writeFileSync("turn-response.json", JSON.stringify({ id: "turn" }));
      send({ id: message.id, result: { turn: { id: "turn" } } });
    };
    if (mode === "early-rejected") {
      approval();
      setTimeout(
        () =>
          send({
            id: message.id,
            error: { message: "fixture dispatch denied" },
          }),
        20,
      );
    } else if (mode === "early-overflow") {
      for (let i = 0; i < 65; i++) approval();
    } else if (mode === "early") {
      approval();
      setTimeout(respond, 20);
    } else {
      respond();
      if (!mode.endsWith("before-dispatch")) approval();
      if (mode === "late-decision") {
        decision = "pending";
        complete();
      } else complete();
    }
  }
  if (message.id === 900) {
    decision = message.result.decision;
    writeFileSync("decision.json", JSON.stringify(message));
    complete();
  }
});
