// @summary Merges sidecar notes and supplementary properties into live instance schema search results.
import { z } from "zod";
import {
  classNotes,
  hiddenEnumValues,
  propertyNotes,
  supplementProperties,
  valueTypeNotes,
} from "./instance-schema-overlay.table";

export const overlayHint =
  'note, valueTypes and source:"sidecar" entries come from the sidecar annotation table; Studio-provided fields stay authoritative.';

interface ValueSchema {
  struct?: string;
  enum?: unknown[];
  properties?: Record<string, ValueSchema>;
  items?: ValueSchema;
  [key: string]: unknown;
}
const valueSchema: z.ZodType<ValueSchema> = z.lazy(() =>
  z
    .object({
      struct: z.string().optional(),
      enum: z.array(z.unknown()).optional(),
      properties: z.record(valueSchema).optional(),
      items: valueSchema.optional(),
    })
    .passthrough(),
);
const property = z.object({ name: z.string(), declaredOn: z.string(), valueSchema }).passthrough();
type Property = z.infer<typeof property>;
const classEntry = z.object({ class: z.string(), properties: z.array(property).optional() }).passthrough();
type ClassEntry = z.infer<typeof classEntry>;
const searchResult = z.object({ classes: z.array(classEntry) }).passthrough();

/** Exact class key first, then the declaring class, so inherited properties need one entry. */
function lookup<T>(table: Readonly<Record<string, T>>, className: string, entry: Property): T | undefined {
  return table[`${className}.${entry.name}`] ?? table[`${entry.declaredOn}.${entry.name}`];
}

/** Studio encodes instance references as an untagged {Type: string, Value: number} handle. */
function isReference(schema: ValueSchema): boolean {
  const fields = schema.properties;
  return (
    schema.struct === undefined &&
    fields !== undefined &&
    Object.keys(fields).length === 2 &&
    fields.Type?.type === "string" &&
    fields.Value?.type === "number"
  );
}

/** Records every value type in a schema that has an Editor Luau authoring note. */
function collectValueTypes(schema: ValueSchema | undefined, found: Set<string>): void {
  if (!schema) return;
  if (schema.struct !== undefined && schema.struct in valueTypeNotes) found.add(schema.struct);
  if (schema.enum) found.add("Enum");
  if (isReference(schema)) {
    found.add("Reference");
    return;
  }
  for (const child of Object.values(schema.properties ?? {})) collectValueTypes(child, found);
  collectValueTypes(schema.items, found);
}

function annotateProperty(className: string, entry: Property, valueTypes: Set<string>): Property {
  const hidden = lookup(hiddenEnumValues, className, entry);
  const schema =
    hidden && entry.valueSchema.enum
      ? { ...entry.valueSchema, enum: entry.valueSchema.enum.filter((value) => !hidden.includes(String(value))) }
      : entry.valueSchema;
  collectValueTypes(schema, valueTypes);
  // A supplement Studio has started to publish keeps only its note; Studio's field wins.
  const note = lookup(propertyNotes, className, entry) ?? supplementProperties[className]?.[entry.name]?.note;
  return { ...entry, valueSchema: schema, ...(note !== undefined && { note }) };
}

function matchesQuery(className: string, propertyName: string, query: string): boolean {
  const needle = query.toLowerCase();
  return className.toLowerCase().includes(needle) || propertyName.toLowerCase().includes(needle);
}

function supplementEntries(className: string, present: ReadonlySet<string>, query: string, valueTypes: Set<string>) {
  return Object.entries(supplementProperties[className] ?? {})
    .filter(([name]) => !present.has(name) && matchesQuery(className, name, query))
    .map(([name, supplement]) => {
      collectValueTypes(supplement.valueSchema, valueTypes);
      return { name, ...supplement, source: "sidecar" };
    });
}

function annotateClass(entry: ClassEntry, query: string, valueTypes: Set<string>) {
  const properties = entry.properties ?? [];
  const note = classNotes[entry.class];
  return {
    ...entry,
    ...(note !== undefined && { note }),
    properties: [
      ...properties.map((item) => annotateProperty(entry.class, item, valueTypes)),
      ...supplementEntries(entry.class, new Set(properties.map((item) => item.name)), query, valueTypes),
    ],
  };
}

/** Classes whose supplements match a request even though Studio returned no entry for them. */
function missingSupplementClasses(returned: ReadonlySet<string>, requested: string[] | undefined, query: string) {
  return Object.keys(supplementProperties).filter((className) => {
    if (returned.has(className)) return false;
    if (requested) return requested.includes(className);
    return query !== "";
  });
}

/** Adds sidecar notes, supplementary properties and Luau value-type notes to a property-level search result. */
export function annotateDetailResult(result: unknown, args: { query?: unknown; classes?: unknown }): unknown {
  const parsed = searchResult.safeParse(result);
  if (!parsed.success) return result;
  const query = typeof args.query === "string" ? args.query : "";
  const requested = Array.isArray(args.classes)
    ? args.classes.filter((name): name is string => typeof name === "string")
    : undefined;
  const valueTypes = new Set<string>();
  const classes: Record<string, unknown>[] = parsed.data.classes.map((entry) =>
    annotateClass(entry, query, valueTypes),
  );
  const returned = new Set(parsed.data.classes.map((entry) => entry.class));
  for (const className of missingSupplementClasses(returned, requested, query)) {
    const properties = supplementEntries(className, new Set(), query, valueTypes);
    if (properties.length === 0) continue;
    const note = classNotes[className];
    classes.push({ class: className, source: "sidecar", ...(note !== undefined && { note }), properties });
  }
  const ordered = [...valueTypes].sort();
  return {
    ...parsed.data,
    classes,
    ...(ordered.length > 0 && { valueTypes: Object.fromEntries(ordered.map((name) => [name, valueTypeNotes[name]])) }),
    overlay: overlayHint,
  };
}

/** Adds sidecar class notes to a compact catalog entry. */
export function annotateCatalogEntry<T extends { class?: unknown }>(entry: T): T & { note?: string } {
  const note = typeof entry.class === "string" ? classNotes[entry.class] : undefined;
  return note === undefined ? entry : { ...entry, note };
}
