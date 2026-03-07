// @summary CLI app-server child mode that serves raw JSON-RPC over stdio using NDJSON framing

import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import { format } from "node:util";
import {
  bindAppServer,
  createAppServerConfig,
  createNdjsonParser,
  createYoloPermissionEngine,
  DiligentAppServer,
  ensureDiligentDir,
  formatNdjsonMessage,
  loadRuntimeConfig,
  openBrowser,
  type RpcPeer,
} from "@diligent/core";
import type { JSONRPCMessage } from "@diligent/protocol";

export interface AppServerStdioOptions {
  cwd: string;
  yolo?: boolean;
}

export async function createCliAppServer(options: AppServerStdioOptions): Promise<DiligentAppServer> {
  const paths = await ensureDiligentDir(options.cwd);
  const runtimeConfig = await loadRuntimeConfig(options.cwd, paths);

  if (options.yolo) {
    runtimeConfig.permissionEngine = createYoloPermissionEngine();
  }

  const config = createAppServerConfig({
    cwd: options.cwd,
    runtimeConfig,
    overrides: { openBrowser },
  });
  return new DiligentAppServer(config);
}

export function createStdioPeer(input: Readable, output: Writable): RpcPeer {
  let messageListener: ((message: JSONRPCMessage) => void | Promise<void>) | null = null;
  let closeListener: ((error?: Error) => void) | null = null;
  let closed = false;

  const closeWith = (error?: unknown): void => {
    if (closed) return;
    closed = true;
    if (error instanceof Error) {
      closeListener?.(error);
      return;
    }
    if (error !== undefined) {
      closeListener?.(new Error(String(error)));
      return;
    }
    closeListener?.();
  };

  const parser = createNdjsonParser((message) => {
    if (!messageListener) return;
    Promise.resolve(messageListener(message)).catch((error) => {
      closeWith(error);
    });
  });

  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    try {
      parser.push(chunk);
    } catch (error) {
      closeWith(error);
    }
  });
  input.on("end", () => {
    try {
      parser.end();
      closeWith();
    } catch (error) {
      closeWith(error);
    }
  });
  input.on("error", (error) => {
    closeWith(error);
  });

  return {
    onMessage(listener) {
      messageListener = listener;
    },
    onClose(listener) {
      closeListener = listener;
    },
    async send(message) {
      if (closed) {
        throw new Error("stdio peer is closed");
      }

      const frame = formatNdjsonMessage(message);
      if (output.write(frame)) {
        return;
      }
      await once(output, "drain");
    },
  };
}

export async function runAppServerStdio(options: AppServerStdioOptions): Promise<never> {
  redirectConsoleToStderr();
  const appServer = await createCliAppServer(options);
  const peer = createStdioPeer(process.stdin, process.stdout);
  const stop = bindAppServer(appServer, peer);

  const shutdown = (exitCode: number, error?: unknown): never => {
    stop();
    if (error !== undefined) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(exitCode);
    }
    process.exit(exitCode);
  };

  peer.onClose?.((error) => {
    if (error) {
      shutdown(1, error);
    }
    shutdown(0);
  });

  process.stdin.on("end", () => {
    shutdown(0);
  });
  process.stdin.on("close", () => {
    shutdown(0);
  });
  process.stdin.resume();

  return await new Promise<never>(() => {});
}

export function redirectConsoleToStderr(): void {
  const write = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };

  console.log = write as typeof console.log;
  console.info = write as typeof console.info;
  console.debug = write as typeof console.debug;
}
