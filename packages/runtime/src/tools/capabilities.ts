// @summary Runtime-owned host function types and helpers for tool factory wiring and permission classification
import type { ToolContext } from "@diligent/core/tool-contract";
import type { ApprovalOutcome, ApprovalRequest, ApprovalResponse } from "../approval/types";
import type { UserInputRequest, UserInputResponse } from "./user-input-types";

export type ApprovalHandler = (request: ApprovalRequest, options?: RuntimeRequestOptions) => Promise<ApprovalOutcome>;

export interface RuntimeToolHost {
  /** Plain decision for plugins and product tools. Built-in tools read `approveWithOutcome` when present. */
  approve?: (request: ApprovalRequest, options?: RuntimeRequestOptions) => Promise<ApprovalResponse>;
  /** The same decision plus who made it, so a permission-rule denial does not end the turn. */
  approveWithOutcome?: ApprovalHandler;
  ask?: (request: UserInputRequest, options?: RuntimeRequestOptions) => Promise<UserInputResponse>;
}
export interface RuntimeRequestOptions {
  signal?: AbortSignal;
}

/** Build a tool host whose two approval callbacks share one outcome-returning handler. */
export function createRuntimeToolHost(
  approve: ApprovalHandler | undefined,
  ask: RuntimeToolHost["ask"],
): RuntimeToolHost {
  if (!approve) return { ask };
  return {
    approve: async (request, options) => (await approve(request, options)).decision,
    approveWithOutcome: approve,
    ask,
  };
}

export async function requestToolApprovalOutcome(
  host: RuntimeToolHost | undefined,
  request: ApprovalRequest,
  options?: RuntimeRequestOptions,
): Promise<ApprovalOutcome> {
  options?.signal?.throwIfAborted();
  let outcome: ApprovalOutcome;
  if (host?.approveWithOutcome) {
    outcome = await host.approveWithOutcome(request, options);
  } else {
    const decision = host?.approve ? await host.approve(request, options) : "once";
    outcome = decision === "reject" ? { decision, source: "user" } : { decision };
  }
  options?.signal?.throwIfAborted();
  return outcome;
}

export async function requestToolApproval(
  host: RuntimeToolHost | undefined,
  request: ApprovalRequest,
  options?: RuntimeRequestOptions,
): Promise<ApprovalResponse> {
  return (await requestToolApprovalOutcome(host, request, options)).decision;
}

export type RejectedApproval = Extract<ApprovalOutcome, { decision: "reject" }>;

/**
 * Model-visible result for a rejected approval. A user rejection, or a permission-rule denial that trips the
 * breaker's stop level, ends the turn through `ctx.abort()`; other rule denials let the model continue without
 * the operation.
 */
export function resolveRejectedApproval(
  outcome: RejectedApproval,
  ctx: Pick<ToolContext, "abort">,
): { output: string; metadata: Record<string, unknown> } {
  if (outcome.source === "user") {
    ctx.abort();
    return { output: "[Rejected by user]", metadata: { error: true, denial: { source: "user" } } };
  }

  const { rule, consecutiveDenials, breaker } = outcome;
  const deniedBy = rule ? `permission rule "${rule.pattern}" (${rule.permission})` : "a permission rule";
  const lines = [
    `Denied by ${deniedBy}. Do not retry this operation or variations of it. Continue without it, or tell the user what was blocked.`,
  ];
  if (breaker === "warn") {
    lines.push(
      `${consecutiveDenials} consecutive operations were denied by permission rules. Stop attempting variations and report the blocked operations to the user.`,
    );
  } else if (breaker === "stop") {
    lines.push(
      `${consecutiveDenials} consecutive operations were denied by permission rules. This turn is stopping; report the blocked operations to the user.`,
    );
    ctx.abort();
  }
  return {
    output: lines.join("\n"),
    metadata: { error: true, denial: { source: "policy", rule, consecutiveDenials } },
  };
}

export async function requestToolUserInput(
  host: RuntimeToolHost | undefined,
  request: UserInputRequest,
  options?: RuntimeRequestOptions,
): Promise<UserInputResponse | null> {
  options?.signal?.throwIfAborted();
  const response = host?.ask ? await host.ask(request, options) : null;
  options?.signal?.throwIfAborted();
  return response;
}
