// @summary Async execution identity remains isolated across concurrent roots and nested children
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSessionExecutionContext,
  onSessionExecutionEnd,
  resolveSessionRoot,
  runWithSessionExecutionContext,
} from "../../src/session/execution-context";

const projects: string[] = [];
async function sessions() {
  const directory = await mkdtemp(join(tmpdir(), "session-ancestry-"));
  projects.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of projects.splice(0)) await rm(directory, { recursive: true, force: true });
});

test("ancestry reads only session headers and leaves existing transcripts unchanged", async () => {
  const directory = await sessions();
  const parent = `${JSON.stringify({ type: "session", id: "parent", parentSession: "root" })}\nnot a JSON entry`;
  const root = `${JSON.stringify({ type: "session", id: "root" })}\n${"x".repeat(100_000)}`;
  await writeFile(join(directory, "parent.jsonl"), parent);
  await writeFile(join(directory, "root.jsonl"), root);
  expect(await resolveSessionRoot("child", "parent", directory)).toBe("root");
  expect(await readFile(join(directory, "parent.jsonl"), "utf8")).toBe(parent);
  expect(await readFile(join(directory, "root.jsonl"), "utf8")).toBe(root);
});

test("a missing ancestry file is rejected without creating it", async () => {
  const directory = await sessions();
  await expect(resolveSessionRoot("child", "missing", directory)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(directory, "missing.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("ancestry rejects a multibyte header whose newline exceeds the 64 KiB byte limit", async () => {
  const directory = await sessions();
  const header = `${JSON.stringify({ type: "session", id: "parent", description: "\uD55C".repeat(22_000) })}\n`;
  // This header fits in 64 Ki characters, but not in the bounded UTF-8 byte read.
  expect(header.length).toBeLessThan(65_536);
  await writeFile(join(directory, "parent.jsonl"), header);
  await expect(resolveSessionRoot("child", "parent", directory)).rejects.toThrow(/read limit|incomplete/);
});

test("ancestry accepts a newline at the final byte of the bounded read", async () => {
  const directory = await sessions();
  const header = JSON.stringify({ type: "session", id: "parent" });
  await writeFile(join(directory, "parent.jsonl"), `${header.padEnd(65_535, " ")}\nignored tail`);
  expect(await resolveSessionRoot("child", "parent", directory)).toBe("parent");
});

test("ancestry rejects cyclic parents and mismatched header IDs", async () => {
  const directory = await sessions();
  await writeFile(join(directory, "parent.jsonl"), `${JSON.stringify({ type: "session", id: "other" })}\n`);
  await expect(resolveSessionRoot("child", "parent", directory)).rejects.toThrow("Invalid session ancestry header");
  await writeFile(
    join(directory, "parent.jsonl"),
    `${JSON.stringify({ type: "session", id: "parent", parentSession: "child" })}\n`,
  );
  await expect(resolveSessionRoot("child", "parent", directory)).rejects.toThrow(/cyclic/);
});

test("scope resources remain active until async work ends and release after failure", async () => {
  const context = {
    sessionId: "A",
    rootSessionId: "A",
    resumed: false,
    rootRequest: { sessionId: "A", requestId: "r" },
  };
  let active = false;
  await expect(
    runWithSessionExecutionContext(context, async () => {
      active = true;
      onSessionExecutionEnd(() => {
        active = false;
      });
      await Promise.resolve();
      expect(active).toBe(true);
      throw new Error("failed run");
    }),
  ).rejects.toThrow("failed run");
  expect(active).toBe(false);
});

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
