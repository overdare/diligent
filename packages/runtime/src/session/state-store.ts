// @summary In-memory committed and pending session entry store with leaf/path helpers

import type { SessionEntry } from "./types";

export interface VisibleSessionState {
  entries: SessionEntry[];
  leafId: string | null;
}

export class SessionStateStore {
  private entries: SessionEntry[] = [];
  private leafId: string | null = null;
  private pendingEntries: SessionEntry[] = [];
  private pendingLeafId: string | null = null;
  private byId = new Map<string, SessionEntry>();

  reset(): void {
    this.entries = [];
    this.leafId = null;
    this.pendingEntries = [];
    this.pendingLeafId = null;
    this.byId.clear();
  }

  replaceCommitted(entries: SessionEntry[]): void {
    this.entries = [...entries];
    this.leafId = entries.length > 0 ? entries[entries.length - 1].id : null;
    this.pendingEntries = [];
    this.pendingLeafId = null;
    this.byId.clear();
    for (const entry of entries) {
      this.byId.set(entry.id, entry);
    }
  }

  appendCommitted(entries: SessionEntry[]): void {
    for (const entry of entries) {
      this.entries.push(entry);
      this.byId.set(entry.id, entry);
      this.leafId = entry.id;
    }
  }

  setPending(entries: SessionEntry[], leafId: string | null): void {
    this.pendingEntries = [...entries];
    this.pendingLeafId = leafId;
  }

  clearPending(): void {
    this.pendingEntries = [];
    this.pendingLeafId = null;
  }

  getCommittedEntries(): SessionEntry[] {
    return this.entries;
  }

  getCommittedLeafId(): string | null {
    return this.leafId;
  }

  getVisibleState(): VisibleSessionState {
    if (this.pendingEntries.length === 0) {
      return { entries: this.entries, leafId: this.leafId };
    }
    return { entries: [...this.entries, ...this.pendingEntries], leafId: this.pendingLeafId };
  }

  getPathEntries(leafId: string | null = this.leafId): SessionEntry[] {
    if (this.entries.length === 0 || !leafId) return [];

    const path: SessionEntry[] = [];
    let current: SessionEntry | undefined = this.byId.get(leafId);
    while (current) {
      path.push(current);
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    path.reverse();
    return path;
  }

  get entryCount(): number {
    return this.getVisibleState().entries.length;
  }
}
