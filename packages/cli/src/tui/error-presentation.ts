// @summary CLI-owned rendering of runtime error presentation and recovery hints

import type { ClientError } from "@diligent/protocol";
import { t } from "./theme";

function formatClientError(error: ClientError): { message: string; hint?: string } {
  const message = error.presentation?.message ?? error.message;
  const recovery = error.presentation?.recovery;

  switch (recovery?.kind) {
    case "configure_provider":
      return {
        message,
        hint: recovery.provider
          ? `Run /provider set ${recovery.provider} to reconnect.`
          : "Run /provider to reconnect.",
      };
    case "start_new_thread":
      return { message, hint: "Run /new to start a new chat." };
    case "retry":
      return { message, hint: "Submit the last prompt again to retry." };
    case undefined:
      return { message };
  }
}

export function formatClientErrorText(error: ClientError): string {
  const { message, hint } = formatClientError(error);
  return hint ? `${message}\n${hint}` : message;
}

/** Local clock time for a transcript error; older days also show the date. */
export function formatErrorTime(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === new Date(now).toDateString()) return clock;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}

/** Transcript lines for an error at the point it happened; the hint is shown only while recovery applies. */
export function buildErrorTranscriptLines(
  error: ClientError,
  timestamp: number,
  options: { includeHint: boolean; now?: number },
): string[] {
  const { message, hint } = formatClientError(error);
  const time = formatErrorTime(timestamp, options.now ?? Date.now());
  return [
    `${t.error}✗ ${message}${t.reset} ${t.dim}· ${time}${t.reset}`,
    ...(hint && options.includeHint ? [`${t.dim}  ${hint}${t.reset}`] : []),
  ];
}
