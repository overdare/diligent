// @summary Discovers instance JSON editing schemas from the running Studio build.
import { z } from "zod";

export const method = "instance.schema.search";
export const readOnly = true;
export const description =
  "Search live Studio instance JSON editing schemas by case-insensitive class/property substring, exact classes, or both. Returns schemaVersion and classes with class, creatable, service, and properties (name, declaredOn, optional writeCondition/valueSchema). Check creatable before creation and write conditions/value hints before JSON edits. A class-name match includes all exposed properties. This is not the complete Luau member API. No limit or cursor. Read-only; no local schema files required.";
export const params = z
  .object({
    query: z.string().min(1).optional().describe("Case-insensitive substring of a class or property name."),
    classes: z.array(z.string().min(1)).min(1).max(20).optional().describe("One to twenty exact class names."),
  })
  .strict()
  .refine((value) => value.query !== undefined || value.classes !== undefined, {
    message: "query or classes is required",
  });
