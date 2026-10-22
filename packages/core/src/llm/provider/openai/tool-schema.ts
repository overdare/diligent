// @summary Adapts function schemas to Responses restrictions shared by OpenAI and ChatGPT
import { type JsonSchema, mapJsonSchema } from "../tool-schema";

/** Like omp's Responses sanitizer, widen oneOf to anyOf and make object properties explicit. */
export function normalizeResponsesToolSchema(schema: JsonSchema): JsonSchema {
  const relocatedBranches = new Map<string, string>();
  let hasReferences = false;
  const normalized = mapJsonSchema(schema, (node, path) => {
    if (typeof node.$ref === "string") hasReferences = true;
    let result = node;
    if (Array.isArray(node.oneOf)) {
      const { oneOf, ...siblings } = node;
      const existing = Array.isArray(node.anyOf) ? node.anyOf : [];
      result = { ...siblings, anyOf: [...existing, ...oneOf] };
      for (let index = 0; index < oneOf.length; index++) {
        relocatedBranches.set(`${path}/oneOf/${index}`, `${path}/anyOf/${existing.length + index}`);
      }
    }
    if (
      (node.type === "object" || (Array.isArray(node.type) && node.type.includes("object"))) &&
      !Object.hasOwn(node, "properties")
    ) {
      result = { ...result, properties: {} };
    }
    return result;
  }) as JsonSchema;

  if (!hasReferences || relocatedBranches.size === 0) return normalized;
  return mapJsonSchema(normalized, (node) => {
    if (typeof node.$ref !== "string" || !node.$ref.startsWith("#/")) return node;
    let ref = node.$ref;
    // Children were visited before parents: relocate inner paths before their enclosing branches.
    for (const [from, to] of relocatedBranches) {
      if (ref === from || ref.startsWith(`${from}/`)) ref = `${to}${ref.slice(from.length)}`;
    }
    return ref === node.$ref ? node : { ...node, $ref: ref };
  }) as JsonSchema;
}
