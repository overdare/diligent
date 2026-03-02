// @summary Bun server entrypoint for Web CLI with /rpc WebSocket and static file hosting
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  type AgentRegistry,
  type AuthProviderName,
  buildOAuthTokens,
  DiligentAppServer,
  type DiligentAppServerConfig,
  type DiligentPaths,
  ensureDiligentDir,
  exchangeCodeForTokens,
  generatePKCE,
  KNOWN_MODELS,
  loadAuthStore,
  loadOAuthTokens,
  type ModeKind,
  removeAuthKey,
  removeOAuthTokens,
  resolveModel,
  saveAuthKey,
  saveOAuthTokens,
  waitForCallback,
} from "@diligent/core";
import { loadWebRuntimeConfig } from "./app-config";
import type { OAuthStartResult, OAuthStatusResult, ProviderAuthStatus } from "../shared/ws-protocol";
import { type AuthCallbacks, RpcBridge, type RpcWsData } from "./rpc-bridge";
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
  const runtimeConfig = await loadWebRuntimeConfig(cwd, paths);

  let registry: AgentRegistry | undefined;

  const appServerConfig: DiligentAppServerConfig = {
    resolvePaths: async (requestCwd) => ensureDiligentDir(requestCwd),
    buildAgentConfig: ({ cwd: requestCwd, mode, signal, approve, ask }) => {
      if (!runtimeConfig.model) {
        throw new Error("No AI provider configured. Please add an API key in the provider settings.");
      }

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

  const PROVIDERS = ["anthropic", "openai", "gemini"] as const;

  // OAuth flow state
  const AUTH_URL = "https://auth.openai.com/oauth/authorize";
  const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
  const REDIRECT_URI = "http://localhost:1455/auth/callback";
  const SCOPES = "openid profile email offline_access";

  let oauthFlowStatus: OAuthStatusResult = { status: "idle" };
  let oauthPending: Promise<void> | null = null;

  const authCallbacks: AuthCallbacks = {
    list: async () => {
      const keys = await loadAuthStore();
      const oauthTokens = await loadOAuthTokens();
      return PROVIDERS.map((p): ProviderAuthStatus => ({
        provider: p,
        configured: Boolean(keys[p]),
        maskedKey: keys[p] ? maskKey(keys[p] as string) : undefined,
        oauthConnected: p === "openai" ? Boolean(oauthTokens) : undefined,
      }));
    },
    set: async (provider, apiKey) => {
      await saveAuthKey(provider as AuthProviderName, apiKey);
      runtimeConfig.providerManager.setApiKey(provider as AuthProviderName, apiKey);
    },
    remove: async (provider) => {
      await removeAuthKey(provider as AuthProviderName);
      runtimeConfig.providerManager.removeApiKey(provider as AuthProviderName);
      if (provider === "openai") {
        await removeOAuthTokens();
        runtimeConfig.providerManager.removeOAuthTokens();
      }
    },
    oauthStart: async (): Promise<OAuthStartResult> => {
      if (oauthPending) {
        throw new Error("OAuth flow already in progress");
      }

      const { codeVerifier, codeChallenge } = generatePKCE();
      const state = randomBytes(16).toString("hex");

      const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        originator: "diligent",
        state,
      });

      const authUrl = `${AUTH_URL}?${params}`;

      oauthFlowStatus = { status: "pending" };
      oauthPending = (async () => {
        try {
          const { code } = await waitForCallback(state, 5 * 60 * 1000);
          const rawTokens = await exchangeCodeForTokens(code, codeVerifier);
          const tokens = buildOAuthTokens(rawTokens);
          await saveOAuthTokens(tokens);
          runtimeConfig.providerManager.setOAuthTokens(tokens);
          oauthFlowStatus = { status: "completed" };
        } catch (e) {
          oauthFlowStatus = {
            status: "expired",
            error: e instanceof Error ? e.message : "OAuth flow failed",
          };
        } finally {
          oauthPending = null;
        }
      })();

      return { authUrl };
    },
    oauthStatus: async (): Promise<OAuthStatusResult> => {
      return oauthFlowStatus;
    },
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
  const bridge = new RpcBridge(appServer, cwd, runtimeConfig.mode, {
    currentModelId: runtimeConfig.model?.id,
    allModels,
    getAvailableModels: () => {
      const configured = runtimeConfig.providerManager.getConfiguredProviders();
      return allModels.filter((m) => configured.has(m.provider as "anthropic" | "openai" | "gemini"));
    },
    onModelChange: (modelId) => {
      runtimeConfig.model = resolveModel(modelId);
    },
  }, authCallbacks);

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

function maskKey(key: string): string {
  if (key.length <= 11) return "***";
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
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
