// @summary Projects root object compositions into provider-compatible fields without schema description dumps
import { isSchemaObject as isRecord, type JsonSchema, mapSchemaChildren } from "./tool-schema";

interface SchemaVariant {
  schema: JsonSchema;
  context?: string;
}

export function projectRootObjectSchema(schema: JsonSchema): JsonSchema {
  const dereferenced = dereferenceSchema(schema, schema, new Set()) as JsonSchema;
  return flattenRootCompositions(dereferenced);
}

/** Expose object arguments without root composition keywords or generated description text. */
function flattenRootCompositions(schema: JsonSchema): JsonSchema {
  let result = schema;
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = result[key];
    if (!Array.isArray(branches)) continue;
    // The canonical tool root is an object, so scalar alternatives cannot match its inputs.
    const variants = branches
      .filter(
        (branch) =>
          key === "allOf" ||
          (branch !== false &&
            (!isRecord(branch) ||
              branch.type === undefined ||
              branch.type === "object" ||
              (Array.isArray(branch.type) && branch.type.includes("object")))),
      )
      .map((branch) => (branch === true ? {} : isRecord(branch) ? flattenRootCompositions(branch) : branch));
    const projected = collapseComposition({ ...result, [key]: variants }, key);
    // Unrepresentable root constraints remain the executor's responsibility.
    const { [key]: remaining, ...object } = projected;
    result = remaining === undefined ? projected : object;
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

export function collapseComposition(schema: JsonSchema, key: "anyOf" | "oneOf" | "allOf"): JsonSchema {
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
