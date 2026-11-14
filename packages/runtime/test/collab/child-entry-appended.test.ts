// @summary Child persistence must retain host append observers and authenticated attribution.
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../../src/collab/registry";
import { ensureDiligentDir } from "../../src/infrastructure";
import { SessionManager } from "../../src/session/manager";
import type { AppendedEntryInfo } from "../../src/session/types";
import { makeCollabDeps } from "../helpers/collab";

describe("child append observation", () => {
  test("observes durably persisted child entries with the child identity and inherited user", async () => {
    const root = await mkdtemp(join(tmpdir(), "child-append-"));
    let registry: AgentRegistry | undefined;
    try {
      const observed: AppendedEntryInfo[] = [];
      const paths = await ensureDiligentDir(root);
      const parent = new SessionManager({
        cwd: root,
        paths,
        agent: async () => {
          throw new Error("Parent model is not used");
        },
      });
      await parent.create();
      const deps = makeCollabDeps({
        cwd: root,
        paths,
        userId: "synthetic-owner",
        getParentSessionId: () => parent.sessionId,
        onChildEntryAppended: (info: AppendedEntryInfo) => observed.push(info),
      });
      registry = new AgentRegistry(deps);
      const { threadId } = registry.spawn({
        prompt: "synthetic child task",
        description: "append coverage",
        agentType: "general",
      });
      const outcome = await registry.wait([threadId], 5_000);
      expect(outcome.status[threadId]).toMatchObject({ kind: "completed" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(observed.length).toBeGreaterThanOrEqual(2);
      expect(observed.every((info) => info.sessionId === threadId && info.userId === "synthetic-owner")).toBe(true);
      expect(observed.map((info) => info.seq)).toEqual(observed.map((_, index) => index + 1));
      const raw = await readFile(observed[0].sessionPath!, "utf8");
      const entries = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(entries[0].parentSession).toBe(parent.sessionId);
      for (const info of observed) expect(entries.some((entry) => entry.id === info.entry.id)).toBe(true);
    } finally {
      await registry?.shutdownAll();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("captures the current user at spawn and refreshes attribution on resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "child-resume-attribution-"));
    let registry: AgentRegistry | undefined;
    try {
      const observed: AppendedEntryInfo[] = [];
      let userId = "first-user";
      registry = new AgentRegistry(
        makeCollabDeps({
          cwd: root,
          paths: await ensureDiligentDir(root),
          getUserId: () => userId,
          onChildEntryAppended: (info: AppendedEntryInfo) => observed.push(info),
        }),
      );
      const { threadId } = registry.spawn({ prompt: "first", description: "", agentType: "general" });
      userId = "second-user";
      expect((await registry.wait([threadId], 5_000)).status[threadId]).toMatchObject({ kind: "completed" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(observed.length).toBeGreaterThanOrEqual(2);
      expect(observed.every((info) => info.userId === "first-user")).toBe(true);
      const firstCount = observed.length;
      const lastSeq = observed.at(-1)!.seq;
      registry.spawn({ prompt: "resume", description: "", agentType: "general", resumeId: threadId });
      expect((await registry.wait([threadId], 5_000)).status[threadId]).toMatchObject({ kind: "completed" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      const resumed = observed.slice(firstCount);
      expect(resumed.length).toBeGreaterThanOrEqual(2);
      expect(
        resumed.every((info) => info.userId === "second-user" && info.sessionId === threadId && info.seq > lastSeq),
      ).toBe(true);
    } finally {
      await registry?.shutdownAll();
      await rm(root, { recursive: true, force: true });
    }
  });
});
