// @summary Single source of truth for the JSON Schema a function tool advertises to models.

import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "./types";

/**
 * The canonical object-shaped JSON Schema for a function tool, before provider adaptation.
 *
 * The `type: "object"` tag is part of the type on purpose: Anthropic rejects the whole request
 * with `tools.N.custom.input_schema.type: Field required` when it is missing. This makes the
 * required root type explicit; adapters handle additional provider-specific restrictions.
 */
export type ObjectJsonSchema = Record<string, unknown> & { type: "object" };

/**
 * Derives the schema advertised to the model: the raw `inputSchema` when the tool carries one
 * (e.g. MCP tools, whose schema is not Zod-authored), otherwise a conversion of its Zod
 * `parameters`.
 *
 * Zod schemas whose top level is a union (`z.union`, `z.discriminatedUnion`) convert to
 * `{ anyOf: [...] }`, which carries no `type`. The branches already describe every accepted
 * shape, so tag the canonical schema as an object instead of rewriting or merging them.
 * Provider adapters handle wire compatibility, including unsupported root compositions.
 */
export function toToolInputSchema(tool: Pick<Tool, "parameters" | "inputSchema">): ObjectJsonSchema {
  return asObjectJsonSchema(tool.inputSchema ?? stripSchemaKeyword(zodToJsonSchema(tool.parameters)));
}

/**
 * Re-applies the object-schema invariant after a provider rewrites a schema for its own
 * constraints, so a transform cannot silently drop the `type` tag on the way out.
 */
export function asObjectJsonSchema(schema: Record<string, unknown>): ObjectJsonSchema {
  return (schema.type === "object" ? schema : { ...schema, type: "object" }) as ObjectJsonSchema;
}

function stripSchemaKeyword(schema: unknown): Record<string, unknown> {
  const { $schema, ...rest } = schema as Record<string, unknown>;
  return rest;
}
