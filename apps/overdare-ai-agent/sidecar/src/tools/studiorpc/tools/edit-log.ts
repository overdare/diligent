// @summary Parses complete Studio transactions and renders bounded change summaries.

import { isRecord } from "./ovdrjm-utils";

/**
 * Studio appends one JSON envelope per finalized edit transaction.
 * Optional Origin metadata attributes MCP sessions; legacy records have unknown authorship.
 * Studio recreates the file when it is missing, which is what makes the
 * rotate-and-delete consumption model safe.
 *
 * Studio writes a single `Edit.Log` in the project root, next to the .umap.
 */

export function isStudioEditLogSourceName(name: string): boolean {
  return /^edit\.log(?:\.[a-z0-9]+-\d+\.consuming)?$/i.test(name);
}

export interface ParsedEditLog {
  envelopes: EditLogEnvelope[];
  failures: number;
  incomplete: boolean;
  consumedChars: number;
}

/** Complete value boundaries are retained so a rotated writer can finish a tail later. */
export function parseEditLogText(text: string): ParsedEditLog {
  const result: ParsedEditLog = { envelopes: [], failures: 0, incomplete: false, consumedChars: 0 };
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index])) {
      result.consumedChars = ++index;
      continue;
    }
    if (text[index] !== "{" && text[index] !== "[") {
      result.failures++;
      do {
        index++;
      } while (index < text.length && text[index] !== "{" && text[index] !== "[");
      result.consumedChars = index;
      continue;
    }
    const start = index;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (; index < text.length; index++) {
      const ch = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          index++;
          break;
        }
      }
    }
    if (depth !== 0 || quoted) {
      result.incomplete = true;
      break;
    }
    try {
      const parsed: unknown = JSON.parse(text.slice(start, index));
      for (const value of Array.isArray(parsed) ? parsed : [parsed]) {
        const envelope = isRecord(value) ? toEnvelope(value) : undefined;
        if (envelope) result.envelopes.push(envelope);
        else result.failures++;
      }
    } catch {
      result.failures++;
    }
    result.consumedChars = index;
  }
  return result;
}

/** Byte budgets conservatively approximate 1,500 / 2,000 tokens; not a tokenizer guarantee. */
export const STUDIO_CHANGES_LIMITS = {
  targetBytes: 6_000,
  maxBytes: 8_000,
  maxTargets: 20,
  maxProperties: 4,
  maxListItems: 3,
  maxValueChars: 80,
} as const;

/**
 * Section headings of the rendered summary. The web notice re-parses these out of
 * the text to show a change count, so renaming one here silently breaks that count
 * — `studiorpc-studio-changes.test.ts` asserts the two lists stay in step.
 */
export const SECTION_TITLES = {
  added: "Added",
  addedThenRemoved: "Added then removed",
  removed: "Removed",
  moved: "Moved",
  modified: "Modified",
  sourceChanged: "Script source changed",
} as const;

export const TURN_START_HEADER = "Studio changes collected at turn start:";
export const MID_TURN_HEADER = "Studio changes recorded during this turn:";
export const NO_EDITS_MESSAGE = "No Studio changes recorded in the collected edit log.";

interface EditLogChange {
  property: string;
  before?: unknown;
  after?: unknown;
  added?: unknown[];
  removed?: unknown[];
  modified?: Array<Record<string, unknown>>;
}

interface EditLogObject {
  guid: string;
  name?: string;
  type?: string;
  role?: string;
  action?: string;
  changes: EditLogChange[];
}

