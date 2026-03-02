// @summary Bun server entrypoint for Web CLI with /rpc WebSocket and static file hosting
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type AgentRegistry,
  DiligentAppServer,
  type DiligentAppServerConfig,
  type DiligentPaths,
  ensureDiligentDir,
  type ModeKind,
} from "@diligent/core";
import { loadWebRuntimeConfig } from "./app-config";
import { RpcBridge, type RpcWsData } from "./rpc-bridge";
import { buildTools } from "./tools";

interface CreateServerOptions {
  port?: number;
  dev?: boolean;
  cwd?: string;
}

export async function createWebServer(options: CreateServerOptions = {}): Promise<{
  server: Bun.Server<RpcWsData>;
  stop: () => void;
}> {
  const cwd = options.cwd ?? process.cwd();
  const port = options.port ?? 7433;
  const dev = options.dev ?? false;

  const paths = await ensureDiligentDir(cwd);
  const runtimeConfig = await loadWebRuntimeConfig(cwd, paths);

  let registry: AgentRegistry | undefined;

  const appServerConfig: DiligentAppServerConfig = {
    resolvePaths: async (requestCwd) => ensureDiligentDir(requestCwd),
    buildAgentConfig: ({ cwd: requestCwd, mode, signal, approve, ask }) => {
      const deps = {
        model: runtimeConfig.model,
        systemPrompt: runtimeConfig.systemPrompt,
        streamFunction: runtimeConfig.streamFunction,
      };
      const result = buildTools(requestCwd, paths, deps, deps);
      if (result.registry) {
        registry = result.registry;
      }

      return {
        model: runtimeConfig.model,
        systemPrompt: runtimeConfig.systemPrompt,
        tools: result.tools,
        streamFunction: runtimeConfig.streamFunction,
        mode: mode as ModeKind,
        signal,
        approve,
        ask,
        permissionEngine: runtimeConfig.permissionEngine,
      };
    },
    compaction: runtimeConfig.compaction,
  };

  const appServer = new DiligentAppServer(appServerConfig);
  const bridge = new RpcBridge(appServer, cwd, runtimeConfig.mode);

  const distDir = resolve(import.meta.dir, "../../dist/client");
  const hasDist = existsSync(distDir);

  const server = Bun.serve<RpcWsData>({
    port,
    fetch(req, bunServer) {
      const url = new URL(req.url);

      if (url.pathname === "/rpc") {
        const sessionId = `web-${crypto.randomUUID().slice(0, 8)}`;
        const upgraded = bunServer.upgrade(req, {
          data: { sessionId },
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (url.pathname === "/health") {
        return Response.json({ ok: true });
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
        bridge.open(ws);
      },
      async message(ws, message) {
        await bridge.message(ws, message);
      },
      close(ws) {
        bridge.close(ws);
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

function parseArgs(argv: string[]): { port?: number; dev: boolean } {
  const portArg = argv.find((arg) => arg.startsWith("--port="));
  const port = portArg ? Number.parseInt(portArg.split("=")[1], 10) : undefined;
  const dev = argv.includes("--dev");
  return { port: Number.isFinite(port) ? port : undefined, dev };
}

const isDirect = process.argv[1] && import.meta.path.endsWith(process.argv[1]);

if (isDirect) {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  createWebServer({
    port: args.port,
    dev: args.dev,
    cwd,
  })
    .then(({ server }) => {
      console.log(`Diligent Web CLI server running at http://localhost:${server.port}`);
      console.log(`RPC endpoint: ws://localhost:${server.port}/rpc`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to start web server: ${message}`);
      process.exit(1);
    });
}

export type { DiligentPaths };
