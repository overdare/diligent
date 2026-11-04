// @summary Verifies empty-request discovery, non-empty search validation, compact catalogs, and Unicode results through the real tool executor.
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
  const memberReply = {
    schemaVersion: "member-build",
    classes: [
      {
        class: "FutureWidget",
        creatable: true,
        scriptCreatable: false,
        properties: response.classes[0].properties,
        functions: [{ name: "Clone", declaredOn: "Instance", params: [], returns: "Instance", static: false }],
        events: [{ name: "Changed", declaredOn: "Instance", params: [{ name: "property", type: "string" }] }],
      },
    ],
  };

  test.each([
    "properties",
    "functions",
    "events",
  ] as const)("selects only %s while preserving class metadata", async (kind) => {
    const { calls, tools } = await setup(memberReply);
    const result = await executeTool(
      tools,
      {
        type: "tool_call",
        id: "kind",
        name: "studiorpc_instance_schema_search",
        input: { classes: ["FutureWidget"], kinds: [kind] },
      },
      context,
    );
    expect(result.metadata?.error).not.toBe(true);
    expect(calls).toEqual([{ method: "instance.schema.search", params: { classes: ["FutureWidget"] } }]);
    const entry = JSON.parse(result.output).classes[0];
    expect(entry).toMatchObject({ class: "FutureWidget", creatable: true, scriptCreatable: false });
    expect(entry[kind]).toEqual(memberReply.classes[0][kind]);
    for (const other of ["properties", "functions", "events"].filter((value) => value !== kind)) {
      expect(entry).not.toHaveProperty(other);
    }
  });

  test("kind selection alone requests full member details instead of the compact class catalog", async () => {
    const { calls, tools } = await setup(memberReply);
    const result = await executeTool(
      tools,
      {
        type: "tool_call",
        id: "kinds",
        name: "studiorpc_instance_schema_search",
        input: { kinds: ["functions", "events"] },
      },
      context,
    );
    expect(result.metadata?.error).not.toBe(true);
    expect(calls).toEqual([{ method: "instance.schema.search", params: {} }]);
    const output = JSON.parse(result.output);
    expect(output).not.toHaveProperty("view", "classes");
    expect(output.classes[0].functions).toEqual(memberReply.classes[0].functions);
    expect(output.classes[0].events).toEqual(memberReply.classes[0].events);
    expect(output.classes[0]).not.toHaveProperty("properties");
  });

  test("combines native name search with sidecar kind selection without leaking property supplements", async () => {
    const { calls, tools } = await setup({ classes: [] });
    const result = await executeTool(
      tools,
      {
        type: "tool_call",
        id: "query-kind",
        name: "studiorpc_instance_schema_search",
        input: { query: "PresetName", kinds: ["functions"] },
      },
      context,
    );
    expect(result.metadata?.error).not.toBe(true);
    expect(calls).toEqual([{ method: "instance.schema.search", params: { query: "PresetName" } }]);
    expect(JSON.parse(result.output).classes).toEqual([]);
    expect(JSON.parse(result.output)).not.toHaveProperty("valueTypes");
  });

  test("retains property annotations only when properties are selected", async () => {
    const reply = {
      classes: [
        {
          class: "Part",
          properties: [
            { name: "Mobility", declaredOn: "Instance", valueSchema: { type: "string", enum: ["Static", "Movable"] } },
          ],
          functions: [],
          events: [],
        },
      ],
    };
    const { tools } = await setup(reply);
    for (const kind of ["properties", "functions"] as const) {
      const result = await executeTool(
        tools,
        {
          type: "tool_call",
          id: kind,
          name: "studiorpc_instance_schema_search",
          input: { classes: ["Part"], kinds: [kind] },
        },
        context,
      );
      const output = JSON.parse(result.output);
      if (kind === "properties") {
        expect(output.classes[0].properties[0].note).toContain("MobilityMode");
        expect(output.valueTypes.Enum).toBeString();
      } else {
        expect(output.classes[0]).not.toHaveProperty("properties");
        expect(output).not.toHaveProperty("valueTypes");
      }
    }
  });

  test("does not invent function or event arrays omitted by an older Studio", async () => {
    const { tools } = await setup(response);
    const result = await executeTool(
      tools,
      {
        type: "tool_call",
        id: "old-kinds",
        name: "studiorpc_instance_schema_search",
        input: { classes: ["FutureWidget"], kinds: ["functions", "events"] },
      },
      context,
    );
    expect(result.metadata?.error).not.toBe(true);
    const entry = JSON.parse(result.output).classes[0];
    for (const key of ["properties", "functions", "events"]) expect(entry).not.toHaveProperty(key);
  });

  test("function selection does not depend on understanding an unselected property schema", async () => {
    const { tools } = await setup({
      classes: [
        {
          class: "FutureWidget",
          properties: [{ futurePropertyShape: true }],
          functions: memberReply.classes[0].functions,
        },
      ],
    });
    const result = await executeTool(
      tools,
      {
        type: "tool_call",
        id: "future-kind",
        name: "studiorpc_instance_schema_search",
        input: { classes: ["FutureWidget"], kinds: ["functions"] },
      },
      context,
    );
    const entry = JSON.parse(result.output).classes[0];
    expect(entry.functions).toEqual(memberReply.classes[0].functions);
    expect(entry).not.toHaveProperty("properties");
  });

  test("sends full discovery to Studio as an empty request", async () => {
    const { calls, tools } = await setup();
    const result = await executeTool(
      tools,
      { type: "tool_call", id: "all", name: "studiorpc_instance_schema_search", input: {} },
      context,
    );
    expect(calls).toEqual([{ method: "instance.schema.search", params: {} }]);
    expect(result.metadata?.error).not.toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({
      schemaVersion: "unicode-build",
      view: "classes",
      classes: [{ class: "FutureWidget", description, creatable: true, service: false }],
    });
    expect(JSON.parse(result.output).classes[0]).not.toHaveProperty("properties");
    expect(result.truncateDirection).toBe("head");
  });

  test.each([
    { query: "" },
    { classes: ["FutureWidget"], query: "" },
    { kinds: [] },
    { kinds: ["methods"] },
    { kinds: "properties" },
  ])("rejects an empty query before contacting Studio: %j", async (input) => {
    const { calls, tools } = await setup();
    const result = await executeTool(
      tools,
      { type: "tool_call", id: "invalid", name: "studiorpc_instance_schema_search", input },
      context,
    );
    expect(result.metadata?.error).toBe(true);
    expect(calls).toEqual([]);
  });

  test.each([
    { classes: ["FutureWidget"] },
    { classes: ["FutureWidget"], query: "Material" },
  ])("targeted lookup preserves property descriptions and exact value hints: %j", async (input) => {
    const { calls, tools } = await setup();
    const result = await executeTool(
      tools,
      {
        type: "tool_call",
        id: "detail",
        name: "studiorpc_instance_schema_search",
        input,
      },
      context,
    );
    expect(calls).toEqual([{ method: "instance.schema.search", params: input }]);
    expect(JSON.parse(result.output)).toMatchObject(response);
  });

  test("large full results omit property payloads instead of flooding the class catalog", async () => {
    const large = structuredClone(response);
    large.classes[0].properties[0].description = description.repeat(20000);
    const { tools } = await setup({
      ...large,
      classes: large.classes.map((entry) => ({
        ...entry,
        scriptCreatable: false,
        functions: [{ name: "Clone", description: description.repeat(20000) }],
        events: [{ name: "Changed", description: description.repeat(20000) }],
      })),
    });
    const result = await executeTool(
      tools,
      { type: "tool_call", id: "compact", name: "studiorpc_instance_schema_search", input: {} },
      context,
    );
    expect(result.metadata?.truncated).not.toBe(true);
    expect(JSON.parse(result.output).classes[0].description).toBe(description);
    expect(JSON.parse(result.output).classes[0].scriptCreatable).toBe(false);
    for (const member of ["properties", "functions", "events"]) {
      expect(JSON.parse(result.output).classes[0]).not.toHaveProperty(member);
    }
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
    expect(JSON.parse(saved).classes).toMatchObject(large.classes);
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
      { type: "tool_call", id: "old", name: "studiorpc_instance_schema_search", input: {} },
      context,
    );
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("query must be non-empty");
    expect(calls).toEqual([{ method: "instance.schema.search", params: {} }]);
  });
});
