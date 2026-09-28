// @summary Async execution identity remains isolated across concurrent roots and nested children
import { expect, test } from "bun:test";
import { getSessionExecutionContext, runWithSessionExecutionContext } from "../../src/session/execution-context";

test("concurrent roots and nested children retain actual identity without leaking outside runs", async () => {
  const rootRequest = { sessionId: "A", requestId: "request-A" };
  const a = { sessionId: "A", rootSessionId: "A", resumed: false, rootRequest };
  const b = { sessionId: "B", rootSessionId: "B", resumed: false, rootRequest: { sessionId: "B", requestId: "B" } };
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: string[] = [];
  await Promise.all([
    runWithSessionExecutionContext(a, async () => {
      await barrier;
      seen.push(getSessionExecutionContext()!.sessionId);
      await runWithSessionExecutionContext({ ...a, sessionId: "A1" }, async () => {
        await Promise.resolve();
        seen.push(getSessionExecutionContext()!.sessionId);
        expect(getSessionExecutionContext()!.rootRequest).toBe(rootRequest);
      });
      expect(getSessionExecutionContext()!.sessionId).toBe("A");
    }),
    runWithSessionExecutionContext(b, async () => {
      seen.push(getSessionExecutionContext()!.sessionId);
      release();
    }),
  ]);
  expect(seen).toEqual(["B", "A", "A1"]);
  expect(getSessionExecutionContext()).toBeUndefined();
});
