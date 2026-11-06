// @summary Terminal UI operations settle only on the corresponding process transition.
import { expect, test } from "bun:test";
import { settleTerminalOperation, type TerminalOperation } from "../../../../src/web/client/lib/terminal-lifecycle";

test("session switching remains pending while the previous process exits or reports stale running state", () => {
  const operation: TerminalOperation = { kind: "new", previousId: "old" };
  expect(settleTerminalOperation(operation, { id: "old", state: "exited" })).toBe(operation);
  expect(settleTerminalOperation(operation, { id: "old", state: "running" })).toBe(operation);
  expect(settleTerminalOperation(operation, { id: "new", state: "starting" })).toBe(operation);
  expect(settleTerminalOperation(operation, { id: "new", state: "running" })).toBeNull();
});

test("stop finishes on exit and a failed launch clears the pending operation", () => {
  const stop: TerminalOperation = { kind: "stop", previousId: "old" };
  expect(settleTerminalOperation(stop, { id: "old", state: "running" })).toBe(stop);
  expect(settleTerminalOperation(stop, { id: "old", state: "exited" })).toBeNull();
  expect(settleTerminalOperation({ kind: "select", previousId: "old" }, { id: "new", state: "error" })).toBeNull();
});

test("resuming an already-running process settles without replacing it", () => {
  expect(settleTerminalOperation({ kind: "resume", previousId: "same" }, { id: "same", state: "running" })).toBeNull();
});
