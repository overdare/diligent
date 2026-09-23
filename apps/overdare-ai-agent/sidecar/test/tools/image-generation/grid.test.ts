// @summary Verifies grid pixel diagnostics, crop persistence, and cleanup after failure or cancellation.
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

test.each(["coin", null])("treats partial-alpha artwork as visible in a cell requested as %s", async (item) => {
  const cwd = await mkdtemp(join(tmpdir(), "grid-partial-alpha-"));
  const partial = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgEpFrAAABJQC97kY5HgAAAABJRU5ErkJggg==",
    "base64",
  );
  try {
    const result = await storeImageGrid(
      cwd,
      { bytes: partial, mediaType: "image/png", requestedModel: "fixture" },
      { rows: 1, columns: 1, items: [item] },
      "transparent",
      new AbortController().signal,
    );
    const cell = item === null ? result.details.skippedCells[0] : result.details.cells[0];
    expect(cell.transparency).toEqual({
      status: "has_transparency",
      transparentPixels: 0,
      partialPixels: 1,
      opaquePixels: 0,
    });
    if (item === null) {
      expect(cell.warning).toContain("visible pixels remain");
      expect(result.details.cells).toHaveLength(0);
      expect(result.stored).toHaveLength(0);
      expect(result.details.skippedCells[0].reason).toBe("requested_empty");
    } else {
      expect(cell.warning).toBeUndefined();
      expect(result.details.skippedCells).toHaveLength(0);
      expect(result.stored).toHaveLength(1);
      expect(await Bun.file(result.details.cells[0].file).exists()).toBe(true);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test.each([
  "cancel",
  "cancel after last write",
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
    if (failure === "cancel" || (failure === "cancel after last write" && writes === 2)) {
      controller.abort(new Error("cancel cropping"));
    }
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
    ).rejects.toThrow(failure === "write failure" ? "disk full" : "cancel cropping");
    expect(writes).toBe(failure === "cancel after last write" ? 2 : 1);
    const remaining = await readdir(join(resolvePaths(cwd).images, "generated"));
    expect(remaining).toHaveLength(1);
    expect(original.file.endsWith(remaining[0])).toBe(true);
  } finally {
    mock.mockRestore();
    await rm(cwd, { recursive: true, force: true });
  }
});
