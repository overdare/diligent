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
export const instancePropertiesSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (reservedKeys.has(key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Use the dedicated identity or hierarchy tool fields.",
        });
    }
  })
  .optional();

export function parseInstanceCreateProperties(_className: string, value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      if (reservedKeys.has(key)) throw new Error(`Property ${key} is controlled by the instance tool envelope.`);
    }
  }
  return instancePropertiesSchema.parse(value) ?? {};
}

export function parseInstancePatchProperties(className: string, value: unknown): Record<string, unknown> {
  return parseInstanceCreateProperties(className, value);
}

/** Keeps Studio's JSON value shapes, including tags and future class properties. */
export function pickKnownInstanceProperties(
  _className: string,
  node: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([key]) => !reservedKeys.has(key)));
}
