// @summary Builds structured Studio instance tool status results for recoverable domain failures.

import type { ToolRenderPayload, ToolResult } from "../types";

export type InstanceOperation = "instance.read" | "vfx_recipe.upsert";
export type InstanceGuidRole = "target" | "parent";
export type MissingGuidCode = "missing_target_guid" | "missing_parent_guid";

export type MissingGuidStatus = {
  kind: "missing_guid";
  code: MissingGuidCode;
  operation: InstanceOperation;
  guid: string;
  role: InstanceGuidRole;
  message: string;
  requiresReadback: true;
  suggestedTool: "studiorpc_level_browse";
};

export type InstanceToolStatus = MissingGuidStatus;

const missingGuidCodeByRole: Record<InstanceGuidRole, MissingGuidCode> = {
  target: "missing_target_guid",
  parent: "missing_parent_guid",
};

const statusOutputOpen = "<studio_instance_status>";
const statusOutputClose = "</studio_instance_status>";

type StatusRenderItem = { key: string; value: string };

function roleLabel(role: InstanceGuidRole): string {
  return role.replace("_", " ");
}

function statusRender(status: InstanceToolStatus): ToolRenderPayload {
  return {
    inputSummary: `${status.operation} ${roleLabel(status.role)} ${status.guid}`,
    outputSummary: status.code,
    blocks: [
      { type: "key_value", title: "Studio instance status", items: statusRenderItems(status) },
      { type: "summary", text: status.message, tone: "warning" },
    ],
  };
}

function statusRenderItems(status: InstanceToolStatus): StatusRenderItem[] {
  return [
    { key: "kind", value: status.kind },
    { key: "code", value: status.code },
    { key: "operation", value: status.operation },
    { key: "role", value: status.role },
    { key: "guid", value: status.guid },
    { key: "requiresReadback", value: String(status.requiresReadback) },
    { key: "suggestedTool", value: status.suggestedTool },
  ];
}

export function instanceStatusResult(status: InstanceToolStatus): ToolResult {
  return {
    output: statusOutput(status),
    render: statusRender(status),
    metadata: {
      error: true,
      method: status.operation,
      status,
    },
  };
}

function statusOutput(status: InstanceToolStatus): string {
  const serializedStatus = JSON.stringify(status);
  return `${statusOutputOpen}\n${serializedStatus}\n${statusOutputClose}\n${status.message}`;
}

export class InstanceToolStatusError extends Error {
  readonly status: InstanceToolStatus;

  constructor(status: InstanceToolStatus) {
    super(status.message);
    this.name = "InstanceToolStatusError";
    this.status = status;
  }
}

export function missingGuidResult(input: {
  operation: InstanceOperation;
  guid: string;
  role: InstanceGuidRole;
}): ToolResult {
  return instanceStatusResult(missingGuidStatus(input));
}

export function missingGuidError(input: {
  operation: InstanceOperation;
  guid: string;
  role: InstanceGuidRole;
}): InstanceToolStatusError {
  return new InstanceToolStatusError(missingGuidStatus(input));
}

export function resultFromInstanceToolStatusError(error: unknown): ToolResult | undefined {
  if (error instanceof InstanceToolStatusError) {
    return instanceStatusResult(error.status);
  }
  return undefined;
}

function missingGuidStatus(input: {
  operation: InstanceOperation;
  guid: string;
  role: InstanceGuidRole;
}): MissingGuidStatus {
  const role = roleLabel(input.role);
  return {
    kind: "missing_guid",
    code: missingGuidCodeByRole[input.role],
    operation: input.operation,
    guid: input.guid,
    role: input.role,
    message: `Missing ${role} GUID for ${input.operation}: ${input.guid}. Read the current hierarchy with studiorpc_level_browse before retrying.`,
    requiresReadback: true,
    suggestedTool: "studiorpc_level_browse",
  };
}
