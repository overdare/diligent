// @summary Bounded execution evidence, paired by actual tool call IDs and selected near the reported tool.
import type { HookInput } from "@diligent/runtime";
import { type RecentRecord, RecentRecordSchema } from "./agent-report-client";
import { maskValue } from "./masking";

/** Correlation stays local; only the existing RecentRecord shape goes over the wire. */
export interface ReportEvidenceCandidate {
  record: RecentRecord;
  calls: Array<{ id: string; name: string; excerpt?: string }>;
}

const CANDIDATE_LIMIT = 50;
const ATTACHMENT_LIMIT = 5;
const PREPARATION_TOOLS = new Set(["skill", "agent_report"]);
type EvidenceCall = ReportEvidenceCandidate["calls"][number];

function sameCall(a: EvidenceCall, b: EvidenceCall): boolean {
  return !!a.id && a.id === b.id && a.name === b.name;
}

function pairedCalls(item: ReportEvidenceCandidate, selected: ReportEvidenceCandidate[]): EvidenceCall[] {
  const results = selected.filter((candidate) => candidate.record.role === "tool_result");
  return item.calls.filter((call) => results.some((result) => result.calls.some((peer) => sameCall(call, peer))));
}

function minimumCallLength(call: EvidenceCall): number {
  return Math.min(call.excerpt?.length ?? 0, call.name.length + 8);
}

function callsFit(calls: EvidenceCall[]): boolean {
  return calls.reduce((sum, call) => sum + minimumCallLength(call), Math.max(0, calls.length - 1)) <= 400;
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  let head = flat.slice(0, limit - 1);
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return `${head}…`;
}

export function previewSessionEntry(input: HookInput): ReportEvidenceCandidate | undefined {
  const entry = maskValue(input.entry) as Record<string, unknown> | undefined;
  if (!entry || typeof input.seq !== "number") return undefined;
  const message = entry.message as Record<string, unknown> | undefined;
  let role: string;
  let tool: string | undefined;
  let excerpt: string;
  let calls: ReportEvidenceCandidate["calls"] = [];
  if (entry.type === "error") {
    role = "error";
    excerpt = `[오류] ${typeof entry.error === "string" ? entry.error : JSON.stringify(entry.error ?? "")}`;
  } else if (entry.type === "message" && message?.role === "tool_result") {
    role = "tool_result";
    tool = typeof message.toolName === "string" ? message.toolName : undefined;
    if (!tool || PREPARATION_TOOLS.has(tool)) return undefined;
    const status = message.isError === true ? "오류" : message.isError === false ? "성공" : "결과";
    excerpt = `[${status}] ${typeof message.output === "string" ? message.output : ""}`;
    if (typeof message.toolCallId === "string") calls = [{ id: message.toolCallId, name: tool }];
  } else if (entry.type === "message" && message?.role === "assistant" && Array.isArray(message.content)) {
    role = "assistant";
    const blocks = message.content.filter(
      (block): block is Record<string, unknown> =>
        !!block &&
        typeof block === "object" &&
        block.type === "tool_call" &&
        typeof block.name === "string" &&
        !PREPARATION_TOOLS.has(block.name),
    );
    if (!blocks.length) return undefined;
    // Prose and thinking are not needed to establish which operation ran.
    calls = blocks.map((block) => ({
      id: typeof block.id === "string" ? block.id : "",
      name: String(block.name),
      excerpt: `→ ${block.name}(${clip(JSON.stringify(block.input ?? {}), 180)})`,
    }));
    excerpt = calls.map((call) => call.excerpt).join("\n");
    const names = new Set(blocks.map((block) => String(block.name)));
    if (names.size === 1) tool = String(blocks[0]!.name);
  } else return undefined;

  const parsed = RecentRecordSchema.safeParse({
    seq: input.seq,
    event_ts: entry.timestamp,
    role,
    ...(tool ? { tool } : {}),
    excerpt: clip(excerpt, 400),
  });
  return parsed.success ? { record: parsed.data, calls } : undefined;
}

export function collectReportEvidence(
  previous: ReportEvidenceCandidate[],
  candidate: ReportEvidenceCandidate | undefined,
): ReportEvidenceCandidate[] {
  if (!candidate) return previous;
  return [...previous.filter((item) => item.record.seq !== candidate.record.seq), candidate]
    .sort((a, b) => a.record.seq - b.record.seq)
    .slice(-CANDIDATE_LIMIT);
}

/** A deterministic neighborhood, not a claim of semantic relevance or a model-written log. */
export function selectReportEvidence(candidates: ReportEvidenceCandidate[], reportedTool?: string): RecentRecord[] {
  if (!candidates.length) return [];
  let anchor = candidates.length - 1;
  if (reportedTool) {
    const matching = candidates.findLastIndex(
      (item) => item.record.tool === reportedTool || item.calls.some((call) => call.name === reportedTool),
    );
    if (matching >= 0) anchor = matching;
  }
  const selected = new Set<number>();
  const hasPair = (a: ReportEvidenceCandidate, b: ReportEvidenceCandidate) =>
    a.record.role !== b.record.role && a.calls.some((call) => b.calls.some((peer) => sameCall(call, peer)));
  const anchorHasPair = candidates.some((item) => hasPair(candidates[anchor]!, item));
  const ranked = candidates.map((_, i) => i).sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || b - a);
  for (const index of ranked) {
    if (selected.has(index)) continue;
    const item = candidates[index]!;
    const paired = candidates.flatMap((other, i) => (i === index || hasPair(item, other) ? [i] : []));
    const group = paired.filter((i) => !selected.has(i));
    // A known execution pair does not need unrelated orphan responses just to fill five slots.
    if (selected.size && anchorHasPair && paired.length === 1 && item.record.role !== "error") continue;
    // Keep a call/response together; do not replace its call with an unrelated neighbor.
    if (selected.size + group.length > ATTACHMENT_LIMIT) continue;
    const proposed = [...new Set([...selected, ...group])].map((i) => candidates[i]!);
    if (
      proposed.some((candidate) => candidate.record.role === "assistant" && !callsFit(pairedCalls(candidate, proposed)))
    )
      continue;
    for (const i of group) selected.add(i);
    if (selected.size === ATTACHMENT_LIMIT) break;
  }
  const chosen = [...selected].map((i) => candidates[i]!);
  return [...selected]
    .sort((a, b) => a - b)
    .map((i) => {
      const item = candidates[i]!;
      if (item.record.role !== "assistant") return item.record;
      const linked = pairedCalls(item, chosen);
      const matching = item.calls.filter((call) => call.name === reportedTool);
      const calls = linked.length ? linked : matching.length ? matching : item.calls;
      // Exact result correlations exclude same-name siblings that were not the selected invocation.
      const ordered = [...calls].sort((a, b) => Number(b.name === reportedTool) - Number(a.name === reportedTool));
      while (!callsFit(ordered)) ordered.pop();
      const minimum = ordered.reduce((sum, call) => sum + minimumCallLength(call), Math.max(0, ordered.length - 1));
      const extra = ordered.length ? Math.floor((400 - minimum) / ordered.length) : 0;
      // Budget space across all selected calls so one long input cannot hide another paired operation.
      const excerpt = ordered.map((call) => clip(call.excerpt ?? "", minimumCallLength(call) + extra)).join(" ");
      return { ...item.record, excerpt: clip(excerpt, 400) };
    });
}
