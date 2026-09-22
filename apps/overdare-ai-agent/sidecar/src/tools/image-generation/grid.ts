// @summary Builds asset-sheet prompts and persists lossless row-major grid crops with pixel diagnostics.
import { unlink } from "node:fs/promises";
import { splitImageGrid } from "@diligent/core/image-contract";
import type { ImageBackground, ImageGenerationResult } from "@diligent/core/provider-contract";
import { z } from "zod";
import { type StoredImage, storeGeneratedImage } from "./image-store";

export const gridSchema = z
  .object({
    rows: z.number().int().min(1).max(64),
    columns: z.number().int().min(1).max(64),
    items: z
      .array(z.string().trim().min(1).max(1000).nullable())
      .min(1)
      .max(64)
      .describe(
        "Exactly rows * columns entries in row-major order. Describe one isolated asset per cell; use null for an empty cell.",
      ),
  })
  .strict()
  .superRefine((grid, ctx) => {
    if (grid.rows * grid.columns > 64)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use at most 64 grid cells." });
    if (grid.items.length !== grid.rows * grid.columns)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Provide exactly rows * columns items, using null for empty cells.",
      });
  });

export type ImageGrid = z.infer<typeof gridSchema>;

export function buildGridPrompt(prompt: string, grid: ImageGrid, background: ImageBackground): string {
  return [
    prompt,
    "",
    `Generate exactly ONE asset sheet arranged in exactly ${grid.columns} columns x ${grid.rows} rows.`,
    "Divide the entire canvas into equal rectangular cells with no outer header, footer, or extra border. Read left to right, then top to bottom.",
    "Center exactly one independent asset in each occupied cell. Keep every silhouette, shadow, and effect inside its cell with generous empty padding on all four sides (at least 10% of cell width/height).",
    "Keep style, perspective, outlines, lighting, and relative scale consistent across assets. No objects may touch or cross a cell boundary. No shared scene or background connecting cells.",
    "Do not draw grid lines, cell borders, labels, numbers, or captions. Cell numbers below are layout instructions only.",
    background === "transparent"
      ? "Use real PNG alpha transparency outside each asset and throughout EMPTY cells and padding. Never draw a checkerboard to represent transparency."
      : "Keep padding and EMPTY cells free of objects, decoration, and shadows, using the requested background.",
    ...grid.items.map(
      (item, index) =>
        `Cell ${index + 1} (row ${Math.floor(index / grid.columns) + 1}, column ${(index % grid.columns) + 1}): ${item ?? "EMPTY — leave this entire cell blank."}`,
    ),
  ].join("\n");
}

export async function storeImageGrid(
  cwd: string,
  generated: ImageGenerationResult,
  grid: ImageGrid,
  background: ImageBackground,
  signal: AbortSignal,
) {
  const split = await splitImageGrid(Uint8Array.from(generated.bytes).buffer, generated.mediaType, grid, { signal });
  const stored: StoredImage[] = [];
  try {
    const cells = [];
    const skippedCells = [];
    for (const [index, cell] of split.cells.entries()) {
      signal.throwIfAborted();
      const item = grid.items[index];
      const empty = cell.opaquePixels + cell.partialPixels === 0;
      const opaque = cell.transparentPixels + cell.partialPixels === 0;
      const warning =
        item === null
          ? background === "transparent" && !empty
            ? "Requested an empty transparent cell, but visible pixels remain. Inspect the sheet before using this crop."
            : undefined
          : empty
            ? "This occupied cell contains no visible artwork. Repair this asset before importing it."
            : background === "transparent" && opaque
              ? "Transparency was requested, but this cell is fully opaque. Repair it before importing it as a cutout."
              : undefined;
      const details = {
        index: index + 1,
        row: cell.row,
        column: cell.column,
        item,
        requestedEmpty: item === null,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
        transparency: {
          status: empty ? "empty" : opaque ? "opaque" : "has_transparency",
          transparentPixels: cell.transparentPixels,
          partialPixels: cell.partialPixels,
          opaquePixels: cell.opaquePixels,
        },
        ...(warning ? { warning } : {}),
      };
      if (item === null || empty) {
        skippedCells.push({ ...details, reason: item === null ? "requested_empty" : "fully_transparent" });
        continue;
      }
      const image = await storeGeneratedImage(
        cwd,
        { bytes: new Uint8Array(cell.bytes), mediaType: "image/png" },
        { signal },
      );
      stored.push(image);
      cells.push({ ...details, file: image.file, mediaType: image.mediaType });
    }
    signal.throwIfAborted();
    return {
      details: {
        rows: grid.rows,
        columns: grid.columns,
        width: split.width,
        height: split.height,
        cells,
        skippedCells,
        guidance:
          "Crops follow equal pixel boundaries; object placement is not semantically verified. Inspect each returned cell before importing. Intentional blanks and fully transparent crops are omitted; check skippedCells for missing artwork and other warnings. Original cell indices are preserved.",
      },
      stored,
    };
  } catch (error) {
    await Promise.all(stored.map((image) => unlink(image.file).catch(() => {})));
    throw error;
  }
}
