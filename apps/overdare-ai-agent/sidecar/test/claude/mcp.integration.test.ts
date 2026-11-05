// @summary Native stdio router and real sidecar endpoint contract for an immutable embedded owner.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Tool } from "@diligent/core/tool-contract";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { type McpRegistries, toCatalogSnapshot } from "../../src/mcp-server";
import { createRouterEndpoint } from "../../src/router-endpoint";

const binary =
  process.env.OVERDARE_MCP_PATH ??
  resolve(import.meta.dir, `../../../target/debug/overdare-mcp${process.platform === "win32" ? ".exe" : ""}`);

test.skipIf(!existsSync(binary))(
  "native embedded MCP uses plugin skills and routes only to its owning sidecar",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "overdare-embedded-mcp-"));
    const directory = join(root, ".overdare-dev/mcp/studios");
    await mkdir(directory, { recursive: true });
    const calls: string[] = [];
    const tool = (name: string): Tool => ({
      name,
      description: name,
      parameters: z.object({}),
      async execute() {
        calls.push(name);
        return { output: `OWNER:${name} 한글` };
      },
    });
    const registries: McpRegistries = {
      tools: new Map(["owner_tool", "load_skill", "ensure_system_prompt"].map((name) => [name, tool(name)])),
      prompts: new Map([["builder", { name: "builder", description: "Builder", load: async () => "OWNER_PROMPT" }]]),
    };
    const endpoint = createRouterEndpoint({ token: "owner-secret", registries: async () => registries });
    const owner = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => endpoint.handle(req, new URL(req.url)) });
    let otherCalls = 0;
    const other = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        otherCalls++;
        return new Response("WRONG_PROJECT");
      },
    });
    const now = new Date().toISOString();
    const record = (id: string, port: number) => ({
      id,
      displayName: id,
      cwd: root,
      sidecarUrl: `http://127.0.0.1:${port}`,
      sidecarToken: "owner-secret",
      pid: process.pid,
      startedAt: now,
      heartbeatAt: now,
      catalog: toCatalogSnapshot(registries),
    });
    await writeFile(join(directory, "owner.json"), JSON.stringify(record("owner", owner.port!)));
    await writeFile(join(directory, "other.json"), JSON.stringify(record("other", other.port!)));
    const client = new Client({ name: "embedded-host-test", version: "1.0" });
    const transport = new StdioClientTransport({
      command: binary,
      args: ["--agent-env=dev", "--embedded-studio=owner"],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
        HOME: root,
        USERPROFILE: root,
      },
      stderr: "ignore",
    });
    try {
      await client.connect(transport);
      expect(client.getInstructions()).not.toContain("ensure_system_prompt");
      const names = (await client.listTools()).tools.map((item) => item.name);
      expect(names).not.toContain("load_skill");
      expect(names).toContain("owner_tool");
      expect(names).not.toContain("ensure_system_prompt");
      expect(names).not.toContain("set_active_overdare_studio");
      const result = await client.callTool({ name: "owner_tool", arguments: {} });
      expect(JSON.stringify(result.content)).toContain("OWNER:owner_tool 한글");
      expect(JSON.stringify(await client.getPrompt({ name: "builder" }))).toContain("OWNER_PROMPT");
      for (const name of ["load_skill", "ensure_system_prompt", "set_active_overdare_studio", "list_overdare_studios"])
        expect((await client.callTool({ name, arguments: { id: "other" } })).isError).toBe(true);
      owner.stop(true);
      await writeFile(join(directory, "owner.json"), JSON.stringify(record("owner", 1)));
      const lost = await client.callTool({ name: "owner_tool", arguments: {} });
      expect(lost.isError).toBe(true);
      expect(JSON.stringify(lost.content)).toContain("owning Studio");
      expect(JSON.stringify(lost.content)).not.toContain("set_active_overdare_studio");
      await rm(join(directory, "owner.json"));
      expect((await client.callTool({ name: "owner_tool", arguments: {} })).isError).toBe(true);
      expect(calls).toEqual(["owner_tool"]);
      expect(otherCalls).toBe(0);
    } finally {
      await client.close();
      owner.stop(true);
      other.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  15_000,
);
