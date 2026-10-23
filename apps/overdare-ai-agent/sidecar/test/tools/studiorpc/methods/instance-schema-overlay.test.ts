// @summary Verifies the sidecar schema overlay through the real schema search tool and guards its keys against a recorded Studio schema.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeTool } from "@diligent/core/tool-contract";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import {
  classNotes,
  hiddenEnumValues,
  propertyNotes,
  supplementProperties,
  valueTypeNotes,
} from "../../../../src/tools/studiorpc/methods/instance-schema-overlay.table";

const context = { toolCallId: "overlay", signal: new AbortController().signal, abort() {} };

interface Entry {
  class: string;
  note?: string;
  source?: string;
  properties?: { name: string; note?: string; source?: string; valueSchema: Record<string, unknown> }[];
}

async function search(input: Record<string, unknown>, reply: unknown) {
  const tools = await createStudioRpcToolProvider({ callRpc: async () => reply }).createTools({
    cwd: "/tmp/schema-overlay",
  });
  const result = await executeTool(
    new Map(tools.map((t) => [t.name, t])),
    { type: "tool_call", id: "overlay", name: "studiorpc_instance_schema_search", input },
    context,
  );
  expect(result.metadata?.error).not.toBe(true);
  return JSON.parse(result.output) as { classes: Entry[]; valueTypes?: Record<string, string> };
}

const classOf = (output: { classes: Entry[] }, name: string) => output.classes.find((entry) => entry.class === name);
const propertyOf = (entry: Entry | undefined, name: string) => entry?.properties?.find((p) => p.name === name);

describe("schema overlay on targeted lookups", () => {
  test("annotates an inherited property through its declaring class and keeps Studio fields", async () => {
    const mobility = {
      name: "Mobility",
      declaredOn: "Instance",
      valueSchema: { type: "string", enum: ["Static", "Movable"] },
    };
    const output = await search(
      { classes: ["FutureWidget"] },
      {
        schemaVersion: "v",
        classes: [{ class: "FutureWidget", creatable: true, service: false, properties: [mobility] }],
      },
    );
    expect(propertyOf(classOf(output, "FutureWidget"), "Mobility")).toEqual({
      ...mobility,
      note: propertyNotes["Instance.Mobility"],
    });
  });

  test("hides engine sentinel enum members while keeping real choices", async () => {
    const [sentinel] = hiddenEnumValues["BasePart.Material"] ?? [];
    const output = await search(
      { classes: ["Part"] },
      {
        classes: [
          {
            class: "Part",
            properties: [
              {
                name: "Material",
                declaredOn: "BasePart",
                valueSchema: { type: "string", enum: ["Plastic", sentinel, "Wood"] },
              },
            ],
          },
        ],
      },
    );
    expect(propertyOf(classOf(output, "Part"), "Material")?.valueSchema.enum).toEqual(["Plastic", "Wood"]);
  });

  test("adds Studio-omitted properties as sidecar entries, filtered like Studio's property query", async () => {
    const reply = {
      classes: [
        {
          class: "VFXPreset",
          properties: [{ name: "Enabled", declaredOn: "VFXPreset", valueSchema: { type: "boolean" } }],
        },
      ],
    };
    const all = classOf(await search({ classes: ["VFXPreset"] }, reply), "VFXPreset");
    expect(all?.properties?.filter((p) => p.source === "sidecar").map((p) => p.name)).toEqual(
      Object.keys(supplementProperties.VFXPreset ?? {}),
    );
    expect(all?.note).toBe(classNotes.VFXPreset);

    const alpha = classOf(await search({ classes: ["VFXPreset"], query: "alpha" }, reply), "VFXPreset");
    expect(alpha?.properties?.filter((p) => p.source === "sidecar").map((p) => p.name)).toEqual(["Alpha"]);
  });

  test("VFXRecipe routes to the dedicated authoring tool without Luau layer supplements", async () => {
    const reply = {
      classes: [
        {
          class: "VFXRecipe",
          properties: [{ name: "AutoActivate", declaredOn: "VFXRecipe", valueSchema: { type: "boolean" } }],
        },
      ],
    };
    const recipe = classOf(await search({ classes: ["VFXRecipe"] }, reply), "VFXRecipe");
    expect(recipe?.note).toContain("studiorpc_vfx_recipe_upsert");
    expect(recipe?.properties?.some((p) => p.source === "sidecar")).toBe(false);
  });

  test("a property Studio publishes wins over the supplement of the same name", async () => {
    const studioPresetName = {
      name: "PresetName",
      declaredOn: "VFXPreset",
      valueSchema: { type: "string", enum: ["Fire"] },
    };
    const output = await search(
      { classes: ["VFXPreset"] },
      { classes: [{ class: "VFXPreset", properties: [studioPresetName] }] },
    );
    const presetNames = classOf(output, "VFXPreset")?.properties?.filter((p) => p.name === "PresetName");
    expect(presetNames).toEqual([{ ...studioPresetName, note: supplementProperties.VFXPreset?.PresetName?.note }]);
  });

  test("a property query Studio cannot match still finds the supplement in a sidecar class entry", async () => {
    const output = await search({ query: "PresetName" }, { classes: [] });
    expect(output.classes).toEqual([
      expect.objectContaining({
        class: "VFXPreset",
        source: "sidecar",
        properties: [expect.objectContaining({ name: "PresetName", source: "sidecar" })],
      }),
    ]);
  });

  test("valueTypes explains exactly the value shapes present in the result", async () => {
    const output = await search(
      { classes: ["FutureWidget"] },
      {
        classes: [
          {
            class: "FutureWidget",
            properties: [
              {
                name: "Tint",
                declaredOn: "FutureWidget",
                valueSchema: { type: "object", struct: "Color3", properties: { R: { type: "integer" } } },
              },
              {
                name: "Target",
                declaredOn: "FutureWidget",
                valueSchema: { type: "object", properties: { Type: { type: "string" }, Value: { type: "number" } } },
              },
            ],
          },
        ],
      },
    );
    expect(output.valueTypes).toEqual({
      Color3: valueTypeNotes.Color3,
      Reference: valueTypeNotes.Reference,
    });
  });

  test("an unexpected Studio result shape passes through unchanged", async () => {
    const reply = { classes: [{ class: "Part", properties: [{ name: "Size" }] }] };
    expect(await search({ classes: ["Part"] }, reply)).toEqual(reply);
  });
});

