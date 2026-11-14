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
  /** Called when user responds "always" — adds a session-scoped rule. */
  remember(request: ApprovalRequest, action: "allow" | "deny"): void;
}
