// @summary Normalizes union and oversized function schemas for Gemini tool compatibility.
import { collapseComposition, projectRootObjectSchema } from "../object-schema";
import { isSchemaObject as isRecord, type JsonSchema, mapJsonSchema } from "../tool-schema";

const DEFAULT_MAX_SCHEMA_BYTES = 32_000;
const PROPERTY_CAPS = [128, 64, 32, 16, 8] as const;

export function normalizeGeminiToolSchema(schema: JsonSchema, maxSchemaBytes = DEFAULT_MAX_SCHEMA_BYTES): JsonSchema {
  const compatible = projectRootObjectSchema(schema);
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

function simplifySchema(value: unknown): unknown {
  return mapJsonSchema(value, (schema) => collapseComposition(schema, "anyOf"));
}
