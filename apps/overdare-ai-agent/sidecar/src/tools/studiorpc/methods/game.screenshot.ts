// @summary Declares the Studio RPC method for capturing a screenshot of the editor viewport.
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { compositeImageRects } from "@diligent/core/image-contract";
import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import { type CameraBlock, projectWorldToScreen } from "../camera-projection";
import {
  type CallRpc,
  isRecord,
  listRunningInstanceNames,
  locateInstanceByName,
  readVec3,
  withCameraAxes,
} from "../camera-response";
import { getReservedUiZones, hiddenCoreGuiParam, REFERENCE_VIEWPORT } from "../reserved-ui";
import { StudioRpcError } from "../rpc";

export const method = "game.screenshot";

export const description =
  "Capture the active OVERDARE Studio viewport and return the PNG with its file path, captured size, and " +
  "camera. UI is included by default. Use screenshots for rendered layout, clipping, overlap, and visual " +
  "quality. UI captures include a red preview overlay of estimated mobile reserved regions; raw path is preserved. " +
  "Use hiddenCoreGui only after reading scripts that hide those controls; reservedUi:false returns a clean preview. " +
  "Use game.observe for live property values such as colors and contrast. `locate` projects world " +
  "positions or instance names/paths into the same normalized 0..1 coordinates used by input injection. " +
  "`screen` is the unclamped projected bounds and `onScreen` means inside the camera frustum, not visible " +
  "through occluders. Camera axes include horizontal groundForward and groundRight for view-relative edits.";

const worldPoint = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const params = z
  .object({
    reservedUi: z
      .boolean()
      .optional()
      .describe(
        "Add a translucent red preview of estimated mobile HUD/control regions. Defaults to true when includeGui is true. " +
          "The original screenshot path is unchanged; false disables the annotation.",
      ),
    hiddenCoreGui: hiddenCoreGuiParam,
    includeGui: z
      .boolean()
      .optional()
      .describe("Whether to include on-screen UI. Defaults to true; pass false for the world render only."),
    camera: z
      .object({ position: worldPoint, lookAt: worldPoint })
      .optional()
      .describe(
        "One-shot editor camera position and look-at point in OVERDARE world coordinates. The original view " +
          "is restored after capture. Rejected while PIE is running because the player camera owns the view.",
      ),
    locate: z
      .array(
        z.union([
          z.string().min(1),
          worldPoint.extend({ label: z.string().optional().describe("Name echoed back on the result.") }),
        ]),
      )
      .max(32)
      .optional()
      .describe(
        "World positions or live/saved instance names and dotted paths to project. Results include normalized " +
          "coordinates, projected bounds when size is known, ambiguity details, and onScreen.",
      ),
  })
  .strict();
// Default at the RPC boundary (not via zod .default) so every call path —
// agent runtime and MCP server — sends an explicit includeGui to Studio.
/** Projection and reserved UI guidance are local; Studio receives no extra parameters. */
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { locate: _l, reservedUi: _r, hiddenCoreGui: _h, camera, ...rest } = args;
  if (isRecord(camera)) {
    Object.assign(rest, { cameraPosition: camera.position, lookAt: camera.lookAt });
  }
  return { includeGui: true, ...rest };
}

export async function recover(error: unknown, args: Record<string, unknown>): Promise<unknown> {
  const data = error instanceof StudioRpcError && isRecord(error.data) ? error.data : undefined;
  const structured = data?.name === "unsupportedWhilePlaying" && data.capability === "editorCameraOverride";
  const compatibleOlderBuild =
    error instanceof StudioRpcError &&
    error.code === -32602 &&
    isRecord(args.camera) &&
    error.message.includes("play test is drawing the screen");
  if (!structured && !compatibleOlderBuild) throw error;
  return {
    status: "unsupportedWhilePlaying",
    capability: "editorCameraOverride",
    while: "playTest",
    retry: { omitCamera: true },
  };
}
export async function attachImages(
  result: unknown,
  _args?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ImageBlock[] | undefined> {
  if (!isRecord(result) || typeof result.path !== "string") return undefined;
  const overlay = isRecord(result.reservedUi) ? result.reservedUi : undefined;
  const paths =
    overlay?.status === "annotated" && typeof overlay.path === "string" ? [overlay.path, result.path] : [result.path];
  for (const path of paths) {
    try {
      const bytes = await readFile(path, { signal });
      return [{ type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } }];
    } catch {
      signal?.throwIfAborted();
    }
  }
  return undefined;
}

