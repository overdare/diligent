// @summary Defines generator-neutral albedo plans passed unchanged to native Studio authoring.
import { z } from "zod";

const color = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);
const rect = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().positive().max(1),
    z.number().positive().max(1),
  ])
  .refine(([x, y, w, h]) => x + w <= 1.000001 && y + h <= 1.000001, "Rectangle must fit inside its surface.");
export const assetId = z.string().regex(/^ovdrassetid:\/\/[1-9][0-9]*$/, "Use a published image asset id.");
const common = { id: z.string().min(1).max(128), opacity: z.number().min(0).max(1).optional() };
const imageSource = z.union([
  z
    .object({
      imageKey: z
        .string()
        .min(1)
        .max(128)
        .refine((key) => key !== "__final", "Reserved image key."),
    })
    .strict(),
  z.object({ assetId }).strict(),
]);
const layer = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("fill"), color }).strict(),
  z
    .object({
      ...common,
      kind: z.literal("shape"),
      shape: z.enum(["rect", "ellipse", "line", "sun", "star", "arrow"]),
      rect,
      color,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("pattern"),
      pattern: z.enum(["stripes", "checker", "dots"]),
      rect,
      color,
      repeat: z.number().int().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("text"),
      text: z.string().max(4096),
      fontKey: z.literal("default-korean"),
      rect,
      color,
      fontSize: z
        .number()
        .positive()
        .max(1)
        .optional()
        .describe("Font height as a fraction of the full surface height, not the text rectangle."),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("image"),
      source: imageSource,
      rect,
      fit: z.enum(["contain", "cover"]).optional(),
    })
    .strict(),
]);
export const texturePlan = z
  .object({
    version: z.literal(1),
    base: z.union([
      z.object({ kind: z.literal("fill"), color }).strict(),
      z.object({ kind: z.literal("current") }).strict(),
    ]),
    surfaces: z.record(
      z.string().min(1),
      z
        .array(layer)
        .max(128)
        .refine(
          (layers) => new Set(layers.map((l) => l.id)).size === layers.length,
          "Layer ids must be unique within a surface.",
        ),
    ),
  })
  .strict();

export const suppliedImage = z.union([
  z.object({ filePath: z.string().min(1) }).strict(),
  z.object({ assetId }).strict(),
]);
