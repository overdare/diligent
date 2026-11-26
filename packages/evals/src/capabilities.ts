// @summary Model capability matrix contracts: support classification, result mapping, and Markdown rendering

import type { Model } from "@diligent/core/provider-contract";
import type { RuntimeEvalExecutionReport, RuntimeEvalExecutionResult } from "./runtime-task";
import type { EvalProvider } from "./task";

export const MODEL_CAPABILITIES = [
  "basic_response",
  "web_search",
  "image_read",
  "image_generation",
  "compaction",
] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export type CapabilityAuthPath = "api_key" | "chatgpt_oauth";

/**
 * `unsupported`: Diligent does not offer the capability for this model, so nothing ran.
 * `not_run`: the capability is supported, but credentials or the environment prevented a valid live call.
 * `skipped`: the cost policy excluded the cell; nothing ran and the run does not fail.
 * None of them counts as a pass.
 */
export type CapabilityCellStatus = "pass" | "fail" | "unsupported" | "not_run" | "skipped";

export interface CapabilityCell {
  provider: EvalProvider;
  authPath: CapabilityAuthPath;
  model: string;
  capability: ModelCapability;
  status: CapabilityCellStatus;
  /** Accepted with degraded-impact diagnostics. */
  degraded?: boolean;
  code?: string;
  reason?: string;
  taskId?: string;
  elapsedMs?: number;
}

export interface CapabilityMatrixReport {
  schemaVersion: 1;
  suite: "capabilities";
  suiteVersion: "capabilities-v1";
  repository: string;
  commitSha: string;
  ref: string;
  runId: string;
  runAttempt: string;
  bunVersion: string;
  os: string;
  architecture: string;
  startedAt: string;
  endedAt: string;
  rootSeed: string;
  providers: EvalProvider[];
  capabilities: ModelCapability[];
  cells: CapabilityCell[];
  counts: Record<CapabilityCellStatus, number>;
  /** True only when no selected cell failed or was not run. */
  passed: boolean;
  executions: RuntimeEvalExecutionReport[];
}

const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  basic_response: "Basic response",
  web_search: "Web search",
  image_read: "Image read",
  image_generation: "Image generation",
  compaction: "Compaction",
};

const STATUS_LABELS: Record<CapabilityCellStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  unsupported: "UNSUPPORTED",
  not_run: "NOT RUN",
  skipped: "SKIPPED",
};

/** Models at or above this input price per million tokens count as expensive for the default matrix. */
export const EXPENSIVE_INPUT_COST_PER_1M = 4;

export function authPathForProvider(provider: EvalProvider): CapabilityAuthPath {
  return provider === "chatgpt" ? "chatgpt_oauth" : "api_key";
}

/** Whether Diligent offers the capability for a model; unsupported cells are recorded without a live call. */
export function capabilitySupport(
  model: Pick<Model, "provider" | "supportsVision">,
  capability: ModelCapability,
): { supported: true } | { supported: false; reason: string } {
  if (capability === "image_read" && !model.supportsVision)
    return { supported: false, reason: "The model card does not declare image input." };
  if (capability === "image_generation" && model.provider !== "chatgpt")
    return {
      supported: false,
      reason: "Diligent binds image generation only to ChatGPT OAuth; API-key providers have no image generation path.",
    };
  return { supported: true };
}

export type CapabilityCostPolicy = (
  model: Pick<Model, "provider" | "modelId">,
  capability: ModelCapability,
) => string | undefined;

/**
 * Default-matrix cost policy. Per provider, only the newest expensive model runs, and it skips compaction, the most
 * token-heavy probe. Provider catalogs list models newest first, so the first expensive card is the newest. Returns
 * the skip reason, or undefined when the cell runs.
 */
export function createCapabilityCostPolicy(
  catalog: readonly Pick<Model, "provider" | "modelId" | "inputCostPer1M">[],
): CapabilityCostPolicy {
  const expensive = catalog.filter((model) => (model.inputCostPer1M ?? 0) >= EXPENSIVE_INPUT_COST_PER_1M);
  const newestExpensive = new Map<string, string>();
  for (const model of expensive)
    if (!newestExpensive.has(model.provider)) newestExpensive.set(model.provider, model.modelId);
  const expensiveKeys = new Set(expensive.map((model) => `${model.provider}/${model.modelId}`));
  return (model, capability) => {
    if (!expensiveKeys.has(`${model.provider}/${model.modelId}`)) return undefined;
    const newest = newestExpensive.get(model.provider);
    if (model.modelId !== newest)
      return `Cost policy: only the newest expensive ${model.provider} model (${newest}) runs.`;
    return capability === "compaction" ? "Cost policy: expensive models skip compaction." : undefined;
  };
}

