// @summary Streaming conversion of pseudo-terminal output into plain text without escape sequences

/** Complete CSI, OSC, DCS/SOS/PM/APC strings, and two-byte or charset escape sequences. */
const ESCAPE_SEQUENCE =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][^\x1b]*\x1b\\|[ -/]*[0-OQ-WYZ\\`-~])/g;
/** The start of an escape sequence that has not reached its final byte or terminator. */
const PARTIAL_ESCAPE = String.raw`\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*\x1b?|[PX^_][^\x1b]*\x1b?|[ -/]*)`;
/** A sequence or carriage return at the end of a chunk that the next chunk may complete. */
const INCOMPLETE_TAIL = new RegExp(`(?:${PARTIAL_ESCAPE}|\\r)$`);
const UNFINISHED_ESCAPE = new RegExp(`${PARTIAL_ESCAPE}$`);
/** C0 controls other than tab and newline, plus DEL. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
/** Longer unterminated sequences are malformed; stop holding them back. */
const MAX_PENDING_CHARS = 4096;

/**
 * Decodes a terminal byte stream into text a model or a plain-text client view can read.
 *
 * Escape sequences (colors, cursor movement, titles) are removed, `\r\n` from the terminal's newline translation becomes
 * `\n`, and a lone `\r` (progress redraws) starts a new line so earlier text is never silently overwritten. Results do
 * not depend on how the stream was split into chunks.
 */
export class TerminalTextDecoder {
  private readonly decoder = new TextDecoder();
  private pending = "";

  /** Returns the text completed by this chunk, holding back a sequence or line ending split across chunks. */
  write(chunk: Uint8Array): string {
    let text = this.pending + this.decoder.decode(chunk, { stream: true });
    this.pending = "";
    const tail = INCOMPLETE_TAIL.exec(text);
    if (tail && text.length - tail.index <= MAX_PENDING_CHARS) {
      this.pending = text.slice(tail.index);
      text = text.slice(0, tail.index);
    }
    return toPlainText(text);
  }

  /** Flushes held-back text at end of stream; an unterminated escape sequence is dropped. */
  end(): string {
    const text = (this.pending + this.decoder.decode()).replace(UNFINISHED_ESCAPE, "");
    this.pending = "";
    return toPlainText(text);
  }
}

// biome-ignore lint/plugin/no-tiny-function: names the terminal-to-plain-text formula used by two callers
function toPlainText(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, "").replace(/\r+\n/g, "\n").replace(/\r/g, "\n").replace(CONTROL, "");
}
