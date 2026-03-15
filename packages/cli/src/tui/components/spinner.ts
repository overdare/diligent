// @summary Animated spinner component for processing indicators
import type { Component } from "../framework/types";
import { t } from "../theme";

const FRAMES = ["✶", "✳", "✢"];
const PREFIX_FRAMES = ["▸", "▹"];
const FRAME_INTERVAL = 120;

interface SpinnerStartOptions {
  prefixMarker?: string;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
}

/** Braille spinner as a Component. Self-animating via interval timer. (D049) */
export class SpinnerComponent implements Component {
  private frameIndex = 0;
  private message = "";
  private active = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime: number | null = null;
  private prefixMarker: string | null = null;

  constructor(private requestRender: () => void) {}

  /** Start the spinner with a message */
  start(message: string, options?: SpinnerStartOptions): void {
    this.stop();
    this.message = message;
    this.active = true;
    this.frameIndex = 0;
    this.startTime = Date.now();
    this.prefixMarker = options?.prefixMarker ?? null;
    this.requestRender();
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      this.requestRender();
    }, FRAME_INTERVAL);
  }

  /** Update the spinner message */
  setMessage(message: string): void {
    this.message = message;
  }

  /** Stop the spinner */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.active = false;
    this.startTime = null;
    this.prefixMarker = null;
  }

  get isRunning(): boolean {
    return this.active;
  }

  render(_width: number): string[] {
    if (!this.active) return [];
    const elapsed = this.startTime !== null ? formatElapsed(Date.now() - this.startTime) : "";
    const elapsedStr = elapsed ? ` ${t.dim}(${elapsed})${t.reset}` : "";
    const spinner = `${t.accent}${FRAMES[this.frameIndex]}${t.reset}`;
    if (!this.prefixMarker) {
      return [`${spinner} ${this.message}${elapsedStr}`];
    }

    const prefix = `${this.frameIndex % 2 === 0 ? t.accent : t.dim}${PREFIX_FRAMES[this.frameIndex % PREFIX_FRAMES.length]}${t.reset}`;
    return [`${prefix} ${spinner} ${this.message}${elapsedStr}`];
  }

  invalidate(): void {
    this.frameIndex = 0;
  }
}
