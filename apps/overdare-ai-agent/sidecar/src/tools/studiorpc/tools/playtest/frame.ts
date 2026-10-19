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

export const MAX_CHECK_DETAIL_BYTES = 2048;
const checkSchema = z
  .object({
    id: z.string().min(1).max(128),
    basis: z.enum(["requirement", "auxiliary"]),
    description: z.string().min(1).max(512).optional(),
    status: z.enum(["pending", "pass", "fail"]),
    detail: jsonRecordSchema.optional(),
  })
  .strict()
  .refine(
    (check) => !check.detail || Buffer.byteLength(JSON.stringify(check.detail), "utf8") <= MAX_CHECK_DETAIL_BYTES,
    {
      message: `check detail must be at most ${MAX_CHECK_DETAIL_BYTES} UTF-8 bytes; keep only the facts that decided the verdict`,
    },
  );

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
    checks: z.array(checkSchema).max(32).optional(),
  })
  .strict();

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
export type PlaytestExpectation = z.infer<typeof expectationSchema>;
export type PlaytestIntent = z.infer<typeof intentSchema>;
export type PlaytestAction = Omit<z.infer<typeof actionSchema>, "events"> & { events: InputEvent[] };
export type PlaytestDecisionCandidate = Pick<PlaytestAction, "id" | "description">;
export interface PlaytestDecisionContext {
  actorId?: string;
  userId?: string;
  goal?: string;
  activeIntent?: { id: string; elapsedMs: number };
  recentActions?: Array<{
    actionId: string;
    intentId?: string;
    result: "effect_confirmed" | "effect_unconfirmed" | "not_checked";
  }>;
}
export type PlaytestCheck = z.infer<typeof checkSchema>;
export type PlaytestCheckBasis = PlaytestCheck["basis"];
export type PlaytestCheckStatus = PlaytestCheck["status"];
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

/** Integer-only input fields. Luau numbers are doubles, so arithmetic like `dist/speed*1000` yields fractions. */
const INTEGER_EVENT_FIELDS = ["durationMs", "timeoutMs"] as const;

function roundIntegerEventFields(event: unknown): unknown {
  if (!isJsonRecord(event)) return event;
  let rounded: Record<string, unknown> | undefined;
  for (const field of INTEGER_EVENT_FIELDS) {
    const value = event[field];
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      rounded ??= { ...event };
      rounded[field] = Math.round(value);
    }
  }
  return rounded ?? event;
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
        action.events = normalizeLuauArray(value.events, `actions[${index + 1}].events`).map(roundIntegerEventFields);
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
  if (Object.hasOwn(input, "checks")) normalized.checks = normalizeLuauArray(input.checks, "checks");
  if (isJsonRecord(input.coverage)) {
    const coverage = { ...input.coverage };
    if (Object.hasOwn(coverage, "targets")) coverage.targets = normalizeLuauArray(coverage.targets, "coverage.targets");
    if (Object.hasOwn(coverage, "observed"))
      coverage.observed = normalizeLuauArray(coverage.observed, "coverage.observed");
    normalized.coverage = coverage;
  }
  return normalized;
}

const OVERSIZE_REPORT_LIMIT_BYTES = 8 * 1024 * 1024;

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** Names the largest frame sections so an oversized adapter can be fixed without guessing. */
function oversizeBreakdown(input: string): string {
  if (Buffer.byteLength(input, "utf8") > OVERSIZE_REPORT_LIMIT_BYTES) return "";
  let decoded: unknown;
  try {
    decoded = JSON.parse(input);
  } catch {
    return "";
  }
  if (!isJsonRecord(decoded)) return "";
  const sections: Array<[string, number]> = [];
  for (const [key, value] of Object.entries(decoded)) {
    if (key === "state" && isJsonRecord(value)) {
      for (const [stateKey, stateValue] of Object.entries(value))
        sections.push([`state.${stateKey}`, jsonBytes(stateValue)]);
    } else {
      sections.push([key, jsonBytes(value)]);
    }
  }
  const largest = sections
    .sort(([, left], [, right]) => right - left)
    .slice(0, 5)
    .map(([path, bytes]) => `${path}=${bytes}`);
  return largest.length ? `; largest sections: ${largest.join(", ")}` : "";
}

