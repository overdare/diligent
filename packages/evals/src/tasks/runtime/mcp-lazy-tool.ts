// @summary Behavioral runtime eval for auto-selected lazy MCP discovery and approved stdio execution

import { readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DiligentServerRequestResponse } from "@diligent/protocol";
import { createPermissionEngine } from "@diligent/runtime";
import { getMcpManager } from "@diligent/runtime/tools";
import type { RuntimeEvalTask } from "../../runtime-task";
import { isRecord } from "../core/helpers";
import { finalAssistantText, isExactReply, RuntimeGrade } from "./grading";
import {
  createIsolatedFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  writeFixture,
} from "./helpers";

const SERVER = "fixture-logistics";
const INTENDED_TOOL = "coordinate_sterile_field_unit";
const DECOY_TOOL = "coordinate_specimen_archive";
const SEARCH_QUERY = "sterile expedition rendezvous";
const ENTRY_PATH = "mcp/server.js";
const MANIFEST_PATH = "manifest.json";
const KEEP_PATH = ".git/.keep";
const CLOSE_MARKER_PATH = ".mcp-closed";
const LAZY_THRESHOLD = 3;
const STARTUP_TIMEOUT_MS = 5_000;
const TOOL_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_TOKENS = 1_337;
const MAX_OUTPUT_BYTES = MAX_OUTPUT_TOKENS * 4;

const INTENDED_DESCRIPTION =
  "Arrange a sterile expedition rendezvous when a case reference, field location, operating window, team roster, and clinical support requirements are known.";

interface FieldUnitRequest {
  case_ref: string;
  deployment: {
    location: { facility: string; region_code: string };
    operating_window: { opens: string; closes: string };
    team: Array<{ badge: string; role: "clinician" | "technician" }>;
  };
  support: { isolation_grade: "negative_pressure" | "standard"; cold_chain: boolean };
}

interface RuntimeConfigRecord {
  serverNames: string[];
  command: string;
  args: string[];
  cwd: string;
  type: string;
  startupTimeoutMs: number;
  toolTimeoutMs: number;
  toolLoading: string;
  lazyThreshold: number;
  maxOutputTokens: number;
  resources: boolean;
  prompts: boolean;
}

export interface McpLazyToolWorld extends RuntimeFixtureWorld {
  serverName: string;
  intendedTool: string;
  decoyTool: string;
  searchQuery: string;
  request: FieldUnitRequest;
  receipt: string;
  decoyReceipt: string;
  clientPrompt: string;
  entryPath: string;
  closeMarkerPath: string;
  entryContent: string;
  entryHash: string;
  manifestContent: string;
  manifestHash: string;
  runtimeConfigs: RuntimeConfigRecord[];
}

