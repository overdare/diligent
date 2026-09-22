// @summary Verifies that failed or cancelled grid persistence removes only that attempt's partial crops.
import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "@diligent/runtime";
import { storeImageGrid } from "../../../src/tools/image-generation/grid";
import * as imageStore from "../../../src/tools/image-generation/image-store";

const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPkEpH7z8XFxQAABvcBW4Wvy/wAAAAASUVORK5CYII=",
  "base64",
);

test.each([
  "cancel",
  "write failure",
])("cleans partial crops after %s and preserves previously saved images", async (failure) => {
  const cwd = await mkdtemp(join(tmpdir(), "grid-cleanup-"));
  const controller = new AbortController();
  const save = imageStore.storeGeneratedImage;
  const original = await save(cwd, { bytes, mediaType: "image/png" });
  let writes = 0;
  const mock = spyOn(imageStore, "storeGeneratedImage").mockImplementation(async (...args) => {
    if (writes === 1 && failure === "write failure") throw new Error("disk full");
    const image = await save(...args);
    writes++;
    if (failure === "cancel") controller.abort(new Error("cancel cropping"));
    return image;
  });
  try {
    await expect(
      storeImageGrid(
        cwd,
        { bytes, mediaType: "image/png", requestedModel: "fixture" },
        { rows: 1, columns: 2, items: ["coin", "gem"] },
        "transparent",
        controller.signal,
      ),
    ).rejects.toThrow(failure === "cancel" ? "cancel cropping" : "disk full");
    expect(writes).toBe(1);
    const remaining = await readdir(join(resolvePaths(cwd).images, "generated"));
    expect(remaining).toHaveLength(1);
    expect(original.file.endsWith(remaining[0])).toBe(true);
  } finally {
    mock.mockRestore();
    await rm(cwd, { recursive: true, force: true });
  }
});
