// @summary Outcome-first grading primitives shared by runtime eval task evaluators

import { posix } from "node:path";
import type { RuntimeEvalExecution, RuntimeToolTrace } from "../../runtime-task";
import type { EvalDiagnostic, EvalDiagnosticImpact, EvalDimension, EvalSemanticResult } from "../../task";
import { isRecord } from "../core/helpers";

/**
 * Collects non-gating diagnostics and produces the task's semantic result.
 *
 * Grading contract (see docs/guide/evals.md "Grading policy"):
 * - `fail` only for a wrong end state, a violated safety boundary, a missing construct-essential event, or a format the
 *   prompt explicitly requires.
 * - `note` for path quality: extra, repeated, recovered, or verification calls; tool choice; call counts and order that
 *   the task does not semantically require.
 */
export class RuntimeGrade {
  private readonly diagnostics: EvalDiagnostic[] = [];

  constructor(private readonly prefix: string) {}

  note(
    code: string,
    message: string,
    options: { dimension?: EvalDimension; impact?: EvalDiagnosticImpact } = {},
  ): void {
    this.diagnostics.push({
      dimension: options.dimension ?? "efficiency",
      impact: options.impact ?? "degraded",
      code: `${this.prefix}.${code}`,
      message,
    });
  }

  fail(code: string, message: string, dimension: Exclude<EvalDimension, "efficiency">): EvalSemanticResult {
    return {
      passed: false,
      code: `${this.prefix}.${code}`,
      message,
      dimension,
      ...(this.diagnostics.length > 0 && { diagnostics: [...this.diagnostics] }),
    };
  }

  pass(): EvalSemanticResult {
    return { passed: true, ...(this.diagnostics.length > 0 && { diagnostics: [...this.diagnostics] }) };
  }
}

const PATH_KEYS = ["file_path", "path", "filePath", "file"] as const;

/**
 * Resolves a traced path to a workspace-relative POSIX path. Accepts `$WORKSPACE`-normalized absolute paths, Windows
 * separators, and paths relative to the thread cwd. Returns undefined for paths outside the workspace.
 */
export function workspaceRelativePath(path: string, threadCwd = "$WORKSPACE"): string | undefined {
  const slashed = path.replaceAll("\\", "/").trim();
  const cwd = threadCwd.replaceAll("\\", "/");
  const cwdRelative = cwd === "$WORKSPACE" ? "" : cwd.startsWith("$WORKSPACE/") ? cwd.slice("$WORKSPACE/".length) : "";
  let candidate: string;
  if (slashed === "$WORKSPACE") candidate = ".";
  else if (slashed.startsWith("$WORKSPACE/")) candidate = slashed.slice("$WORKSPACE/".length);
  else if (slashed.startsWith("$") || posix.isAbsolute(slashed) || /^[A-Za-z]:\//.test(slashed)) return undefined;
  else candidate = posix.join(cwdRelative, slashed);
  const normalized = posix.normalize(candidate);
  if (normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized === "." ? "" : normalized.replace(/\/$/, "");
}

/** Workspace-relative paths a traced call addressed, including every file named in an `apply_patch` envelope. */
export function tracePaths(trace: Pick<RuntimeToolTrace, "input">, threadCwd?: string): string[] {
  const input = trace.input;
  if (!isRecord(input)) return [];
  const raw: string[] = [];
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string") raw.push(value);
  }
  const patch = typeof input.patch === "string" ? input.patch : typeof input.input === "string" ? input.input : "";
  for (const match of patch.matchAll(/^\*{3} (?:Add|Update|Delete) File: (.+)$/gm)) raw.push(match[1]!);
  for (const match of patch.matchAll(/^\*{3} Move to: (.+)$/gm)) raw.push(match[1]!);
  return raw.flatMap((path) => {
    const relative = workspaceRelativePath(path, threadCwd);
    return relative === undefined ? [] : [relative];
  });
}

export function traceTargets(trace: Pick<RuntimeToolTrace, "input">, path: string, threadCwd?: string): boolean {
  return tracePaths(trace, threadCwd).includes(path);
}

/** Successful calls that read the given workspace-relative file, whether issued directly or nested in code mode. */
export function successfulReadsOf(input: Pick<RuntimeEvalExecution<unknown>, "toolCalls" | "threadCwd">, path: string) {
  return input.toolCalls.filter(
    (call) => call.capability === "read" && call.outcome === "success" && traceTargets(call, path, input.threadCwd),
  );
}

/** Successful write-capability calls that changed the given workspace-relative file. */
export function successfulWritesTo(
  input: Pick<RuntimeEvalExecution<unknown>, "toolCalls" | "threadCwd">,
  path: string,
) {
  return input.toolCalls.filter(
    (call) => call.capability === "write" && call.outcome === "success" && traceTargets(call, path, input.threadCwd),
  );
}

/** Successful runs of an exact allowed shell command whose process exited 0. */
export function passingCommandRuns(
  input: Pick<RuntimeEvalExecution<unknown>, "toolCalls">,
  command: string,
): RuntimeToolTrace[] {
  return input.toolCalls.filter((call) => {
    if (call.name !== "bash" || call.outcome !== "success") return false;
    if (!isRecord(call.input) || typeof call.input.command !== "string" || call.input.command.trim() !== command)
      return false;
    return isRecord(call.output) && isRecord(call.output.metadata) && call.output.metadata.exitCode === 0;
  });
}

/** Text of the final assistant message in a turn (the user-visible answer); defaults to the last turn. */
export function finalAssistantText(input: Pick<RuntimeEvalExecution<unknown>, "turns">, turnIndex?: number): string {
  const last = input.turns
    .at(turnIndex ?? -1)
    ?.messages.filter((message) => message.role === "assistant")
    .at(-1);
  if (!last || last.role !== "assistant") return "";
  return last.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

const REPLY_WRAPPERS = [
  /^```[^\n]*\n([\s\S]*?)\n?```$/,
  /^`+([^`]*)`+$/,
  /^\*\*([\s\S]*)\*\*$/,
  /^"([^"]*)"$/,
  /^'([^']*)'$/,
  /^“([^”]*)”$/,
] as const;

/**
 * Reply text with cosmetic presentation removed: surrounding whitespace, wrapping code, bold, or quote markup, and
 * trailing sentence punctuation. Wording, typos, and extra text are preserved so they still count.
 */
export function unwrapReply(text: string): string {
  let current = text.trim();
  for (let previous = ""; previous !== current; ) {
    previous = current;
    for (const wrapper of REPLY_WRAPPERS) {
      const match = wrapper.exec(current);
      if (match) current = match[1]!.trim();
    }
    current = current.replace(/[.!。]$/, "").trim();
  }
  return current;
}

/** Whether a final answer is the required reply once cosmetic presentation is removed. */
export function isExactReply(text: string, expected: string): boolean {
  return unwrapReply(text) === expected;
}

/** Calls the task did not anticipate but that cannot affect the outcome: failed or rejected read-only probes. */
export function harmlessFailedProbes(input: Pick<RuntimeEvalExecution<unknown>, "toolCalls">): RuntimeToolTrace[] {
  return input.toolCalls.filter((call) => call.capability === "read" && call.outcome !== "success");
}

/** Completed compactions announced during one turn, whether automatic or requested. */
export function compactionEndCount(
  turn: Pick<RuntimeEvalExecution<unknown>["turns"][number], "notifications">,
): number {
  return turn.notifications.filter(
    (notice) =>
      notice.method === "agent/event" &&
      isRecord(notice.params) &&
      isRecord(notice.params.event) &&
      notice.params.event.type === "compaction_end",
  ).length;
}
