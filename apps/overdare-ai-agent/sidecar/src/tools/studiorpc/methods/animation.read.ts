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
  "Read an existing character rig, or an animation clip as editable JSON. Downloaded clips are opened as editable copies; the original rig and animation are preserved.\n" +
  "Pass modelGuid to select a Workspace Model's existing single skeletal MeshPart. Omit it for the default ODA rig; with assetPath, the clip's own original rig is inferred. " +
  "The same read/write/preview/publish tools work on general rigs. Bone names are the original names, including names containing IK, Camera or Item; the naming filter below applies only to ODA. " +
  "General-rig captures use the original materials and +X/+Y component views. Measurements use original bone names and component space; review their meaning for the selected rig.\n" +
  "With a clip, openEditor:true also opens the existing Studio AnimationEditor and reports its actual preview clip, mesh and bone count. A different already-open clip is preserved and returns an error; close it first. " +
  "The selected editor refreshes when the same clip is changed through animation.write. Omit openEditor for a data-only read.\n" +
  "With openEditor:true and a requested preview, the images also include a screenshot of the actual AnimationEditor window. Its capture status and path are in editor; a frame sheet alone does not prove the editor UI.\n" +
  "Without assetPath (start here): returns `rig`, `template`, `limits` and `animations` (asset paths of the " +
  "clips that already exist). `rig.bones[]` lists the bones you can animate: name, parent, refLocal.translation " +
  "and refComponent (translation, and axisX/axisY/axisZ = the bone's own axes in component space); " +
  "`rig.notAnimatable` names the IK, camera and item bones. Use bone names exactly as " +
  "listed, and check a bone's axes before deciding which rotation component bends it the way you want. " +
  "`template` is a valid empty animation to start from. You do not need an asset name to create a clip: " +
  "studiorpc_animation_write without assetPath creates one.\n" +
  "With assetPath: returns { assetPath, filePath, revision, animation, preview? }. `animation` is in the " +
  "studiorpc_animation_write format; send it back edited, with this `revision` unchanged. Use this to see the " +
  "clip's current state (a person may have edited it in the AnimationEditor) and after REVISION_CONFLICT.\n" +
  "With assetId (ovdrassetid://N, e.g. from an Action Sequence AnimationTrack) instead of assetPath: opens that " +
  "animation for editing and adds `source` { assetId, openedFrom, note }. An id published from this project opens " +
  'the clip it was published from (openedFrom "published clip"); any other id is downloaded once into an editable ' +
  'copy /Temp/AnimationAssets/Asset_<id> (openedFrom "copy", keys baked per frame where the motion needs them). ' +
  "Edit it with studiorpc_animation_write and the returned assetPath; the id keeps pointing at the old version " +
  "until you publish again and put the new id where the old one was used.\n" +
  "No image unless you pass `preview` with assetPath or assetId: true = default frames (0%, 20%, 40%, 60%, 80%, 100%, rounded to distinct integer frames), both views " +
  'and a MOTION column; or { frames: [up to 22 integer frames], views: ["front", "side"], motion: false } to ' +
  "look closely at specific frames. Leave optional fields out when you do not use them (blank strings and " +
  "preview false count as not given). The PNG comes back as an image: blocks = up to six frames in order, each with front/side rows; " +
  "columns = frames in order (each labeled), then requested MOTION: the clip onion-skinned (earlier = fainter). " +
  "preview.floor reports raw skinned-mesh heights against component z = 0: status, method, referenceLowestCm " +
  "and samples [{ frame, lowestCm, bone, lowestByBoneCm }]. Bone groups use the original dominant skin influence. " +
  "preview.poseSamples lists, per " +
  "sampled frame, bones' componentTranslationCm and rotationQuat [x,y,z,w], plus the sample's lowestCm. " +
  "Use these measurements and requested images for task-specific review; they do not classify contact or artistic quality. " +
  "preview.status is completed, skipped or failed (see preview.diagnostic).";

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
      .describe("Clip to read, as returned by studiorpc_animation_write. Omit to get the rig and a template."),
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