export interface EditLogEnvelope {
  origin?: { kind?: string; sessionId?: string; connectionId?: string; studioInstanceId?: string };
  timestamp: string;
  operation?: string;
  subjectGuids: string[];
  objects: EditLogObject[];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** First present key wins. Studio logs use PascalCase; docs and older builds used lowercase. */
function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/**
 * Tolerant field mapping. Real Studio logs (2026-08) use PascalCase throughout
 * (`Timestamp`/`Action`/`ActorGuids`/`Objects`/`Changes`/`Property`/`Added`);
 * the planning docs used lowercase plus `operation`/`subjectGuids`. Both are
 * accepted, along with ActorGuid/ObjectGuid naming drift.
 */
function toEnvelope(value: Record<string, unknown>): EditLogEnvelope | undefined {
  const rawObjects = (asArray(pick(value, "objects", "Objects")) ?? []).filter(isRecord);
  const objects: EditLogObject[] = [];
  for (const raw of rawObjects) {
    const guid = asString(pick(raw, "ActorGuid", "ObjectGuid"));
    if (!guid) continue;
    const changes: EditLogChange[] = [];
    for (const change of (asArray(pick(raw, "changes", "Changes")) ?? []).filter(isRecord)) {
      const property = asString(pick(change, "property", "Property"));
      if (!property) continue;
      changes.push({
        property,
        before: pick(change, "before", "Before"),
        after: pick(change, "after", "After"),
        added: asArray(pick(change, "added", "Added")),
        removed: asArray(pick(change, "removed", "Removed")),
        modified: asArray(pick(change, "modified", "Modified"))?.filter(isRecord),
      });
    }
    objects.push({
      guid,
      name: asString(pick(raw, "Name", "name")),
      type: asString(pick(raw, "InstanceType", "instanceType")),
      role: asString(pick(raw, "role", "Role")),
      action: asString(pick(raw, "action", "Action")),
      changes,
    });
  }
  if (objects.length === 0) return undefined;
  return {
    timestamp: asString(pick(value, "timestamp", "Timestamp")) ?? "",
    origin: isRecord(value.Origin)
      ? {
          kind: asString(value.Origin.Kind),
          sessionId: asString(value.Origin.SessionId),
          connectionId: asString(value.Origin.ConnectionId),
          studioInstanceId: asString(value.Origin.StudioInstanceId),
        }
      : undefined,
    operation: asString(pick(value, "operation", "Operation", "action", "Action")),
    subjectGuids: [
      ...asStringArray(pick(value, "subjectGuids", "SubjectGuids")),
      ...asStringArray(pick(value, "ActorGuids", "ObjectGuids")),
    ],
    objects,
  };
}

/** Per-instance aggregate accumulated across all envelopes in a batch. */
interface TargetSummary {
  guid: string;
  name?: string;
  type?: string;
  created: boolean;
  removed: boolean;
  reparent?: { from?: string; to?: string };
  /** property -> earliest before / latest after across the batch. */
  props: Map<
    string,
    { before?: string; after?: string; beforeIdentity?: string; afterIdentity?: string; count: number }
  >;
  /** list-typed property -> rendered delta lines. */
  lists: Map<string, { added: string[]; removed: string[]; modified: string[] }>;
  /** Semantic group edits, not readable instance properties. */
  gizmoChanges: Map<"Position/orientation" | "Size", number>;
  sourceEdits: number;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "(none)");
}

function short(value: string | undefined): string {
  const text = value ?? "(none)";
  return text.length > STUDIO_CHANGES_LIMITS.maxValueChars
    ? `${text.slice(0, STUDIO_CHANGES_LIMITS.maxValueChars)}…`
    : text;
}

/** Render one element of a list delta: plain string, or {Name, InstanceType, ObjectGuid} reference. */
function formatListItem(item: unknown): string {
  if (isRecord(item)) {
    const name = asString(item.Name);
    const type = asString(item.InstanceType);
    if (name || type) return `${type ?? "Instance"} "${name ?? "?"}"`;
  }
  return formatValue(item);
}

/** Best-effort identity of a modified struct element (e.g. an Attribute's Key). */
function formatModifiedItem(item: Record<string, unknown>): string {
  // Every other field goes through pick(); these nested elements must too, or a
  // PascalCase log (what Studio actually writes) renders as undefined -> undefined.
  const before = pick(item, "before", "Before");
  const after = pick(item, "after", "After");
  const key =
    (isRecord(before) ? asString(before.Key) : undefined) ?? (isRecord(after) ? asString(after.Key) : undefined);
  const label = key ? `"${key}": ` : "";
  return `${label}${formatValue(before)} -> ${formatValue(after)}`;
}

const CREATE_ACTION = /create/i;
const REMOVE_ACTION = /delete|remove|destroy/i;

/**
 * True for the records that carry the transaction's direct subjects. Older logs have
 * no `role`; there, an envelope-level subject list is the fallback filter.
 */
function isSubject(object: EditLogObject, envelope: EditLogEnvelope): boolean {
  if (object.role === "auxiliary") return false;
  if (object.role === "subject") return true;
  if (envelope.subjectGuids.length > 0) return envelope.subjectGuids.includes(object.guid);
  return true;
}

