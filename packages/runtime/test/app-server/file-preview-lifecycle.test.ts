// @summary Historical file previews must not resume or retain a conversation runtime
import { expect, test } from "bun:test";
import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiligentAppServer } from "../../src/app-server/server";
import { ensureDiligentDir } from "../../src/infrastructure/diligent-dir";
import { createSessionFile } from "../../src/session/persistence";

test("reads historical thread files without materializing a SessionManager", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "file-preview-lifecycle-"));
  const paths = await ensureDiligentDir(cwd);
  const { header } = await createSessionFile(paths.sessions, cwd);
  await writeFile(join(cwd, "README.md"), "# Historical file");
  const server = new DiligentAppServer({ cwd, resolvePaths: ensureDiligentDir });
  try {
    const response = await server.handleRequest("preview", {
      id: 1,
      method: "file/read",
      params: { threadId: header.id, path: "README.md" },
    });
    expect(response).toMatchObject({ result: { kind: "markdown", content: "# Historical file" } });
    const runtimes = (server as unknown as { threads: Map<string, unknown> }).threads;
    expect(runtimes.has(header.id)).toBe(false);
  } finally {
    await server.shutdown();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("reads historical project metadata without parsing conversation entries", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "file-preview-header-"));
  const paths = await ensureDiligentDir(cwd);
  const session = await createSessionFile(paths.sessions, cwd);
  await appendFile(session.path, "an incomplete conversation entry\n");
  await writeFile(join(cwd, "README.md"), "# File content is independent of history");
  const server = new DiligentAppServer({ cwd, resolvePaths: ensureDiligentDir });
  try {
    expect(
      await server.handleRequest("preview", {
        id: 1,
        method: "file/read",
        params: { threadId: session.header.id, path: "README.md" },
      }),
    ).toMatchObject({
      result: { kind: "markdown", content: "# File content is independent of history" },
    });
  } finally {
    await server.shutdown();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("finds imported historical sessions whose filename differs from their header ID", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "file-preview-imported-"));
  const paths = await ensureDiligentDir(cwd);
  const session = await createSessionFile(paths.sessions, cwd);
  await rename(session.path, join(paths.sessions, "imported-session.jsonl"));
  await writeFile(join(cwd, "README.md"), "# Imported session project");
  const server = new DiligentAppServer({ cwd, resolvePaths: ensureDiligentDir });
  try {
    expect(
      await server.handleRequest("preview", {
        id: 1,
        method: "file/read",
        params: { threadId: session.header.id, path: "README.md" },
      }),
    ).toMatchObject({
      result: { kind: "markdown", content: "# Imported session project" },
    });
    expect((server as unknown as { threads: Map<string, unknown> }).threads.has(session.header.id)).toBe(false);
  } finally {
    await server.shutdown();
    await rm(cwd, { recursive: true, force: true });
  }
});
