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

function targetCoverageStatus(progress: TargetProgress) {
  const confirmations = progress.kind === "action" ? progress.effectsConfirmed : progress.observedSamples;
  if (confirmations > 0) return "covered";
  if (progress.completed > 0) return "completed_unverified";
  if (progress.dispatched > 0) return "dispatched";
  if (progress.selected > 0) return "selected";
  if (progress.offeredFrames > 0) return "offered";
  return "uncovered";
}

function inventoryCoverageStatus(total: number, covered: number) {
  if (total === 0) return "not_declared";
  if (covered === total) return "complete";
  return "partial";
}

export function createCoverageTracker() {
  const targets = new Map<string, TargetProgress>();
  function requireTarget(id: string, kind?: PlaytestCoverageTarget["kind"]) {
    const progress = targets.get(id);
    if (!progress) throw new Error(`Undeclared coverage target ${id}`);
    if (kind && progress.kind !== kind) throw new Error(`Coverage target ${id} requires kind ${kind}`);
    return progress;
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
        const progress = requireTarget(id);
        if (progress.kind === "action")
          throw new Error(`Action coverage ${id} requires confirmed input effect, not an observation hit`);
        progress.observedSamples++;
      }
      for (const id of new Set(frame.actions.map((a) => a.coverageKey).filter((id): id is string => !!id))) {
        requireTarget(id, "action").offeredFrames++;
      }
    },
    event(event: PlaytestEvent) {
      if (typeof event.coverageKey !== "string") return;
      const progress = requireTarget(event.coverageKey, "action");
      if (event.type === "model_choice" || event.type === "singleton_choice" || event.type === "intent_step")
        progress.selected++;
      if (event.type === "action_dispatch") progress.dispatched++;
      if (event.type === "input_reply" && event.status === "completed") progress.completed++;
      if (
        event.type === "action_result" &&
        event.observed === true &&
        event.inputStatus === "completed" &&
        Array.isArray(event.expectations) &&
        event.expectations.length > 0
      ) {
        const checks = event.expectations as Array<{ passed?: boolean }>;
        if (checks.every((check) => check.passed === true)) progress.effectsConfirmed++;
        else progress.effectsFailed++;
      }
    },
    summary() {
      const rows = [...targets.values()].map((progress) => {
        const status = targetCoverageStatus(progress);
        const covered = status === "covered";
        return { ...progress, status, covered };
      });
      const coveredTargets = rows.filter((progress) => progress.covered).length;
      return {
        scope: "declared_test_targets",
        status: inventoryCoverageStatus(rows.length, coveredTargets),
        totalTargets: rows.length,
        coveredTargets,
        ...(rows.length ? { percentage: Math.round((1000 * coveredTargets) / rows.length) / 10 } : {}),
        targets: rows,
      };
    },
  };
}
