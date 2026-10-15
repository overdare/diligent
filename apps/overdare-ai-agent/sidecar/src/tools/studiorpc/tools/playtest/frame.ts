// @summary Playtest adapter frame validation and bounded input batch checks.
import { z } from "zod";
import {
  expandWithOrigin,
  type InputEvent,
  inputEventsSchema,
  MAX_EVENT_COUNT,
  validateBatch,
} from "../pie-input/events";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const jsonRecordSchema = z.record(z.string(), jsonValueSchema);
const expectationValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

const expectationSchema = z
  .object({
    key: z.string().min(1),
    op: z.enum(["change", "increase", "decrease", "equals"]),
    value: expectationValueSchema.optional(),
  })
  .strict()
  .refine((value) => value.op !== "equals" || Object.hasOwn(value, "value"), {
    message: "equals expectations require a value",
  });

const intentSchema = z
  .object({
    id: z.string().min(1).max(128),
    description: z.string().min(1).max(512),
    validityKey: z.string().min(1).max(256),
    completeWhen: z.array(expectationSchema).min(1).max(16),
  })
  .strict();

const actionSchema = z
  .object({
    id: z.string().min(1).max(128),
    coverageKey: z.string().min(1).max(128).optional(),
    description: z.string().min(1).max(512),
    events: z.array(z.unknown()).min(1).max(MAX_EVENT_COUNT),
    validityKey: z.string().max(256).optional(),
    expiresAtGameTime: z.number().finite().nonnegative().optional(),
    expectations: z.array(expectationSchema).max(16).optional(),
    intent: intentSchema.optional(),
  })
  .strict();

const frameEventSchema = z
  .object({
    id: z.string().min(1).max(256),
    level: z.enum(["info", "warning", "error"]).optional(),
    message: z.string().min(1).max(1024),
    data: jsonRecordSchema.optional(),
  })
  .strict();

const harnessErrorSchema = z.object({ message: z.string().min(1).max(2048) }).strict();
const coverageTargetSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum(["action", "state", "event"]),
    description: z.string().min(1).max(512),
    source: z.string().max(512).optional(),
  })
  .strict();
const coverageSchema = z
  .object({
    targets: z.array(coverageTargetSchema).max(128),
    observed: z.array(z.string().min(1).max(128)).max(128).optional(),
  })
  .strict();

const progressSchema = z
  .object({
    sequence: z.number().int().nonnegative().safe(),
    waiting: z
      .object({
        reason: z.string().min(1).max(512),
        timeoutMs: z.number().int().min(1).max(180000),
      })
      .strict()
      .optional(),
  })
  .strict();

const playtestFrameSchema = z
  .object({
    protocolVersion: z.literal(1),
    harnessId: z.string().min(1).max(256),
    ready: z.boolean().optional(),
    revision: z.number().int().nonnegative().safe(),
    gameTimeSeconds: z.number().finite().nonnegative(),
    state: jsonRecordSchema,
    decisionState: jsonRecordSchema.optional(),
    coverage: coverageSchema.optional(),
    progress: progressSchema.optional(),
    actions: z.array(actionSchema).max(16),
    terminal: z
      .object({
        outcome: z.enum(["success", "failure"]),
        reason: z.string().max(1024).optional(),
      })
      .strict()
      .optional(),
    error: harnessErrorSchema.optional(),
    events: z.array(frameEventSchema).max(64).optional(),
  })
  .strict();

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
export type PlaytestExpectation = z.infer<typeof expectationSchema>;
export type PlaytestIntent = z.infer<typeof intentSchema>;
export type PlaytestAction = Omit<z.infer<typeof actionSchema>, "events"> & { events: InputEvent[] };
export type PlaytestDecisionCandidate = Pick<PlaytestAction, "id" | "description">;
export interface PlaytestDecisionContext {
  activeIntent?: { id: string; elapsedMs: number };
  recentActions?: Array<{
    actionId: string;
    intentId?: string;
    result: "effect_confirmed" | "effect_unconfirmed" | "not_checked";
  }>;
}
export type PlaytestFrameEvent = z.infer<typeof frameEventSchema>;
export type PlaytestTerminal = z.infer<typeof playtestFrameSchema>["terminal"];
export type PlaytestCoverageTarget = z.infer<typeof coverageTargetSchema>;
export type PlaytestProgress = z.infer<typeof progressSchema>;
export type PlaytestFrame = Omit<z.infer<typeof playtestFrameSchema>, "actions"> & {
  actions: PlaytestAction[];
};

export const MAX_FRAME_JSON_BYTES = 256 * 1024;

function normalizeLuauArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isJsonRecord(value)) throw new Error(`${path} must be an array or a Luau numeric-key table`);
  const entries = Object.entries(value);
  if (entries.length === 0) return [];
  const numeric = entries
    .map(([key, item]) => {
      if (!/^[1-9]\d*$/.test(key) || String(Number(key)) !== key) {
        throw new Error(`${path} has non-array key ${JSON.stringify(key)}`);
      }
      return [Number(key), item] as const;
    })
    .sort(([left], [right]) => left - right);
  for (let index = 0; index < numeric.length; index += 1) {
    if (numeric[index][0] !== index + 1) {
      throw new Error(`${path} numeric keys must be contiguous from 1`);
    }
  }
  return numeric.map(([, item]) => item);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Luau JSONEncode writes arrays as numeric-key objects; normalize only protocol array fields. */
function normalizeFrameArrays(input: unknown): unknown {
  if (!isJsonRecord(input)) return input;
  const normalized: Record<string, unknown> = { ...input };
  if (Object.hasOwn(input, "actions")) {
    normalized.actions = normalizeLuauArray(input.actions, "actions").map((value, index) => {
      if (!isJsonRecord(value)) return value;
      const action: Record<string, unknown> = { ...value };
      if (Object.hasOwn(value, "events"))
        action.events = normalizeLuauArray(value.events, `actions[${index + 1}].events`);
      if (Object.hasOwn(value, "expectations")) {
        action.expectations = normalizeLuauArray(value.expectations, `actions[${index + 1}].expectations`);
      }
      if (isJsonRecord(value.intent)) {
        const intent: Record<string, unknown> = { ...value.intent };
        if (Object.hasOwn(intent, "completeWhen")) {
          intent.completeWhen = normalizeLuauArray(intent.completeWhen, `actions[${index + 1}].intent.completeWhen`);
        }
        action.intent = intent;
      }
      return action;
    });
  }
  if (Object.hasOwn(input, "events")) normalized.events = normalizeLuauArray(input.events, "events");
  if (isJsonRecord(input.coverage)) {
    const coverage = { ...input.coverage };
    if (Object.hasOwn(coverage, "targets")) coverage.targets = normalizeLuauArray(coverage.targets, "coverage.targets");
    if (Object.hasOwn(coverage, "observed"))
      coverage.observed = normalizeLuauArray(coverage.observed, "coverage.observed");
    normalized.coverage = coverage;
  }
  return normalized;
}

/** Parses and validates a StringValue payload or already-decoded frame object. */
export function parsePlaytestFrame(input: unknown): PlaytestFrame {
  let candidate = input;
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > MAX_FRAME_JSON_BYTES) {
      throw new Error(`Playtest frame exceeds ${MAX_FRAME_JSON_BYTES} UTF-8 bytes`);
    }
    try {
      candidate = JSON.parse(input) as unknown;
    } catch (error) {
      throw new Error(`Playtest frame is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  candidate = normalizeFrameArrays(candidate);

  const parsed = playtestFrameSchema.safeParse(candidate);
  if (!parsed.success) {
    const diagnostic = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "frame"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid playtest frame: ${diagnostic}`);
  }

  const actions: PlaytestAction[] = [];
  const seenIds = new Set<string>();
  const seenIntentIds = new Set<string>();
  const intentActionCount = parsed.data.actions.filter((action) => action.intent !== undefined).length;
  if (intentActionCount > 0 && intentActionCount !== parsed.data.actions.length) {
    throw new Error("Invalid playtest frame: actions cannot mix intent-tagged and legacy actions");
  }
  for (const action of parsed.data.actions) {
    if (seenIds.has(action.id)) throw new Error(`Invalid playtest frame: duplicate action id ${action.id}`);
    seenIds.add(action.id);
    if (action.intent) {
      if (seenIntentIds.has(action.intent.id)) {
        throw new Error(`Invalid playtest frame: duplicate intent id ${action.intent.id}`);
      }
      seenIntentIds.add(action.intent.id);
    }
    let events: InputEvent[];
    try {
      events = inputEventsSchema.parse(action.events);
    } catch (error) {
      throw new Error(
        `Invalid playtest action ${action.id} events: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const expanded = expandWithOrigin(events);
    if (expanded.sent.length > MAX_EVENT_COUNT) {
      throw new Error(`Invalid playtest action ${action.id}: expanded input exceeds ${MAX_EVENT_COUNT} events`);
    }
    const batchError = validateBatch(expanded.sent, expanded.origin);
    if (batchError) throw new Error(`Invalid playtest action ${action.id}: ${batchError}`);
    actions.push({ ...action, events });
  }

  return { ...parsed.data, actions };
}

/** Recursively removes source-like payloads and caps event diagnostics before logging. */
export function safeTraceValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 1024);
  if (depth >= 5) return "[depth-limited]";
  if (Array.isArray(value)) return value.slice(0, 32).map((entry) => safeTraceValue(entry, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 64)) {
      if (key.toLowerCase() === "rawsource") continue;
      result[key.slice(0, 128)] = safeTraceValue(entry, depth + 1);
    }
    return result;
  }
  return String(value).slice(0, 256);
}
