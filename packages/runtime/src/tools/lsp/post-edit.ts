// @summary Post-write language server sync and diagnostics note appended to successful edit/write/apply_patch results
import type { Diagnostic } from "vscode-languageserver-protocol";
import { changedLineRanges, intersectsRanges } from "./changed-lines";
import { diagnosticSummary } from "./format";
import type { LspWorkspace } from "./workspace";

/** One file a write tool changed. `after` is undefined when the file was deleted. */
export interface WrittenFile {
  path: string;
  /** Content before the write; undefined for a new file. */
  before?: string;
  after?: string;
}

/**
 * Called by write tools after a successful write. Resolves to a note to append to the result, or `undefined`.
 * Never rejects: diagnostics are informational and must not turn a successful write into an error.
 */
export type PostWriteHook = (files: WrittenFile[], options?: { signal?: AbortSignal }) => Promise<string | undefined>;

/** Optional arguments of the write tools (`edit`, `multi_edit`, `write`, `apply_patch`). */
export interface WriteToolOptions {
  postWrite?: PostWriteHook;
}

/** `output` followed by the post-write note, when the hook returns one. */
export async function appendPostWriteNote(
  output: string,
  options: WriteToolOptions | undefined,
  files: WrittenFile[],
  signal: AbortSignal,
): Promise<string> {
  const note = await options?.postWrite?.(files, { signal });
  return note ? `${output}\n\n${note}` : output;
}

export const POST_EDIT_DIAGNOSTICS_BUDGET_MS = 1_500;
const MAX_REPORTED_ERRORS = 10;
const ERROR_SEVERITY = 1;

export interface PostWriteHookOptions {
  /** Total wait for diagnostics across all files of one write. */
  budgetMs?: number;
}

interface FileReport {
  server: string;
  path: string;
  edited: Diagnostic[];
  /** Errors outside edited lines not present before the write; `undefined` when the previous state is unknown. */
  newElsewhere: number | undefined;
  elsewhere: number;
}

/**
 * Keeps open documents in sync with Diligent's writes and, unless `postEditDiagnostics` is `off`, reports errors the
 * write left in its changed lines plus a count of new errors elsewhere. Late diagnostics are dropped.
 */
export function createPostWriteHook(workspace: LspWorkspace, options: PostWriteHookOptions = {}): PostWriteHook {
  const budgetMs = options.budgetMs ?? POST_EDIT_DIAGNOSTICS_BUDGET_MS;
  return async (files, hookOptions) => {
    try {
      const deadline = AbortSignal.timeout(budgetMs);
      const signal = hookOptions?.signal ? AbortSignal.any([hookOptions.signal, deadline]) : deadline;
      const startedAt = Date.now();
      const remaining = () => Math.max(0, budgetMs - (Date.now() - startedAt));
      const reports = await Promise.all(
        files.map((file) => checkFile(workspace, file, signal, remaining).catch(() => undefined)),
      );
      return formatReports(
        workspace,
        reports.filter((report): report is FileReport => report !== undefined),
      );
    } catch {
      return undefined;
    }
  };
}

async function checkFile(
  workspace: LspWorkspace,
  file: WrittenFile,
  signal: AbortSignal,
  remaining: () => number,
): Promise<FileReport | undefined> {
  const mode = workspace.postEditDiagnostics;
  if (file.after === undefined) {
    for (const client of workspace.manager.runningClients()) await client.close(file.path);
    return undefined;
  }
  const acquired = await workspace.acquire(file.path, { start: mode === "start", signal });
  if (!acquired) return undefined;
  const { client, spec } = acquired;
  if (mode === "off") {
    if (client.isOpen(file.path)) await client.sync(file.path, file.after);
    return undefined;
  }

  const prior = client.document(file.path);
  const priorDiagnostics = client.latestDiagnostics(file.path);
  const version = await client.sync(file.path, file.after);
  const after = await workspace.diagnostics(client, file.path, version, { timeoutMs: remaining(), signal });
  const errors = after?.filter((diagnostic) => diagnostic.severity === ERROR_SEVERITY) ?? [];
  if (errors.length === 0) return undefined;

  const changed = file.before === undefined ? undefined : changedLineRanges(file.before, file.after);
  const isEdited = (diagnostic: Diagnostic) =>
    !changed || intersectsRanges(changed, diagnostic.range.start.line + 1, diagnostic.range.end.line + 1);
  const edited = errors.filter(isEdited);
  const elsewhere = errors.filter((diagnostic) => !isEdited(diagnostic));

  let baseline: Diagnostic[] | undefined;
  if (elsewhere.length > 0 && file.before !== undefined) {
    if (prior?.text === file.before && priorDiagnostics && priorDiagnostics.version >= prior.version) {
      baseline = priorDiagnostics.diagnostics;
    } else if (remaining() > 0) {
      // Ask for the previous content's verdict, then hand the server the written content again.
      const baselineVersion = await client.sync(file.path, file.before);
      baseline = await workspace.diagnostics(client, file.path, baselineVersion, { timeoutMs: remaining(), signal });
      await client.sync(file.path, file.after);
    }
  }

  return {
    server: spec.name,
    path: file.path,
    edited,
    elsewhere: elsewhere.length,
    newElsewhere: baseline
      ? countNew(
          elsewhere,
          baseline.filter((d) => d.severity === ERROR_SEVERITY),
        )
      : undefined,
  };
}

/** Errors in `current` not matched by an error with the same message, code and source in `baseline`. */
function countNew(current: Diagnostic[], baseline: Diagnostic[]): number {
  const remainingBaseline = new Map<string, number>();
  for (const diagnostic of baseline) {
    const key = diagnosticKey(diagnostic);
    remainingBaseline.set(key, (remainingBaseline.get(key) ?? 0) + 1);
  }
  let added = 0;
  for (const diagnostic of current) {
    const key = diagnosticKey(diagnostic);
    const count = remainingBaseline.get(key) ?? 0;
    if (count > 0) remainingBaseline.set(key, count - 1);
    else added++;
  }
  return added;
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify([diagnostic.message, diagnostic.code ?? null, diagnostic.source ?? null]);
}

function formatReports(workspace: LspWorkspace, reports: FileReport[]): string | undefined {
  const lines: string[] = [];
  let listed = 0;
  for (const report of reports) {
    const parts: string[] = [];
    if (report.edited.length > 0) parts.push(`${plural(report.edited.length, "error")} in edited lines`);
    if (report.newElsewhere === undefined && report.elsewhere > 0) {
      parts.push(`${plural(report.elsewhere, "error")} elsewhere (pre-existing errors not excluded)`);
    } else if (report.newElsewhere) {
      parts.push(`${plural(report.newElsewhere, "new error")} elsewhere`);
    }
    if (parts.length === 0) continue;
    const path = workspace.displayPath(report.path);
    lines.push(`LSP (${report.server}): ${path}: ${parts.join(", ")}`);
    for (const diagnostic of report.edited) {
      if (listed >= MAX_REPORTED_ERRORS) break;
      listed++;
      lines.push(`  ${path}:${diagnostic.range.start.line + 1} ${diagnosticSummary(diagnostic)}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
