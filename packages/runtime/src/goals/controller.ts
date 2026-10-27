// @summary Durable goal lifecycle and run ownership, independent of any client or model
import { type GoalChange, GoalChangeSchema, type ThreadGoal } from "@diligent/protocol";
import type { SessionRunOutcome } from "../session/types";
import { chargeableGoalTokens, type GoalRunIdentity, type GoalUsageSample, goalSampleKey } from "./accounting";
import { renderBudgetLimitPrompt, renderContinuationPrompt, renderUserTurnNote } from "./prompts";
import type { GoalStore } from "./store";
import { NON_WORK_TOOLS } from "./tools";

export interface GoalWorkScope {
  identity: GoalRunIdentity;
  signal: AbortSignal;
  /** Cancels goal-owned subagents; also aborts when the run itself is invalidated. */
  childSignal: AbortSignal;
  startedAt: number;
  recordUsage(sample: Omit<GoalUsageSample, "identity">): void;
  noteTool(name: string): void;
  childStarted(id: string): void;
  childFinished(id: string): void;
}
interface GoalHost {
  changed: (snapshot: { goal: ThreadGoal | null; sequence: number }) => Promise<void>;
  wake: (delayMs?: number) => void;
}
interface GoalRunState {
  id: string;
  workTools: number;
  objectiveEdited: boolean;
  interruptTools?: () => void;
  /** Set when the token budget is crossed inside this run; the run may write one text-only wrap-up reply. */
  wrapUp?: { injected: boolean; stopped: boolean };
}
type AutoResumeReason = "user_turn" | "config_reload";
export interface GoalAutoResumeOptions {
  enabled: boolean;
  mode: string;
}
const BLOCKED_AUDIT_RUNS = 3;
const NO_PROGRESS_RUNS = 3;

