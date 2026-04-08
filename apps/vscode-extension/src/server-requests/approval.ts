// @summary Maps protocol approval requests onto native VS Code confirm UX
import type { ApprovalRequestParams, ApprovalRequestResult } from "@diligent/protocol";
import * as vscode from "vscode";

export async function resolveApprovalRequest(params: ApprovalRequestParams): Promise<ApprovalRequestResult> {
  const detailItems = Object.entries(params.request.details ?? {})
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
  const message = `${params.request.toolName} requests ${params.request.permission} access.`;
  const detail = [params.request.description, detailItems].filter(Boolean).join("\n\n");

  const choice = await vscode.window.showWarningMessage(
    message,
    {
      modal: true,
    },
    { title: "Allow once", decision: "once" as const },
    { title: "Always allow", decision: "always" as const },
    { title: "Reject", decision: "reject" as const },
  );

  if (detail) {
    void vscode.window.showInformationMessage(detail);
  }

  return { decision: choice?.decision ?? "reject" };
}
