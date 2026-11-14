// @summary Treats an empty value on an optional parameter as the parameter not being given.
import { z } from "zod";
export function dropEmptyOptionals(schema: z.ZodTypeAny, input: unknown): unknown {
  const shape = objectShape(schema, input);
  if (!shape || !isPlainObject(input)) return input;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const field = shape[key];
    if (!field) {
      out[key] = value; // Unknown to the schema — let validation have its say.
      continue;
    }
    const cleaned = dropEmptyOptionals(field, value);
    if (isEmpty(cleaned) && isOptional(field)) continue;
    out[key] = cleaned;
  }
  return out;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStrictObject(schema: z.ZodTypeAny): boolean {
  let current: z.ZodType | undefined = schema;
  for (let depth = 0; current && depth < 10; depth += 1) {
    if (current instanceof z.ZodObject) return current.def.catchall instanceof z.ZodNever;
    current = unwrap(current);
  }
  return false;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  try {
    return schema.isOptional();
  } catch {
    return false;
  }
}

/** Unwraps Zod wrappers and selects a strict union branch only when input keys identify exactly one. */
function objectShape(schema: z.ZodTypeAny, input: unknown): Record<string, z.ZodTypeAny> | undefined {
  let current: z.ZodType | undefined = schema;
  for (let depth = 0; current && depth < 10; depth += 1) {
    if (current instanceof z.ZodObject) return current.shape;
    if (current instanceof z.ZodUnion || current instanceof z.ZodDiscriminatedUnion) {
      const branches = (current.options as z.ZodType[])
        .map((option) => ({ option, shape: objectShape(option, input) }))
        .filter((branch): branch is { option: z.ZodTypeAny; shape: Record<string, z.ZodTypeAny> } => {
          return branch.shape !== undefined;
        });
      if (branches.length === 1) return branches[0].shape;
      if (!isPlainObject(input) || !branches.every((branch) => isStrictObject(branch.option))) return undefined;
      const keys = Object.keys(input);
      const fits = branches.filter((branch) => keys.every((key) => key in branch.shape));
      return fits.length === 1 ? fits[0].shape : undefined;
    }
    current = unwrap(current);
  }
  return undefined;
}

function unwrap(schema: z.ZodType): z.ZodType | undefined {
  if ("unwrap" in schema && typeof schema.unwrap === "function") return schema.unwrap() as z.ZodType;
  if (schema instanceof z.ZodPipe) {
    return (schema.in instanceof z.ZodTransform ? schema.out : schema.in) as z.ZodType;
  }
  return undefined;
}
