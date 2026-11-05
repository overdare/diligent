// @summary Deterministic private PTY protocol fixture; real PTY behavior is covered by Rust tests.
import { createInterface } from "node:readline";

let started = false;
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (!started) {
    started = true;
    if (process.argv.includes("--wait-for-stop")) {
      console.log(JSON.stringify({ type: "output", data: Buffer.from("WAITING_FOR_STOP").toString("base64") }));
    } else console.log(JSON.stringify({ type: "ready", pid: process.pid }));
    continue;
  }
  if (message.type === "stop") {
    console.log(JSON.stringify({ type: "exit", code: 0 }));
    break;
  }
  if (message.type === "input") {
    const data = Buffer.from(message.data, "base64").toString("utf8");
    if (data === "EXIT_BUT_LINGER") {
      console.log(JSON.stringify({ type: "exit", code: 0 }));
      continue;
    }
    console.log(JSON.stringify({ type: "output", data: Buffer.from(data).toString("base64") }));
  }
  if (message.type === "resize")
    console.log(
      JSON.stringify({
        type: "output",
        data: Buffer.from(`SIZE=${message.cols}x${message.rows}\r\n`).toString("base64"),
      }),
    );
}