/** Maps one runtime execution to a matrix cell status. Authentication and usage-limit rejections are `not_run`. */
export function classifyCapabilityExecution(
  result: Pick<RuntimeEvalExecutionResult, "passed" | "status" | "failure" | "failures" | "execution">,
): Pick<CapabilityCell, "status" | "degraded" | "code" | "reason"> {
  if (result.passed) return { status: "pass", ...(result.status === "degraded" && { degraded: true }) };
  const fatal = result.execution.turns
    .flatMap((turn) => turn.coreEvents)
    .findLast((snapshot) => snapshot.event.type === "error" && snapshot.event.fatal)?.event;
  const providerReason = fatal?.type === "error" ? fatal.error.providerErrorReason : undefined;
  const authFailure = result.failures.find((failure) => failure.category === "provider_auth");
  if (authFailure || providerReason === "credentials_missing" || providerReason === "credentials_rejected")
    return {
      status: "not_run",
      code: providerReason ? `provider_auth.${providerReason}` : (authFailure?.code ?? "provider_auth.rejected"),
      reason: authFailure?.message ?? (fatal?.type === "error" ? fatal.error.message : "Authentication failed."),
    };
  if (providerReason === "usage_limit_reached")
    return {
      status: "not_run",
      code: "provider_usage_limit",
      reason: fatal?.type === "error" ? fatal.error.message : "Usage limit reached.",
    };
  return { status: "fail", code: result.failure?.code, reason: result.failure?.message };
}

export function countCapabilityCells(cells: readonly CapabilityCell[]): Record<CapabilityCellStatus, number> {
  const counts: Record<CapabilityCellStatus, number> = { pass: 0, fail: 0, unsupported: 0, not_run: 0, skipped: 0 };
  for (const cell of cells) counts[cell.status] += 1;
  return counts;
}

export function renderCapabilityMatrixMarkdown(report: CapabilityMatrixReport): string {
  const columns = report.capabilities;
  const rows = new Map<string, CapabilityCell[]>();
  for (const cell of report.cells) {
    const key = `${cell.provider}\u0000${cell.model}`;
    rows.set(key, [...(rows.get(key) ?? []), cell]);
  }
  const lines = [
    "## Model capability matrix",
    "",
    `Commit \`${report.commitSha}\` · run \`${report.runId}\` · ${report.os}/${report.architecture} · ${report.startedAt}`,
    "",
    `PASS ${report.counts.pass} · FAIL ${report.counts.fail} · NOT RUN ${report.counts.not_run} · UNSUPPORTED ${report.counts.unsupported} · SKIPPED ${report.counts.skipped}`,
    "",
    `| Provider | Auth | Model | ${columns.map((capability) => CAPABILITY_LABELS[capability]).join(" | ")} |`,
    `|---|---|---|${columns.map(() => "---").join("|")}|`,
  ];
  for (const cells of rows.values()) {
    const first = cells[0]!;
    const byCapability = new Map(cells.map((cell) => [cell.capability, cell]));
    const values = columns.map((capability) => {
      const cell = byCapability.get(capability);
      if (!cell) return "-";
      return cell.degraded ? `${STATUS_LABELS[cell.status]} (degraded)` : STATUS_LABELS[cell.status];
    });
    lines.push(
      `| ${first.provider} | ${first.authPath === "chatgpt_oauth" ? "ChatGPT OAuth" : "API key"} | ${first.model} | ${values.join(" | ")} |`,
    );
  }
  const problems = report.cells.filter((cell) => cell.status === "fail" || cell.status === "not_run");
  if (problems.length > 0) {
    lines.push("", "### Failed and not-run cells", "");
    for (const cell of problems) {
      const code = cell.code ? ` \`${cell.code}\`` : "";
      lines.push(
        `- ${STATUS_LABELS[cell.status]} ${cell.provider}/${cell.model} ${cell.capability}${code}: ${singleLine(cell.reason ?? "No detail recorded.")}`,
      );
    }
  }
  const unsupported = new Map<string, Set<string>>();
  for (const cell of report.cells.filter((candidate) => candidate.status === "unsupported")) {
    const key = `${cell.capability}: ${cell.reason ?? "unsupported"}`;
    unsupported.set(key, (unsupported.get(key) ?? new Set()).add(cell.provider));
  }
  if (unsupported.size > 0) {
    lines.push("", "### Unsupported", "");
    for (const [key, providers] of unsupported) lines.push(`- ${key} (${[...providers].join(", ")})`);
  }
  const skipped = new Map<string, Set<string>>();
  for (const cell of report.cells.filter((candidate) => candidate.status === "skipped")) {
    const key = cell.reason ?? "Skipped.";
    skipped.set(key, (skipped.get(key) ?? new Set()).add(`${cell.provider}/${cell.model}`));
  }
  if (skipped.size > 0) {
    lines.push("", "### Skipped", "");
    for (const [reason, models] of skipped) lines.push(`- ${reason} (${[...models].join(", ")})`);
  }
  return `${lines.join("\n")}\n`;
}

function singleLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 300 ? `${collapsed.slice(0, 300)}...` : collapsed;
}
