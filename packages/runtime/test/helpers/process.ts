// @summary Liveness checks for processes that tests expect a cleanup path to have killed

import { readFileSync } from "node:fs";

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      // An orphan can be a zombie until PID 1 reaps it. It cannot execute or hold pipes open.
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat[stat.lastIndexOf(")") + 2] !== "Z";
    }
    return true;
  } catch {
    return false;
  }
}

// Process death is an OS event with no completion signal to await, so poll until a bounded deadline.
export async function waitUntilDead(pid: number, deadlineMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (!isAlive(pid)) return true;
    await Bun.sleep(25);
  }
  return !isAlive(pid);
}
