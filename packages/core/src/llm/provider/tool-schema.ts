// @summary Visits JSON Schema children without treating property names or literal data as schema keywords
export type JsonSchema = Record<string, unknown>;

const SCHEMA_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
]);
const SCHEMA_ARRAY_KEYS = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
const SCHEMA_VALUE_KEYS = new Set([
  "items",
  "additionalItems",
  "additionalProperties",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "propertyNames",
  "contentSchema",
  "not",
  "if",
  "then",
  "else",
]);

export function isSchemaObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copy on change. Paths are JSON Pointers into the original schema, including escaped property names. */
export function mapSchemaChildren(
  schema: JsonSchema,
  visit: (value: unknown, path: string) => unknown,
  path = "#",
): JsonSchema {
  let result = schema;
  for (const [key, child] of Object.entries(schema)) {
    const childPath = `${path}/${key}`;
    let next = child;
    if (SCHEMA_MAP_KEYS.has(key) && isSchemaObject(child)) {
      let mapped = child;
      for (const [name, value] of Object.entries(child)) {
        const escaped = name.replace(/~/g, "~0").replace(/\//g, "~1");
        const entry = visit(value, `${childPath}/${escaped}`);
        if (entry === value) continue;
        if (mapped === child) mapped = { ...child };
        Object.defineProperty(mapped, name, { value: entry, enumerable: true, writable: true, configurable: true });
      }
      next = mapped;
    } else if ((SCHEMA_ARRAY_KEYS.has(key) || key === "items") && Array.isArray(child)) {
      let mapped = child;
      for (let index = 0; index < child.length; index++) {
        const entry = visit(child[index], `${childPath}/${index}`);
        if (entry === child[index]) continue;
        if (mapped === child) mapped = child.slice();
        mapped[index] = entry;
      }
      next = mapped;
    } else if (SCHEMA_VALUE_KEYS.has(key)) {
      next = visit(child, childPath);
    }
    if (next === child) continue;
    if (result === schema) result = { ...schema };
    Object.defineProperty(result, key, { value: next, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

export function mapJsonSchema(
  value: unknown,
  visit: (schema: JsonSchema, path: string) => JsonSchema,
  path = "#",
): unknown {
  if (!isSchemaObject(value)) return value;
  return visit(
    mapSchemaChildren(value, (child, childPath) => mapJsonSchema(child, visit, childPath), path),
    path,
  );
}
