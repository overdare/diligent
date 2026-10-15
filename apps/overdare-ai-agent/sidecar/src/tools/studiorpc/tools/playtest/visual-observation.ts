// @summary Acquires bounded PNG evidence for an owned single-client PIE session without provider-specific capture.
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, sep, win32 } from "node:path";
import type { call } from "../../rpc";
import type { PlaytestFrame } from "./frame";

export interface VisualTarget {
  pieSessionId: string;
  clientId: string;
}
export interface PlaytestVisual {
  dataUrl: string;
  metadata: VisualTarget & {
    capturedAtMs: number;
    stateRevision: number;
    width: number;
    height: number;
    sha256: string;
    camera?: Record<string, unknown>;
    artifactPath?: string;
  };
}
export interface ScreenshotRoots {
  localRoot?: string;
  remoteRoot?: string;
}
export type VisualObserver = (
  frame: PlaytestFrame,
  signal: AbortSignal,
  target: VisualTarget,
) => Promise<PlaytestVisual>;
interface VisualObserverOptions extends ScreenshotRoots {
  callRpc: typeof call;
  clock?: { now(): number };
  directory?: string;
}
const MAX_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function resolveScreenshotPath(file: string, roots: ScreenshotRoots): string {
  if (roots.remoteRoot || roots.localRoot) {
    if (!roots.remoteRoot || !roots.localRoot || !isAbsolute(roots.localRoot))
      throw new Error("Screenshot mapping requires absolute local and remote roots");
    const paths = /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(roots.remoteRoot) ? win32 : posix;
    if (!paths.isAbsolute(file) || !paths.isAbsolute(roots.remoteRoot))
      throw new Error("Screenshot mapping requires absolute paths");
    const suffix = paths.relative(roots.remoteRoot, file);
    if (!suffix || suffix === ".." || suffix.startsWith(`..${paths.sep}`) || paths.isAbsolute(suffix))
      throw new Error("Screenshot is outside the configured remote root");
    return join(roots.localRoot, ...suffix.split(paths.sep));
  }
  if (process.platform !== "win32" && /^(?:[a-z]:[\\/]|\\\\)/i.test(file))
    throw new Error("Studio screenshot is on another host; configure verified screenshot root mapping");
  if (!isAbsolute(file)) throw new Error("Studio screenshot path must be absolute");
  return file;
}

export function createVisualObserver(options: VisualObserverOptions): VisualObserver {
  const now = () => options.clock?.now() ?? performance.now();
  async function verify(target: VisualTarget, signal: AbortSignal) {
    const status = await options.callRpc("game.pie.status", {}, { signal, timeoutMs: 5000 });
    if (
      !record(status) ||
      status.running !== true ||
      status.pieSessionId !== target.pieSessionId ||
      !Array.isArray(status.clients) ||
      status.clients.length !== 1
    )
      throw new Error("Visual capture requires the same owned session and a single client");
    const client = status.clients[0];
    if (
      !record(client) ||
      client.clientId !== target.clientId ||
      client.injectable !== true ||
      client.targeted !== true
    )
      throw new Error("Visual capture client does not match the targeted PIE client");
  }
  return async (frame, signal, target) => {
    signal.throwIfAborted();
    await verify(target, signal);
    const capturedAtMs = now(); // Conservative request-start age; not an atomic Studio/state snapshot.
    const result = await options.callRpc("game.screenshot", { includeGui: true }, { signal, timeoutMs: 10000 });
    await verify(target, signal);
    if (!record(result) || result.success !== true || typeof result.path !== "string" || !record(result.image))
      throw new Error("Studio did not return a readable screenshot capture");
    if (
      (result.clientId !== undefined && result.clientId !== target.clientId) ||
      (result.pieSessionId !== undefined && result.pieSessionId !== target.pieSessionId)
    )
      throw new Error("Screenshot reports another session or client");
    const file = resolveScreenshotPath(result.path, options);
    if (options.localRoot) {
      const suffix = relative(await realpath(options.localRoot), await realpath(file));
      if (suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix))
        throw new Error("Screenshot resolves outside the local shared root");
    }
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_BYTES)
      throw new Error("Screenshot exceeds the 10 MiB image limit or is not a file");
    const bytes = await readFile(file, { signal });
    if (
      bytes.length > MAX_BYTES ||
      bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.toString("ascii", 12, 16) !== "IHDR"
    )
      throw new Error("Screenshot is not supported PNG image data");
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (
      !width ||
      !height ||
      width > 8192 ||
      height > 8192 ||
      result.image.width !== width ||
      result.image.height !== height
    )
      throw new Error("Screenshot dimensions do not match captured image metadata");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let artifactPath: string | undefined;
    if (options.directory) {
      const directory = join(options.directory, "images");
      await mkdir(directory, { recursive: true });
      artifactPath = join(directory, `${sha256}.png`);
      await writeFile(artifactPath, bytes, { signal });
    }
    signal.throwIfAborted();
    return {
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      metadata: {
        ...target,
        capturedAtMs,
        stateRevision: frame.revision,
        width,
        height,
        sha256,
        ...(record(result.camera) ? { camera: result.camera } : {}),
        ...(artifactPath ? { artifactPath } : {}),
      },
    };
  };
}
