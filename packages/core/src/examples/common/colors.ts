// @summary Shared ANSI color constants and helpers for examples
export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[2;33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

export const tag = (color: string, label: string) => `${color}${c.bold}[${label}]${c.reset}`;
