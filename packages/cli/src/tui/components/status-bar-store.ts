// @summary Renderer-agnostic status bar state container

import type { Mode, ThinkingEffort } from "@diligent/protocol";

export interface StatusBarInfo {
  model?: string;
  tokensUsed?: number;
  contextWindow?: number;
  sessionId?: string;
  status?: "idle" | "busy" | "retry";
  cwd?: string;
  mode?: Mode;
  effort?: ThinkingEffort;
  effortLabel?: string;
}

export class StatusBarStore {
  private info: StatusBarInfo = {};

  update(info: Partial<StatusBarInfo>): void {
    Object.assign(this.info, info);
  }

  resetUsage(): void {
    this.info.tokensUsed = undefined;
    this.info.sessionId = undefined;
  }

  getInfo(): StatusBarInfo {
    return { ...this.info };
  }
}
