// @summary Overlay dialog shown while context compaction is in progress
import type { Component } from "../framework/types";
import { t } from "../theme";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL = 80;

/** Modal overlay that shows a spinning indicator while context is being compacted */
export class CompactingDialog implements Component {
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private message: string;

  constructor(
    private requestRender: () => void,
    message: string,
  ) {
    this.message = message;
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      this.requestRender();
    }, FRAME_INTERVAL);
  }

  updateMessage(message: string): void {
    this.message = message;
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  render(width: number): string[] {
    const spinner = `${t.accent}${FRAMES[this.frameIndex]}${t.reset}`;
    const label = `${spinner} ${this.message}`;

    const visibleLen = 2 + this.message.length; // spinner char + space + message
    const paddingNeeded = 4; // 2 side padding each side
    const dialogWidth = Math.min(visibleLen + paddingNeeded + 2, Math.floor(width * 0.7));
    const innerWidth = dialogWidth - 4;

    const lines: string[] = [];

    const titleStr = " Compacting ";
    const borderLen = Math.max(0, dialogWidth - 2 - titleStr.length);
    lines.push(`${t.bold}┌─${titleStr}${"─".repeat(borderLen)}┐${t.reset}`);

    // Content line with spinner
    const contentPad = " ".repeat(Math.max(0, innerWidth - visibleLen));
    lines.push(`${t.bold}│${t.reset} ${label}${contentPad} ${t.bold}│${t.reset}`);

    lines.push(`${t.bold}└${"─".repeat(dialogWidth - 2)}┘${t.reset}`);

    return lines;
  }

  handleInput(_data: string): void {
    // Not interactive — swallow all input during compaction
  }

  invalidate(): void {
    this.frameIndex = 0;
  }
}
