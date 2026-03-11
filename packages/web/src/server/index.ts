// @summary Bun server entrypoint for Web CLI with /rpc WebSocket, persisted image routes, and static file hosting
import { createWriteStream, existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import {
  type AgentRegistry,
  createAppServerConfig,
  DiligentAppServer,
  type DiligentPaths,
  ensureDiligentDir,
  getModelInfoList,
  loadRuntimeConfig,
  type PROVIDER_NAMES,
  type RpcPeer,
} from "@diligent/core";
import type { JSONRPCMessage } from "@diligent/protocol";
import { JSONRPCMessageSchema } from "@diligent/protocol";
import type { ServerWebSocket } from "bun";
import { decodeWebImageRelativePath, toWebImageUrl, WEB_IMAGE_ROUTE_PREFIX } from "../shared/image-routes";

interface WsData {
  connectionId: string;
}

interface CreateServerOptions {
  port?: number;
  dev?: boolean;
  cwd?: string;
  distDir?: string;
}

interface ParsedArgs {
  port?: number;
  dev: boolean;
  distDir?: string;
  cwd?: string;
  logFile?: string;
}

export async function createWebServer(options: CreateServerOptions = {}): Promise<{
  server: Bun.Server<WsData>;
  stop: () => void;
}> {
  const cwd = options.cwd ?? process.cwd();
  const port = options.port ?? 7433;
  const dev = options.dev ?? false;

  const paths = await ensureDiligentDir(cwd);
  const runtimeConfig = await loadRuntimeConfig(cwd, paths);

  let registry: AgentRegistry | undefined;

  const baseConfig = createAppServerConfig({
    cwd,
    runtimeConfig,
    overrides: {
      toImageUrl: (absPath) => toWebImageUrl(absPath),
      getInitializeResult: async () => ({
        cwd,
        mode: runtimeConfig.mode,
        effort: runtimeConfig.effort,
        currentModel: runtimeConfig.model?.id,
        availableModels: getModelInfoList().filter((m) =>
          runtimeConfig.providerManager
            .getConfiguredProviders()
            .includes(m.provider as (typeof PROVIDER_NAMES)[number]),
        ),
        skills: runtimeConfig.skills.map((s) => ({
          name: s.name,
          description: s.description,
        })),
      }),
    },
  });

  // Wrap buildAgentConfig to capture registry for shutdown
  const origBuild = baseConfig.buildAgentConfig;
  baseConfig.buildAgentConfig = async (args) => {
    const result = await origBuild(args);
    if (result.registry) registry = result.registry;
    return result;
  };

  const appServer = new DiligentAppServer(baseConfig);

  // Map from connectionId → peer receive function, for routing WS messages
  const peerReceivers = new Map<string, (raw: string | Buffer) => void>();

  const distDir = options.distDir ?? resolveDistDir();
  const hasDist = existsSync(distDir);

  const server = Bun.serve<WsData>({
    port,
    fetch(req, bunServer) {
      const url = new URL(req.url);

      if (url.pathname === "/rpc") {
        const connectionId = `web-${crypto.randomUUID().slice(0, 8)}`;
        const upgraded = bunServer.upgrade(req, { data: { connectionId } });
        if (upgraded) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (url.pathname === "/health") {
        return Response.json({ ok: true });
      }

      if (url.pathname.startsWith(WEB_IMAGE_ROUTE_PREFIX)) {
        const image = resolvePersistedImage(url.pathname, paths);
        if (!image) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(Bun.file(image.path), {
          headers: {
            "Content-Type": image.mediaType,
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      if (!dev && hasDist) {
        let filePath = join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
        if (!existsSync(filePath)) {
          filePath = join(distDir, "index.html");
        }

        if (existsSync(filePath)) {
          return new Response(Bun.file(filePath));
        }
      }

      if (dev) {
        return new Response("Web server is running in --dev mode. Start Vite separately on :5174", { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        const { peer, receive } = createWsPeer(ws);
        peerReceivers.set(ws.data.connectionId, receive);
        appServer.connect(ws.data.connectionId, peer);
      },
      message(ws, raw) {
        peerReceivers.get(ws.data.connectionId)?.(raw);
      },
      close(ws) {
        peerReceivers.delete(ws.data.connectionId);
        appServer.disconnect(ws.data.connectionId);
      },
    },
  });

  return {
    server,
    stop: () => {
      registry?.shutdownAll().catch(() => {});
      server.stop();
    },
  };
}

/** Create a transport-neutral RpcPeer backed by a Bun WebSocket */
function createWsPeer(ws: ServerWebSocket<WsData>): {
  peer: RpcPeer;
  receive: (raw: string | Buffer) => void;
} {
  const listeners: Array<(msg: JSONRPCMessage) => void | Promise<void>> = [];

  const peer: RpcPeer = {
    send(message: JSONRPCMessage): void {
      ws.send(JSON.stringify(message));
    },
    onMessage(listener: (msg: JSONRPCMessage) => void | Promise<void>): void {
      listeners.push(listener);
    },
  };

  const receive = (raw: string | Buffer): void => {
    let parsed: JSONRPCMessage;
    try {
      parsed = JSONRPCMessageSchema.parse(JSON.parse(typeof raw === "string" ? raw : raw.toString()));
    } catch {
      ws.send(JSON.stringify({ id: "unknown", error: { code: -32700, message: "Malformed JSON" } }));
      return;
    }
    for (const listener of listeners) {
      void listener(parsed);
    }
  };

  return { peer, receive };
}

function resolveDistDir(): string {
  // Compiled binary: dist/client sits next to the binary executable
  const candidate = resolve(dirname(process.execPath), "dist", "client");
  if (existsSync(candidate)) return candidate;
  // Dev fallback: relative to source file
  return resolve(import.meta.dir, "../../dist/client");
}

function resolvePersistedImage(pathname: string, paths: DiligentPaths): { path: string; mediaType: string } | null {
  const relativePath = decodeWebImageRelativePath(pathname);
  if (!relativePath) {
    return null;
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const fullPath = resolve(paths.root, "images", ...segments);
  const imageRoot = resolve(paths.root, "images");
  const expectedPrefix = `${imageRoot}${sep}`;
  if (fullPath !== imageRoot && !fullPath.startsWith(expectedPrefix)) {
    return null;
  }
  if (!existsSync(fullPath)) {
    return null;
  }

  let resolvedPath: string;
  let resolvedRoot: string;
  try {
    resolvedPath = realpathSync(fullPath);
    resolvedRoot = realpathSync(imageRoot);
  } catch {
    return null;
  }

  const resolvedPrefix = `${resolvedRoot}${sep}`;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedPrefix)) {
    return null;
  }

  return {
    path: resolvedPath,
    mediaType: inferImageMediaType(resolvedPath),
  };
}

function inferImageMediaType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

function enableProcessLogFile(logFile: string, baseDir: string): () => void {
  const resolvedPath = resolve(baseDir, logFile);
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const stream = createWriteStream(resolvedPath, { flags: "a" });
  const originalStdoutWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  const originalStderrWrite = process.stderr.write.bind(process.stderr) as typeof process.stderr.write;

  let mirrorEnabled = true;
  let reportedStreamError = false;

  const reportStreamError = (error: unknown): void => {
    if (reportedStreamError) return;
    reportedStreamError = true;
    mirrorEnabled = false;
    const message = error instanceof Error ? error.message : String(error);
    originalStderrWrite(`[webserver-log] Failed to write log file ${resolvedPath}: ${message}\n`);
  };

  stream.on("error", reportStreamError);

  const mirrorWrite = (chunk: unknown, encoding?: unknown): void => {
    if (!mirrorEnabled) return;
    try {
      if (typeof chunk === "string") {
        if (typeof encoding === "string") {
          stream.write(chunk, encoding as BufferEncoding);
        } else {
          stream.write(chunk);
        }
        return;
      }
      if (chunk instanceof Uint8Array) {
        stream.write(chunk);
        return;
      }
      stream.write(String(chunk));
    } catch (error) {
      reportStreamError(error);
    }
  };

  process.stdout.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
    mirrorWrite(chunk, typeof encoding === "function" ? undefined : encoding);
    return originalStdoutWrite(chunk as never, encoding as never, cb as never);
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
    mirrorWrite(chunk, typeof encoding === "function" ? undefined : encoding);
    return originalStderrWrite(chunk as never, encoding as never, cb as never);
  }) as typeof process.stderr.write;

  originalStdoutWrite(`[webserver-log] Mirroring stdout/stderr to ${resolvedPath}\n`);

  return () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    stream.end();
  };
}

export function parseArgs(argv: string[]): ParsedArgs {
  const portArg = argv.find((arg) => arg.startsWith("--port="));
  const port = portArg ? Number.parseInt(portArg.split("=")[1], 10) : undefined;
  const dev = argv.includes("--dev");
  const distArg = argv.find((arg) => arg.startsWith("--dist-dir="));
  const distDir = distArg ? distArg.split("=")[1] : undefined;
  const cwdArg = argv.find((arg) => arg.startsWith("--cwd="));
  const cwd = cwdArg ? cwdArg.split("=")[1] : undefined;
  const logFileArg = argv.find((arg) => arg.startsWith("--log-file="));
  const logFile = logFileArg ? logFileArg.slice("--log-file=".length) : undefined;
  return { port: Number.isFinite(port) ? port : undefined, dev, distDir, cwd, logFile };
}

const isDirect = import.meta.main;

if (isDirect) {
  // Global safety net: plugins or internal code may throw uncaught errors or
  // unhandled promise rejections (e.g. Bun happy-eyeballs socket errors that
  // bypass user-level handlers).  Log and swallow — never crash the server.
  process.on("uncaughtException", (err) => {
    console.error("[Server] Uncaught exception (swallowed to keep server alive):", err?.message ?? err);
  });
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error("[Server] Unhandled promise rejection (swallowed to keep server alive):", message);
  });

  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const cwd = process.cwd();
    const serverCwd = args.cwd ?? cwd;
    const logFile = args.logFile ?? process.env.DILIGENT_WEB_LOG_FILE;
    const cleanupLogFile = logFile ? enableProcessLogFile(logFile, serverCwd) : null;

    createWebServer({
      port: args.port,
      dev: args.dev,
      cwd: serverCwd,
      distDir: args.distDir,
    })
      .then(({ server }) => {
        console.log(`DILIGENT_PORT=${server.port}`);
        console.log(`Diligent Web CLI server running at http://localhost:${server.port}`);
        console.log(`RPC endpoint: ws://localhost:${server.port}/rpc`);
      })
      .catch((error) => {
        cleanupLogFile?.();
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to start web server: ${message}`);
        process.exit(1);
      });
  })();
}

export type { DiligentPaths };
