// @summary Volatile private-terminal output and direct keystrokes for a running Bash tool call
import type { ThreadTerminalParams, ThreadTerminalResponse } from "@diligent/protocol";
import { matchesKey, parseKittyKey } from "../framework/keys";
import { BRACKETED_PASTE_END, BRACKETED_PASTE_START } from "../framework/stdin-buffer";
import { sliceToFitWidth } from "../framework/string-width";
import type { Component, RenderBlock } from "../framework/types";

export class PrivateTerminal implements Component {
  private cursor = 0;
  private output = "";
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private running = false;
  private stopping = false;

  constructor(
    readonly toolCallId: string,
    private readonly threadId: string,
    private readonly exchange: (params: ThreadTerminalParams) => Promise<ThreadTerminalResponse>,
    private readonly redraw: () => void,
  ) {
    void this.poll();
  }

  stop(): void {
    this.closed = true;
    this.running = false;
    this.output = "";
    clearTimeout(this.timer);
  }

  private async poll(): Promise<void> {
    try {
      const result = await this.exchange({ threadId: this.threadId, toolCallId: this.toolCallId, cursor: this.cursor });
      if (this.closed) return;
      const changed = this.running !== (result.state === "running") || result.output.length > 0 || result.reset;
      this.cursor = result.cursor;
      this.running = result.state === "running";
      this.output = ((result.reset ? "" : this.output) + result.output).slice(-16 * 1024);
      if (changed) this.redraw();
      if (result.state !== "closed") this.timer = setTimeout(() => void this.poll(), 100);
    } catch {
      this.stop();
      this.redraw();
    }
  }
  sendKey(data: string): boolean {
    if (this.closed) return false;
    if (!this.running) return !matchesKey(data, "escape") && !matchesKey(data, "ctrl+c");
    if (this.stopping) return true;
    const params = { threadId: this.threadId, toolCallId: this.toolCallId, cursor: this.cursor };
    const kitty = parseKittyKey(data);
    if (kitty?.eventType === 3) return true;
    const cancel = matchesKey(data, "escape");
    if (cancel) this.stopping = true;
    let input = data;
    if (matchesKey(data, "bracketed_paste")) {
      input = data.slice(BRACKETED_PASTE_START.length, -BRACKETED_PASTE_END.length);
    } else if (matchesKey(data, "enter")) {
      input = "\r";
    } else if (matchesKey(data, "ctrl+c")) {
      input = "\x03";
    }
    void this.exchange(cancel ? { ...params, cancel: true } : { ...params, input }).catch(() => {
      this.stop();
      this.redraw();
    });
    return true;
  }

  render(width: number): string[] {
    if (this.closed) return [];
    if (!this.running) return [sliceToFitWidth("Private terminal · waiting for the command…", width)];
    return [
      "Private terminal · type here · Esc to stop",
      ...Bun.stripANSI(this.output)
        .split(/\r\n|\r|\n/)
        .slice(-8)
        .map((line) => line.replace(/\p{Cc}/gu, "")),
    ].map((line) => sliceToFitWidth(line, width));
  }

  renderBlocks(width: number): RenderBlock[] {
    const lines = this.render(width);
    return lines.length ? [{ key: `private-terminal:${this.toolCallId}`, lines, persistence: "volatile" }] : [];
  }

  invalidate(): void {}
}