async function annotateReservedUi(
  result: unknown,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  if (
    args.includeGui === false ||
    args.reservedUi === false ||
    !isRecord(result) ||
    result.success === false ||
    typeof result.path !== "string"
  )
    return result;
  const hiddenCoreGui = [...new Set(hiddenCoreGuiParam.parse(args.hiddenCoreGui) ?? [])];
  const zones = getReservedUiZones(hiddenCoreGui).map((zone) => ({
    ...zone,
    rect: {
      left: zone.rect.left / REFERENCE_VIEWPORT.width,
      top: zone.rect.top / REFERENCE_VIEWPORT.height,
      right: zone.rect.right / REFERENCE_VIEWPORT.width,
      bottom: zone.rect.bottom / REFERENCE_VIEWPORT.height,
    },
  }));
  const guidance = {
    source: "reference-layout",
    visibilitySource: hiddenCoreGui.length ? "caller-script-review" : "assumed-defaults",
    referenceViewport: REFERENCE_VIEWPORT,
    hiddenCoreGui,
    zones,
    note:
      "Red regions are estimated mobile layout guidance, not game pixels or measured runtime bounds. " +
      "Hidden controls were declared by the caller after script review, not verified at runtime. " +
      "Do not reproduce the red tint in generated artwork. Use the original path for clean image references.",
  };
  let writtenPath: string | undefined;
  try {
    const original = await readFile(result.path, { signal });
    const image = await compositeImageRects(
      Uint8Array.from(original).buffer,
      "image/png",
      zones.map((zone) => zone.rect),
      [255, 0, 0, 64],
    );
    signal?.throwIfAborted();
    const path = join(
      dirname(result.path),
      `${basename(result.path, extname(result.path))}.reserved-ui-${randomUUID()}.png`,
    );
    try {
      await writeFile(path, new Uint8Array(image.bytes), { signal, flag: "wx" });
      writtenPath = path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") await unlink(path).catch(() => {});
      throw error;
    }
    signal?.throwIfAborted();
    return {
      ...result,
      reservedUi: { ...guidance, status: "annotated", path, image: { width: image.width, height: image.height } },
    };
  } catch (error) {
    if (writtenPath) await unlink(writtenPath).catch(() => {});
    signal?.throwIfAborted();
    return {
      ...result,
      reservedUi: {
        ...guidance,
        status: "unavailable",
        warning: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

type Point = { x: number; y: number; z: number; label?: string; half?: { x: number; y: number; z: number } };

function readCamera(result: unknown): { camera: CameraBlock; image: { width: number; height: number } } | undefined {
  if (!isRecord(result)) return undefined;
  const camera = isRecord(result.camera) ? result.camera : undefined;
  const image = isRecord(result.image) ? result.image : undefined;
  const cframe = camera && isRecord(camera.CFrame) ? camera.CFrame : undefined;
  const position = readVec3(cframe?.Position);
  const orientation = readVec3(cframe?.Orientation);
  if (!camera || !position || !orientation) return undefined;
  if (
    typeof camera.fieldOfView !== "number" ||
    !Number.isFinite(camera.fieldOfView) ||
    camera.fieldOfView <= 0 ||
    camera.fieldOfView >= 180 ||
    typeof camera.aspectRatio !== "number" ||
    !Number.isFinite(camera.aspectRatio) ||
    camera.aspectRatio <= 0
  ) {
    return undefined;
  }
  if (
    typeof image?.width !== "number" ||
    !Number.isFinite(image.width) ||
    image.width <= 0 ||
    typeof image?.height !== "number" ||
    !Number.isFinite(image.height) ||
    image.height <= 0
  ) {
    return undefined;
  }
  return {
    camera: { position, orientation, fieldOfView: camera.fieldOfView, aspectRatio: camera.aspectRatio },
    image: { width: image.width, height: image.height },
  };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
function projectedRect(
  read: { camera: CameraBlock; image: { width: number; height: number } },
  centre: Point,
  half: { x: number; y: number; z: number },
): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let inFront = 0;
  let behind = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const projected = projectWorldToScreen(read.camera, read.image, {
          x: centre.x + sx * half.x,
          y: centre.y + sy * half.y,
          z: centre.z + sz * half.z,
        });
        if (projected.behindCamera) {
          behind++;
          continue;
        }
        inFront++;
        minX = Math.min(minX, projected.normalized.x);
        maxX = Math.max(maxX, projected.normalized.x);
        minY = Math.min(minY, projected.normalized.y);
        maxY = Math.max(maxY, projected.normalized.y);
      }
    }
  }
  if (inFront === 0) return undefined;
  if (behind > 0) {
    minX = Math.min(minX, 0);
    maxX = Math.max(maxX, 1);
    minY = Math.min(minY, 0);
    maxY = Math.max(maxY, 1);
  }
  return { minX: round(minX, 4), minY: round(minY, 4), maxX: round(maxX, 4), maxY: round(maxY, 4) };
}
function aspectNote(read: { camera: CameraBlock; image: { width: number; height: number } }): string | undefined {
  const imageAspect = read.image.width / read.image.height;
  const stretch = imageAspect / read.camera.aspectRatio;
  if (stretch > 0.98 && stretch < 1.02) return undefined;
  return (
    `The image is ${read.image.width}x${read.image.height}, an aspect of ${round(imageAspect, 3)}, but the ` +
    `camera saw ${round(read.camera.aspectRatio, 3)}. The picture is squeezed horizontally to ` +
    `${round(stretch, 3)} of the view's proportions, so judge shapes and relative sizes with that in mind. ` +
    `Normalized coordinates are unaffected: a fraction of the image's width is still the same fraction of ` +
    `the viewport, which is why locate and pointer positions stay correct.`
  );
}

export async function postProcess(
  result: unknown,
  args: Record<string, unknown>,
  callRpc: CallRpc,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  return annotateReservedUi(await postProcessCamera(result, args, callRpc), args, signal);
}

async function postProcessCamera(result: unknown, args: Record<string, unknown>, callRpc: CallRpc): Promise<unknown> {
  const requested = Array.isArray(args.locate) ? (args.locate as (string | Point)[]) : [];
  const locate = requested.filter((entry): entry is Point => typeof entry !== "string");
  const locateNames = requested.filter((entry): entry is string => typeof entry === "string");
  const read = readCamera(result);
  if (!locate?.length && !locateNames?.length) {
    const note = read ? aspectNote(read) : undefined;
    return withCameraAxes(note && isRecord(result) ? { ...result, imageAspectNote: note } : result);
  }
  if (!read || (isRecord(result) && isRecord(result.camera) && result.camera.projection === "orthographic")) {
    return { ...(isRecord(result) ? result : { result }), locateError: "camera block is missing or not perspective" };
  }
  const out: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  const note = aspectNote(read);
  if (note) out.imageAspectNote = note;

  const named: Point[] = [];
  const absent: string[] = [];
  const failed: string[] = [];
  const ambiguous: string[] = [];
  let failureDetail = "";
  let levelBrowse: Promise<unknown> | undefined;
  const cachedCallRpc: CallRpc = (method, params, options) => {
    if (method === "level.browse" && Object.keys(params).length === 0) {
      levelBrowse ??= callRpc(method, params, options);
      return levelBrowse;
    }
    return callRpc(method, params, options);
  };
  const namedResults = await Promise.all(locateNames.map((name) => locateInstanceByName(cachedCallRpc, name)));
  for (const [index, name] of locateNames.entries()) {
    const result = namedResults[index];
    if (result.found) {
      named.push({ ...result.position, label: result.path ?? name, half: result.half });
      if (result.matches !== undefined && result.matches > 1) {
        ambiguous.push(`${name}: ${result.matches} instances share that name; this one is ${result.path ?? "unknown"}`);
      }
    } else if (result.reason === "lookupFailed") {
      failed.push(name);
      failureDetail ||= result.detail;
    } else {
      absent.push(name);
    }
  }
  const nearby = absent.length > 0 ? await listRunningInstanceNames(callRpc) : [];
  if (absent.length > 0) {
    out.locateNotFound = absent;
    out.locateNote =
      "Those names are in neither the running game nor the saved level. A name a script invented at run " +
      "time exists only while the play test is up." +
      (nearby.length > 0 ? ` The running game lists: ${nearby.slice(0, 12).join(", ")}.` : "");
  }
  if (ambiguous.length > 0) {
    out.locateAmbiguous = ambiguous;
    out.locateAmbiguousNote =
      "A name is unique only among siblings, so these each matched more than one instance and the point " +
      "reported is for the one listed. Pass the dotted path instead — locate takes either — to say " +
      "which one you meant.";
  }
  if (failed.length > 0) {
    out.locateUnanswered = failed;
    out.locateUnansweredNote =
      "Looking these up failed, so nothing is known about them — this is not the same as their being " +
      `absent, and they may well be there. The first error was: ${failureDetail}. Retrying is reasonable ` +
      "here, unlike for locateNotFound.";
  }

  const points = [...(locate ?? []), ...named];
  if (points.length > 0) {
    out.located = points.map((point) => {
      const p = projectWorldToScreen(read.camera, read.image, point);
      const screen = point.half ? projectedRect(read, point, point.half) : undefined;
      const onScreen = screen
        ? screen.maxX >= 0 && screen.minX <= 1 && screen.maxY >= 0 && screen.minY <= 1
        : p.onScreen;
      return {
        ...(point.label === undefined ? {} : { label: point.label }),
        world: { x: point.x, y: point.y, z: point.z },
        normalized: { x: round(p.normalized.x, 4), y: round(p.normalized.y, 4) },
        ...(screen ? { screen } : {}),
        onScreen,
      };
    });
  }
  return withCameraAxes(out);
}
