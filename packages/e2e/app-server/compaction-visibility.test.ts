// @summary Public history must not expose model-only compaction checkpoints
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPACTION_MIN_INPUT_TOKENS } from "@diligent/core/compaction-contract";
import { ensureDiligentDir } from "@diligent/runtime";
import { appendEntry, createSessionFile } from "@diligent/runtime/session";
import { createSimpleStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

let root: string | undefined;
let client: ProtocolTestClient | undefined;
afterEach(async () => {
  client?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("manual compaction persists the exact continuation checkpoint but returns only a display label", async () => {
  root = await mkdtemp(join(tmpdir(), "checkpoint-continuation-"));
  const paths = await ensureDiligentDir(root);
  const saved = await createSessionFile(paths.sessions, root);
  await appendEntry(saved.path, {
    type: "message",
    id: "old-user",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: "Source context ".repeat(COMPACTION_MIN_INPUT_TOKENS), timestamp: 1 },
  });
  const checkpoint = "Continue with EXACT_REFERENCE_73; user denied publication.";
  client = createProtocolClient(createTestServer({ cwd: root, streamFunction: createSimpleStream(checkpoint) }));
  await client.request("initialize", { clientName: "test", clientVersion: "0", protocolVersion: 1 });
  await client.request("thread/resume", { threadId: saved.header.id });
  const result = await client.request("thread/compact/start", { threadId: saved.header.id });
  expect(result).toMatchObject({ compacted: true, summary: "Compacted" });
  expect(JSON.stringify(client.notifications)).not.toContain(checkpoint);
  const entries = (await Bun.file(saved.path).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(entries.find((entry) => entry.type === "compaction")).toMatchObject({
    summary: expect.stringContaining(checkpoint),
    displaySummary: "Compacted",
  });
});

test("read and history hide legacy checkpoints even when the display summary repeats their body", async () => {
  root = await mkdtemp(join(tmpdir(), "checkpoint-visibility-"));
  const paths = await ensureDiligentDir(root);
  const saved = await createSessionFile(paths.sessions, root);
  const checkpoint = "Internal checkpoint: EXACT_REFERENCE_73 and confidential context";
  await appendEntry(saved.path, {
    type: "compaction",
    id: "checkpoint",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    summary: checkpoint,
    displaySummary: checkpoint,
    tokensBefore: 10000,
    tokensAfter: 100,
  });
  client = createProtocolClient(createTestServer({ cwd: root }));
  await client.request("initialize", { clientName: "test", clientVersion: "0", protocolVersion: 1 });
  for (const method of ["thread/read", "thread/history"]) {
    const result = await client.request(method, { threadId: saved.header.id });
    expect(JSON.stringify(result)).not.toContain(checkpoint);
    expect(result).toMatchObject({
      items: [expect.objectContaining({ type: "compaction", summary: "Compacted", displaySummary: "Compacted" })],
    });
  }
});
