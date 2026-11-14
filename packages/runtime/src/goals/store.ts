// @summary Append-only goal state ledger independent of the conversation tree
import { appendFile, mkdir, readFile, truncate } from "node:fs/promises";
import { join } from "node:path";
import { type ThreadGoal, ThreadGoalSchema } from "@diligent/protocol";
import { z } from "zod";
import { isSafeSessionId } from "../session/types";
import { chargeableGoalTokens, type GoalUsageSample, goalSampleKey } from "./accounting";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const SampleSchema = z.object({
  executionId: z.string().optional(),
  identity: z.object({ goalId: z.string(), epoch: counter, outerRunId: z.string() }),
  sessionId: z.string(),
  coreTurnId: z.string(),
  inputTokens: counter,
  outputTokens: counter,
  cacheReadTokens: counter,
  cacheWriteTokens: counter,
});
const RecordSchema = z.discriminatedUnion("type", [
  z.object({
    version: z.literal(1),
    sequence: counter.positive(),
    type: z.literal("snapshot"),
    goal: ThreadGoalSchema.nullable(),
    epoch: counter,
    revision: counter,
  }),
  z.object({ version: z.literal(1), sequence: counter.positive(), type: z.literal("usage"), sample: SampleSchema }),
]);
export type GoalLedgerInput =
  | { type: "snapshot"; goal: ThreadGoal | null; epoch: number; revision: number }
  | { type: "usage"; sample: GoalUsageSample };
type GoalLedgerRecord = z.infer<typeof RecordSchema>;
export interface GoalStoredState {
  goal: ThreadGoal | null;
  sequence: number;
  epoch: number;
  revision: number;
  usageKeys: Set<string>;
}

export class GoalStore {
  private state: GoalStoredState = { goal: null, sequence: 0, epoch: 0, revision: 0, usageKeys: new Set() };
  private queue: Promise<void> = Promise.resolve();
  private failure: unknown;
  private closed = false;

  constructor(
    private readonly path: string,
    private readonly sessionId: string,
    records: GoalLedgerRecord[],
  ) {
    for (const record of records) this.apply(record);
  }

  read(): GoalStoredState {
    return {
      ...this.state,
      goal: this.state.goal ? { ...this.state.goal } : null,
      usageKeys: new Set(this.state.usageKeys),
    };
  }

  append(input: GoalLedgerInput): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Goal store is closed"));
    // Capture caller-owned values now, not when a previous write finally settles.
    const snapshot = structuredClone(input);
    const work = this.queue.then(async () => {
      const record = RecordSchema.parse({ ...snapshot, version: 1, sequence: this.state.sequence + 1 });
      if (record.type === "snapshot" && record.goal && record.goal.threadId !== this.sessionId)
        throw new Error("Goal belongs to another session");
      if (record.type === "snapshot" && (record.revision < this.state.revision || record.epoch < this.state.epoch))
        throw new Error("Obsolete goal snapshot");
      await appendFile(this.path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      this.apply(record);
      this.failure = undefined;
    });
    this.queue = work.catch((error: unknown) => {
      this.failure = error;
    });
    return work;
  }

  async flush(): Promise<void> {
    await this.queue;
    if (this.failure) throw this.failure;
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  private apply(record: GoalLedgerRecord): void {
    if (record.sequence !== this.state.sequence + 1) throw new Error("Corrupt goal ledger sequence");
    this.state.sequence = record.sequence;
    if (record.type === "snapshot") {
      if (record.goal && record.goal.threadId !== this.sessionId) throw new Error("Goal belongs to another session");
      if (record.revision < this.state.revision || record.epoch < this.state.epoch)
        throw new Error("Obsolete goal snapshot");
      this.state.goal = record.goal;
      this.state.epoch = record.epoch;
      this.state.revision = record.revision;
      return;
    }
    const key = goalSampleKey(record.sample);
    if (this.state.usageKeys.has(key)) return;
    this.state.usageKeys.add(key);
    if (this.state.goal?.id !== record.sample.identity.goalId) return;
    this.state.goal.tokensUsed += chargeableGoalTokens(record.sample);
    this.state.goal.cacheReadTokens += record.sample.cacheReadTokens;
  }
}

export async function openGoalStore(sessionsDir: string, sessionId: string): Promise<GoalStore> {
  if (!isSafeSessionId(sessionId)) throw new Error(`Invalid session ID: ${sessionId}`);
  const dir = join(sessionsDir, "goals");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // A crashed append may leave an incomplete last record. Remove that tail before appending.
  const end = content.lastIndexOf("\n") + 1;
  const records = content
    .slice(0, end)
    .split("\n")
    .filter(Boolean)
    .map((line) => RecordSchema.parse(JSON.parse(line)));
  const store = new GoalStore(path, sessionId, records);
  if (end !== content.length) await truncate(path, Buffer.byteLength(content.slice(0, end)));
  return store;
}
