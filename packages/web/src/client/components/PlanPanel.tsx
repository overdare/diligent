// @summary Persistent plan progress panel displayed between MessageList and InputDock
import { memo } from "react";
import type { PlanState } from "../lib/thread-store";

function PlanPanelImpl({ planState }: { planState: PlanState }) {
  const doneCount = planState.steps.filter((s) => s.status === "done").length;
  const activeSteps = planState.steps.filter((s) => s.status !== "cancelled");
  const totalCount = activeSteps.length;

  return (
    <div className="shrink-0 border-t border-text/10 bg-surface px-6 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-text">
        <span>{planState.title}</span>
        <span className="text-muted">
          {doneCount}/{totalCount}
        </span>
      </div>
      <ul className="max-h-36 overflow-y-auto text-sm leading-relaxed">
        {planState.steps.map((step) => (
          <li
            key={step.text}
            className={`flex items-start gap-2 ${step.status === "done" || step.status === "cancelled" ? "text-muted line-through" : "text-text"}`}
          >
            <span className="shrink-0">
              {step.status === "done"
                ? "✓"
                : step.status === "cancelled"
                  ? "✕"
                  : step.status === "in_progress"
                    ? "▶"
                    : "○"}
            </span>{" "}
            <span>{step.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const PlanPanel = memo(PlanPanelImpl);