export const mcpLazyToolTask: RuntimeEvalTask<McpLazyToolWorld> = {
  id: "mcp-lazy-tool",
  description: "Discover one fixture-local stdio MCP tool through auto-selected lazy proxies and run it with approval.",
  fixtureVersion: "mcp-lazy-tool-v4",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 4,
    maxToolCalls: 4,
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["mcp_search_tools", "mcp_run_tool"],
    allowedCapabilities: ["execute"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const fixture = fixtureFor(seed, root);
    await writeFixture(root, {
      [ENTRY_PATH]: fixture.entryContent,
      [MANIFEST_PATH]: fixture.manifestContent,
      [KEEP_PATH]: "fixture boundary\n",
    });
    return {
      root,
      seed,
      expected: fixture.receipt,
      protectedPaths: [ENTRY_PATH, MANIFEST_PATH, KEEP_PATH],
      allowedChanges: [],
      ...fixture,
      runtimeConfigs: [],
    };
  },
  async createRuntimeConfig(world, profile) {
    const config = await createIsolatedFixtureRuntimeConfig(world, profile);
    const server = {
      type: "stdio" as const,
      command: process.execPath,
      args: [world.entryPath],
      cwd: world.root,
      startupTimeoutMs: STARTUP_TIMEOUT_MS,
      toolTimeoutMs: TOOL_TIMEOUT_MS,
    };
    config.diligent.mcpServers = { [SERVER]: server };
    config.diligent.mcp = {
      toolLoading: "auto",
      lazyThreshold: LAZY_THRESHOLD,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      resources: false,
      prompts: false,
    };
    config.permissionEngine = createPermissionEngine([]);
    world.runtimeConfigs.push({
      serverNames: Object.keys(config.diligent.mcpServers),
      command: server.command,
      args: [...server.args],
      cwd: server.cwd,
      type: server.type,
      startupTimeoutMs: server.startupTimeoutMs,
      toolTimeoutMs: server.toolTimeoutMs,
      toolLoading: config.diligent.mcp.toolLoading!,
      lazyThreshold: config.diligent.mcp.lazyThreshold!,
      maxOutputTokens: config.diligent.mcp.maxOutputTokens!,
      resources: config.diligent.mcp.resources!,
      prompts: config.diligent.mcp.prompts!,
    });
    return config;
  },
  createSteps: (world) => [{ kind: "turn", mode: "default", message: world.clientPrompt }],
  respondToServerRequest(_world, request): DiligentServerRequestResponse {
    if (request.method !== "approval/request") throw new Error(`Unexpected server request: ${request.method}`);
    return { method: request.method, result: { decision: "once" } };
  },
  snapshotWorld: async (world) => ({
    entryHash: sha256Text(await readFile(world.entryPath, "utf8")),
    closeMarkerAbsent: !(await fileExists(world.closeMarkerPath)),
    runtimeConfigs: world.runtimeConfigs,
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("mcp_lazy");
    const { world } = input;
    const runs = input.toolCalls.filter((call) => call.name === "mcp_run_tool" && call.outcome === "success");
    const toolOf = (call: (typeof runs)[number]) => (isRecord(call.input) ? call.input.tool : undefined);
    if (runs.some((call) => toolOf(call) !== INTENDED_TOOL))
      return grade.fail("decoy_tool", "A non-matching connected service was executed.", "behavior");
    const intended = runs.filter((call) => toolOf(call) === INTENDED_TOOL);
    if (intended.length === 0)
      return grade.fail("tool_selection", "The matching connected service was never executed.", "behavior");
    if (!intended.some((call) => JSON.stringify(call.output ?? "").includes(world.receipt)))
      return grade.fail("arguments", "The service never confirmed the requested arrangement.", "semantic_goal");
    const answer = finalAssistantText(input);
    if (!answer.includes(world.receipt))
      return grade.fail("final", "The final answer did not report the confirmation.", "semantic_goal");
    if (!isExactReply(answer, world.receipt))
      return grade.fail("final_format", "The final answer was not only the confirmation.", "format_contract");
    if (intended.length > 1 || input.toolCalls.some((call) => call.outcome !== "success"))
      grade.note("rejected_input_recovered", "The service was called again after a rejected or failed attempt.");
    if (input.toolCalls.filter((call) => call.name === "mcp_search_tools").length > 1)
      grade.note("repeated_search", "More than one tool search preceded the service call.", { impact: "info" });
    return grade.pass();
  },
  async cleanup(world) {
    await getMcpManager().disposeAll();
    const deadline = Date.now() + 900;
    while (!(await fileExists(world.closeMarkerPath)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!(await fileExists(world.closeMarkerPath)))
      throw new Error("Fixture MCP process did not write its close marker.");
    await unlink(world.closeMarkerPath);
  },
};

function fixtureFor(seed: string, root: string) {
  const caseRef = seededToken(seed, "FIELD_CASE");
  const clinician = seededToken(seed, "CLINICIAN");
  const technician = seededToken(seed, "TECHNICIAN");
  const facility = seededToken(seed, "FACILITY");
  const receipt = seededToken(seed, "FIELD_UNIT_RECEIPT");
  const decoyReceipt = seededToken(seed, "ARCHIVE_RECEIPT");
  const request: FieldUnitRequest = {
    case_ref: caseRef,
    deployment: {
      location: { facility, region_code: "KR-41" },
      operating_window: { opens: "2026-10-06", closes: "2026-10-09" },
      team: [
        { badge: clinician, role: "clinician" },
        { badge: technician, role: "technician" },
      ],
    },
    support: { isolation_grade: "negative_pressure", cold_chain: true },
  };
  const clientPrompt =
    `Arrange the mobile clinical unit for case ${caseRef} at ${facility} in KR-41 from 2026-10-06 through ` +
    `2026-10-09. ${clinician} is the clinician and ${technician} is the technician. The unit needs negative-pressure ` +
    "isolation and cold-chain support. Find the appropriate connected service and reply with only its confirmation.";
  const manifestContent = `${JSON.stringify({ fixture: "mcp-field-unit", case: caseRef }, null, 2)}\n`;
  const entryPath = join(root, ENTRY_PATH);
  const closeMarkerPath = join(root, CLOSE_MARKER_PATH);
  const entryContent = serverSource({ request, receipt, decoyReceipt });
  return {
    serverName: SERVER,
    intendedTool: INTENDED_TOOL,
    decoyTool: DECOY_TOOL,
    searchQuery: SEARCH_QUERY,
    request,
    receipt,
    decoyReceipt,
    clientPrompt,
    entryPath,
    closeMarkerPath,
    entryContent,
    entryHash: sha256Text(entryContent),
    manifestContent,
    manifestHash: sha256Text(manifestContent),
  };
}

function serverSource(input: { request: FieldUnitRequest; receipt: string; decoyReceipt: string }): string {
  const runtimeModules = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../runtime/node_modules");
  const sdk = pathToFileURL(join(runtimeModules, "@modelcontextprotocol/sdk/dist/esm/server/mcp.js")).href;
  const stdio = pathToFileURL(join(runtimeModules, "@modelcontextprotocol/sdk/dist/esm/server/stdio.js")).href;
  const zod = import.meta.resolve("zod");
  return `import { writeFileSync } from "node:fs";
import { McpServer } from ${JSON.stringify(sdk)};
import { StdioServerTransport } from ${JSON.stringify(stdio)};
import { z } from ${JSON.stringify(zod)};

const closeMarker = ${JSON.stringify(CLOSE_MARKER_PATH)};
process.on("exit", () => { try { writeFileSync(closeMarker, "closed\\n"); } catch {} });
const server = new McpServer({ name: "diligent-eval-field-unit", version: "1.0.0" });
const strictObject = (shape) => z.object(shape).strict();
const expectedRequest = ${JSON.stringify(input.request)};
const canonical = (value) => Array.isArray(value)
  ? "[" + value.map(canonical).join(",") + "]"
  : value !== null && typeof value === "object"
    ? "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
    : JSON.stringify(value);
server.registerTool(${JSON.stringify(INTENDED_TOOL)}, {
  description: ${JSON.stringify(INTENDED_DESCRIPTION)},
  inputSchema: {
    case_ref: z.string(),
    deployment: strictObject({
      location: strictObject({ facility: z.string(), region_code: z.string().regex(/^[A-Z]{2}-[0-9]{2}$/) }),
      operating_window: strictObject({ opens: z.string(), closes: z.string() }),
      team: z.array(strictObject({ badge: z.string(), role: z.enum(["clinician", "technician"]) })).length(2),
    }),
    support: strictObject({ isolation_grade: z.enum(["negative_pressure", "standard"]), cold_chain: z.boolean() }),
  },
  _meta: { "anthropic/maxResultSizeChars": ${MAX_OUTPUT_BYTES} },
}, async (actual) => ({
  content: [{
    type: "text",
    text: canonical(actual) === canonical(expectedRequest) ? ${JSON.stringify(input.receipt)} : "REJECTED_INPUT",
  }],
}));
server.registerTool(${JSON.stringify(DECOY_TOOL)}, { description: "Transfer preserved archive specimens to a repository vault.", inputSchema: { archive_ref: z.string() } }, async () => ({ content: [{ type: "text", text: ${JSON.stringify(input.decoyReceipt)} }] }));
server.registerTool("schedule_remote_lab_inventory", { description: "Count sealed laboratory inventory for remote storage.", inputSchema: { inventory_ref: z.string() } }, async () => ({ content: [{ type: "text", text: "INVENTORY_DECOY" }] }));
server.registerTool("reserve_research_vessel_berth", { description: "Reserve a berth for a research vessel.", inputSchema: { vessel_ref: z.string() } }, async () => ({ content: [{ type: "text", text: "VESSEL_DECOY" }] }));
server.registerTool("dispatch_museum_crate_team", { description: "Dispatch a handling team for museum crates.", inputSchema: { crate_ref: z.string() } }, async () => ({ content: [{ type: "text", text: "MUSEUM_DECOY" }] }));
await server.connect(new StdioServerTransport());
`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
