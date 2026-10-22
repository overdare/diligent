// @summary Normalizes union and oversized function schemas for Gemini tool compatibility.
import { isSchemaObject as isRecord, type JsonSchema, mapJsonSchema, mapSchemaChildren } from "../tool-schema";

const DEFAULT_MAX_SCHEMA_BYTES = 32_000;
const PROPERTY_CAPS = [128, 64, 32, 16, 8] as const;

interface SchemaVariant {
  schema: JsonSchema;
  context?: string;
}

export function normalizeGeminiToolSchema(schema: JsonSchema, maxSchemaBytes = DEFAULT_MAX_SCHEMA_BYTES): JsonSchema {
  const dereferenced = dereferenceSchema(schema, schema, new Set()) as JsonSchema;
  const compatible = flattenRootCompositions(dereferenced);
  if (!Number.isFinite(maxSchemaBytes) || JSON.stringify(compatible).length <= maxSchemaBytes) return compatible;
  const normalized = simplifySchema(compatible);
  return trimToSchemaBudget(isRecord(normalized) ? normalized : compatible, maxSchemaBytes);
}

function trimToSchemaBudget(schema: JsonSchema, maxSchemaBytes: number): JsonSchema {
  for (const maxProperties of PROPERTY_CAPS) {
    const trimmed = pruneDanglingRequired(capObjectProperties(schema, maxProperties));
    if (isRecord(trimmed) && JSON.stringify(trimmed).length <= maxSchemaBytes) return trimmed;
  }
  return schema;
}

function capObjectProperties(value: unknown, maxProperties: number): unknown {
  return mapJsonSchema(value, (schema) => {
    if (!isRecord(schema.properties)) return schema;
    const entries = Object.entries(schema.properties);
    if (entries.length <= maxProperties) return schema;
    return { ...schema, properties: Object.fromEntries(entries.slice(0, maxProperties)) };
  });
}

function pruneDanglingRequired(value: unknown): unknown {
  return mapJsonSchema(value, (schema) => {
    if (!Array.isArray(schema.required)) return schema;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = schema.required.filter((name) => typeof name === "string" && Object.hasOwn(properties, name));
    if (required.length > 0) return { ...schema, required };
    const { required: _dropped, ...rest } = schema;
    return rest;
  });
}

/** Fold root object compositions before the Google SDK mistakes them for parameterless tools. */
function flattenRootCompositions(schema: JsonSchema): JsonSchema {
  let result = schema;
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = result[key];
    if (!Array.isArray(branches)) continue;
    const variants = branches.map((branch) => (isRecord(branch) ? flattenRootCompositions(branch) : branch));
    result = collapseComposition({ ...result, [key]: variants }, key);
  }
  return result;
}

function dereferenceSchema(value: unknown, root: JsonSchema, resolvingRefs: Set<string>): unknown {
  // Walk schema positions only: names such as "$defs" and values under const/default are data.
  if (!isRecord(value)) return value;

  const ref = typeof value.$ref === "string" ? value.$ref : undefined;
  if (ref === "#" || ref?.startsWith("#/")) {
    if (resolvingRefs.has(ref)) return {};
    const target = ref === "#" ? root : resolveJsonPointer(root, ref);
    if (target !== undefined) {
      const nextRefs = new Set(resolvingRefs).add(ref);
      const { $ref, ...siblings } = value;
      const dereferenced = dereferenceSchema(target, root, nextRefs);
      if (isRecord(dereferenced)) {
        return dereferenceSchema({ ...dereferenced, ...siblings }, root, nextRefs);
      }
      return dereferenced;
    }
  }

  let node = value;
  if (value.$defs !== undefined || value.definitions !== undefined || value.$schema !== undefined) {
    const { $defs, definitions, $schema, ...rest } = value;
    node = rest;
  }
  return mapSchemaChildren(node, (child) => dereferenceSchema(child, root, resolvingRefs));
}

function resolveJsonPointer(root: JsonSchema, ref: string): unknown {
  let current: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function simplifySchema(value: unknown): unknown {
  return mapJsonSchema(value, (schema) => collapseComposition(schema, "anyOf"));
}

function collapseComposition(schema: JsonSchema, key: "anyOf" | "oneOf" | "allOf"): JsonSchema {
  const branches = schema[key];
  if (!Array.isArray(branches) || branches.length === 0) return schema;
  const variants = deduplicateSchemas(
    key === "allOf" ? branches : branches.filter((variant) => !isImpossibleSchema(variant)),
  );
  if (variants.length === 0 || !variants.every(isObjectSchema)) return { ...schema, [key]: variants };

  const { [key]: _composition, ...siblings } = schema;
  const merged = mergeObjectSchemas(variants, key === "allOf");
  const ownProperties = isRecord(siblings.properties) ? siblings.properties : {};
  const required = [
    ...new Set([
      ...(Array.isArray(merged.required) ? merged.required : []),
      ...(Array.isArray(siblings.required) ? siblings.required : []),
    ]),
  ];
  return {
    ...(variants.length === 1 ? variants[0] : {}),
    ...merged,
    ...siblings,
    properties: { ...(merged.properties as JsonSchema), ...ownProperties },
    ...(required.length > 0 ? { required } : {}),
  };
}

function mergeObjectSchemas(schemas: JsonSchema[], intersect = false): JsonSchema {
  const variantsByProperty = new Map<string, SchemaVariant[]>();

  for (const schema of schemas) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const context = typeof schema.description === "string" ? schema.description : undefined;
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (!isRecord(propertySchema)) continue;
      const variants = variantsByProperty.get(propertyName) ?? [];
      variants.push({ schema: propertySchema, context });
      variantsByProperty.set(propertyName, variants);
    }
  }

  const properties = Object.fromEntries(
    [...variantsByProperty].map(([propertyName, variants]) => [propertyName, mergePropertyVariants(variants)]),
  );
  const requiredSets = schemas.map((schema) => new Set(Array.isArray(schema.required) ? schema.required : []));
  const required = intersect
    ? [...new Set(requiredSets.flatMap((set) => [...set]))]
    : [...(requiredSets[0] ?? [])].filter((name) => requiredSets.every((set) => set.has(name)));

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(schemas.every((schema) => schema.additionalProperties === false) ? { additionalProperties: false } : {}),
  };
}

function mergePropertyVariants(variants: SchemaVariant[]): JsonSchema {
  const unique = new Map<string, SchemaVariant>();
  for (const variant of variants) {
    const fingerprint = JSON.stringify(variant.schema);
    const existing = unique.get(fingerprint);
    if (!existing) {
      unique.set(fingerprint, { ...variant });
    } else if (variant.context && existing.context !== variant.context) {
      existing.context = [existing.context, variant.context].filter(Boolean).join(" ");
    }
  }

  const entries = [...unique.values()];
  if (entries.length === 1) return entries[0]!.schema;
  return {
    anyOf: entries.map(({ schema, context }) =>
      context
        ? {
            ...schema,
            description: `${context}${typeof schema.description === "string" ? ` ${schema.description}` : ""}`,
          }
        : schema,
    ),
    description: "The accepted value shape depends on the selected object variant.",
  };
}

function deduplicateSchemas(values: unknown[]): unknown[] {
  const unique = new Map<string, unknown>();
  for (const value of values) unique.set(JSON.stringify(value), value);
  return [...unique.values()];
}

function isObjectSchema(value: unknown): value is JsonSchema {
  return isRecord(value) && (value.type === "object" || value.type === undefined);
}

function isImpossibleSchema(value: unknown): boolean {
  return isRecord(value) && isRecord(value.not) && Object.keys(value.not).length === 0;
}
