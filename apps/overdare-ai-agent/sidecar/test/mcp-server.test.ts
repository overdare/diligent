// @summary Tests the OVERDARE MCP server: studio tools + bootstrap ensure_system_prompt/load_skill
// exposed as MCP tools, and bootstrap agents exposed as MCP prompts, via an in-memory MCP client.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveExperimentStates } from "@diligent/runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OVERDARE_EXPERIMENTS } from "../src/experiments";
import { StudioRpcError } from "../src/tools/studiorpc/rpc";

const levelBrowseMock = mock(async () => [
  { guid: "WORKSPACE_GUID", name: "Workspace", class: "Folder", children: [] },
]);

mock.module("../src/tools/studiorpc/rpc.ts", () => ({
  StudioRpcError,
  applyLevelChanges: async () => ({ ok: true }),
  call: (method: string) => {
    if (method === "level.browse") return levelBrowseMock();
    throw new Error(`Unexpected RPC method in test: ${method}`);
  },
}));

const { buildRegistries, createMcpServer, resolveSystemPromptPath } = await import("../src/mcp-server");

function globalSystemPromptPath(bootstrapDir: string): string {
  return join(bootstrapDir, "__global__", "system-prompt.txt");
}

async function makeBootstrapDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "overdare-mcp-"));
  await writeFile(join(dir, "system-prompt.txt"), "BOOTSTRAP PROMPT MUST NOT BE RETURNED", "utf-8");
  await mkdir(join(dir, "__global__"), { recursive: true });
  await writeFile(globalSystemPromptPath(dir), "SYSTEM PROMPT BODY", "utf-8");

  const skillDir = join(dir, "skills", "test-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: test-skill\ndescription: A test skill\n---\nSKILL BODY CONTENT",
    "utf-8",
  );

  // A skill that is not usable over MCP — load_skill must exclude it (see MCP_EXCLUDED_SKILLS).
  const excludedSkillDir = join(dir, "skills", "record-project-memory");
  await mkdir(excludedSkillDir, { recursive: true });
  await writeFile(
    join(excludedSkillDir, "SKILL.md"),
    "---\nname: record-project-memory\ndescription: Host-only knowledge handoff\n---\nMEMORY SKILL BODY",
    "utf-8",
  );

  const agentDir = join(dir, "agents", "test-agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "AGENT.md"),
    "---\nname: test-agent\ndescription: A test agent\nmodel_class: lite\n---\nAGENT BODY CONTENT",
    "utf-8",
  );

  return dir;
}