function applyChange(target: TargetSummary, change: EditLogChange): void {
  if (change.property === "GroupCFrame" || change.property === "GroupSize") {
    // Studio emits synthetic properties for Model/Folder gizmo edits. Report
    // only the change: instance.read cannot read these properties, and size
    // values are per-edit scale factors (Before is always 1), not dimensions.
    const kind = change.property === "GroupCFrame" ? "Position/orientation" : "Size";
    target.gizmoChanges.set(kind, (target.gizmoChanges.get(kind) ?? 0) + 1);
    return;
  }
  if (change.property === "Source") {
    // 2026-08-10 decision: script edits log only "changed", never content.
    target.sourceEdits++;
    return;
  }
  if (change.property === "Parent" && (change.before !== undefined || change.after !== undefined)) {
    target.reparent = {
      from: target.reparent?.from ?? formatValue(change.before),
      to: formatValue(change.after),
    };
    return;
  }
  if (change.added || change.removed || change.modified) {
    let list = target.lists.get(change.property);
    if (!list) {
      list = { added: [], removed: [], modified: [] };
      target.lists.set(change.property, list);
    }
    for (const item of change.added ?? []) list.added.push(formatListItem(item));
    for (const item of change.removed ?? []) list.removed.push(formatListItem(item));
    for (const item of change.modified ?? []) list.modified.push(formatModifiedItem(item));
    return;
  }
  // Scalar before/after: collapse repeated edits (gizmo drags) to first-before -> last-after.
  const entry = target.props.get(change.property) ?? { count: 0 };
  if (entry.count === 0) {
    entry.before = formatValue(change.before);
    entry.beforeIdentity = JSON.stringify(change.before);
  }
  entry.after = formatValue(change.after);
  entry.afterIdentity = JSON.stringify(change.after);
  entry.count++;
  target.props.set(change.property, entry);
}

function aggregate(envelopes: EditLogEnvelope[]): Map<string, TargetSummary> {
  const targets = new Map<string, TargetSummary>();
  const targetFor = (guid: string): TargetSummary => {
    let target = targets.get(guid);
    if (!target) {
      target = {
        guid,
        created: false,
        removed: false,
        props: new Map(),
        lists: new Map(),
        gizmoChanges: new Map(),
        sourceEdits: 0,
      };
      targets.set(guid, target);
    }
    return target;
  };
  for (const envelope of envelopes) {
    for (const object of envelope.objects) {
      if (!isSubject(object, envelope)) continue;
      const target = targetFor(object.guid);
      target.name = object.name ?? target.name;
      target.type = object.type ?? target.type;
      const action = object.action ?? envelope.operation ?? "";
      if (CREATE_ACTION.test(action)) {
        target.created = true;
        target.removed = false; // re-created after a delete
      } else if (REMOVE_ACTION.test(action)) {
        target.removed = true;
      }
      for (const change of object.changes) {
        if (REMOVE_ACTION.test(action) && change.property === "Descendants") {
          // Explicit flattened cascade references are deletions, not selected subjects
          // or ordinary list changes. LuaChildren removals can also mean reparenting.
          for (const ref of change.removed ?? []) {
            if (!isRecord(ref)) continue;
            const guid = asString(pick(ref, "ActorGuid", "ObjectGuid"));
            if (!guid || guid === object.guid) continue;
            const descendant = targetFor(guid);
            descendant.name = asString(pick(ref, "Name", "name")) ?? descendant.name;
            descendant.type = asString(pick(ref, "InstanceType", "instanceType")) ?? descendant.type;
            descendant.removed = true;
          }
        } else applyChange(target, change);
      }
    }
  }
  return targets;
}

export type StudioChangeType = keyof typeof SECTION_TITLES;

function label(target: TargetSummary): string {
  return `${short(target.type ?? "Instance")} "${short(target.name ?? target.guid)}" (${short(target.guid)})`;
}

interface Detail {
  property: string;
  lines: string[];
  omittedItems: number;
}

