// @summary Declares the Studio RPC method that reads the character rig or an animation clip as JSON.
import { readFile } from "node:fs/promises";
import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import { isRecord } from "../camera-response";
import {
  ANIMATION_TIMEOUT_MS,
  attachPreviewImage,
  dropBlank,
  formatRigResult,
  normalizePreview,
  previewSchema,
  withErrorData,
} from "./animation-shared";

export const method = "animation.read";

export const readOnly = true;

export const timeoutMs = ANIMATION_TIMEOUT_MS;

export const description =
  "Read a character rig and template, or an editable animation with its revision. Omit modelGuid for the built-in Studio character; supply a Workspace Model with one skeletal MeshPart for its original rig. assetPath infers that clip's rig. " +
  "assetId reopens this project's published source clip or downloads an editable copy; editing preserves the published ID until a new publication is used. General rigs retain original bone names, bind poses, weights and materials. " +
  "The rig reports bone-local reference transforms and component axes in Z-up cm; Only the built-in character excludes IK/camera/item bones from editing; other rigs retain their original bone names. " +
  "preview is opt-in. It returns rendered views and raw component-space pose/floor measurements. openEditor opens the selected clip in AnimationEditor; a different open clip is preserved and causes an error. With preview it also captures the editor window. Use character-animation for pose guidance.";

export const params = z
  .object({
    modelGuid: z
      .string()
      .optional()
      .describe(
        "Existing Workspace Model with one skeletal MeshPart. Select its original rig for creation or assetId import; assetPath can infer the rig.",
      ),
    assetPath: z
      .string()
      .optional()
      .describe(
        "Editable /Temp/AnimationAssets/ clip returned by animation.read/write. Character drafts use character.inspect. Omit for rig/template.",
      ),
    assetId: z
      .string()
      .optional()
      .describe("Instead of assetPath: an animation id, ovdrassetid://N, to open for editing."),
    openEditor: z
      .boolean()
      .optional()
      .describe(
        "With assetPath or assetId, open the selected clip in Studio's existing AnimationEditor. Does not close another clip.",
      ),
    preview: previewSchema
      .optional()
      .describe(
        "Only with assetPath or assetId. true for the default contact sheet, or { frames, views, motion }. Omit or false for none.",
      ),
  })
  .strict();

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return normalizePreview(dropBlank(args, ["assetPath", "assetId", "modelGuid"]));
}

export async function recover(error: unknown): Promise<unknown> {
  return withErrorData(error);
}

export async function attachImages(result: unknown): Promise<ImageBlock[] | undefined> {
  const images = (await attachPreviewImage(result)) ?? [];
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      return images.length ? images : undefined;
    }
  }
  const editor = isRecord(result) && isRecord(result.editor) ? result.editor : undefined;
  if (editor?.screenshotStatus === "completed" && typeof editor.screenshotPath === "string") {
    try {
      const bytes = await readFile(editor.screenshotPath);
      images.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") },
      });
    } catch {
      // Preserve any frame sheet even when the separately reported UI image cannot be read.
    }
  }
  return images.length ? images : undefined;
}

export function postProcess(result: unknown): unknown {
  return formatRigResult(result);
}
