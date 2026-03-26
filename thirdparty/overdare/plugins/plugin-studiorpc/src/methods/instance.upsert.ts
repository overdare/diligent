// @summary Defines batched argument schemas for instance upserts.
import { z } from "zod";
import {
  classPropertiesSchemas,
  classPropertyShapes,
  instanceClassEnum,
  instancePropertiesSchema,
  serviceClassEnum,
} from "./instance.params.ts";

const addParams = z
  .object({
    class: instanceClassEnum,
    parentGuid: z.string(),
    name: z.string(),
    properties: instancePropertiesSchema,
  })
  .strict();

const updateParams = z
  .object({
    guid: z.string(),
    name: z.string().optional(),
    properties: instancePropertiesSchema,
  })
  .strict();

const itemParams = z
  .union([addParams, updateParams])
  .describe(
    "Each item is inferred by its fields: add uses parentGuid/class/name/properties, update uses guid/(optional name)/properties.",
  );

export const params = z
  .object({
    items: z
      .array(itemParams)
      .min(1)
      .max(10)
      .describe(
        "Batch items inferred as add or update by their fields. Start with a small number first, then increase up to 10 if needed.",
      ),
  })
  .strict();

export const method = "instance.upsert";

export const description =
  "Upsert instances in batch. Start with a small number of items first, then increase up to 10 if needed. Each item is inferred by its fields: add uses parentGuid/class/name/properties, update uses guid with optional name and properties. To create nested hierarchies, add the parent first so its GUID is returned, then add children using that GUID as parentGuid in subsequent items. Services (Workspace, Lighting, Atmosphere, Players, StarterPlayer, MaterialService, etc.) are singletons — they cannot be added, only updated by guid.";

export type InstanceUpsertAddArgs = z.infer<typeof addParams>;
export type InstanceUpsertUpdateArgs = z.infer<typeof updateParams>;
export type InstanceUpsertItemArgs = InstanceUpsertAddArgs | InstanceUpsertUpdateArgs;
export type InstanceUpsertArgs = z.infer<typeof params>;

export function isUpdateItem(value: InstanceUpsertItemArgs): value is InstanceUpsertUpdateArgs {
  return "guid" in value && typeof value.guid === "string";
}

/**
 * Validates properties of each item against the class-specific schema for precise error messages.
 * Falls back to the raw ZodError if no class-specific issues are found.
 */
export function parseArgs(value: Record<string, unknown>): InstanceUpsertArgs {
  const result = params.safeParse(value);
  if (result.success) return result.data;

  // Attempt class-aware re-validation for actionable error messages
  const items = Array.isArray(value.items) ? (value.items as Record<string, unknown>[]) : [];
  const details: string[] = [];
  const serviceClasses = new Set<string>(serviceClassEnum.options);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    const cls = typeof item.class === "string" ? item.class : undefined;
    if (cls && serviceClasses.has(cls)) {
      details.push(`  [items[${i}]] "${cls}" is a Service — it cannot be added, only updated by guid.`);
      continue;
    }
    validateItemProperties(item, `items[${i}]`, details);
  }

  if (details.length > 0) {
    throw new Error(details.join("\n"));
  }
  // No class-specific issues found — throw the original zod error
  throw result.error;
}

/**
 * For update items (no `class` field), find the best-matching class by key overlap
 * so we can validate against the right schema and give precise errors.
 */
function inferClassFromProperties(props: Record<string, unknown>): string | undefined {
  const propKeys = Object.keys(props);
  if (propKeys.length === 0) return undefined;

  let bestClass: string | undefined;
  let bestOverlap = 0;

  for (const [name, shapes] of Object.entries(classPropertyShapes)) {
    const shapeKeys = Object.keys(shapes);
    let overlap = 0;
    for (const key of propKeys) {
      if (shapeKeys.includes(key)) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestClass = name;
    }
  }

  return bestClass;
}

function validateItemProperties(item: Record<string, unknown>, path: string, details: string[]): void {
  const className = typeof item.class === "string" ? item.class : undefined;
  const props = item.properties;
  if (props == null || typeof props !== "object") return;

  const resolvedClass = className ?? inferClassFromProperties(props as Record<string, unknown>);
  if (!resolvedClass) return;

  const schema = classPropertiesSchemas.get(resolvedClass);
  if (!schema) return;

  const r = schema.safeParse(props);
  if (!r.success) {
    const label = className ? `class=${resolvedClass}` : `closest match: ${resolvedClass}`;
    for (const issue of r.error.issues) {
      const loc = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
      details.push(`  [${path}.properties${loc}] (${label}) ${issue.message}`);
    }
  }
}
