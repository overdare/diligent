// @summary Shared <system-reminder> envelope for periodic loop-hook reminders (plan, knowledge)

/** Wraps reminder lines in the `<system-reminder>` envelope the model recognizes as runtime-injected guidance. */
export function formatSystemReminder(lines: readonly string[]): string {
  return ["<system-reminder>", ...lines, "</system-reminder>"].join("\n");
}
