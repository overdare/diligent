// @summary Compact persistent goal status with collapsible details and explicit lifecycle controls

import type { GoalStatus as GoalLifecycleStatus, ThreadGoal } from "@diligent/protocol";
import { formatGoalDuration, goalElapsedMs, goalStopMessage } from "@diligent/runtime/client";
import { memo, type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { Check, ChevronDown, X } from "./icons";

export interface GoalStatusProps {
  goal: ThreadGoal;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  defaultExpanded?: boolean;
}

type StatusTone = "active" | "success" | "warning" | "muted";

const STATUS_META: Record<GoalLifecycleStatus, { label: string; tone: StatusTone }> = {
  active: { label: "In progress", tone: "active" },
  paused: { label: "Paused", tone: "muted" },
  blocked: { label: "Blocked", tone: "warning" },
  budget_limited: { label: "Budget limit reached", tone: "warning" },
  usage_limited: { label: "Usage limit reached", tone: "warning" },
  complete: { label: "Complete", tone: "success" },
};

const TONE_TEXT: Record<StatusTone, string> = {
  active: "text-accent",
  success: "text-success",
  warning: "text-warning",
  muted: "text-text-tertiary",
};

const TONE_FILL: Record<StatusTone, string> = {
  active: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  muted: "bg-text-tertiary",
};

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function usageRatio(goal: ThreadGoal): number {
  const turnRatio = goal.maxTurns === undefined ? 0 : goal.turnsUsed / goal.maxTurns;
  const tokenRatio = goal.tokenBudget === undefined ? 0 : goal.tokensUsed / goal.tokenBudget;
  return Math.min(1, Math.max(turnRatio, tokenRatio));
}

function StatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === "success") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      {tone === "active" ? <span className="absolute h-3 w-3 animate-ping rounded-full bg-accent/40" /> : null}
      <span className={cn("relative h-2 w-2 rounded-full", TONE_FILL[tone])} />
    </span>
  );
}

function GoalStatusImpl({ goal, onPause, onResume, onClear, defaultExpanded = false }: GoalStatusProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [, tick] = useState(0);
  useEffect(() => {
    if (goal.runStartedAt === undefined) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [goal.runStartedAt]);
  const status = STATUS_META[goal.status];
  const canResume = goal.status !== "active" && goal.status !== "complete";
  const stopMessage = goalStopMessage(goal);
  const tokenSummary =
    goal.tokenBudget === undefined
      ? `${compactNumber.format(goal.tokensUsed)} tokens`
      : `${compactNumber.format(goal.tokensUsed)} / ${compactNumber.format(goal.tokenBudget)} tokens`;
  const showProgress = goal.status !== "complete" && (goal.tokenBudget !== undefined || goal.maxTurns !== undefined);

  return (
    <section aria-label="Goal status" className="shrink-0 border-t border-border/10 bg-surface-dark px-7 pt-3">
      <div className="mx-auto w-full max-w-plan overflow-hidden rounded-lg border border-border/60 bg-surface-default">
        <div className="flex items-center gap-1 pr-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="group flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-3.5 text-left transition hover:bg-fill-ghost-hover"
          >
            <StatusIcon tone={status.tone} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-medium leading-5 text-text">{goal.objective}</h2>
              <p className="mt-0.5 truncate text-xs leading-4 text-text-tertiary">
                <span className={cn("font-medium", TONE_TEXT[status.tone])}>{status.label}</span>
                <span className="px-1.5 text-text-tertiary/60">·</span>
                {formatGoalDuration(goalElapsedMs(goal))}
                <span className="px-1.5 text-text-tertiary/60">·</span>
                {tokenSummary}
                {goal.maxTurns !== undefined ? (
                  <>
                    <span className="px-1.5 text-text-tertiary/60">·</span>
                    {goal.turnsUsed.toLocaleString()} / {goal.maxTurns.toLocaleString()} runs
                  </>
                ) : null}
              </p>
            </div>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0 text-text-tertiary transition-transform group-hover:text-text-secondary",
                expanded && "rotate-180",
              )}
            />
          </button>
          {goal.status === "active" ? (
            <button
              type="button"
              onClick={onPause}
              className="rounded-md px-2.5 py-1 text-xs text-text-secondary transition hover:bg-fill-ghost-hover hover:text-text"
            >
              Pause
            </button>
          ) : canResume ? (
            <button
              type="button"
              onClick={onResume}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
            >
              Resume
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClear}
            title="Clear goal"
            className="rounded-md p-1.5 text-text-tertiary transition hover:bg-fill-ghost-hover hover:text-text"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Clear</span>
          </button>
        </div>

        {stopMessage ? (
          <output
            aria-live="polite"
            className="block break-words border-t border-border/20 px-4 py-2 text-xs leading-5 text-text-secondary"
          >
            {stopMessage}
          </output>
        ) : null}

        {showProgress ? (
          <div className="h-0.5 bg-border/20">
            <div
              className={cn("h-full transition-[width]", TONE_FILL[status.tone])}
              style={{ width: `${usageRatio(goal) * 100}%` }}
            />
          </div>
        ) : null}

        {expanded ? (
          <div className="max-h-72 space-y-3 overflow-y-auto border-t border-border/20 px-4 py-3">
            <GoalDetail label="Objective">
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text">{goal.objective}</p>
            </GoalDetail>
            {goal.reason ? (
              <GoalDetail label="Reason">
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words text-xs leading-5",
                    status.tone === "warning" ? "text-warning" : "text-text-secondary",
                  )}
                >
                  {goal.reason}
                </p>
              </GoalDetail>
            ) : null}
            {goal.completionEvidence ? (
              <GoalDetail label="Evidence">
                <p className="whitespace-pre-wrap break-words rounded-md border border-border/30 bg-fill-dark/60 px-3 py-2 text-xs leading-5 text-text-secondary">
                  {goal.completionEvidence}
                </p>
              </GoalDetail>
            ) : null}
            <p className="text-2xs leading-4 text-text-tertiary">
              {goal.tokensUsed.toLocaleString()} /{" "}
              {goal.tokenBudget === undefined ? "unlimited" : goal.tokenBudget.toLocaleString()} tokens ·{" "}
              {goal.cacheReadTokens.toLocaleString()} cached read tokens (not charged)
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function GoalDetail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-text-tertiary">{label}</div>
      {children}
    </div>
  );
}

export const GoalStatus = memo(GoalStatusImpl);
