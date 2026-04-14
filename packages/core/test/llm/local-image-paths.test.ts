// @summary Tests relative local-image persistence and backward-compatible resolution

import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localImageToBase64 } from "../../src/llm/image-io";
import { resolvePersistedLocalImagePath, toPersistedLocalImagePath } from "../../src/llm/local-image-paths";

describe("local image paths", () => {
  it("stores project-local image paths relative to cwd", () => {
    const cwd = "/workspace/project";
    const absPath = "/workspace/project/.diligent/images/thread/example.png";

    expect(toPersistedLocalImagePath(absPath, cwd)).toBe(".diligent/images/thread/example.png");
  });

  it("resolves relative persisted image paths against cwd and keeps absolute legacy paths", () => {
    const cwd = "/workspace/project";
    expect(resolvePersistedLocalImagePath(".diligent/images/thread/example.png", cwd)).toBe(
      "/workspace/project/.diligent/images/thread/example.png",
    );
    expect(resolvePersistedLocalImagePath("/tmp/example.png", cwd)).toBe("/tmp/example.png");
  });

  it("skips missing files during materialization", async () => {
    const result = await localImageToBase64(
      {
        type: "local_image",
        path: ".diligent/images/missing.png",
        mediaType: "image/png",
      },
      { cwd: "/workspace/project" },
    );

    expect(result).toBeNull();
  });

  it("materializes relative persisted paths when file exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "diligent-local-image-"));
    try {
      const dirPath = join(cwd, ".diligent", "images", "thread");
      const filePath = join(dirPath, "example.png");
      await mkdir(dirPath, { recursive: true });
      await Bun.write(filePath, Buffer.from("image-bytes"));

      const result = await localImageToBase64(
        {
          type: "local_image",
          path: ".diligent/images/thread/example.png",
          mediaType: "image/png",
        },
        { cwd },
      );

      expect(result?.type).toBe("image");
      expect(result?.source.media_type).toBe("image/png");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