/** Parses and validates a StringValue payload or already-decoded frame object. */
export function parsePlaytestFrame(input: unknown): PlaytestFrame {
  let candidate = input;
  if (typeof input === "string") {
    const bytes = Buffer.byteLength(input, "utf8");
    if (bytes > MAX_FRAME_JSON_BYTES) {
      throw new Error(
        `Playtest frame exceeds ${MAX_FRAME_JSON_BYTES} UTF-8 bytes (${bytes})${oversizeBreakdown(input)}. ` +
          "Publish current facts only: report verdicts through checks, transient logs through events/api.emit, and keep history out of state.",
      );
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

  const checkIds = new Set<string>();
  for (const check of parsed.data.checks ?? []) {
    if (checkIds.has(check.id)) throw new Error(`Invalid playtest frame: duplicate check id ${check.id}`);
    checkIds.add(check.id);
  }

  const frame = { ...parsed.data, actions };
  // Transitional root frames may omit actors (or carry incomplete actor data).
  // They are withheld by the runner, not treated as an adapter parse failure.
  if (frame.ready !== false && Object.hasOwn(frame.state, "multiplayerActors")) parseMultiplayerActors(frame);
  return frame;
}

const actorSchema = z
  .object({
    actorId: z.string().min(1).max(128),
    userId: z.string().min(1).max(128),
    position: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict(),
    state: jsonRecordSchema,
    decisionState: jsonRecordSchema,
    actions: z.array(z.unknown()).max(16),
    progress: progressSchema,
    terminal: playtestFrameSchema.shape.terminal,
  })
  .strict();

/**
 * Accepts the protocol array (or Luau numeric-key table) and, for adapters that index actors by id,
 * a map whose keys equal each entry's actorId. Keys sort so actor order is stable across frames.
 */
function normalizeActorList(value: unknown): unknown[] {
  if (isJsonRecord(value)) {
    const entries = Object.entries(value);
    const keyedById =
      entries.length > 0 && entries.every(([key, actor]) => isJsonRecord(actor) && actor.actorId === key);
    if (keyedById) return entries.sort(([left], [right]) => left.localeCompare(right)).map(([, actor]) => actor);
  }
  return normalizeLuauArray(value, "state.multiplayerActors");
}

export interface MultiplayerActor {
  actorId: string;
  userId: string;
  position: { x: number; y: number; z: number };
  state: Record<string, unknown>;
  decisionState: Record<string, unknown>;
  actions: PlaytestAction[];
  progress: PlaytestProgress;
  terminal?: PlaytestTerminal;
}

/** Authoritative shared snapshot only. No main character/UI facts are inherited by peers. */
export function parseMultiplayerActors(frame: PlaytestFrame): MultiplayerActor[] {
  const values = normalizeActorList(frame.state.multiplayerActors);
  if (values.length !== 2)
    throw new Error(`Two-player frames require exactly two multiplayerActors, got ${values.length}`);
  const actors = values.map((value) => {
    if (!isJsonRecord(value)) throw new Error("Invalid multiplayer actor");
    const normalized = normalizeFrameArrays({ actions: value.actions }) as Record<string, unknown>;
    const actor = actorSchema.parse({ ...value, actions: normalized.actions });
    const projected = parsePlaytestFrame({
      protocolVersion: 1,
      harnessId: frame.harnessId,
      revision: frame.revision,
      gameTimeSeconds: frame.gameTimeSeconds,
      state: {},
      actions: actor.actions,
    });
    for (const action of projected.actions) {
      for (const event of action.events) {
        if (event.type === "key") continue;
        if (event.type === "wait" && !event.until) continue;
        if ((event.type === "pointerMove" || event.type === "pointerButton") && event.position && !event.target)
          continue;
        throw new Error(
          `Multiplayer action ${action.id} requires keys, unconditional waits or normalized pointer positions; main-targeted lookups are forbidden`,
        );
      }
    }
    return { ...actor, actions: projected.actions } as MultiplayerActor;
  });
  if (new Set(actors.map((a) => a.actorId)).size !== 2 || new Set(actors.map((a) => a.userId)).size !== 2)
    throw new Error("multiplayerActors must have unique actorId and userId");
  return actors;
}

export function projectActorFrame(frame: PlaytestFrame, actorId: string): PlaytestFrame {
  const actor = parseMultiplayerActors(frame).find((a) => a.actorId === actorId);
  if (!actor) throw new Error(`Authoritative snapshot lost actor ${actorId}`);
  return {
    protocolVersion: frame.protocolVersion,
    harnessId: frame.harnessId,
    ready: frame.ready,
    revision: frame.revision,
    gameTimeSeconds: frame.gameTimeSeconds,
    state: actor.state,
    decisionState: actor.decisionState,
    actions: actor.actions,
    progress: actor.progress,
    terminal: actor.terminal,
    // Inventory declarations are shared; observations/events are not actor-local.
    ...(frame.coverage ? { coverage: { targets: frame.coverage.targets } } : {}),
  };
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