function details(target: TargetSummary, expanded = false): Detail[] {
  const result: Detail[] = [];
  for (const [kind, count] of target.gizmoChanges) {
    result.push({
      property: kind,
      lines: [`  ${kind} changed via gizmo${count > 1 ? ` (${count} edits)` : ""}`],
      omittedItems: 0,
    });
  }
  for (const [property, entry] of target.props) {
    if (entry.beforeIdentity === entry.afterIdentity) continue;
    result.push({
      property,
      lines: [
        `  ${short(property)}: ${short(entry.before)} -> ${short(entry.after)}${entry.count > 1 ? ` (${entry.count} edits)` : ""}`,
      ],
      omittedItems: 0,
    });
  }
  for (const [property, delta] of target.lists) {
    const lines: string[] = [];
    let omittedItems = 0;
    let remaining = expanded ? Number.POSITIVE_INFINITY : STUDIO_CHANGES_LIMITS.maxListItems;
    for (const kind of ["added", "removed", "modified"] as const) {
      const items = delta[kind];
      const shown = items.slice(0, remaining);
      remaining -= shown.length;
      omittedItems += items.length - shown.length;
      if (expanded) {
        for (const item of shown) lines.push(`  ${short(property)}: ${kind} ${short(item)}`);
      } else if (shown.length) {
        lines.push(`  ${short(property)}: ${kind} ${shown.map(short).join(", ")}`);
      }
    }
    if (omittedItems) lines.push(`  ${short(property)}: ${omittedItems} list items omitted`);
    if (lines.length) result.push({ property, lines, omittedItems });
  }
  // Identity and reference changes are useful even when a transform-heavy edit
  // exhausts the per-object property budget.
  return result.sort((a, b) => propertyPriority(a.property) - propertyPriority(b.property));
}

function propertyPriority(property: string): number {
  return /^(Name|Tag|Attribute)$|reference|refobject|assetid/i.test(property) ? 0 : 1;
}

function kinds(target: TargetSummary): StudioChangeType[] {
  if (target.created && target.removed) return ["addedThenRemoved"];
  if (target.removed) return ["removed"];
  const result: StudioChangeType[] = [];
  if (target.created) result.push("added");
  else {
    if (target.reparent && target.reparent.from !== target.reparent.to) result.push("moved");
    const hasProperties = [...target.props.values()].some((entry) => entry.beforeIdentity !== entry.afterIdentity);
    const hasLists = [...target.lists.values()].some(
      (delta) => delta.added.length || delta.removed.length || delta.modified.length,
    );
    if (hasProperties || hasLists || target.gizmoChanges.size) result.push("modified");
  }
  if (target.sourceEdits) result.push("sourceChanged");
  return result;
}

function priority(target: TargetSummary): number {
  const types = kinds(target);
  if (types.includes("sourceChanged")) return 0;
  if (types.includes("removed")) return 1;
  if (types.includes("moved")) return 2;
  if ([...target.props.keys(), ...target.lists.keys()].some((key) => propertyPriority(key) === 0)) return 3;
  if (types.includes("added")) return 4;
  return 5;
}

function eventLine(target: TargetSummary, kind: StudioChangeType): string {
  const identity = label(target);
  switch (kind) {
    case "added":
      return `+ ${identity}`;
    case "addedThenRemoved":
      return `+- ${identity}`;
    case "removed":
      return `- ${identity}`;
    case "moved":
      return `> ${identity}: parent ${short(target.reparent?.from)} -> ${short(target.reparent?.to)}`;
    case "modified":
      return `~ ${identity}`;
    case "sourceChanged":
      return `* ${identity}: source edited ${target.sourceEdits} time(s); content is not logged; read the script for its current state`;
  }
}

const ATTRIBUTION =
  "Explicit MCP records for this session are excluded when session attribution is available. " +
  "Legacy or unattributed records do not identify who made the changes and may include this session's own work. " +
  "This is a collected log summary, not a diff against your work. " +
  "Compare these changes with your own work; if anything differs from what you expect, inspect the affected instances before editing.";

export interface EditLogSummary {
  output: string;
  editCount: number;
  shownTargets: number;
  omittedTargets: number;
}

export interface EditLogSummaryOptions {
  footer?: string;
}

