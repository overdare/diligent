// @summary App-server e2e tests for memory CRUD and filesystem persistence

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDiligentDir, type StreamFunction } from "@diligent/runtime";
import { readMemory } from "@diligent/runtime/memory";
import { createSimpleStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

let tmpDir = "";
let client: ProtocolTestClient;

afterEach(async () => {
  client?.close();
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  tmpDir = "";
});

describe("memory", () => {
  test("memory entries can be added, updated, listed, deleted, and persisted through JSON-RPC", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-memory-"));
    const server = createTestServer({ cwd: tmpDir });
    client = createProtocolClient(server);

    const threadId = await client.initAndStartThread(tmpDir);
    const added = (await client.request("memory/update", {
      action: "upsert",
      threadId,
      type: "feedback",
      name: "Focused tests",
      content: "Use focused tests before the full suite",
    })) as {
      entry: { id: string; name: string; description: string; type: string; content: string };
    };
    expect(added.entry).toMatchObject({
      id: "focused-tests",
      name: "Focused tests",
      description: "Use focused tests before the full suite",
      type: "feedback",
      content: "Use focused tests before the full suite",
    });

    const updated = (await client.request("memory/update", {
      action: "upsert",
      threadId,
      id: added.entry.id,
      type: "project",
      description: "Run focused tests first",
      content: "Run focused tests before the full suite",
    })) as {
      entry: { id: string; type: string; content: string };
    };
    expect(updated.entry).toMatchObject({
      id: added.entry.id,
      type: "project",
      content: "Run focused tests before the full suite",
    });

    const listed = (await client.request("memory/list", { threadId, limit: 10 })) as {
      data: Array<{ id: string; type: string }>;
    };
    expect(listed.data).toContainEqual(expect.objectContaining({ id: added.entry.id, type: "project" }));

    const paths = await ensureDiligentDir(tmpDir);
    expect(await readFile(join(paths.memory, "MEMORY.md"), "utf8")).toContain(
      "- [Focused tests](focused-tests.md) — Run focused tests first",
    );

    const deleted = (await client.request("memory/update", {
      action: "delete",
      threadId,
      id: added.entry.id,
    })) as { deleted: boolean };
    expect(deleted.deleted).toBe(true);

    const persisted = await readMemory(paths.memory);
    expect(persisted.some((entry) => entry.id === added.entry.id)).toBe(false);
    expect(await readFile(join(paths.memory, "MEMORY.md"), "utf8")).not.toContain("focused-tests.md");
  });

  test("memory/list returns memory files written by another agent into the project memory directory", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-memory-"));
    const paths = await ensureDiligentDir(tmpDir);
    await writeFile(
      join(paths.memory, "combat-damage.md"),
      "---\nname: combat-damage\ndescription: Server-authoritative hitscan\nmetadata:\n  type: project\n---\n\nDamage is computed on the server.\n",
    );
    const server = createTestServer({ cwd: tmpDir });
    client = createProtocolClient(server);
    const threadId = await client.initAndStartThread(tmpDir);

    const listed = (await client.request("memory/list", { threadId })) as { data: unknown[] };

    expect(listed.data).toEqual([
      expect.objectContaining({
        id: "combat-damage",
        description: "Server-authoritative hitscan",
        type: "project",
        content: "Damage is computed on the server.",
      }),
    ]);
  });

  test("memory/update honors a caller-defined id and rejects ids that are not file names", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-memory-"));
    const server = createTestServer({ cwd: tmpDir });
    client = createProtocolClient(server);
    const threadId = await client.initAndStartThread(tmpDir);

    const created = (await client.request("memory/update", {
      action: "upsert",
      threadId,
      id: "project.runtime",
      type: "feedback",
      content: "Use Bun",
    })) as { entry: { id: string } };

    expect(created.entry.id).toBe("project.runtime");
    await expect(
      client.request("memory/update", { action: "upsert", threadId, id: "../outside", type: "project", content: "x" }),
    ).rejects.toThrow("Invalid memory id");
  });

  test("a running thread sees memory another agent changed before its next turn and is told once", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-memory-"));
    const paths = await ensureDiligentDir(tmpDir);
    await writeFile(
      join(paths.memory, "combat-damage.md"),
      "---\nname: combat-damage\ndescription: HP bar first\nmetadata:\n  type: project\n---\n\nBuild the HP bar first.\n",
    );
    await writeFile(
      join(paths.memory, "MEMORY.md"),
      "# Memory Index\n\n- [Combat damage](combat-damage.md) — HP bar first\n",
    );
    const seen: Array<{ system: string; messages: string }> = [];
    const reply = createSimpleStream("ok");
    const streamFunction: StreamFunction = (model, context, options) => {
      seen.push({
        system: context.systemPrompt.map((section) => section.content).join("\n"),
        messages: JSON.stringify(context.messages),
      });
      return reply(model, context, options);
    };
    const server = createTestServer({ cwd: tmpDir, streamFunction, runtimeToolsConfig: {} });
    client = createProtocolClient(server);
    const threadId = await client.initAndStartThread(tmpDir);
    const notice = "Project memory changed since your previous turn";
    const count = (text: string) => text.split(notice).length - 1;

    await client.sendTurnAndWait(threadId, "first");
    await writeFile(
      join(paths.memory, "MEMORY.md"),
      "# Memory Index\n\n- [Combat damage](combat-damage.md) — Floating damage numbers replace the HP bar\n",
    );
    await client.sendTurnAndWait(threadId, "second");
    await client.sendTurnAndWait(threadId, "third");

    expect(seen).toHaveLength(3);
    expect(seen[0].system).toContain("HP bar first");
    expect(seen[1].system).toContain("Floating damage numbers replace the HP bar");
    expect(seen[1].system).not.toContain("HP bar first");
    expect(count(seen[0].messages)).toBe(0);
    expect(count(seen[1].messages)).toBe(1);
    expect(seen[1].messages).toContain("Floating damage numbers replace the HP bar");
    // An unchanged index adds no further notice; the earlier one stays in history.
    expect(count(seen[2].messages)).toBe(1);
  });
});
