// @summary Verifies full discovery, compact catalogs, Unicode data, and empty-query normalization through the real tool executor.
import { describe, expect, test } from "bun:test";
import { executeTool } from "@diligent/core/tool-contract";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import { StudioRpcError } from "../../../../src/tools/studiorpc/rpc";

const context = { toolCallId: "discovery", signal: new AbortController().signal, abort() {} };
const description = "\uC7AC\uC9C8 \uBC0F \uD06C\uAE30 \uC124\uBA85";
const response = {
  schemaVersion: "unicode-build",
  classes: [
    {
      class: "FutureWidget",
      description,
      creatable: true,
      service: false,
      properties: [
        { name: "Material", description, declaredOn: "FutureWidget", valueSchema: { type: "string", enum: ["Wood"] } },
      ],
    },
  ],
};
async function setup(reply: unknown = response) {
  const calls: unknown[] = [];
  const tools = await createStudioRpcToolProvider({
    callRpc: async (method, params) => {
      calls.push({ method, params });
      return reply;
    },
  }).createTools({ cwd: "/tmp/schema-discovery" });
  return { calls, tools: new Map(tools.map((t) => [t.name, t])) };
}

describe("live class discovery", () => {
  test.each([{ query: "" }, {}])("forwards a full-search request after common optional cleanup: %j", async (input) => {
    const { calls, tools } = await setup();
    const result = await executeTool(
      tools,
      { type: "tool_call", id: "all", name: "studiorpc_instance_schema_search", input },
      context,
    );
    expect(calls).toEqual([{ method: "instance.schema.search", params: { query: "" } }]);
    expect(result.metadata?.error).not.toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({
      schemaVersion: "unicode-build",
      view: "classes",
      classes: [{ class: "FutureWidget", description, creatable: true, service: false }],
    });
    expect(JSON.parse(result.output).classes[0]).not.toHaveProperty("properties");
    expect(result.truncateDirection).toBe("head");
  });

  test("targeted class lookup preserves property descriptions and exact value hints", async () => {
    const { calls, tools } = await setup();
    const result = await executeTool(
      tools,
      {
        type: "tool_call",
        id: "detail",
        name: "studiorpc_instance_schema_search",
        input: { classes: ["FutureWidget"], query: "Material" },
      },
      context,
    );
    expect(calls).toEqual([
      { method: "instance.schema.search", params: { classes: ["FutureWidget"], query: "Material" } },
    ]);
    expect(JSON.parse(result.output)).toEqual(response);
  });

  test("large full results omit property payloads instead of flooding the class catalog", async () => {
    const large = structuredClone(response);
    large.classes[0].properties[0].description = description.repeat(20000);
    const { tools } = await setup(large);
    const result = await executeTool(
      tools,
      { type: "tool_call", id: "compact", name: "studiorpc_instance_schema_search", input: { query: "" } },
      context,
    );
    expect(result.metadata?.truncated).not.toBe(true);
    expect(JSON.parse(result.output).classes[0].description).toBe(description);
    expect(Buffer.byteLength(result.output)).toBeLessThan(2000);
  });

  test("Unicode detail truncation preserves the full output and does not split characters", async () => {
    const large = structuredClone(response);
    large.classes[0].properties[0].description = description.repeat(5000);
    const { tools } = await setup(large);
    let saved = "";
    const result = await executeTool(
      tools,
      {
        type: "tool_call",
        id: "large",
        name: "studiorpc_instance_schema_search",
        input: { classes: ["FutureWidget"] },
      },
      context,
      {
        outputStore: {
          save: async (output) => {
            saved = output;
            return "/tmp/schema-full.json";
          },
        },
      },
    );
    expect(JSON.parse(saved)).toEqual(large);
    expect(result.metadata?.truncated).toBe(true);
    expect(result.metadata?.truncatedFrom).toEqual({ bytes: Buffer.byteLength(saved) });
    expect(result.output).not.toContain("\uFFFD");
    expect(result.output).toContain("/tmp/schema-full.json");
  });

  test("an older Studio rejecting full search is reported without invented fallback queries", async () => {
    const calls: unknown[] = [];
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method, params) => {
        calls.push({ method, params });
        throw new StudioRpcError("query must be non-empty", -32602, undefined);
      },
    }).createTools({ cwd: "/tmp/schema-discovery" });
    const result = await executeTool(
      new Map(tools.map((t) => [t.name, t])),
      { type: "tool_call", id: "old", name: "studiorpc_instance_schema_search", input: { query: "" } },
      context,
    );
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("query must be non-empty");
    expect(calls).toEqual([{ method: "instance.schema.search", params: { query: "" } }]);
  });
});
