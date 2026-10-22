// @summary File previews expose project files through the shared JSON-RPC boundary
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

describe("file/read", () => {
  let root: string;
  let project: string;
  let client: ProtocolTestClient;
  let threadId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "diligent-file-read-"));
    project = join(root, "project");
    await mkdir(join(project, "docs"), { recursive: true });
    await writeFile(join(project, "docs", "README.md"), "# Project\n\nFile preview content.");
    client = createProtocolClient(createTestServer({ cwd: project }));
    threadId = await client.initAndStartThread(project);
  });

  afterEach(async () => {
    client?.close();
    await rm(root, { recursive: true, force: true });
  });

  test("returns actual Markdown content for project-relative and absolute paths", async () => {
    for (const path of ["docs/README.md", join(project, "docs", "README.md")]) {
      expect(await client.request("file/read", { threadId, path })).toMatchObject({
        kind: "markdown",
        name: "README.md",
        content: "# Project\n\nFile preview content.",
      });
    }
  });

  test("reads paths with spaces, Unicode, percent signs, and URL-like characters literally", async () => {
    const name = "report 100% #1 café.md";
    await writeFile(join(project, name), "# Exact file");
    expect(await client.request("file/read", { threadId, path: name })).toMatchObject({
      name,
      content: "# Exact file",
    });
  });

  test("returns image bytes and their media type", async () => {
    const dataBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    await writeFile(join(project, "shot.png"), Buffer.from(dataBase64, "base64"));
    expect(await client.request("file/read", { threadId, path: "shot.png" })).toMatchObject({
      kind: "image",
      mediaType: "image/png",
      dataBase64,
    });
  });

  test("distinguishes text and binary downloads", async () => {
    await writeFile(join(project, "code.ts"), "const answer = 42;");
    await writeFile(join(project, "bytes.bin"), Buffer.from([0, 255, 1]));
    expect(await client.request("file/read", { threadId, path: "code.ts" })).toMatchObject({
      kind: "text",
      content: "const answer = 42;",
    });
    expect(await client.request("file/read", { threadId, path: "bytes.bin" })).toMatchObject({
      kind: "binary",
      dataBase64: "AP8B",
      mediaType: "application/octet-stream",
    });
  });

  test("lists directory entries with their paths and kinds", async () => {
    await mkdir(join(project, "docs", "nested"));
    const canonicalProject = await realpath(project);
    expect(await client.request("file/read", { threadId, path: "docs" })).toMatchObject({
      kind: "directory",
      entries: [
        { name: "nested", path: join(canonicalProject, "docs", "nested"), isDirectory: true },
        { name: "README.md", path: join(canonicalProject, "docs", "README.md"), isDirectory: false },
      ],
    });
  });

  test("uses the requested thread project even when another thread is active", async () => {
    const other = join(root, "other");
    await mkdir(other);
    await writeFile(join(other, "README.md"), "Wrong project");
    await client.request("thread/start", { cwd: other });
    expect(await client.request("file/read", { threadId, path: "docs/README.md" })).toMatchObject({
      content: "# Project\n\nFile preview content.",
    });
  });

  test("reading an unloaded historical thread does not change the active conversation", async () => {
    const historicalThreadId = threadId;
    client.close();
    const restarted = createTestServer({ cwd: project });
    client = createProtocolClient(restarted);
    const otherProject = join(root, "active-project");
    await mkdir(otherProject);
    await client.initAndStartThread(otherProject);
    await client.request("file/read", { threadId: historicalThreadId, path: "docs/README.md" });
    const observer = createProtocolClient(restarted);
    try {
      await observer.request("initialize", { clientName: "observer", clientVersion: "0.0.0", protocolVersion: 1 });
      expect(await observer.request("thread/read", {})).toMatchObject({ cwd: otherProject });
    } finally {
      observer.close();
    }
  });

  test("does not require creating a thread to read the connection project", async () => {
    expect(await client.request("file/read", { path: "docs/README.md" })).toMatchObject({
      kind: "markdown",
      content: "# Project\n\nFile preview content.",
    });
  });

  test("returns an actionable error for missing files", async () => {
    await expect(client.request("file/read", { threadId, path: "missing.md" })).rejects.toThrow("File not found");
  });

  test("rejects missing or malformed thread IDs without falling back to another project", async () => {
    await expect(client.request("file/read", { threadId: "missing-thread", path: "docs/README.md" })).rejects.toThrow(
      "Thread not found",
    );
    await expect(
      client.request("file/read", { threadId: "../another-thread", path: "docs/README.md" }),
    ).rejects.toThrow("Invalid thread ID");
  });

  test("rejects traversal and absolute files outside the project", async () => {
    await writeFile(join(root, "secret.md"), "Do not expose");
    for (const path of ["../secret.md", join(root, "secret.md")]) {
      await expect(client.request("file/read", { threadId, path })).rejects.toThrow("outside the project");
    }
  });

  test("rejects symlinks escaping the project but permits internal symlinks", async () => {
    await writeFile(join(root, "secret.md"), "Do not expose");
    await symlink(join(root, "secret.md"), join(project, "outside.md"));
    await symlink(join(project, "docs", "README.md"), join(project, "inside.md"));
    await expect(client.request("file/read", { threadId, path: "outside.md" })).rejects.toThrow("outside the project");
    expect(await client.request("file/read", { threadId, path: "inside.md" })).toMatchObject({
      content: "# Project\n\nFile preview content.",
    });
  });

  test("rejects oversized files before returning their content", async () => {
    await writeFile(join(project, "large.txt"), Buffer.alloc(10 * 1024 * 1024 + 1, 97));
    await expect(client.request("file/read", { threadId, path: "large.txt" })).rejects.toThrow("10 MiB");
  });

  test("rejects URLs instead of fetching remote content", async () => {
    await expect(client.request("file/read", { threadId, path: "https://example.com/file.md" })).rejects.toThrow(
      "local file path",
    );
  });

  test("accepts local file URIs without treating their encoding as literal filename bytes", async () => {
    const path = join(project, "a space.md");
    await writeFile(path, "# URI file");
    expect(await client.request("file/read", { threadId, path: pathToFileURL(path).href })).toMatchObject({
      content: "# URI file",
    });
  });
});
