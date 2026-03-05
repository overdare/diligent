// @summary Bun server entrypoint for Web CLI with /rpc WebSocket and static file hosting
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type AgentRegistry,
  DiligentAppServer,
  type DiligentAppServerConfig,
  type DiligentPaths,
  ensureDiligentDir,
  KNOWN_MODELS,
  loadRuntimeConfig,
  type ModeKind,
  type PROVIDER_NAMES,
  resolveModel,
} from "@diligent/core";
import { RpcBridge, type RpcWsData } from "./rpc-bridge";
import { buildTools } from "./tools";

interface CreateServerOptions {
  port?: number;
  dev?: boolean;
  cwd?: string;
  distDir?: string;
}

export async function createWebServer(options: CreateServerOptions = {}): Promise<{
  server: Bun.Server<RpcWsData>;
  stop: () => void;
}> {
  const cwd = options.cwd ?? process.cwd();
  const port = options.port ?? 7433;
  const dev = options.dev ?? false;

  const paths = await ensureDiligentDir(cwd);
  const runtimeConfig = await loadRuntimeConfig(cwd, paths);

  let registry: AgentRegistry | undefined;

  const appServerConfig: DiligentAppServerConfig = {
    cwd,
    resolvePaths: async (requestCwd) => ensureDiligentDir(requestCwd),
    buildAgentConfig: ({ cwd: requestCwd, mode, signal, approve, ask, getSessionId }) => {
      if (!runtimeConfig.model) {
        throw new Error("No AI provider configured. Please add an API key in the provider settings.");
      }

      const deps = {
        model: runtimeConfig.model,
        systemPrompt: runtimeConfig.systemPrompt,
        streamFunction: runtimeConfig.streamFunction,
        getParentSessionId: getSessionId,
        ask,
      };
      const result = buildTools(requestCwd, paths, deps);
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
        registry: result.registry,
      };
    },
    compaction: runtimeConfig.compaction,
  };

  const allModels = KNOWN_MODELS.map((m) => ({
    id: m.id,
    provider: m.provider,
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    inputCostPer1M: m.inputCostPer1M,
    outputCostPer1M: m.outputCostPer1M,
    supportsThinking: m.supportsThinking,
  }));

  const appServer = new DiligentAppServer(appServerConfig);
  const bridge = new RpcBridge(
    appServer,
    cwd,
    runtimeConfig.mode,
    {
      currentModelId: runtimeConfig.model?.id,
      allModels,
      getAvailableModels: () => {
        const configured = runtimeConfig.providerManager.getConfiguredProviders();
        return allModels.filter((m) => configured.includes(m.provider as (typeof PROVIDER_NAMES)[number]));
      },
      onModelChange: (modelId) => {
        runtimeConfig.model = resolveModel(modelId);
      },
    },
    runtimeConfig.providerManager,
  );

  const distDir = options.distDir ?? resolveDistDir();
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

function resolveDistDir(): string {
  // Compiled binary: dist/client sits next to the binary executable
  const candidate = resolve(dirname(process.execPath), "dist", "client");
  if (existsSync(candidate)) return candidate;
  // Dev fallback: relative to source file
  return resolve(import.meta.dir, "../../dist/client");
}

function parseArgs(argv: string[]): { port?: number; dev: boolean; distDir?: string; cwd?: string } {
  const portArg = argv.find((arg) => arg.startsWith("--port="));
  const port = portArg ? Number.parseInt(portArg.split("=")[1], 10) : undefined;
  const dev = argv.includes("--dev");
  const distArg = argv.find((arg) => arg.startsWith("--dist-dir="));
  const distDir = distArg ? distArg.split("=")[1] : undefined;
  const cwdArg = argv.find((arg) => arg.startsWith("--cwd="));
  const cwd = cwdArg ? cwdArg.split("=")[1] : undefined;
  return { port: Number.isFinite(port) ? port : undefined, dev, distDir, cwd };
}

const isDirect = process.argv[1] && import.meta.path.endsWith(process.argv[1]);

if (isDirect) {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  createWebServer({
    port: args.port,
    dev: args.dev,
    cwd: args.cwd ?? cwd,
    distDir: args.distDir,
  })
    .then(({ server }) => {
      console.log(`DILIGENT_PORT=${server.port}`);
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
