// @summary Opt-in dev adapter for agent-mounted image files read by a remote Studio process.

import { posix, win32 } from "node:path";
import { call, StudioRpcError } from "../tools/studiorpc/rpc";

interface DevStudioRpcOptions {
  enabled: boolean;
  localFileRoot?: string;
  remoteFileRoot?: string;
}

const IMAGE_IMPORT = "asset_manager.image.import";

export function createDevStudioRpc(options: DevStudioRpcOptions, callRpc: typeof call = call): typeof call {
  if (!options.enabled) return callRpc;
  const localRoot = options.localFileRoot?.trim();
  const remoteRoot = options.remoteFileRoot?.trim();
  if (!localRoot && !remoteRoot) return callRpc;
  if (
    !localRoot ||
    !remoteRoot ||
    !pathStyle(localRoot).isAbsolute(localRoot) ||
    !pathStyle(remoteRoot).isAbsolute(remoteRoot)
  ) {
    throw new Error(
      "Set STUDIO_LOCAL_FILE_ROOT and STUDIO_REMOTE_FILE_ROOT together to absolute shared-directory paths.",
    );
  }

  return async (method, params, rpcOptions) => {
    if (method !== IMAGE_IMPORT || typeof params?.file !== "string") return callRpc(method, params, rpcOptions);
    rpcOptions?.signal?.throwIfAborted();
    const file = mapSharedImagePath(params.file, localRoot, remoteRoot);
    try {
      return await callRpc(method, { ...params, file }, { ...rpcOptions, timeoutMs: rpcOptions?.timeoutMs ?? 120_000 });
    } catch (error) {
      rpcOptions?.signal?.throwIfAborted();
      if (!(error instanceof StudioRpcError) || error.code !== -32008) throw error;
      throw new StudioRpcError(
        `${error.message}\n\nStudio-side image path: ${file}\n` +
          "Studio reads the file on its own computer. Verify that this shared path is accessible there. " +
          "Invalid file does not prove an image-format problem. Keep the import step blocked and report the error. " +
          "Do not substitute template icons or change image format without evidence and user approval.",
        error.code,
        error.data,
      );
    }
  };
}

function pathStyle(path: string): typeof posix {
  return /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(path) ? win32 : posix;
}

function pathWithinRoot(file: string, root: string, paths: typeof posix): string | undefined {
  if (!paths.isAbsolute(file)) return undefined;
  const relative = paths.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative))
    return undefined;
  return relative;
}

function mapSharedImagePath(file: string, localRoot: string, remoteRoot: string): string {
  const local = pathStyle(localRoot);
  const remote = pathStyle(remoteRoot);
  const relative = pathWithinRoot(file, localRoot, local);
  if (relative !== undefined) return remote.join(remoteRoot, ...relative.split(local.sep));
  if (pathWithinRoot(file, remoteRoot, remote) !== undefined) return remote.normalize(file);
  throw new Error(
    "Image file is outside the configured dev shared file roots. " +
      "Use a file inside STUDIO_LOCAL_FILE_ROOT or its mapped STUDIO_REMOTE_FILE_ROOT. " +
      "Keep the import step blocked; do not substitute another asset or change image format.",
  );
}
