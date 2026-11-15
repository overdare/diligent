// @summary Root deadlines prevent new work from starting after the execution budget expires

import { expect, test } from "bun:test";
import { RuntimeDeadline, RuntimeDeadlineError } from "../../src/runner/runtime-deadline";

test("does not start a deferred operation after the root budget expires", async () => {
  const deadline = new RuntimeDeadline(0);
  let started = false;
  try {
    await expect(
      deadline.run("turn completion", async () => {
        started = true;
      }),
    ).rejects.toBeInstanceOf(RuntimeDeadlineError);
    expect(started).toBe(false);
    expect(deadline.signal.reason).toMatchObject({ kind: "root" });
  } finally {
    deadline.close();
  }
});
