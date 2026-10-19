// @summary Imports image, model, and audio files through Studio's unified asset manager RPC.
import { z } from "zod";

export const method = "asset_manager.import";
export const timeoutMs = 300_000;
export const description =
  "Import an external image, model, or audio file into the asset manager. Studio selects the importer " +
  "from the file format and returns asset.assetid. Supported formats are png/jpg/jpeg/tga/bmp/exr, " +
  "fbx/obj/glb/gltf, and wav/mp3/ogg. The absolute file path must be accessible to the Studio process. " +
  "assetName optionally names an imported model. This tool saves the level after successful import. " +
  "Do not automatically retry after timeout or cancellation: inspect the asset manager first.";
export const params = z
  .object({
    file: z.string().min(1).describe("Absolute file path accessible on Studio's computer."),
    assetName: z.string().min(1).optional().describe("Optional name for a model; ignored for images and audio."),
  })
  .strict();