/** A single byte/target budget covers all sections, including counts and recovery instructions. */
export function summarizeEditLog(
  envelopes: EditLogEnvelope[],
  parseFailures = 0,
  header = TURN_START_HEADER,
  options: EditLogSummaryOptions = {},
): EditLogSummary {
  const targets = [...aggregate(envelopes).values()].filter((target) => kinds(target).length);
  const counts = Object.fromEntries(Object.keys(SECTION_TITLES).map((key) => [key, 0])) as Record<
    StudioChangeType,
    number
  >;
  for (const target of targets) for (const kind of kinds(target)) counts[kind]++;
  const editCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (!editCount) return { output: NO_EDITS_MESSAGE, editCount: 0, shownTargets: 0, omittedTargets: 0 };

  const selected: TargetSummary[] = [];
  const footer = options.footer ?? 'Use studiorpc_studio_changes with view="details" to inspect omitted changes.';
  const transientTypes = new Map<string, number>();
  for (const target of targets.filter((t) => kinds(t).includes("addedThenRemoved"))) {
    const type = target.type ?? "Instance";
    transientTypes.set(type, (transientTypes.get(type) ?? 0) + 1);
  }
  const render = (): string => {
    const parts = [header, ATTRIBUTION];
    let omittedProperties = 0;
    let omittedItems = 0;
    for (const kind of Object.keys(SECTION_TITLES) as StudioChangeType[]) {
      if (!counts[kind]) continue;
      const entries: string[] = [];
      if (kind === "addedThenRemoved") {
        entries.push(
          [...transientTypes.entries()]
            .slice(0, 3)
            .map(([type, count]) => `${short(type)}: ${count}`)
            .join(", "),
        );
        if (transientTypes.size > 3) entries.push(`(${transientTypes.size - 3} more types)`);
      } else {
        for (const target of selected.filter((t) => kinds(t).includes(kind))) {
          const lines = [eventLine(target, kind)];
          if (kind === "added" || kind === "modified") {
            const all = details(target);
            const shown = all.slice(0, STUDIO_CHANGES_LIMITS.maxProperties);
            lines.push(...shown.flatMap((detail) => detail.lines));
            const omitted = all.length - shown.length;
            omittedProperties += omitted;
            omittedItems += all.reduce((sum, detail) => sum + detail.omittedItems, 0);
            if (omitted) lines.push(`  ${omitted} properties omitted`);
          }
          entries.push(lines.join("\n"));
        }
        const omitted = counts[kind] - entries.length;
        if (omitted) entries.push(`(${omitted} entries omitted)`);
      }
      parts.push(`${SECTION_TITLES[kind]} (${counts[kind]}):\n${entries.join("\n")}`);
    }
    parts.push(
      `${selected.length} of ${targets.length} objects detailed; ${targets.length - selected.length} objects, ${omittedProperties} properties and ${omittedItems} list items omitted from detail.`,
    );
    if (parseFailures) parts.push(`(${parseFailures} log entries could not be parsed and were skipped.)`);
    parts.push(footer);
    return parts.join("\n\n");
  };
  for (const target of targets
    .filter((t) => !kinds(t).includes("addedThenRemoved"))
    .sort((a, b) => priority(a) - priority(b))) {
    if (selected.length >= STUDIO_CHANGES_LIMITS.maxTargets) break;
    selected.push(target);
    if (Buffer.byteLength(render(), "utf8") > STUDIO_CHANGES_LIMITS.targetBytes) selected.pop();
  }
  return {
    output: render(),
    editCount,
    shownTargets: selected.length,
    omittedTargets: targets.length - selected.length,
  };
}

export interface StudioChangeDetailsOptions {
  guid?: string;
  changeType?: StudioChangeType;
  offset?: number;
  limit?: number;
  /** Remaining budget after the caller reserves its header and continuation text. */
  maxBytes?: number;
}

/** Page detail rows rather than objects, so a single object with many properties remains queryable. */
export function studioChangeDetails(envelopes: EditLogEnvelope[], options: StudioChangeDetailsOptions = {}) {
  const rows: string[] = [];
  for (const target of aggregate(envelopes).values()) {
    if (options.guid && target.guid !== options.guid) continue;
    for (const kind of kinds(target)) {
      if (options.changeType && kind !== options.changeType) continue;
      if (kind === "modified" || kind === "added") {
        const changes = details(target, true).flatMap((detail) => detail.lines);
        if (changes.length) for (const line of changes) rows.push(`${eventLine(target, kind)}\n${line}`);
        else rows.push(eventLine(target, kind));
      } else rows.push(eventLine(target, kind));
    }
  }
  const offset = options.offset ?? 0;
  const limit = Math.min(options.limit ?? 20, 20);
  const shown: string[] = [];
  const maxBytes = Math.min(options.maxBytes ?? STUDIO_CHANGES_LIMITS.targetBytes, STUDIO_CHANGES_LIMITS.targetBytes);
  for (const row of rows.slice(offset, offset + limit)) {
    if (Buffer.byteLength(shown.concat(row).join("\n"), "utf8") > maxBytes) break;
    shown.push(row);
  }
  const end = offset + shown.length;
  return { output: shown.join("\n"), total: rows.length, nextOffset: end < rows.length ? end : undefined };
}
