// @summary Normalizes generated artwork into an upload-ready PNG inside the current project.
import { randomUUID } from "node:crypto";
import { mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { resizeImageToSquarePng } from "@diligent/core/image-contract";
import type { Tool } from "@diligent/core/tool-contract";
import type { RuntimeToolHost } from "@diligent/runtime";
import { z } from "zod";
import { readReferenceImages, resolveReferenceImages } from "./reference-images";

const SIZE = 1080;
const MAX_BYTES = 10_000_000;
const parameters = z
  .object({
    sourceImage: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Existing PNG, JPEG, or WebP on the agent host, normally generate_image's file. Relative paths resolve from the project directory.",
      ),
  })
  .strict();

export function createPrepareWorldThumbnailTool(cwd: string, host?: RuntimeToolHost): Tool<typeof parameters> {
  return {
    name: "prepare_world_thumbnail",
    description:
      "Prepare an existing image for an OVERDARE world thumbnail without generating new art. " +
      "Center-crops non-square images, resizes to exactly 1080x1080, encodes real PNG under 10 MB, " +
      "and saves a new unique file in the current project's thumbnails folder. Preserves the source. " +
      "Returns file, directory, actual dimensions, bytes, source/crop dimensions, and the final image. " +
      "Inspect the final image for cropped subjects/text and mobile readability. Embed the final image using its returned file path; " +
      "omit separate file/folder links unless requested, and do not create a separate small preview or upload it. If local preparation fails, correct the local problem and reuse the source instead of regenerating art.",
    parameters,
    supportParallel: true,
    async execute(args, ctx) {
      ctx.signal.throwIfAborted();
      const project = await realpath(cwd);
      const directory = join(project, "thumbnails");
      const resolvedDirectory = await realpath(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return directory;
        throw error;
      });
      const projectRelative = relative(project, resolvedDirectory);
      if (projectRelative === ".." || projectRelative.startsWith(`..${sep}`) || isAbsolute(projectRelative)) {
        throw new Error("Thumbnail output folder must remain inside the project.");
      }
      const file = join(resolvedDirectory, `world-thumbnail-${randomUUID()}.png`);
      const approval = await host?.approve?.({
        permission: "write",
        toolName: "prepare_world_thumbnail",
        description: "Save an upload-ready world thumbnail in the project",
        details: {
          sourceImage: args.sourceImage,
          directory: resolvedDirectory,
          file_path: file.replaceAll("\\", "/"),
        },
      });
      if (approval === "reject")
        return { output: "[Rejected by user]", metadata: { error: true, operation: "world_thumbnail" } };
      ctx.signal.throwIfAborted();
      const paths = await resolveReferenceImages(cwd, [args.sourceImage], ctx.signal);
      const [source] = await readReferenceImages(paths, ctx.signal);
      const image = await resizeImageToSquarePng(Uint8Array.from(source.bytes).buffer, source.mediaType, SIZE, {
        signal: ctx.signal,
      });
      const bytes = Buffer.from(image.bytes);
      if (bytes.length >= MAX_BYTES)
        throw new Error("Thumbnail exceeds the upload limit of 10 MB; no thumbnail was saved.");
      ctx.signal.throwIfAborted();
      await mkdir(resolvedDirectory, { recursive: true });
      if ((await realpath(resolvedDirectory)) !== resolvedDirectory) {
        throw new Error("Thumbnail output folder changed after approval; retry with its current location.");
      }
      ctx.signal.throwIfAborted();
      try {
        await writeFile(file, bytes, { flag: "wx", signal: ctx.signal });
        ctx.signal.throwIfAborted();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") await unlink(file).catch(() => {});
        throw error;
      }
      const details = {
        file,
        directory: resolvedDirectory,
        mediaType: "image/png",
        width: SIZE,
        height: SIZE,
        bytes: bytes.length,
        source: image.source,
        crop: image.crop,
      };
      return {
        output: JSON.stringify(details, null, 2),
        outputImages: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } },
        ],
        metadata: { operation: "world_thumbnail", ...details },
      };
    },
  };
}
