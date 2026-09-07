// @summary Preserves live Studio JSON properties while protecting tool-owned identity and hierarchy.
import { z } from "zod";

const reservedKeys = new Set([
  "ActorGuid",
  "ObjectKey",
  "InstanceType",
  "LuaChildren",
  "Name",
  "Parent",
  "__proto__",
  "constructor",
  "prototype",
]);
// Validate each input key before Zod builds the output record and omits __proto__.
const propertyNameSchema = z.string().refine((key) => !reservedKeys.has(key), {
  message: "Use the dedicated identity or hierarchy tool fields.",
});

export const instancePropertiesSchema = z.record(propertyNameSchema, z.unknown()).default({});

/** Keeps Studio's JSON value shapes, including tags and future class properties. */
export function pickInstanceProperties(node: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([key]) => !reservedKeys.has(key)));
}
