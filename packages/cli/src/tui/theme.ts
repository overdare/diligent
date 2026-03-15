// @summary ANSI color and style utilities for terminal output
// --- Primitives (raw ANSI codes) ---
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";
const INVERSE = "\x1b[7m";
const BOLD_OFF = "\x1b[22m";
const ITALIC_OFF = "\x1b[23m";
const UNDERLINE_OFF = "\x1b[24m";

// Tailwind-like terminal palette (ANSI 256 approximations)
const WHITE = "\x1b[38;5;15m";
const SLATE_400 = "\x1b[38;5;245m";
const EMERALD_400 = "\x1b[38;5;78m";
const BLUE_400 = "\x1b[38;5;75m";
const AMBER_400 = "\x1b[38;5;215m";
const TEAL_300 = "\x1b[38;5;116m";
const ROSE_400 = "\x1b[38;5;210m";
const BG_SLATE_800 = "\x1b[48;5;236m";

// --- Semantic theme (exported) ---
export const t = {
  reset: RESET,

  // Text formatting
  bold: BOLD,
  boldOff: BOLD_OFF,
  dim: DIM,
  italic: ITALIC,
  italicOff: ITALIC_OFF,
  underline: UNDERLINE,
  underlineOff: UNDERLINE_OFF,
  inverse: INVERSE,

  // Semantic colors
  accent: TEAL_300, // interactive elements, selected items, links
  success: BLUE_400, // completed tool calls
  info: TEAL_300, // informational labels and headings
  ok: EMERALD_400, // positive states/checks
  warn: AMBER_400, // warnings
  error: ROSE_400, // errors, failures
  text: WHITE, // primary body text
  textMuted: SLATE_400, // secondary body text
  muted: DIM, // low-emphasis hints

  // Mode-specific
  modePlan: TEAL_300,
  modeExecute: TEAL_300,

  // Backgrounds
  bgUser: BG_SLATE_800, // user message background
} as const;