export class GoalController {
  private goal: ThreadGoal | null;
  private epoch: number;
  private revision: number;
  private readonly usageKeys: Set<string>;
  private cancellation = new AbortController();
  private childCancellation = new AbortController();
  private children = new Set<string>();
  private noProgress = 0;
  private retries = 0;
  private retryNotBefore = 0;
  private runsSinceStart = 0;
  private objectiveEdited = false;
  private lastBlockedClaim?: string;
  /** In-memory only: a restart never resumes automatically. */
  private autoResume?: { reason: AutoResumeReason; goalId: string; turnId?: string };
  private run?: GoalRunState;
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
    if (this.goal?.runStartedAt !== undefined) this.goal = { ...this.goal, runStartedAt: undefined };
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
        if (this.goal)
          this.goal = { ...this.goal, status: "paused", reason: "persistence_error", runStartedAt: undefined };
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
    this.childCancellation = new AbortController();
  }
  /**
   * Pause active work. `user_turn` and `config_reload` are transient: they resume automatically
   * unless another pause reason overrides them first.
   */
  async pause(reason: string, turnId?: string): Promise<void> {
    const goal = this.goal;
    if (!goal) return;
    if (goal.status === "active") {
      this.invalidate();
      goal.status = "paused";
      goal.reason = reason;
      goal.runStartedAt = undefined;
      this.autoResume =
        reason === "user_turn" || reason === "config_reload" ? { reason, goalId: goal.id, turnId } : undefined;
      await this.save();
      return;
    }
    const transient = goal.reason === "user_turn" || goal.reason === "config_reload";
    if (goal.status !== "paused" || !transient || goal.reason === reason) return;
    // A reload during a user turn keeps the user-turn suspension; anything else overrides it.
    if (reason === "config_reload" && goal.reason === "user_turn") return;
    goal.reason = reason;
    this.autoResume = undefined;
    await this.save();
  }
  /** Suspend an active goal while an ordinary user turn runs; it resumes after that turn succeeds. */
  async suspendForUserTurn(turnId: string): Promise<void> {
    if (this.goal?.status === "active") {
      await this.pause("user_turn", turnId);
      return;
    }
    if (this.autoResume?.reason === "user_turn" && this.goal?.reason === "user_turn") this.autoResume.turnId = turnId;
  }
  async resumeAfterUserTurn(turnId: string, options: GoalAutoResumeOptions): Promise<void> {
    if (this.autoResume?.reason !== "user_turn" || this.autoResume.turnId !== turnId) return;
    await this.autoResumeNow("user_turn", options);
  }
  async resumeAfterConfigReload(options: GoalAutoResumeOptions): Promise<void> {
    if (this.autoResume?.reason !== "config_reload") return;
    await this.autoResumeNow("config_reload", options);
  }
  private async autoResumeNow(reason: AutoResumeReason, options: GoalAutoResumeOptions): Promise<void> {
    const token = this.autoResume;
    this.autoResume = undefined;
    const goal = this.goal;
    if (!token || !goal || goal.id !== token.goalId || goal.status !== "paused" || goal.reason !== reason) return;
    if (!options.enabled || options.mode === "plan") return;
    this.noProgress = 0;
    this.retries = 0;
    this.retryNotBefore = 0;
    goal.status = "active";
    goal.reason = undefined;
    await this.save();
    if (this.goal?.status === "active") this.host.wake();
  }
  /** Model-reported pause, honored only on an explicit user request. */
  async requestPause(): Promise<void> {
    const goal = this.goal;
    if (goal?.status === "active") this.invalidate();
    else if (!(goal?.status === "paused" && goal.reason === "user_turn")) throw new Error("No active goal to pause");
    goal.status = "paused";
    goal.reason = "user_request";
    goal.runStartedAt = undefined;
    this.autoResume = undefined;
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
    this.autoResume = undefined;
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
      this.resetAudit();
      this.objectiveEdited = false;
      const now = Date.now();
      this.goal = {
        id: crypto.randomUUID(),
        threadId: this.threadId,
        revision: this.revision,
        objective: change.objective,
        status: "active",
        tokenBudget: change.tokenBudget,
        maxTurns: change.maxTurns ?? options.defaultMaxTurns,
        turnsUsed: 0,
        tokensUsed: 0,
        cacheReadTokens: 0,
        activeTimeMs: 0,
        accountingScope: "reported_agent_tokens",
        createdAt: now,
        updatedAt: now,
      };
    } else if (change.action === "edit") {
      const goal = this.goal!;
      if (goal.status === "complete") throw new Error("Completed goals cannot be edited; set a new goal instead");
      if (goal.status === "active") throw new Error("Pause the goal before editing it");
      if (change.objective === undefined && change.tokenBudget === undefined && change.maxTurns === undefined)
        throw new Error("Nothing to edit; pass an objective or a limit");
      const objective = change.objective ?? goal.objective;
      if (objective !== goal.objective) {
        this.resetAudit();
        this.objectiveEdited = true;
      }
      this.goal = {
        ...goal,
        objective,
        tokenBudget: change.tokenBudget === null ? undefined : (change.tokenBudget ?? goal.tokenBudget),
        maxTurns: change.maxTurns === null ? undefined : (change.maxTurns ?? goal.maxTurns),
      };
    } else {
      if (this.goal!.status === "complete" || this.goal!.status === "active")
        throw new Error("This goal cannot be resumed");
      if (this.limited()) throw new Error("Raise the exhausted limit before resuming");
      this.invalidate();
      this.resetAudit();
      this.goal!.status = "active";
      this.goal!.reason = undefined;
    }
    await this.save();
    if (this.goal?.status === "active") this.host.wake();
  }
  private resetAudit(): void {
    this.noProgress = 0;
    this.retries = 0;
    this.retryNotBefore = 0;
    this.runsSinceStart = 0;
    this.lastBlockedClaim = undefined;
  }
  private limited(): boolean {
    return (
      !!this.goal &&
      ((this.goal.maxTurns !== undefined && this.goal.turnsUsed >= this.goal.maxTurns) ||
        (this.goal.tokenBudget !== undefined && this.goal.tokensUsed >= this.goal.tokenBudget))
    );
  }
  private limit(): void {
    if (!this.goal) return;
    this.invalidate();
    this.goal.status = "budget_limited";
    this.goal.runStartedAt = undefined;
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
  private currentRun(identity: GoalRunIdentity): GoalRunState | undefined {
    return this.run?.id === identity.outerRunId &&
      this.activeRunId === identity.outerRunId &&
      this.epoch === identity.epoch &&
      this.goal?.id === identity.goalId
      ? this.run
      : undefined;
  }
  async beginRun(options: { interruptTools?: () => void } = {}): Promise<GoalWorkScope | null> {
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
    this.run = {
      id: identity.outerRunId,
      workTools: 0,
      objectiveEdited: this.objectiveEdited,
      interruptTools: options.interruptTools,
    };
    this.objectiveEdited = false;
    this.runsSinceStart++;
    this.goal.turnsUsed++;
    this.childCancellation = new AbortController();
    const startedAt = Date.now();
    this.goal.runStartedAt = startedAt;
    const scope: GoalWorkScope = {
      identity,
      signal: this.cancellation.signal,
      childSignal: AbortSignal.any([this.cancellation.signal, this.childCancellation.signal]),
      startedAt,
      recordUsage: (sample) => this.recordUsage({ ...sample, identity }),
      noteTool: (name) => {
        if (this.run?.id === identity.outerRunId && !NON_WORK_TOOLS.has(name)) this.run.workTools++;
      },
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
  /** Input message for the current goal run. */
  continuationPrompt(): string {
    if (!this.goal) throw new Error("No goal exists");
    return renderContinuationPrompt(this.goal, {
      runsSinceStart: this.runsSinceStart,
      objectiveEdited: this.run?.objectiveEdited ?? false,
    });
  }
  /** Goal context to inject before a model sample; may stop a wrap-up run that keeps calling tools. */
  contextInjection(scope: GoalWorkScope | undefined, turn: { first: boolean; compacted: boolean }): string | undefined {
    const goal = this.goal;
    if (!goal) return undefined;
    if (!scope) {
      return goal.status === "paused" && goal.reason === "user_turn" && (turn.first || turn.compacted)
        ? renderUserTurnNote(goal)
        : undefined;
    }
    const run = this.run?.id === scope.identity.outerRunId ? this.run : undefined;
    if (!run || goal.id !== scope.identity.goalId) return undefined;
    if (run.wrapUp) {
      if (run.wrapUp.stopped) return undefined;
      if (!run.wrapUp.injected) {
        run.wrapUp.injected = true;
        return renderBudgetLimitPrompt(goal);
      }
      // The wrap-up reply asked for tools again; stop before another sample.
      run.wrapUp.stopped = true;
      this.invalidate();
      return undefined;
    }
    if (!this.isCurrent(scope.identity) || !turn.compacted) return undefined;
    return renderContinuationPrompt(goal, {
      runsSinceStart: this.runsSinceStart,
      objectiveEdited: false,
      compacted: true,
    });
  }
  recordUsage(sample: GoalUsageSample): void {
    const key = goalSampleKey(sample);
    if (this.usageKeys.has(key)) return;
    this.usageKeys.add(key);
    this.enqueue(this.store.append({ type: "usage", sample }));
    if (this.goal?.id !== sample.identity.goalId) return;
    this.goal.tokensUsed += chargeableGoalTokens(sample);
    this.goal.cacheReadTokens += sample.cacheReadTokens;
    const run = this.run?.id === sample.identity.outerRunId ? this.run : undefined;
    if (this.goal.status === "budget_limited" && run?.wrapUp && sample.sessionId === this.threadId) {
      // Tools sampled after the budget was crossed never dispatch.
      run.interruptTools?.();
      return;
    }
    if (this.goal.tokenBudget === undefined || this.goal.tokensUsed < this.goal.tokenBudget) return;
    if (this.goal.status === "active") {
      const current = this.currentRun(sample.identity);
      if (!current) {
        this.limit();
        return;
      }
      // Synchronous, before the core can dispatch the just-sampled tool batch.
      this.goal.status = "budget_limited";
      this.goal.reason = "token_budget";
      current.wrapUp = { injected: false, stopped: false };
      this.childCancellation.abort();
      current.interruptTools?.();
      void this.save().catch(() => {});
    } else if (
      this.goal.status === "complete" &&
      this.epoch === sample.identity.epoch &&
      this.activeRunId === sample.identity.outerRunId
    ) {
      // Completion may still have a final response in flight. Keep its verified
      // status, but do not allow that response to bypass the execution cap.
      this.cancellation.abort();
    }
  }
  async report(identity: GoalRunIdentity, status: "complete" | "blocked", evidence: string): Promise<void> {
    if (!this.isCurrent(identity)) throw new Error("Stale goal execution");
    if (!evidence.trim()) throw new Error("Non-empty evidence or a blocking reason is required");
    if (status === "complete") {
      if (!this.run?.workTools)
        throw new Error(
          "Completion rejected: this goal run has not verified anything yet. Inspect the current state with at least one tool call other than get_goal, update_goal, or plan, then report again.",
        );
      if (this.children.size) throw new Error("Wait for goal-owned children before declaring completion");
    } else if (this.runsSinceStart < BLOCKED_AUDIT_RUNS) {
      this.lastBlockedClaim = evidence.trim();
      throw new Error(
        `Blocked rejected: this is consecutive goal run ${this.runsSinceStart}; "blocked" requires the same blocker across at least 3 consecutive goal runs. Take the next safe action, or end this run with a short status; the goal continues automatically.`,
      );
    }
    this.goal!.status = status;
    if (status === "complete") this.goal!.completionEvidence = evidence.trim();
    else {
      this.goal!.reason = evidence.trim();
      this.goal!.runStartedAt = undefined;
      this.invalidate();
    }
    await this.save();
  }
  async settle(scope: GoalWorkScope, outcome: SessionRunOutcome): Promise<void> {
    const owned =
      this.goal?.id === scope.identity.goalId &&
      this.epoch === scope.identity.epoch &&
      this.activeRunId === scope.identity.outerRunId;
    const run = this.run?.id === scope.identity.outerRunId ? this.run : undefined;
    if (run) this.run = undefined;
    if (this.goal?.id === scope.identity.goalId) {
      this.goal.activeTimeMs += Math.max(0, Date.now() - scope.startedAt);
      if (this.goal.runStartedAt === scope.startedAt) this.goal.runStartedAt = undefined;
      if (owned && this.goal.status === "complete" && outcome.status === "failed") {
        this.goal.status = "blocked";
        this.goal.reason = `Completion cleanup failed: ${outcome.error.message}`;
        this.goal.completionEvidence = undefined;
      }
      await this.save();
    }
    const current = this.isCurrent(scope.identity);
    if (this.activeRunId === scope.identity.outerRunId) this.activeRunId = undefined;
    if (!current) {
      if (owned && this.goal?.status === "budget_limited") this.invalidate();
      return;
    }
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
      this.noProgress = (run?.workTools ?? 0) > 0 || this.children.size > 0 ? 0 : this.noProgress + 1;
      if (this.noProgress >= NO_PROGRESS_RUNS) {
        this.goal!.status = "blocked";
        this.goal!.reason = this.lastBlockedClaim ?? "no_progress";
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
