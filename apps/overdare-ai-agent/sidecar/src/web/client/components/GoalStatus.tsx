// @summary Compact persistent goal status and explicit lifecycle controls

import type { ThreadGoal } from "@diligent/protocol";
import { memo } from "react";

export interface GoalStatusProps {
  goal: ThreadGoal;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
}

function GoalStatusImpl({ goal, onPause, onResume, onClear }: GoalStatusProps) {
  const tokenLimit = goal.tokenBudget === undefined ? "unlimited" : goal.tokenBudget.toLocaleString();
  const canResume = goal.status !== "active" && goal.status !== "complete";

  return (
    <section aria-label="Goal status" className="shrink-0 border-t border-border/10 bg-surface-dark px-7 pt-3">
      <div className="mx-auto flex w-full max-w-plan items-start gap-3 rounded-lg border border-border/60 bg-surface-default px-4 py-3">
        <span aria-hidden="true" className="mt-0.5 font-mono text-sm text-text-secondary">
          ◎
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 truncate text-sm font-medium text-text">{goal.objective}</h2>
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] uppercase tracking-wide text-text-secondary">
              {goal.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-tertiary">
            {goal.tokensUsed.toLocaleString()} / {tokenLimit} tokens · {goal.turnsUsed.toLocaleString()} /{" "}
            {goal.maxTurns.toLocaleString()} runs
          </p>
          {goal.reason ? <p className="mt-1 text-xs text-text-secondary">{goal.reason}</p> : null}
          <p className="mt-1 text-xs text-text-tertiary">
            {goal.cacheReadTokens.toLocaleString()} cached read tokens (not charged) ·{" "}
            {Math.floor(goal.activeTimeMs / 1000).toLocaleString()}s active
          </p>
          {goal.completionEvidence ? (
            <p className="mt-1 text-xs text-text-secondary">Evidence: {goal.completionEvidence}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {goal.status === "active" ? (
            <button
              type="button"
              onClick={onPause}
              className="rounded-md border border-border/60 px-2.5 py-1 text-xs text-text-secondary transition hover:bg-fill-ghost-hover hover:text-text"
            >
              Pause
            </button>
          ) : canResume ? (
            <button
              type="button"
              onClick={onResume}
              className="rounded-md border border-border/60 px-2.5 py-1 text-xs text-text-secondary transition hover:bg-fill-ghost-hover hover:text-text"
            >
              Resume
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2.5 py-1 text-xs text-text-tertiary transition hover:bg-fill-ghost-hover hover:text-text"
          >
            Clear
          </button>
        </div>
      </div>
    </section>
  );
}

export const GoalStatus = memo(GoalStatusImpl);
