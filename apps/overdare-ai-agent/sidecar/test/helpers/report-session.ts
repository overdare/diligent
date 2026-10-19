// @summary Real JSONL fixtures for report tools; the fake hook represents already-persisted entries.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BundledToolProvider, type HookInput, SESSION_VERSION } from "@diligent/runtime";

export class ReportSessionFiles {
  readonly root = mkdtempSync(join(tmpdir(), "report-session-"));
  private readonly entries = new Map<string, Map<number, unknown>>();

  path(sessionId: string): string {
    return join(this.root, `${encodeURIComponent(sessionId)}.jsonl`);
  }

  write(input: HookInput): void {
    const entries = this.entries.get(input.session_id) ?? new Map<number, unknown>();
    const seq = typeof input.seq === "number" ? input.seq : 1;
    entries.set(seq, input.entry);
    this.entries.set(input.session_id, entries);
    const header = {
      type: "session",
      version: SESSION_VERSION,
      id: input.session_id,
      timestamp: "2026-10-19T09:00:00Z",
      cwd: input.cwd,
    };
    const lines: unknown[] = [header];
    for (let i = 1; i <= Math.max(...entries.keys()); i++) {
      lines.push(entries.get(i) ?? { type: "session_info", id: `padding-${i}` });
    }
    writeFileSync(this.path(input.session_id), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  }

  track(provider: BundledToolProvider): BundledToolProvider {
    const original = provider.onEntryAppended!;
    const observer = async (input: HookInput) => {
      this.write(input);
      return original({ ...input, transcript_path: this.path(input.session_id) });
    };
    observer.mode = original.mode;
    return { ...provider, onEntryAppended: observer };
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
