// @summary Preserves live Studio JSON properties while protecting tool-owned identity and hierarchy.
import { z } from "zod";

const instanceMetadataKeys = new Set(["ActorGuid", "ObjectKey", "InstanceType", "LuaChildren", "Name", "Parent"]);
const derivedPropertyKeys = new Set(["WorldTransform"]);
// Validate each input key before Zod builds the output record and omits __proto__.
const propertyNameSchema = z
  .string()
  .refine((key) => !instanceMetadataKeys.has(key), {
    message: "Use the dedicated identity or hierarchy tool fields.",
  })
  .refine((key) => !derivedPropertyKeys.has(key), {
    message: "WorldTransform is a derived cache. Query instance.schema.search for writable transform properties.",
  })
  .refine((key) => key !== "__proto__", {
    message: "The __proto__ property key is not supported for writes.",
  });

export const instancePropertiesSchema = z.record(propertyNameSchema, z.unknown()).default({});

/** Keeps Studio JSON values, including read-only caches, while separating identity fields. */
export function pickInstanceProperties(node: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([key]) => !instanceMetadataKeys.has(key)));
}
