// @summary Small shared formatting helpers for transcript timing labels

interface MessageTimestampFormatOptions {
  now?: number;
  timeZone?: string;
  hour12?: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Constructing an Intl.DateTimeFormat costs far more than formatting with one, and every rendered
// message formats its timestamp, so formatters are shared per distinct option set.
const formatters = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter;
}

let hour12Preference: boolean | undefined;

function localHour12Preference(): boolean {
  if (hour12Preference === undefined) {
    const hourCycle = cachedFormatter(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
    hour12Preference = hourCycle === "h11" || hourCycle === "h12";
  }
  return hour12Preference;
}

function localYear(timestamp: number, timeZone?: string): string {
  return cachedFormatter("en-US", { year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(timestamp);
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatDurationLabel(durationMs?: number): string | null {
  if (durationMs === undefined || Number.isNaN(durationMs) || durationMs < 1000) return null;

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** Precise tool-call timing, matching the TUI: most Studio RPC calls finish well under a second. */
export function formatToolDurationLabel(durationMs?: number): string | null {
  if (durationMs === undefined || Number.isNaN(durationMs) || durationMs < 0) return null;

  const roundedMs = Math.round(durationMs);
  if (roundedMs < 1000) return `${roundedMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1).replace(/\.0$/, "")}s`;

  const totalSeconds = Math.floor(durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
}

export function formatMessageTimestamp(timestamp: number, options: MessageTimestampFormatOptions = {}): string {
  const now = options.now ?? Date.now();
  const elapsed = Math.max(0, now - timestamp);

  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return `${minutes}m ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `${hours}h ago`;
  }

  const includeYear = localYear(timestamp, options.timeZone) !== localYear(now, options.timeZone);
  const formatter = cachedFormatter("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: options.hour12 ?? localHour12Preference(),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  const parts = formatter.formatToParts(timestamp);
  const date = `${partValue(parts, "month")} ${partValue(parts, "day")}${includeYear ? `, ${partValue(parts, "year")}` : ""}`;
  const period = partValue(parts, "dayPeriod");
  return `${date}, ${partValue(parts, "hour")}:${partValue(parts, "minute")}${period ? ` ${period}` : ""}`;
}

export function formatMessageTimestampTooltip(
  timestamp: number,
  options: Pick<MessageTimestampFormatOptions, "timeZone"> = {},
): string {
  const formatter = cachedFormatter("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  const parts = formatter.formatToParts(timestamp);
  const timezone = partValue(parts, "timeZoneName") || formatter.resolvedOptions().timeZone;
  return `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")} ${partValue(parts, "hour")}:${partValue(parts, "minute")} ${timezone}`;
}
