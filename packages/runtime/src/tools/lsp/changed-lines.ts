// @summary Line ranges of new content that a write changed, from a bounded Myers line diff

/** Inclusive 1-based line range in the new content. */
export interface LineRange {
  start: number;
  end: number;
}

/** Beyond this edit distance the diff gives up and reports the whole differing middle as one range. */
const MAX_EDIT_DISTANCE = 2_000;

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * Lines of `after` that are new or replaced relative to `before`. A pure deletion marks the lines on both sides of
 * the removed text. Returns no ranges when the contents are equal.
 */
export function changedLineRanges(before: string, after: string): LineRange[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const oldMiddle = a.slice(prefix, a.length - suffix);
  const newMiddle = b.slice(prefix, b.length - suffix);
  if (oldMiddle.length === 0 && newMiddle.length === 0) return [];

  const marked = diffMarks(oldMiddle, newMiddle);
  const lines = marked
    ? [...marked].map((index) => index + prefix + 1)
    : rangeOf(prefix + 1, Math.max(prefix + 1, prefix + newMiddle.length));
  return toRanges(lines.filter((line) => line >= 1 && line <= b.length));
}

/**
 * 0-based indexes into `b` (relative to the compared middle) touched by the edit script: inserted lines, and the
 * neighbours of each deletion point (which may be -1 or b.length, outside the middle). `undefined` when the edit
 * distance exceeds the bound.
 */
function diffMarks(a: string[], b: string[]): Set<number> | undefined {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return undefined;

  const inserted = new Set<number>();
  /** Positions in `b` where lines of `a` were removed: between b[y - 1] and b[y]. */
  const deletedAt: number[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snapshot = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && snapshot[offset + k - 1]! < snapshot[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = snapshot[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) inserted.add(prevY);
      else deletedAt.push(y);
    }
    x = prevX;
    y = prevY;
  }
  const marks = new Set(inserted);
  // A replaced line is already marked; a pure deletion marks the lines it now separates.
  for (const position of deletedAt) {
    if (inserted.has(position) || inserted.has(position - 1)) continue;
    marks.add(position - 1);
    marks.add(position);
  }
  return marks;
}

function rangeOf(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function toRanges(lines: number[]): LineRange[] {
  const sorted = [...new Set(lines)].sort((left, right) => left - right);
  const ranges: LineRange[] = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last && line === last.end + 1) last.end = line;
    else ranges.push({ start: line, end: line });
  }
  return ranges;
}

export function intersectsRanges(ranges: readonly LineRange[], startLine: number, endLine: number): boolean {
  return ranges.some((range) => range.start <= endLine && startLine <= range.end);
}
