// @summary Presentation helpers for welcome banner, timing lines, resumed transcript hydration, and shutdown text

import { displayWidth } from "./framework/string-width";
import { t } from "./theme";

export function buildWelcomeBanner(args: {
  version: string;
  modelId: string;
  cwd: string;
  terminalColumns: number;
  yolo: boolean;
}): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const dir = home && args.cwd.startsWith(home) ? `~${args.cwd.slice(home.length)}` : args.cwd;

  const boxWidth = Math.min(54, Math.max(44, args.terminalColumns - 2));
  const inner = boxWidth - 4;

  const pad = (s: string) => s + " ".repeat(Math.max(0, inner - displayWidth(s)));
  const truncate = (s: string) => (displayWidth(s) > inner ? `${s.slice(0, inner - 1)}…` : s);

  const title = `>_ diligent (v${args.version})`;
  const modelLine = truncate(`model:     ${args.modelId}`);
  const dirLine = truncate(`directory: ${dir}`);
  const yoloLine = args.yolo ? truncate("yolo:      ON ⚡ all permissions auto-approved") : "";

  const row = (s: string) => `${t.dim}│ ${pad(s)} │${t.reset}`;

  return [
    `${t.dim}╭${"─".repeat(boxWidth - 2)}╮${t.reset}`,
    `${t.dim}│${t.reset} ${t.bold}${pad(title)}${t.reset} ${t.dim}│${t.reset}`,
    row(""),
    row(modelLine),
    row(dirLine),
    ...(yoloLine ? [`${t.dim}│${t.reset} ${t.warn}${pad(yoloLine)}${t.reset} ${t.dim}│${t.reset}`] : []),
    `${t.dim}╰${"─".repeat(boxWidth - 2)}╯${t.reset}`,
    "",
    `${t.dim}  Tip: /help · ctrl+o toggle tool details · ctrl+c cancel · ctrl+d exit${t.reset}`,
    "",
  ];
}

export function formatDuration(ms?: number): string | null {
  if (ms === undefined || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function buildTurnTimingLine(args: { loopMs: number | null; thinkingMs: number }): string | null {
  const loopLabel = formatDuration(args.loopMs ?? undefined);
  const thinkingLabel = formatDuration(args.thinkingMs);

  if (!loopLabel && !thinkingLabel) {
    return null;
  }

  return `${t.dim}⏱ ${loopLabel ? `Loop ${loopLabel}` : ""}${loopLabel && thinkingLabel ? " · " : ""}${thinkingLabel ? `Thought ${thinkingLabel}` : ""}${t.reset}`;
}

export function buildShutdownMessage(sessionId: string | null): string {
  let farewell = `\n${t.dim}Goodbye!${t.reset}\n`;
  if (sessionId) {
    farewell += `\n${t.dim}Resume this session with:${t.reset}\n`;
    farewell += `  diligent --resume ${sessionId}\n\n`;
  }
  return farewell;
}
