// @summary Declares unified Studio asset import for image and 3D model files.
import { posix, win32 } from "node:path";
import { z } from "zod";

export const method = "asset_manager.import";
export const timeoutMs = 120_000;

export const description =
  "Import an external 3D model or image file into the OVERDARE asset manager and return its asset ID. " +
  "Studio reads the absolute file path on its own computer. Models: fbx, obj, glb, gltf. " +
  "Images: png, jpg, jpeg, tga, bmp, exr. Optionally set assetName for a 3D model; " +
  "otherwise Studio uses the file name.";

const extensions = new Set(["fbx", "obj", "glb", "gltf", "png", "jpg", "jpeg", "tga", "bmp", "exr"]);

export const params = z.object({
  file: z
    .string()
    .min(1)
    .refine(
      (file) => posix.isAbsolute(file) || win32.isAbsolute(file),
      "Use an absolute file path accessible to Studio",
    )
    .refine((file) => extensions.has(posix.extname(file).slice(1).toLowerCase()), "Unsupported asset file extension")
    .describe("Absolute file path accessible to Studio. Supports fbx, obj, glb, gltf, png, jpg, jpeg, tga, bmp, exr."),
  assetName: z.string().optional().describe("Optional 3D model name. Studio uses the file name when omitted."),
});
