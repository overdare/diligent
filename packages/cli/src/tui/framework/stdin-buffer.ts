// @summary Parses raw terminal input into individual key sequences
/**
 * Splits batched raw input into individual key sequences.
 * Handles single characters, escape sequences, and Kitty protocol sequences.
 */
export const BRACKETED_PASTE_START = "\x1b[200~";
export const BRACKETED_PASTE_END = "\x1b[201~";

export class StdinBuffer {
  private pending = "";
  private inBracketedPaste = false;

  /** Split a raw input chunk into individual sequences */
  split(data: string): string[] {
    const sequences: string[] = [];
    const input = this.pending + data;
    this.pending = "";

    if (!this.inBracketedPaste && !input.includes("\x1b") && this.looksLikePlainMultilinePaste(input)) {
      return [`${BRACKETED_PASTE_START}${input}${BRACKETED_PASTE_END}`];
    }

    let i = 0;

    while (i < input.length) {
      if (this.inBracketedPaste) {
        const endIdx = input.indexOf(BRACKETED_PASTE_END, i);
        if (endIdx === -1) {
          this.pending = input.slice(i);
          break;
        }
        const content = input.slice(i, endIdx);
        sequences.push(`${BRACKETED_PASTE_START}${content}${BRACKETED_PASTE_END}`);
        i = endIdx + BRACKETED_PASTE_END.length;
        this.inBracketedPaste = false;
        continue;
      }

      if (input.startsWith(BRACKETED_PASTE_START, i)) {
        this.inBracketedPaste = true;
        i += BRACKETED_PASTE_START.length;
        continue;
      }

      if (input[i] === "\x1b") {
        const rest = input.slice(i);
        if (BRACKETED_PASTE_START.startsWith(rest)) {
          this.pending = rest;
          break;
        }

        const seq = this.readEscapeSequence(input, i);
        sequences.push(seq);
        i += seq.length;
      } else {
        sequences.push(input[i]);
        i++;
      }
    }

    return sequences;
  }

  private looksLikePlainMultilinePaste(input: string): boolean {
    if (input.length < 2) return false;

    const lineBreaks = [...input.matchAll(/\r\n|\r|\n/g)].map((m) => ({ index: m.index ?? -1, token: m[0] }));
    if (lineBreaks.length === 0) return false;

    if (lineBreaks.length >= 2) return true;

    const only = lineBreaks[0];
    const breakPos = only.index;
    const breakLen = only.token.length;
    const breakAtEnd = breakPos + breakLen === input.length;

    return !breakAtEnd;
  }

  private readEscapeSequence(data: string, start: number): string {
    // Just ESC alone or at end of data
    if (start + 1 >= data.length) {
      return data[start];
    }

    const next = data[start + 1];

    // CSI sequence: ESC [
    if (next === "[") {
      return this.readCSISequence(data, start);
    }

    // SS3 sequence: ESC O
    if (next === "O") {
      if (start + 2 < data.length) {
        return data.slice(start, start + 3);
      }
      return data.slice(start, start + 2);
    }

    // Alt+key: ESC + char
    return data.slice(start, start + 2);
  }

  private readCSISequence(data: string, start: number): string {
    // CSI: ESC [ followed by parameter bytes (0x30-0x3F), intermediate bytes (0x20-0x2F),
    // and a final byte (0x40-0x7E)
    let i = start + 2; // Skip ESC [

    // Read parameter bytes (digits, semicolons, question marks, etc.)
    while (i < data.length && data.charCodeAt(i) >= 0x30 && data.charCodeAt(i) <= 0x3f) {
      i++;
    }

    // Read intermediate bytes
    while (i < data.length && data.charCodeAt(i) >= 0x20 && data.charCodeAt(i) <= 0x2f) {
      i++;
    }

    // Read final byte
    if (i < data.length && data.charCodeAt(i) >= 0x40 && data.charCodeAt(i) <= 0x7e) {
      i++;
    }

    return data.slice(start, i);
  }
}
