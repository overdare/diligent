// @summary Rendering helpers for the legacy footer status bar

import { sep } from "node:path";
import type { Mode } from "@diligent/protocol";
import { displayWidth } from "../framework/string-width";
import { t } from "../theme";
import type { StatusBarStore } from "./status-bar-store";

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

function visibleLength(s: string): number {
  return displayWidth(s.replace(/\x1b\[[0-9;]*m/g, ""));
}

export function renderStatusBar(store: StatusBarStore, width: number): string[] {
  const info = store.getInfo();
  const leftParts: string[] = [];
  const safeWidth = Math.max(1, width - 1);

  if (info.model) {
    leftParts.push(info.model);
  }

  if (info.contextWindow) {
    const used = info.tokensUsed ?? 0;
    const pct = Math.round((used / info.contextWindow) * 100);
    leftParts.push(`${formatTokensCompact(used)} / ${formatTokensCompact(info.contextWindow)} (${pct}%)`);
  } else if (info.tokensUsed !== undefined) {
    leftParts.push(`${formatTokensCompact(info.tokensUsed)} used`);
  }

  if (info.cwd) {
    leftParts.push(shortenPath(info.cwd));
  }

  if (info.effortLabel ?? info.effort) {
    leftParts.push(`thinking:${info.effortLabel ?? info.effort}`);
  }

  const statusHint = info.status === "busy" ? "ctrl+c to cancel" : info.status === "retry" ? "retrying…" : "";
  const modeHint = !statusHint && info.mode && info.mode !== "default" ? formatModeHint(info.mode) : "";
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
