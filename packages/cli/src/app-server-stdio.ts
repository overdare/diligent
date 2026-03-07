// @summary CLI app-server child mode that serves raw JSON-RPC over stdio using NDJSON framing

import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import { format } from "node:util";
import {
  bindAppServer,
  createNdjsonParser,
  createPermissionEngine,
  createYoloPermissionEngine,
  DiligentAppServer,
  type DiligentPaths,
  ensureDiligentDir,
  formatNdjsonMessage,
  type ModeKind,
  type RpcPeer,
} from "@diligent/core";
import type { JSONRPCMessage } from "@diligent/protocol";
import { type AppConfig, loadConfig } from "./config";
import { buildTools } from "./tui/tools";

export interface AppServerStdioOptions {
  cwd: string;
  yolo?: boolean;
}

export async function createCliAppServer(options: AppServerStdioOptions): Promise<DiligentAppServer> {
  const paths = await ensureDiligentDir(options.cwd);
  const config = await loadCliConfig(options, paths);
  const permissionEngine = config.diligent.yolo
    ? createYoloPermissionEngine()
    : createPermissionEngine(config.diligent.permissions ?? []);

  return new DiligentAppServer({
    resolvePaths: async (cwd) => ensureDiligentDir(cwd),
    buildAgentConfig: async ({ cwd, mode, effort, signal, approve, ask, getSessionId }) => {
      const deps = {
        model: config.model,
        systemPrompt: config.systemPrompt,
        streamFunction: config.streamFunction,
        getParentSessionId: getSessionId,
        ask,
      };
      const { tools, registry } = await buildTools(cwd, paths, deps, config.diligent.tools);

      return {
        model: config.model,
        systemPrompt: config.systemPrompt,
        tools,
        streamFunction: config.streamFunction,
        mode: mode as ModeKind,
        effort,
        signal,
        approve,
        ask,
        permissionEngine,
        registry,
      };
    },
    compaction: config.compaction,
  });
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

async function loadCliConfig(options: AppServerStdioOptions, paths: DiligentPaths): Promise<AppConfig> {
  const config = await loadConfig(options.cwd, paths);
  if (options.yolo) {
    config.diligent = { ...config.diligent, yolo: true };
  }
  return config;
}

export function redirectConsoleToStderr(): void {
  const write = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };

  console.log = write as typeof console.log;
  console.info = write as typeof console.info;
  console.debug = write as typeof console.debug;
}
