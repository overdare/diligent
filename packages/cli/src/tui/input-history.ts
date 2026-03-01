// @summary Manages command input history for the TUI
import { dirname } from "node:path";

export class InputHistory {
  private entries: string[] = [];
  private maxSize: number;
  private filePath: string;

  constructor(filePath: string, maxSize = 100) {
    this.filePath = filePath;
    this.maxSize = maxSize;
  }

  /** Read history file and populate entries. */
  async load(): Promise<void> {
    try {
      const content = await Bun.file(this.filePath).text();
      this.entries = content
        .split("\n")
        .filter((line) => line.length > 0)
        .slice(-this.maxSize);
    } catch {
      // File doesn't exist or can't be read — start empty
      this.entries = [];
    }
  }

  /** Add an entry, deduplicating against the last entry, and persist. */
  add(text: string): void {
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === text) {
      return;
    }
    this.entries.push(text);
    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize);
    }
    // Fire-and-forget save
    this.save().catch(() => {});
  }

  /** Return a copy of the entries array. */
  getEntries(): string[] {
    return [...this.entries];
  }

  private async save(): Promise<void> {
    const dir = dirname(this.filePath);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await Bun.write(this.filePath, this.entries.join("\n") + "\n");
  }
}
