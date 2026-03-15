// @summary Calculates display width of characters and strings accounting for CJK

enum CodePoint {
  ZeroWidthJoiner = 0x200d,
  CombiningEnclosingKeycap = 0x20e3,
}

function isCombiningMark(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isVariationSelector(codePoint: number): boolean {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

function isEmojiModifier(codePoint: number): boolean {
  return codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function isEmojiLike(codePoint: number): boolean {
  if (
    codePoint === 0x276e ||
    codePoint === 0x276f ||
    codePoint === 0x2722 ||
    codePoint === 0x2733 ||
    codePoint === 0x2736
  ) {
    return false;
  }

  return (
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    isRegionalIndicator(codePoint)
  );
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint === CodePoint.ZeroWidthJoiner ||
    codePoint === 0x200c ||
    codePoint === 0x200b ||
    (codePoint >= 0x0000 && codePoint <= 0x001f) ||
    codePoint === 0x007f ||
    isCombiningMark(codePoint) ||
    isVariationSelector(codePoint) ||
    isEmojiModifier(codePoint)
  );
}

function graphemeWidth(segment: string): number {
  const codePoints = [...segment].map((ch) => ch.codePointAt(0)!);
  if (codePoints.length === 0) return 0;

  if (codePoints.every((cp) => isZeroWidthCodePoint(cp))) return 0;

  const hasJoiner = codePoints.includes(CodePoint.ZeroWidthJoiner);
  const emojiCount = codePoints.filter((cp) => isEmojiLike(cp)).length;

  if (hasJoiner && emojiCount > 0) return 2;
  if (emojiCount === 2 && codePoints.every((cp) => isRegionalIndicator(cp))) return 2;
  if (codePoints.includes(CodePoint.CombiningEnclosingKeycap)) return 2;
  if (emojiCount > 0) return 2;

  let width = 0;
  for (const cp of codePoints) {
    width += charDisplayWidth(cp);
  }
  return width;
}

let cachedSegmenter: Intl.Segmenter | null = null;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (cachedSegmenter !== null) return cachedSegmenter;
  if (typeof Intl === "undefined" || typeof Intl.Segmenter === "undefined") return null;
  cachedSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return cachedSegmenter;
}

/**
 * Get the terminal display width of a Unicode code point.
 * CJK / Hangul / fullwidth characters occupy 2 columns; most others occupy 1.
 */
export function charDisplayWidth(codePoint: number): number {
  if (isZeroWidthCodePoint(codePoint)) return 0;

  // Hangul Jamo (initial consonants — always wide in terminals)
  if (codePoint >= 0x1100 && codePoint <= 0x115f) return 2;
  if (codePoint >= 0x11a3 && codePoint <= 0x11a7) return 2;
  if (codePoint >= 0x11fa && codePoint <= 0x11ff) return 2;
  // CJK Radicals, Kangxi Radicals, Ideographic Description, CJK Symbols
  if (codePoint >= 0x2e80 && codePoint <= 0x303e) return 2;
  // Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo, Kanbun, etc.
  if (codePoint >= 0x3040 && codePoint <= 0x33bf) return 2;
  // CJK Unified Ideographs Extension A
  if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return 2;
  // CJK Unified Ideographs
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return 2;
  // Hangul Syllables (가–힣)
  if (codePoint >= 0xac00 && codePoint <= 0xd7af) return 2;
  // CJK Compatibility Ideographs
  if (codePoint >= 0xf900 && codePoint <= 0xfaff) return 2;
  // Vertical / Small / Compatibility Forms
  if (codePoint >= 0xfe10 && codePoint <= 0xfe6f) return 2;
  // Fullwidth Forms (！through ～)
  if (codePoint >= 0xff01 && codePoint <= 0xff60) return 2;
  // Fullwidth currency / symbol variants
  if (codePoint >= 0xffe0 && codePoint <= 0xffe6) return 2;
  // CJK Unified Ideographs Extension B–F + Supplementary
  if (codePoint >= 0x20000 && codePoint <= 0x2fa1f) return 2;
  return 1;
}

/**
 * Measure the terminal display width of a plain string (no ANSI codes).
 * Uses grapheme segmentation when available so emoji sequences are measured as one cluster.
 */
export function displayWidth(str: string): number {
  // Fast path: pure printable ASCII
  let allAscii = true;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 0x7e || code < 0x20) {
      allAscii = false;
      break;
    }
  }
  if (allAscii) return str.length;

  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    let width = 0;
    for (const { segment } of segmenter.segment(str)) {
      width += graphemeWidth(segment);
    }
    return width;
  }

  let width = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) {
      width += charDisplayWidth(cp);
    }
  }
  return width;
}

/**
 * Slice characters from the start of a string that fit within `maxWidth`
 * terminal columns. Returns the substring.
 */
export function sliceToFitWidth(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    let width = 0;
    let end = 0;
    for (const part of segmenter.segment(str)) {
      const segment = part.segment;
      const segmentWidth = graphemeWidth(segment);
      if (width + segmentWidth > maxWidth) break;
      width += segmentWidth;
      end = part.index + segment.length;
    }
    return str.slice(0, end);
  }

  let width = 0;
  let byteEnd = 0;
  for (const ch of str) {
    const cw = charDisplayWidth(ch.codePointAt(0)!);
    if (width + cw > maxWidth) break;
    width += cw;
    byteEnd += ch.length;
  }
  return str.slice(0, byteEnd);
}

/**
 * Slice characters from the end of a string that fit within `maxWidth`
 * terminal columns. Returns the substring.
 */
export function sliceEndToFitWidth(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    const parts = [...segmenter.segment(str)];
    let width = 0;
    let start = str.length;
    for (let i = parts.length - 1; i >= 0; i--) {
      const segment = parts[i].segment;
      const segmentWidth = graphemeWidth(segment);
      if (width + segmentWidth > maxWidth) break;
      width += segmentWidth;
      start = parts[i].index;
    }
    return str.slice(start);
  }

  const chars = [...str];
  let width = 0;
  let startIdx = chars.length;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = charDisplayWidth(chars[i].codePointAt(0)!);
    if (width + cw > maxWidth) break;
    width += cw;
    startIdx = i;
  }
  return chars.slice(startIdx).join("");
}
