// @summary Checks action freshness and compares observed effects without executing gameplay.
import { type PlaytestAction, type PlaytestExpectation, type PlaytestFrame, safeTraceValue } from "./frame";
import { isRecord } from "./observation";

function getPath(root: Record<string, unknown>, path: string): { present: boolean; value: unknown } {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return { present: false, value: undefined };
    current = current[part];
  }
  return { present: true, value: current };
}

export function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === undefined || right === undefined) return false;
  try {
    return stableStringify(left) === stableStringify(right);
  } catch {
    return false;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function evaluateExpectations(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  expectations: PlaytestExpectation[] | undefined,
): Array<Record<string, unknown>> {
  return (expectations ?? []).map((expectation) => {
    const oldValue = getPath(before, expectation.key);
    const newValue = getPath(after, expectation.key);
    let passed = false;
    switch (expectation.op) {
      case "change":
        passed = oldValue.present && newValue.present && !jsonEqual(oldValue.value, newValue.value);
        break;
      case "increase":
        passed =
          oldValue.present &&
          newValue.present &&
          typeof oldValue.value === "number" &&
          typeof newValue.value === "number" &&
          newValue.value > oldValue.value;
        break;
      case "decrease":
        passed =
          oldValue.present &&
          newValue.present &&
          typeof oldValue.value === "number" &&
          typeof newValue.value === "number" &&
          newValue.value < oldValue.value;
        break;
      case "equals":
        passed = newValue.present && jsonEqual(newValue.value, expectation.value);
        break;
    }
    return {
      key: expectation.key,
      op: expectation.op,
      before: { present: oldValue.present, value: safeTraceValue(oldValue.value) },
      after: { present: newValue.present, value: safeTraceValue(newValue.value) },
      ...(expectation.op === "equals" ? { expected: expectation.value } : {}),
      passed,
    };
  });
}

export function actionForChoice(frame: PlaytestFrame, id: string, intentMode: boolean) {
  return frame.actions.find((action) => (intentMode ? action.intent?.id === id : action.id === id));
}
export function actionStillValid(
  before: PlaytestFrame,
  latest: PlaytestFrame,
  actionId: string,
  intentMode = false,
): boolean {
  if (latest.error || latest.terminal || before.harnessId !== latest.harnessId) return false;
  const prior = actionForChoice(before, actionId, intentMode);
  const current = actionForChoice(latest, actionId, intentMode);
  if (!prior || !current) return false;
  if (Boolean(prior.intent) !== Boolean(current.intent)) return false;
  if (intentMode) {
    if (
      !prior.intent ||
      !current.intent ||
      prior.intent.validityKey !== current.intent.validityKey ||
      !jsonEqual(prior.intent.completeWhen, current.intent.completeWhen)
    )
      return false;
  } else if (prior.validityKey !== current.validityKey) return false;
  if (current.expiresAtGameTime !== undefined && latest.gameTimeSeconds >= current.expiresAtGameTime) return false;
  return true;
}

export function actionCoverageKey(action: PlaytestAction | undefined): string | undefined {
  const key = (action as (PlaytestAction & { coverageKey?: unknown }) | undefined)?.coverageKey;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}
