// @summary Durable goal lifecycle and run ownership, independent of any client or model
import { type GoalChange, GoalChangeSchema, type ThreadGoal } from "@diligent/protocol";
import type { SessionRunOutcome } from "../session/types";
import { chargeableGoalTokens, type GoalRunIdentity, type GoalUsageSample, goalSampleKey } from "./accounting";
import type { GoalStore } from "./store";

export interface GoalWorkScope {
  identity: GoalRunIdentity;
  signal: AbortSignal;
  startedAt: number;
  recordUsage(sample: Omit<GoalUsageSample, "identity">): void;
  childStarted(id: string): void;
  childFinished(id: string): void;
}
interface GoalHost {
  changed: (snapshot: { goal: ThreadGoal | null; sequence: number }) => Promise<void>;
  wake: (delayMs?: number) => void;
}
export class GoalController {
  private goal: ThreadGoal | null;
  private epoch: number;
  private revision: number;
  private readonly usageKeys: Set<string>;
  private cancellation = new AbortController();
  private children = new Set<string>();
  private noProgress = 0;
  private retries = 0;
  private retryNotBefore = 0;
  private activeRunId?: string;
  private writes: Promise<void> = Promise.resolve();
  private failure: unknown;
  private constructor(
    private store: GoalStore,
    private threadId: string,
    private host: GoalHost,
  ) {
    const state = store.read();
    this.goal = state.goal;
    this.epoch = state.epoch;
    this.revision = state.revision;
    this.usageKeys = state.usageKeys;
  }
  static async open(store: GoalStore, threadId: string, host: GoalHost): Promise<GoalController> {
    const controller = new GoalController(store, threadId, host);
    if (controller.goal?.status === "active") await controller.pause("restart");
    return controller;
  }
  read(): { goal: ThreadGoal | null; sequence: number } {
    return { goal: this.goal ? { ...this.goal } : null, sequence: this.store.read().sequence };
  }
  async snapshot(): Promise<{ goal: ThreadGoal | null; sequence: number }> {
    await this.writes;
    // Recover storage/notification availability without ever resuming autonomous work.
    if (this.failure) await this.save(true);
    await this.flush();
    const state = this.store.read();
    return { goal: state.goal, sequence: state.sequence };
  }
  get hasChildren(): boolean {
    return this.children.size > 0;
  }
  wake(): void {
    if (this.goal?.status === "active") this.host.wake(Math.max(0, this.retryNotBefore - Date.now()));
  }
  async close(): Promise<void> {
    await this.pause("shutdown");
    await this.flush();
    await this.store.close();
  }
  private enqueue(write: Promise<void>, recovery = false): void {
    this.writes = Promise.all([this.writes, write])
      .then(async () => {
        // Already queued writes may succeed after a failure. Only an explicit
        // paused recovery snapshot may publish again or clear the failure latch.
        if (this.failure && !recovery) return;
        const state = this.store.read();
        await this.host.changed({ goal: state.goal, sequence: state.sequence });
        if (recovery) this.failure = undefined;
      })
      .catch((error: unknown) => {
        this.failure = error;
        this.invalidate();
        if (this.goal) this.goal = { ...this.goal, status: "paused", reason: "persistence_error" };
      });
  }
  async flush(): Promise<void> {
    await this.writes;
    await this.store.flush();
    if (this.failure) throw this.failure;
  }
  private save(recovery = false): Promise<void> {
    this.revision++;
    if (this.goal) this.goal = { ...this.goal, revision: this.revision, updatedAt: Date.now() };
    this.enqueue(
      this.store.append({ type: "snapshot", goal: this.goal, epoch: this.epoch, revision: this.revision }),
      recovery,
    );
    return this.flush();
  }
  private invalidate(): void {
    this.epoch++;
    this.activeRunId = undefined;
    this.cancellation.abort();
    this.cancellation = new AbortController();
  }
  async pause(reason: string): Promise<void> {
    if (this.goal?.status !== "active") return;
    this.invalidate();
    this.goal.status = "paused";
    this.goal.reason = reason;
    await this.save();
  }
  async change(
    input: GoalChange,
    options: { idle: boolean; enabled: boolean; mode: string; defaultMaxTurns?: number },
  ): Promise<void> {
    const change = GoalChangeSchema.parse(input);
    if (change.action !== "set") {
      if (!this.goal || change.expectedGoalId !== this.goal.id || change.expectedRevision !== this.goal.revision)
        throw new Error("Goal revision conflict; reload the current goal");
    } else if (change.expectedRevision !== undefined && change.expectedRevision !== this.revision)
      throw new Error("Goal revision conflict");
    if (change.action === "set" && this.goal && change.expectedRevision === undefined)
      throw new Error("Goal replacement requires the current expected revision");
    if (["set", "edit", "resume"].includes(change.action)) {
      if (!options.enabled) throw new Error("Goal mode is disabled; enable goals.enabled in configuration");
      if (!options.idle) throw new Error("Wait for the running turn and its cleanup before changing the goal");
      if (options.mode === "plan") throw new Error("Goal execution is unavailable in plan mode");
      if (this.children.size > 0) throw new Error("Wait for goal-owned children to settle");
    }
    if (change.action === "pause") {
      await this.pause("user");
      return;
    }
    if (change.action === "clear") {
      this.invalidate();
      this.goal = null;
      await this.save();
      return;
    }
    if (change.action === "set") {
      if (this.goal && this.goal.status !== "complete")
        throw new Error("An unfinished goal exists; edit or clear it first");
      this.invalidate();
      this.noProgress = 0;
      this.retries = 0;
      this.retryNotBefore = 0;
      const now = Date.now();
      this.goal = {
        id: crypto.randomUUID(),
        threadId: this.threadId,
        revision: this.revision,
        objective: change.objective,
        status: "active",
        tokenBudget: change.tokenBudget,
        maxTurns: change.maxTurns ?? options.defaultMaxTurns ?? 20,
        turnsUsed: 0,
        tokensUsed: 0,
        cacheReadTokens: 0,
        activeTimeMs: 0,
        accountingScope: "reported_agent_tokens",
        createdAt: now,
        updatedAt: now,
      };
    } else if (change.action === "edit") {
      if (this.goal!.status === "complete") throw new Error("Completed goals cannot be edited; set a new goal instead");
      if (this.goal!.status === "active") throw new Error("Pause the goal before editing it");
      this.goal = {
        ...this.goal!,
        objective: change.objective,
        tokenBudget: change.tokenBudget ?? this.goal!.tokenBudget,
        maxTurns: change.maxTurns ?? this.goal!.maxTurns,
      };
    } else {
      if (this.goal!.status === "complete" || this.goal!.status === "active")
        throw new Error("This goal cannot be resumed");
      if (this.limited()) throw new Error("Raise the exhausted limit before resuming");
      this.invalidate();
      this.noProgress = 0;
      this.retries = 0;
      this.retryNotBefore = 0;
      this.goal!.status = "active";
      this.goal!.reason = undefined;
    }
    await this.save();
    if (this.goal?.status === "active") this.host.wake();
  }
  private limited(): boolean {
    return (
      !!this.goal &&
      (this.goal.turnsUsed >= this.goal.maxTurns ||
        (this.goal.tokenBudget !== undefined && this.goal.tokensUsed >= this.goal.tokenBudget))
    );
  }
  private limit(): void {
    if (!this.goal) return;
    this.invalidate();
    this.goal.status = "budget_limited";
    this.goal.reason =
      this.goal.tokenBudget !== undefined && this.goal.tokensUsed >= this.goal.tokenBudget
        ? "token_budget"
        : "turn_limit";
    void this.save().catch(() => {});
  }
  isCurrent(identity: GoalRunIdentity): boolean {
    return (
      this.goal?.id === identity.goalId &&
      this.epoch === identity.epoch &&
      this.activeRunId === identity.outerRunId &&
      this.goal.status === "active"
    );
  }
  async beginRun(): Promise<GoalWorkScope | null> {
    if (this.goal?.status !== "active") return null;
    if (this.children.size > 0) return null;
    if (this.activeRunId) throw new Error("A goal run is already active");
    if (this.limited()) {
      this.limit();
      await this.flush();
      return null;
    }
    const identity = { goalId: this.goal.id, epoch: this.epoch, outerRunId: crypto.randomUUID() };
    this.activeRunId = identity.outerRunId;
    this.goal.turnsUsed++;
    const scope: GoalWorkScope = {
      identity,
      signal: this.cancellation.signal,
      startedAt: Date.now(),
      recordUsage: (sample) => this.recordUsage({ ...sample, identity }),
      childStarted: (id) => {
        this.children.add(id);
      },
      childFinished: (id) => {
        this.children.delete(id);
        if (!this.children.size && !this.activeRunId && this.goal?.status === "active")
          this.host.wake(Math.max(0, this.retryNotBefore - Date.now()));
      },
    };
    await this.save();
    return this.isCurrent(identity) ? scope : null;
  }
  recordUsage(sample: GoalUsageSample): void {
    const key = goalSampleKey(sample);
    if (this.usageKeys.has(key)) return;
    this.usageKeys.add(key);
    this.enqueue(this.store.append({ type: "usage", sample }));
    if (this.goal?.id !== sample.identity.goalId) return;
    this.goal.tokensUsed += chargeableGoalTokens(sample);
    this.goal.cacheReadTokens += sample.cacheReadTokens;
    // Synchronous abort before the core can dispatch the just-sampled tool batch.
    if (this.goal.tokenBudget !== undefined && this.goal.tokensUsed >= this.goal.tokenBudget) {
      if (this.goal.status === "active") this.limit();
      else if (
        this.goal.status === "complete" &&
        this.epoch === sample.identity.epoch &&
        this.activeRunId === sample.identity.outerRunId
      ) {
        // Completion may still have a final response in flight. Keep its verified
        // status, but do not allow that response to bypass the execution cap.
        this.cancellation.abort();
      }
    }
  }
  async report(identity: GoalRunIdentity, status: "complete" | "blocked", evidence: string): Promise<void> {
    if (!this.isCurrent(identity)) throw new Error("Stale goal execution");
    if (!evidence.trim()) throw new Error("Non-empty evidence or a blocking reason is required");
    if (status === "complete" && this.children.size)
      throw new Error("Wait for goal-owned children before declaring completion");
    this.goal!.status = status;
    if (status === "complete") this.goal!.completionEvidence = evidence.trim();
    else {
      this.goal!.reason = evidence.trim();
      this.invalidate();
    }
    await this.save();
  }
  async settle(scope: GoalWorkScope, outcome: SessionRunOutcome, usedTools: boolean): Promise<void> {
    const owned =
      this.goal?.id === scope.identity.goalId &&
      this.epoch === scope.identity.epoch &&
      this.activeRunId === scope.identity.outerRunId;
    if (this.goal?.id === scope.identity.goalId) {
      this.goal.activeTimeMs += Math.max(0, Date.now() - scope.startedAt);
      if (owned && this.goal.status === "complete" && outcome.status === "failed") {
        this.goal.status = "blocked";
        this.goal.reason = `Completion cleanup failed: ${outcome.error.message}`;
        this.goal.completionEvidence = undefined;
      }
      await this.save();
    }
    const current = this.isCurrent(scope.identity);
    if (this.activeRunId === scope.identity.outerRunId) this.activeRunId = undefined;
    if (!current) return;
    let delay = 0;
    if (outcome.status === "interrupted") {
      await this.pause("interrupted");
      return;
    }
    if (outcome.status === "failed") {
      const error = outcome.error;
      if (error.providerErrorReason === "usage_limit_reached") {
        this.goal!.status = "usage_limited";
        this.goal!.reason = error.message;
      } else if (
        error.isRetryable &&
        ["network", "server_error", "rate_limit"].includes(error.providerErrorType ?? "") &&
        this.retries < 3
      ) {
        delay = Math.min(60_000, Math.max(error.retryAfterMs ?? 0, 1000 * 2 ** this.retries++));
      } else {
        this.goal!.status = "blocked";
        this.goal!.reason = error.message;
      }
    } else {
      this.retries = 0;
      this.noProgress = usedTools || this.children.size > 0 ? 0 : this.noProgress + 1;
      if (this.noProgress >= 3) {
        this.goal!.status = "blocked";
        this.goal!.reason = "no_progress";
      }
    }
    this.retryNotBefore = Date.now() + delay;
    if (this.goal?.status !== "active") this.invalidate();
    await this.save();
    if (this.goal?.status === "active") {
      if (this.limited()) {
        this.limit();
        await this.flush();
      } else this.host.wake(delay);
    }
  }
}