describe("schema overlay on the full catalog", () => {
  test("adds class notes without property payloads or value types", async () => {
    const output = await search(
      {},
      {
        classes: [
          {
            class: "Part",
            creatable: true,
            service: false,
            properties: [{ name: "Size", declaredOn: "BasePart", valueSchema: {} }],
          },
        ],
      },
    );
    expect(output.classes).toEqual([{ class: "Part", creatable: true, service: false, note: classNotes.Part }]);
    expect(output.valueTypes).toBeUndefined();
  });
});

/**
 * Recorded from a live Studio's targeted instance.schema.search lookups (class -> property -> declaredOn).
 * Re-record it when Studio's schema changes so stale overlay keys surface here instead of silently never applying.
 */
const recorded = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../fixtures/studio-schema-property-index.json"), "utf8"),
) as { classes: Record<string, Record<string, string>> };

function resolves(key: string): boolean {
  const [owner, name] = key.split(".") as [string, string];
  return (
    Object.values(recorded.classes).some((properties) => properties[name] === owner) ||
    recorded.classes[owner]?.[name] !== undefined
  );
}

describe("schema overlay keys against the recorded Studio schema", () => {
  test("every property note and hidden-enum key names a published property", () => {
    const stale = [...Object.keys(propertyNotes), ...Object.keys(hiddenEnumValues)].filter((key) => !resolves(key));
    expect(stale).toEqual([]);
  });

  test("every class note names a recorded class", () => {
    expect(Object.keys(classNotes).filter((name) => recorded.classes[name] === undefined)).toEqual([]);
  });

  test("supplements name recorded classes and only properties Studio does not publish", () => {
    const misplaced = Object.entries(supplementProperties).flatMap(([className, properties]) =>
      Object.keys(properties).filter(
        (name) => recorded.classes[className] === undefined || recorded.classes[className]?.[name] !== undefined,
      ),
    );
    expect(misplaced).toEqual([]);
  });
});
