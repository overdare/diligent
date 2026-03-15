// @summary Footer status bar displaying mode and connection information

import { sep } from "node:path";
import type { Mode, ThinkingEffort } from "@diligent/protocol";
import { displayWidth } from "../framework/string-width";
import type { Component } from "../framework/types";
import { t } from "../theme";

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

function formatTokensCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function shortenPath(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const p = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = p.split(sep).filter(Boolean);
  if (parts.length > 3) {
    return `…${sep}${parts.slice(-2).join(sep)}`;
  }
  return p;
}

const MODE_COLORS: Record<string, string> = {
  plan: t.modePlan,
  execute: t.modeExecute,
};

function formatModeHint(mode: Mode): string {
  const color = MODE_COLORS[mode] ?? "";
  return `${t.boldOff}${color}${mode} mode${t.reset}${t.dim}  (shift+tab to cycle)`;
}

/** Visible length excluding ANSI escape codes with wide-char support */
function visibleLength(s: string): number {
  return displayWidth(s.replace(/\x1b\[[0-9;]*m/g, ""));
}

/** Bottom status bar showing model, tokens, session info */
export class StatusBar implements Component {
  private info: StatusBarInfo = {};

  update(info: Partial<StatusBarInfo>): void {
    Object.assign(this.info, info);
  }

  /** Reset usage counters when starting a new thread */
  resetUsage(): void {
    this.info.tokensUsed = undefined;
    this.info.sessionId = undefined;
  }

  render(width: number): string[] {
    const leftParts: string[] = [];
    const safeWidth = Math.max(1, width - 1);

    if (this.info.model) {
      leftParts.push(this.info.model);
    }

    if (this.info.contextWindow) {
      const used = this.info.tokensUsed ?? 0;
      const pct = Math.round((used / this.info.contextWindow) * 100);
      leftParts.push(`${formatTokensCompact(used)} / ${formatTokensCompact(this.info.contextWindow)} (${pct}%)`);
    } else if (this.info.tokensUsed !== undefined) {
      leftParts.push(`${formatTokensCompact(this.info.tokensUsed)} used`);
    }

    if (this.info.cwd) {
      leftParts.push(shortenPath(this.info.cwd));
    }

    if (this.info.effortLabel ?? this.info.effort) {
      leftParts.push(`thinking:${this.info.effortLabel ?? this.info.effort}`);
    }

    const statusHint =
      this.info.status === "busy" ? "ctrl+c to cancel" : this.info.status === "retry" ? "retrying…" : "";
    const modeHint =
      !statusHint && this.info.mode && this.info.mode !== "default" ? formatModeHint(this.info.mode) : "";
    const rightHint = statusHint || modeHint;

    if (leftParts.length === 0 && !rightHint) return [];

    const leftStr = leftParts.length > 0 ? `  ${leftParts.join(" · ")}` : "";

    if (rightHint) {
      const leftVisible = visibleLength(leftStr);
      const rightVisible = visibleLength(rightHint);
      const pad = Math.max(1, safeWidth - leftVisible - rightVisible);
      const full = `${t.dim}${leftStr}${" ".repeat(pad)}${rightHint}${t.reset}`;
      if (leftVisible + pad + rightVisible <= safeWidth) {
        return [full];
      }
    }

    let line = leftStr;
    if (visibleLength(line) > safeWidth) {
      const chars = [...line];
      let truncated = "";
      for (const ch of chars) {
        if (displayWidth(`${truncated + ch}…`) > safeWidth) break;
        truncated += ch;
      }
      line = `${truncated}…`;
    }

    return [`${t.dim}${line}${t.reset}`];
  }

  invalidate(): void {
    // No cached state
  }
}
