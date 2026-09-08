// @summary Preserves live Studio JSON properties while protecting tool-owned identity and hierarchy.
import { z } from "zod";
import { classPropertiesSchemas, instanceClassEnum } from "./instance.params";

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

const creatableClasses = new Set<string>(instanceClassEnum.options);

function classSchema(className: string): z.AnyZodObject {
  const schema = classPropertiesSchemas.get(className);
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`Unsupported instance class: ${className}`);
  }
  return schema;
}

function propertyRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Instance properties must be an object.");
  }
  return instancePropertiesSchema.parse(value);
}

function formatIssues(className: string, error: z.ZodError): Error {
  return new Error(
    error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
        return `  [properties${path}] (class=${className}) ${issue.message}`;
      })
      .join("\n"),
  );
}

/** Validates a newly-created instance and returns schema defaults. */
export function parseInstanceCreateProperties(className: string, value: unknown): Record<string, unknown> {
  if (!creatableClasses.has(className)) {
    throw new Error(`Unsupported creatable instance class: ${className}`);
  }
  const result = classSchema(className).safeParse(propertyRecord(value));
  if (!result.success) throw formatIssues(className, result.error);
  return result.data;
}

/** Validates only supplied update keys and never injects create defaults. */
export function parseInstancePatchProperties(className: string, value: unknown): Record<string, unknown> {
  const raw = propertyRecord(value);
  const result = classSchema(className).partial().safeParse(raw);
  if (!result.success) throw formatIssues(className, result.error);
  return Object.fromEntries(Object.keys(raw).map((key) => [key, result.data[key]]));
}
