// @summary Keep terminal launch and replacement feedback tied to process transitions.
import type { ClaudeSessionStatus } from "../../../claude/session";

export interface TerminalOperation {
  kind: "resume" | "new" | "select" | "stop";
  previousId: string | null;
}

export function settleTerminalOperation(
  operation: TerminalOperation | null,
  status: ClaudeSessionStatus,
): TerminalOperation | null {
  if (!operation || status.state === "error") return null;
  if (operation.kind === "stop") return status.state === "exited" ? null : operation;
  if (status.state === "running" && (operation.kind === "resume" || status.id !== operation.previousId)) return null;
  return operation;
}
