// @summary Runtime-owned host function types and helpers for tool factory wiring and permission classification
import type { ApprovalRequest, ApprovalResponse } from "../approval/types";
import type { UserInputRequest, UserInputResponse } from "./user-input-types";

export interface RuntimeToolHost {
  approve?: (request: ApprovalRequest, options?: RuntimeRequestOptions) => Promise<ApprovalResponse>;
  ask?: (request: UserInputRequest, options?: RuntimeRequestOptions) => Promise<UserInputResponse>;
}
export interface RuntimeRequestOptions {
  signal?: AbortSignal;
}

export async function requestToolApproval(
  host: RuntimeToolHost | undefined,
  request: ApprovalRequest,
  options?: RuntimeRequestOptions,
): Promise<ApprovalResponse> {
  options?.signal?.throwIfAborted();
  const response = host?.approve ? await host.approve(request, options) : "once";
  options?.signal?.throwIfAborted();
  return response;
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