async function connectClient(bootstrapDir: string): Promise<Client> {
  const registries = await buildRegistries({
    cwd: process.cwd(),
    bootstrapDir,
    systemPromptPath: globalSystemPromptPath(bootstrapDir),
  });
  const server = createMcpServer(registries);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("OVERDARE MCP server", () => {
  beforeEach(() => {
    levelBrowseMock.mockClear();
  });

  test("resolves the system prompt under the environment-specific global storage root", () => {
    expect(
      resolveSystemPromptPath({
        USERPROFILE: "C:\\Users\\tester",
        DILIGENT_STORAGE_NAMESPACE: "overdare",
      }),
    ).toBe(join("C:\\Users\\tester", ".overdare", "system-prompt.txt"));
    expect(
      resolveSystemPromptPath({
        USERPROFILE: "C:\\Users\\tester",
        DILIGENT_STORAGE_NAMESPACE: "overdare-dev",
      }),
    ).toBe(join("C:\\Users\\tester", ".overdare-dev", "system-prompt.txt"));
  });

  test("lists studio built-in tools with input schemas", async () => {
    const client = await connectClient(await makeBootstrapDir());
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("studiorpc_level_browse");
    expect(names).toContain("studiorpc_rig_builder_insert");
    // Luau validation runs inside the script-writing tools, so it is not a tool of its own.
    expect(names).not.toContain("studiorpc_lua_validate");
    expect(names).toContain("overdaresearch");
    expect(names).toContain("overdaresearch_deep");
    const browse = tools.find((tool) => tool.name === "studiorpc_level_browse");
    expect(browse?.inputSchema).toBeDefined();
    expect(browse?.inputSchema).not.toHaveProperty("$schema");
    const rigBuilderInsert = tools.find((tool) => tool.name === "studiorpc_rig_builder_insert");
    expect(rigBuilderInsert?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        ParentActorGuid: { type: "string" },
        Position: {
          type: "object",
          required: ["x", "y", "z"],
        },
      },
    });
    await client.close();
  });

  test("native geometry tools and guidance are active while the old builder stays deprecated", async () => {
    const registries = await buildRegistries({
      cwd: process.cwd(),
      bootstrapDir: join(import.meta.dir, "../../bootstrap"),
      experiments: resolveExperimentStates(OVERDARE_EXPERIMENTS, { procedural: true }),
    });
    expect(registries.tools.has("studiorpc_execute_luau")).toBe(true);
    expect(registries.tools.has("studiorpc_instance_schema_search")).toBe(true);
    expect(registries.tools.has("studiorpc_procedural_run")).toBe(false);
    expect([...registries.tools.keys()].filter((name) => name.startsWith("studiorpc_proceduralmodel_")).sort()).toEqual(
      ["studiorpc_proceduralmodel_api", "studiorpc_proceduralmodel_set", "studiorpc_proceduralmodel_validate"],
    );
    expect(registries.tools.get("load_skill")?.description).toContain("procedural-builder");
    expect(registries.tools.get("load_skill")?.description).toContain("geometry-recipe");
    for (const name of ["procedural-builder", "geometry-recipe"]) {
      const prompt = registries.prompts.get(`agent-${name}`)!;
      if (name === "geometry-recipe") {
        expect(prompt.description).not.toContain("Deprecated");
      } else {
        expect(prompt.description).toContain("Deprecated");
      }
      const body = await prompt.load();
      expect(body).toContain("ProceduralModel");
      if (name === "geometry-recipe") {
        expect(body).toContain("studiorpc_execute_luau");
        expect(body).toContain("AutoRebuild");
        expect(body).not.toContain("studiorpc_proceduralmodel_");
      } else {
        expect(body).not.toContain("studiorpc_procedural_run");
        expect(body).not.toContain("studiorpc_proceduralmodel_");
      }
      const skill = await registries.tools.get("load_skill")!.execute(
        { name },
        {
          toolCallId: "deprecated-guide",
          signal: new AbortController().signal,
          abort() {},
        },
      );
      if (name === "geometry-recipe") {
        expect(skill.output).not.toContain("# Deprecated");
        expect(skill.output).toContain("on_generate");
      } else {
        expect(skill.output).toContain("Deprecated");
      }
      if (name !== "geometry-recipe") expect(skill.output).toContain("studiorpc_execute_luau");
    }
  });

  test("calls a studio tool and returns its output", async () => {
    const client = await connectClient(await makeBootstrapDir());
    const result = await client.callTool({ name: "studiorpc_level_browse", arguments: {} });
    expect(levelBrowseMock).toHaveBeenCalledTimes(1);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("Workspace");
    await client.close();
  });

  test("reports unknown tool as an error", async () => {
    const client = await connectClient(await makeBootstrapDir());
    const result = await client.callTool({ name: "does_not_exist", arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });

  test("surfaces bootstrap instructions without blocking Studio tools based on the client cwd", async () => {
    const client = await connectClient(await makeBootstrapDir());
    const instructions = client.getInstructions();
    expect(instructions).toContain("ensure_system_prompt");
    expect(instructions).not.toContain(".uasset");
    expect(instructions).not.toContain("do not proceed");
    await client.close();
  });

  test("exposes the base system prompt and skills as model-callable tools, not prompts", async () => {
    const client = await connectClient(await makeBootstrapDir());
    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("ensure_system_prompt");
    expect(toolNames).toContain("load_skill");

    // Skills and the system prompt are tools now — they must not leak back in as prompts.
    const { prompts } = await client.listPrompts();
    const promptNames = prompts.map((prompt) => prompt.name);
    expect(promptNames).not.toContain("overdare-system-prompt");
    expect(promptNames).not.toContain("test-skill");
    await client.close();
  });

  test("exposes bootstrap agents as prompts", async () => {
    const client = await connectClient(await makeBootstrapDir());
    const { prompts } = await client.listPrompts();
    const names = prompts.map((prompt) => prompt.name);
    expect(names).toContain("agent-test-agent");
    await client.close();
  });

  test("returns the global system prompt instead of the runtime bootstrap copy", async () => {
    const client = await connectClient(await makeBootstrapDir());
    const result = await client.callTool({ name: "ensure_system_prompt", arguments: {} });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toBe("SYSTEM PROMPT BODY");
    await client.close();
  });

  test("loads a skill body via the load_skill tool", async () => {
    const client = await connectClient(await makeBootstrapDir());
    const result = await client.callTool({ name: "load_skill", arguments: { name: "test-skill" } });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toContain("SKILL BODY CONTENT");
    await client.close();
  });

  test("reports an unknown skill name as an error listing available skills", async () => {
    const client = await connectClient(await makeBootstrapDir());
    const result = await client.callTool({ name: "load_skill", arguments: { name: "nope" } });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toContain("test-skill");
    await client.close();
  });

  test("excludes MCP-unusable skills (record-project-memory) from load_skill", async () => {
    const client = await connectClient(await makeBootstrapDir());
    // Not advertised in the tool description...
    const { tools } = await client.listTools();
    const loadSkill = tools.find((tool) => tool.name === "load_skill");
    expect(loadSkill?.description).toContain("test-skill");
    expect(loadSkill?.description).not.toContain("record-project-memory");
    // ...and not loadable by name.
    const result = await client.callTool({ name: "load_skill", arguments: { name: "record-project-memory" } });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
