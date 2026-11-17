// @summary Types for rule-based permission engine — D027, D028, D029
import type { ApprovalRequest } from "@diligent/protocol";

// Re-exports from protocol (canonical source)
export type { ApprovalRequest, ApprovalResponse } from "@diligent/protocol";

export type PermissionAction = "allow" | "deny" | "prompt";

export interface PermissionRule {
  permission: "read" | "write" | "execute";
  /** Wildcard pattern matched against toolName, path, or command */
  pattern: string;
  action: PermissionAction;
}

export interface PermissionEngine {
  /** Evaluate a request. Returns "allow"/"deny" if a rule decides, "prompt" if none match. */
  evaluate(request: ApprovalRequest): PermissionAction;
  /** The rule that decides `evaluate` (the last match), or undefined when no rule matches. */
  decidingRule(request: ApprovalRequest): PermissionRule | undefined;
  /** Called when user responds "always" — adds a session-scoped rule. */
  remember(request: ApprovalRequest, action: "allow" | "deny"): void;
}

/**
 * An approval decision together with who made it. A user rejection ends the turn; a permission-rule
 * denial is reported to the model and the turn continues until the consecutive-denial breaker stops it.
 */
export type ApprovalOutcome =
  | { decision: "once" | "always" }
  | { decision: "reject"; source: "user" }
  | {
      decision: "reject";
      source: "policy";
      /** The deciding rule when the engine can name it. */
      rule?: PermissionRule;
      /** Permission-rule denials in a row for this thread, including this one. */
      consecutiveDenials: number;
      /** `warn` at the breaker threshold, `stop` at twice the threshold (the turn ends). */
      breaker: "none" | "warn" | "stop";
    };
