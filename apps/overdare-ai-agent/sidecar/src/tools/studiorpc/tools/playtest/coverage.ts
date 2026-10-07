// @summary Aggregates declared test-goal coverage without equating input dispatch with verified behavior.
import type { PlaytestCoverageTarget, PlaytestFrame } from "./frame";
import type { PlaytestEvent } from "./runtime";

interface TargetProgress extends PlaytestCoverageTarget {
  observedSamples: number;
  offeredFrames: number;
  selected: number;
  dispatched: number;
  completed: number;
  effectsConfirmed: number;
  effectsFailed: number;
}

export function createCoverageTracker() {
  const targets = new Map<string, TargetProgress>();
  function target(id: string, kind?: PlaytestCoverageTarget["kind"]) {
    const t = targets.get(id);
    if (!t) throw new Error(`Undeclared coverage target ${id}`);
    if (kind && t.kind !== kind) throw new Error(`Coverage target ${id} requires kind ${kind}`);
    return t;
  }
  return {
    observe(frame: PlaytestFrame) {
      for (const item of frame.coverage?.targets ?? []) {
        const prior = targets.get(item.id);
        if (
          prior &&
          (prior.kind !== item.kind || prior.description !== item.description || prior.source !== item.source)
        ) {
          throw new Error(`Coverage target ${item.id} changed meaning during the episode`);
        }
        if (!prior) {
          if (targets.size >= 128) throw new Error("Coverage inventory exceeds 128 targets");
          targets.set(item.id, {
            ...item,
            observedSamples: 0,
            offeredFrames: 0,
            selected: 0,
            dispatched: 0,
            completed: 0,
            effectsConfirmed: 0,
            effectsFailed: 0,
          });
        }
      }
      for (const id of new Set(frame.coverage?.observed ?? [])) {
        const t = target(id);
        if (t.kind === "action")
          throw new Error(`Action coverage ${id} requires confirmed input effect, not an observation hit`);
        t.observedSamples++;
      }
      for (const id of new Set(frame.actions.map((a) => a.coverageKey).filter((id): id is string => !!id))) {
        target(id, "action").offeredFrames++;
      }
    },
    event(event: PlaytestEvent) {
      if (typeof event.coverageKey !== "string") return;
      const t = target(event.coverageKey, "action");
      if (event.type === "model_choice" || event.type === "singleton_choice" || event.type === "intent_step")
        t.selected++;
      if (event.type === "action_dispatch") t.dispatched++;
      if (event.type === "input_reply" && event.status === "completed") t.completed++;
      if (
        event.type === "action_result" &&
        event.observed === true &&
        event.inputStatus === "completed" &&
        Array.isArray(event.expectations) &&
        event.expectations.length > 0
      ) {
        const checks = event.expectations as Array<{ passed?: boolean }>;
        if (checks.every((check) => check.passed === true)) t.effectsConfirmed++;
        else t.effectsFailed++;
      }
    },
    summary() {
      const rows = [...targets.values()].map((t) => {
        const covered = t.kind === "action" ? t.effectsConfirmed > 0 : t.observedSamples > 0;
        const status = covered
          ? "covered"
          : t.completed > 0
            ? "completed_unverified"
            : t.dispatched > 0
              ? "dispatched"
              : t.selected > 0
                ? "selected"
                : t.offeredFrames > 0
                  ? "offered"
                  : "uncovered";
        return { ...t, status, covered };
      });
      const coveredTargets = rows.filter((t) => t.covered).length;
      return {
        scope: "declared_test_targets",
        status: rows.length === 0 ? "not_declared" : coveredTargets === rows.length ? "complete" : "partial",
        totalTargets: rows.length,
        coveredTargets,
        ...(rows.length ? { percentage: Math.round((1000 * coveredTargets) / rows.length) / 10 } : {}),
        targets: rows,
      };
    },
  };
}
