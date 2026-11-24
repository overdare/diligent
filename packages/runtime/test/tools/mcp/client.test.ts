// @summary Tests for McpConnectionManager — signature reuse, dispose, error isolation, call mapping

import { describe, expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { McpConnectionManager, type McpTransportFactory } from "../../../src/tools/mcp/client";
import { NeedsAuthError } from "../../../src/tools/mcp/oauth";
import type { McpServerConfig } from "../../../src/tools/mcp/types";

function buildServer(name: string): McpServer {
  const server = new McpServer({ name, version: "1.0.0" });
  server.registerTool(
    "echo",
    { description: "Echo text back", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
    async ({ text }) => ({ content: [{ type: "text", text: `echo:${text}` }] }),
  );
  return server;
}

function countingFactory(): { factory: McpTransportFactory; connects: () => number; failFor?: Set<string> } {
  let connects = 0;
  const state = { failFor: new Set<string>() };
  const factory: McpTransportFactory = async (name): Promise<Transport> => {
    if (state.failFor.has(name)) throw new Error(`boom:${name}`);
    connects += 1;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await buildServer(name).connect(serverTransport);
    return clientTransport;
  };
  return Object.assign({ factory, connects: () => connects }, state);
}

const stdioConfig: McpServerConfig = { command: "irrelevant", args: [] };

/** Return a wire result verbatim, including extensions the fixture server's SDK does not know yet. */
function managerReturning(raw: Record<string, unknown>): McpConnectionManager {
  return new McpConnectionManager(async () => {
    const server = buildServer("results");
    const [client, transport] = InMemoryTransport.createLinkedPair();
    const send = transport.send.bind(transport);
    transport.send = (message, options) =>
      send(
        "result" in message && Array.isArray(message.result.content) ? { ...message, result: raw } : message,
        options,
      );
    await server.connect(transport);
    return client;
  });
}

describe("McpConnectionManager.sync", () => {
  test("connects once and lists tools", async () => {
    const f = countingFactory();
    const manager = new McpConnectionManager(f.factory);
    const runtimes = await manager.sync({ github: stdioConfig });
    expect(runtimes).toHaveLength(1);
    expect(runtimes[0]).toMatchObject({ name: "github", status: "connected" });
    expect(runtimes[0].tools.map((t) => t.name)).toContain("echo");
    expect(runtimes[0].tools[0].readOnly).toBe(true);
    await manager.disposeAll();
  });

  test("reuses connection on identical signature", async () => {
    const f = countingFactory();
    const manager = new McpConnectionManager(f.factory);
    await manager.sync({ github: stdioConfig });
    await manager.sync({ github: stdioConfig });
    expect(f.connects()).toBe(1);
    await manager.disposeAll();
  });

  test("reconnects when transport signature changes", async () => {
    const f = countingFactory();
    const manager = new McpConnectionManager(f.factory);
    await manager.sync({ github: stdioConfig });
    await manager.sync({ github: { command: "irrelevant", args: ["--changed"] } });
    expect(f.connects()).toBe(2);
    await manager.disposeAll();
  });

  test("isolates a failing server without affecting others", async () => {
    const f = countingFactory();
    f.failFor.add("bad");
    const manager = new McpConnectionManager(f.factory);
    const runtimes = await manager.sync({ bad: stdioConfig, good: stdioConfig });
    const bad = runtimes.find((r) => r.name === "bad");
    const good = runtimes.find((r) => r.name === "good");
    expect(bad?.status).toBe("error");
    expect(bad?.error).toContain("boom:bad");
    expect(good?.status).toBe("connected");
    await manager.disposeAll();
  });

  test("coalesces concurrent syncs into a single connect (no double OAuth/login)", async () => {
    let connects = 0;
    const slowFactory: McpTransportFactory = async (name): Promise<Transport> => {
      connects += 1;
      await new Promise((r) => setTimeout(r, 30));
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await buildServer(name).connect(serverTransport);
      return clientTransport;
    };
    const manager = new McpConnectionManager(slowFactory);
    const [a, b] = await Promise.all([manager.sync({ github: stdioConfig }), manager.sync({ github: stdioConfig })]);
    expect(connects).toBe(1);
    expect(a[0].status).toBe("connected");
    expect(b[0].status).toBe("connected");
    await manager.disposeAll();
  });

  test("surfaces needs_auth (never opens a browser) when the provider requires login", async () => {
    // The connect-path OAuth provider throws NeedsAuthError instead of launching a browser;
    // a raw 401/UnauthorizedError from the transport is treated the same way.
    const authFactory: McpTransportFactory = (name): Transport => {
      throw new NeedsAuthError(name);
    };
    const manager = new McpConnectionManager(authFactory);
    const runtimes = await manager.sync({ atlassian: { url: "https://example.test/mcp" } });
    expect(runtimes[0]).toMatchObject({ name: "atlassian", status: "needs_auth" });
    expect(runtimes[0].tools).toHaveLength(0);
    await manager.disposeAll();
  });

  test("maps a raw 401/UnauthorizedError to needs_auth", async () => {
    const unauthorizedFactory: McpTransportFactory = (): Transport => {
      const error = new Error("HTTP 401 Unauthorized");
      error.name = "UnauthorizedError";
      throw error;
    };
    const manager = new McpConnectionManager(unauthorizedFactory);
    const runtimes = await manager.sync({ atlassian: { url: "https://example.test/mcp" } });
    expect(runtimes[0].status).toBe("needs_auth");
    await manager.disposeAll();
  });

  test("maps an OAuth invalid_token transport error to needs_auth (not a hard error)", async () => {
    // Atlassian surfaces expired/invalid tokens as a plain transport error, not a clean 401.
    const invalidTokenFactory: McpTransportFactory = (): Transport => {
      throw new Error(
        'Streamable HTTP error: Error POSTing to endpoint: {"error":"invalid_token","error_description":"Missing or invalid access token"}',
      );
    };
    const manager = new McpConnectionManager(invalidTokenFactory);
    const runtimes = await manager.sync({ atlassian: { url: "https://example.test/mcp" } });
    expect(runtimes[0].status).toBe("needs_auth");
    await manager.disposeAll();
  });

  // A transport whose `start()` rejects — models a server rejecting the token during the connect
  // handshake (not at transport construction, which does no network I/O).
  function startFailingTransport(message: string): Transport {
    return {
      async start() {
        throw new Error(message);
      },
      async send() {},
      async close() {},
    } as unknown as Transport;
  }

  test("silently refreshes tokens and reconnects when a server rejects with invalid_token", async () => {
    // Atlassian rejects an expired token with a non-401 body; the SDK won't auto-refresh, so the
    // manager must force a refresh via the injected auth() and reconnect once.
    let attempts = 0;
    const failThenSucceed: McpTransportFactory = async (name): Promise<Transport> => {
      attempts += 1;
      if (attempts === 1) {
        return startFailingTransport(
          'Streamable HTTP error: {"error":"invalid_token","error_description":"Missing or invalid access token"}',
        );
      }
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await buildServer(name).connect(serverTransport);
      return clientTransport;
    };
    let refreshCalls = 0;
    const refresh = async (): Promise<string> => {
      refreshCalls += 1;
      return "AUTHORIZED";
    };
    const manager = new McpConnectionManager(failThenSucceed, refresh);
    manager.setOAuthDeps({ storeDir: "/tmp/mcp-oauth-test", openBrowser: () => {} });

    const runtimes = await manager.sync({ atlassian: { url: "https://example.test/mcp" } });
    expect(refreshCalls).toBe(1);
    expect(attempts).toBe(2);
    expect(runtimes[0]).toMatchObject({ name: "atlassian", status: "connected" });
    expect(runtimes[0].tools.map((t) => t.name)).toContain("echo");
    await manager.disposeAll();
  });

  test("falls back to needs_auth when a silent refresh cannot authorize", async () => {
    let refreshCalls = 0;
    // Refresh that cannot silently authorize (SDK would need interactive login).
    const refresh = async (): Promise<string> => {
      refreshCalls += 1;
      throw new NeedsAuthError("atlassian");
    };
    const manager = new McpConnectionManager(
      (): Transport => startFailingTransport('{"error":"invalid_token"}'),
      refresh,
    );
    manager.setOAuthDeps({ storeDir: "/tmp/mcp-oauth-test", openBrowser: () => {} });

    const runtimes = await manager.sync({ atlassian: { url: "https://example.test/mcp" } });
    expect(refreshCalls).toBe(1);
    expect(runtimes[0].status).toBe("needs_auth");
    await manager.disposeAll();
  });

  test("disposes a removed server", async () => {
    const f = countingFactory();
    const manager = new McpConnectionManager(f.factory);
    await manager.sync({ github: stdioConfig });
    const runtimes = await manager.sync({});
    expect(runtimes).toHaveLength(0);
    // Re-adding reconnects (proves the old one was disposed, not reused).
    await manager.sync({ github: stdioConfig });
    expect(f.connects()).toBe(2);
    await manager.disposeAll();
  });
});

describe("McpConnectionManager.listStatus", () => {
  test("reports connected + toolCount, disabled, and needs_auth without reconnecting", async () => {
    const f = countingFactory();
    const authFactory: McpTransportFactory = (name, config): Transport => {
      // Route the OAuth-needing server through NeedsAuthError; others through the counting stub.
      if (name === "linear") throw new NeedsAuthError(name);
      return (f.factory as (n: string, c: McpServerConfig) => Transport)(name, config);
    };
    const manager = new McpConnectionManager(authFactory);
    const servers: Record<string, McpServerConfig> = {
      github: stdioConfig,
      linear: { url: "https://example.test/mcp" },
      off: { command: "x", enabled: false },
    };
    const first = await manager.listStatus(servers);
    expect(first.find((s) => s.name === "github")).toMatchObject({
      transport: "stdio",
      status: "connected",
      toolCount: 1,
    });
    expect(first.find((s) => s.name === "linear")).toMatchObject({
      transport: "http",
      status: "needs_auth",
      toolCount: 0,
    });
    expect(first.find((s) => s.name === "off")).toMatchObject({ status: "disabled" });

    // A second listStatus must read cache — no additional connects for the healthy server.
    const connectsAfterFirst = f.connects();
    await manager.listStatus(servers);
    expect(f.connects()).toBe(connectsAfterFirst);
    await manager.disposeAll();
  });
});

describe("McpConnectionManager.logout", () => {
  test("drops the live connection so a later call fails", async () => {
    const f = countingFactory();
    const manager = new McpConnectionManager(f.factory);
    await manager.sync({ github: stdioConfig });
    await manager.logout("github", stdioConfig);
    await expect(manager.call("github", "echo", {}, new AbortController().signal)).rejects.toThrow(/not connected/);
    await manager.disposeAll();
  });
});

describe("McpConnectionManager.call", () => {
  test("preserves future content kinds received over the transport with an identifying fallback", async () => {
    const raw = {
      content: [
        {
          type: "video",
          uri: "data://clip",
          title: "Clip",
          data: "opaque-payload",
          _meta: { private: "hidden-value" },
        },
        { type: "text", text: "known content", extension: { retained: true } },
      ],
      extension: { retained: true },
    };
    const manager = managerReturning(raw);
    try {
      await manager.sync({ future: stdioConfig });
      const result = await manager.call("future", "echo", { text: "ignored" }, new AbortController().signal);
      expect(result.rawResult).toEqual(raw);
      for (const value of ["unsupported", "video", "data://clip", "Clip", "metadata.mcpResult.content[0]"])
        expect(result.text).toContain(value);
      expect(result.text).not.toContain("opaque-payload");
      expect(result.text).not.toContain("hidden-value");
    } finally {
      await manager.disposeAll();
    }
  });

  test("continues to reject malformed known content instead of treating it as a future kind", async () => {
    const manager = managerReturning({ content: [{ type: "text", text: 42 }] });
    try {
      await manager.sync({ malformed: stdioConfig });
      await expect(
        manager.call("malformed", "echo", { text: "ignored" }, new AbortController().signal),
      ).rejects.toThrow();
    } finally {
      await manager.disposeAll();
    }
  });

  test("preserves resource links, mixed payloads and private metadata before projecting output", async () => {
    const raw = {
      content: [
        { type: "text" as const, text: "  leading\ntrailing  " },
        { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" },
        {
          type: "resource_link" as const,
          uri: "https://example.test/report.csv",
          name: "report.csv",
          mimeType: "text/csv",
          description: "Generated report",
        },
        { type: "audio" as const, data: "YXVkaW8=", mimeType: "audio/wav", _meta: { private: "block-private" } },
        {
          type: "resource" as const,
          resource: { uri: "data://report", mimeType: "application/octet-stream", blob: "YmluYXJ5" },
        },
        { type: "resource" as const, resource: { uri: "data://text", text: "  resource text  " } },
        { type: "image" as const, data: "dGlmZg==", mimeType: "image/tiff" },
      ],
      structuredContent: { count: 2, _meta: { private: "structured-private" } },
      isError: true,
      _meta: { private: "result-private" },
    };
    const manager = new McpConnectionManager(async () => {
      const server = new McpServer({ name: "results", version: "1" });
      server.registerTool("result", {}, async () => raw);
      const [client, transport] = InMemoryTransport.createLinkedPair();
      await server.connect(transport);
      return client;
    });
    try {
      await manager.sync({ results: stdioConfig });
      const result = await manager.call("results", "result", {}, new AbortController().signal);
      expect(result.rawResult).toEqual(raw);
      expect(result.isError).toBe(true);
      expect(result.images).toEqual([
        { data: "aW1hZ2U=", mimeType: "image/png" },
        { data: "dGlmZg==", mimeType: "image/tiff" },
      ]);
      expect(result.text.startsWith("  leading\ntrailing  ")).toBe(true);
      for (const text of [
        "report.csv",
        "https://example.test/report.csv",
        "text/csv",
        "Generated report",
        "audio/wav",
        "playback unavailable",
        "data://report",
        "application/octet-stream",
        "metadata.mcpResult.content[3]",
        "  resource text  ",
        "Structured output:",
        '"count": 2',
        "image/tiff; rendering unavailable",
      ])
        expect(result.text).toContain(text);
      for (const text of ["YXVkaW8=", "YmluYXJ5", "block-private", "result-private", "structured-private"])
        expect(result.text).not.toContain(text);
    } finally {
      await manager.disposeAll();
    }
  });

  test("does not trim text-only results", async () => {
    const manager = new McpConnectionManager(async () => {
      const server = new McpServer({ name: "text", version: "1" });
      server.registerTool("text", {}, async () => ({ content: [{ type: "text", text: "  exact text\n\n" }] }));
      const [client, transport] = InMemoryTransport.createLinkedPair();
      await server.connect(transport);
      return client;
    });
    try {
      await manager.sync({ text: stdioConfig });
      expect((await manager.call("text", "text", {}, new AbortController().signal)).text).toBe("  exact text\n\n");
    } finally {
      await manager.disposeAll();
    }
  });

  test("resource-link-only output is visible", async () => {
    const manager = new McpConnectionManager(async () => {
      const server = new McpServer({ name: "links", version: "1" });
      server.registerTool("link", {}, async () => ({
        content: [
          {
            type: "resource_link",
            uri: "https://example.test/report.csv",
            name: "report.csv",
            mimeType: "text/csv",
            description: "Generated report",
          },
        ],
      }));
      const [client, transport] = InMemoryTransport.createLinkedPair();
      await server.connect(transport);
      return client;
    });
    try {
      await manager.sync({ links: stdioConfig });
      const result = await manager.call("links", "link", {}, new AbortController().signal);
      expect(result.isError).toBe(false);
      for (const value of ["https://example.test/report.csv", "report.csv", "text/csv", "Generated report"])
        expect(result.text).toContain(value);
    } finally {
      await manager.disposeAll();
    }
  });

  test("routes a call and normalizes the result", async () => {
    const f = countingFactory();
    const manager = new McpConnectionManager(f.factory);
    await manager.sync({ github: stdioConfig });
    const result = await manager.call("github", "echo", { text: "hi" }, new AbortController().signal);
    expect(result.text).toBe("echo:hi");
    expect(result.isError).toBe(false);
    await manager.disposeAll();
  });

  test("throws when the server is not connected", async () => {
    const manager = new McpConnectionManager(countingFactory().factory);
    await expect(manager.call("nope", "echo", {}, new AbortController().signal)).rejects.toThrow(/not connected/);
  });
});
