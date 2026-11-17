// @summary Tolerant line-sequence matching shared by apply_patch and edit: exact, then whitespace and punctuation passes

export interface LineMatchPass {
  /** Human-readable reason reported to the model when this pass, not an exact match, found the text. */
  label: string;
  compare: (fileLine: string, patternLine: string) => boolean;
}

function normalizeUnicode(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000]/g, " ");
}

/** Passes in order of strictness. The first pass that matches wins. */
export const LINE_MATCH_PASSES: readonly LineMatchPass[] = [
  { label: "exact", compare: (a, b) => a === b },
  { label: "ignoring trailing whitespace", compare: (a, b) => a.trimEnd() === b.trimEnd() },
  { label: "ignoring indentation", compare: (a, b) => a.trim() === b.trim() },
  {
    label: "ignoring indentation and typographic punctuation",
    compare: (a, b) => normalizeUnicode(a.trim()) === normalizeUnicode(b.trim()),
  },
];

function matchesAt(lines: string[], pattern: string[], index: number, pass: LineMatchPass): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (!pass.compare(lines[index + i], pattern[i])) return false;
  }
  return true;
}

function tryMatch(lines: string[], pattern: string[], start: number, pass: LineMatchPass, eof: boolean): number {
  if (eof) {
    const fromEnd = lines.length - pattern.length;
    if (fromEnd >= start && matchesAt(lines, pattern, fromEnd, pass)) return fromEnd;
  }
  for (let index = start; index <= lines.length - pattern.length; index++) {
    if (matchesAt(lines, pattern, index, pass)) return index;
  }
  return -1;
}

/** First index at or after `start` where `pattern` matches under the strictest succeeding pass, or -1. */
export function seekSequence(lines: string[], pattern: string[], start: number, eof = false): number {
  if (pattern.length === 0) return -1;
  for (const pass of LINE_MATCH_PASSES) {
    const found = tryMatch(lines, pattern, start, pass, eof);
    if (found !== -1) return found;
  }
  return -1;
}

export type UniqueLineMatch =
  | { kind: "found"; index: number; pass: LineMatchPass }
  | { kind: "ambiguous"; indexes: number[]; pass: LineMatchPass }
  | { kind: "none" };

/**
 * Finds `pattern` in `lines` with the strictest pass that matches anywhere, skipping `exact` (callers try an exact
 * substring match first). A pass that matches more than once is ambiguous; looser passes are not consulted then.
 */
export function findTolerantLineMatch(lines: string[], pattern: string[]): UniqueLineMatch {
  if (pattern.length === 0) return { kind: "none" };
  for (const pass of LINE_MATCH_PASSES.slice(1)) {
    const indexes: number[] = [];
    for (let index = 0; index <= lines.length - pattern.length; index++) {
      if (matchesAt(lines, pattern, index, pass)) indexes.push(index);
    }
    if (indexes.length === 1) return { kind: "found", index: indexes[0], pass };
    if (indexes.length > 1) return { kind: "ambiguous", indexes, pass };
  }
  return { kind: "none" };
}
