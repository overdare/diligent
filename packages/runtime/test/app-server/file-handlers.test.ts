// @summary File preview validation follows the opened file through filesystem changes
import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFilePreview } from "../../src/app-server/file-handlers";

test("does not expose an outside file substituted after resolving the preview path", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "file-preview-symlink-race-"));
  const project = join(root, "project");
  await fs.mkdir(project);
  const target = join(project, "README.md");
  const outside = join(root, "private.md");
  await fs.writeFile(target, "# Project file");
  await fs.writeFile(outside, "Private file outside the project");
  const originalOpen = fs.open;
  const open = spyOn(fs, "open").mockImplementationOnce(async (path, flags, mode) => {
    await fs.rm(target);
    await fs.symlink(outside, target);
    return originalOpen(path, flags, mode);
  });
  try {
    await expect(readFilePreview(project, "README.md")).rejects.toThrow();
  } finally {
    open.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")(
  "rejects a directory substituted immediately before the file is opened",
  async () => {
    const project = await fs.mkdtemp(join(tmpdir(), "file-preview-type-race-"));
    const target = join(project, "README.md");
    await fs.writeFile(target, "# Project file");
    const originalOpen = fs.open;
    const open = spyOn(fs, "open").mockImplementationOnce(async (path, flags, mode) => {
      await fs.rm(target);
      await fs.mkdir(target);
      return originalOpen(path, flags, mode);
    });
    try {
      await expect(readFilePreview(project, "README.md")).rejects.toThrow("Only regular files");
    } finally {
      open.mockRestore();
      await fs.rm(project, { recursive: true, force: true });
    }
  },
);
