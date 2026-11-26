// @summary Tests for MCP OAuth helpers — header precedence, gating, and file token store

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  createConnectOAuthProvider,
  createMcpOAuthHandle,
  FileOAuthStore,
  NeedsAuthError,
  oauthStorePath,
  resolveAuthHeaders,
  shouldUseOAuth,
} from "../../../src/tools/mcp/oauth";
import type { McpHttpServerConfig } from "../../../src/tools/mcp/types";

describe("resolveAuthHeaders", () => {
  test("keeps explicit Authorization header", () => {
    const config: McpHttpServerConfig = { url: "https://x", headers: { Authorization: "Bearer static" } };
    expect(resolveAuthHeaders(config).Authorization).toBe("Bearer static");
  });

  test("injects bearer token from env when no header is set", () => {
    process.env.__MCP_TEST_TOKEN = "abc";
    const config: McpHttpServerConfig = { url: "https://x", bearerTokenEnvVar: "__MCP_TEST_TOKEN" };
    expect(resolveAuthHeaders(config).Authorization).toBe("Bearer abc");
    delete process.env.__MCP_TEST_TOKEN;
  });

  test("explicit header wins over env bearer token", () => {
    process.env.__MCP_TEST_TOKEN = "abc";
    const config: McpHttpServerConfig = {
      url: "https://x",
      headers: { authorization: "Bearer explicit" },
      bearerTokenEnvVar: "__MCP_TEST_TOKEN",
    };
    expect(resolveAuthHeaders(config).authorization).toBe("Bearer explicit");
    expect(resolveAuthHeaders(config).Authorization).toBeUndefined();
    delete process.env.__MCP_TEST_TOKEN;
  });
});

describe("shouldUseOAuth", () => {
  test("false when an Authorization header is present", () => {
    expect(shouldUseOAuth({ url: "https://x", headers: { Authorization: "Bearer s" } })).toBe(false);
  });

  test("false when oauth is explicitly disabled", () => {
    expect(shouldUseOAuth({ url: "https://x", oauth: { enabled: false } })).toBe(false);
  });

  test("true for a plain remote server with no static auth", () => {
    expect(shouldUseOAuth({ url: "https://x" })).toBe(true);
  });
});

describe("FileOAuthStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-oauth-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("round-trips tokens, client info, and code verifier via patch", async () => {
    const store = new FileOAuthStore(join(dir, "srv.json"));
    expect(await store.getTokens()).toBeUndefined();
    await store.patch({ codeVerifier: "verifier" });
    await store.patch({ tokens: { access_token: "at", token_type: "Bearer" } });
    expect(await store.getCodeVerifier()).toBe("verifier");
    expect((await store.getTokens())?.access_token).toBe("at");
  });
});

describe("connect-path OAuth refresh with stored state", () => {
  const serverUrl = "https://mcp.example.test/mcp";
  const issuer = "https://auth.example.test";
  const clientInformation = { client_id: "cid", redirect_uris: ["http://127.0.0.1:8976/callback"] };
  let dir: string;
  let tokenRequests: URLSearchParams[];

  // Resource server advertising a separate authorization server, which refreshes any token.
  const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    if (url.href === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
      return Response.json({ resource: serverUrl, authorization_servers: [issuer] });
    }
    if (url.href === "https://auth.example.test/.well-known/oauth-authorization-server") {
      return Response.json({
        issuer,
        authorization_endpoint: "https://auth.example.test/authorize",
        token_endpoint: "https://auth.example.test/token",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.href === "https://auth.example.test/token" && init?.method === "POST") {
      tokenRequests.push(new URLSearchParams(String(init.body)));
      return Response.json({ access_token: "at-new", token_type: "Bearer", refresh_token: "rt-new", expires_in: 3600 });
    }
    return new Response("not found", { status: 404 });
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-oauth-refresh-"));
    tokenRequests = [];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("refreshes state stored before issuer binding and stores it bound to the issuer", async () => {
    const store = new FileOAuthStore(oauthStorePath(dir, "srv"));
    await store.patch({
      clientInformation,
      tokens: { access_token: "at-old", token_type: "Bearer", refresh_token: "rt-old" },
    });
    const provider = createConnectOAuthProvider("srv", { storeDir: dir, openBrowser: () => {} }, undefined);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await auth(provider, { serverUrl, fetchFn })).toBe("AUTHORIZED");
    } finally {
      warn.mockRestore();
    }

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token");
    expect(tokenRequests[0]?.get("refresh_token")).toBe("rt-old");
    expect(tokenRequests[0]?.get("resource")).toBe(serverUrl);
    const saved = JSON.parse(await readFile(oauthStorePath(dir, "srv"), "utf8"));
    expect(saved.tokens).toMatchObject({ access_token: "at-new", refresh_token: "rt-new", issuer });
    expect(saved.clientInformation).toMatchObject({ client_id: "cid", issuer });
  });

  test("does not present a refresh token bound to another issuer and reports needs-auth", async () => {
    const store = new FileOAuthStore(oauthStorePath(dir, "srv"));
    await store.patch({
      clientInformation,
      tokens: {
        access_token: "at-old",
        token_type: "Bearer",
        refresh_token: "rt-old",
        issuer: "https://old-auth.example.test",
      },
    });
    const provider = createConnectOAuthProvider("srv", { storeDir: dir, openBrowser: () => {} }, undefined);

    await expect(auth(provider, { serverUrl, fetchFn })).rejects.toBeInstanceOf(NeedsAuthError);
    expect(tokenRequests).toHaveLength(0);
  });
});

describe("createMcpOAuthHandle", () => {
  test("provides SDK-compatible client metadata and a loopback redirect", () => {
    const handle = createMcpOAuthHandle(
      "srv",
      { storeDir: "/tmp/none", openBrowser: () => {}, redirectPort: 9999 },
      undefined,
    );
    expect(handle.provider.redirectUrl).toBe("http://127.0.0.1:9999/callback");
    expect(handle.provider.clientMetadata.redirect_uris).toEqual(["http://127.0.0.1:9999/callback"]);
    handle.close();
  });

  test("waitForCallback rejects on timeout", async () => {
    const handle = createMcpOAuthHandle(
      "srv",
      { storeDir: "/tmp/none", openBrowser: () => {}, redirectPort: 9998 },
      undefined,
    );
    await expect(handle.waitForCallback(10)).rejects.toThrow(/timed out/);
    handle.close();
  });

  test("an occupied loopback port surfaces as a login error naming the port", async () => {
    const occupier = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("busy") });
    const port = occupier.port;
    const opened: string[] = [];
    const handle = createMcpOAuthHandle(
      "srv",
      { storeDir: "/tmp/none", openBrowser: (url) => opened.push(url), redirectPort: port },
      undefined,
    );
    try {
      await handle.provider.redirectToAuthorization(new URL("https://auth.example/authorize"));
      expect(opened).toEqual(["https://auth.example/authorize"]);
      await expect(handle.waitForCallback(2000)).rejects.toThrow(
        `MCP OAuth callback server failed: loopback callback port ${port} is already in use (set a free one if needed)`,
      );
    } finally {
      handle.close();
      occupier.stop(true);
    }
  });
});
