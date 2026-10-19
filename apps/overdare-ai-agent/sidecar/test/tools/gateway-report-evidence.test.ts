// @summary Verifies report evidence keeps real execution context instead of report preparation.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { HookInput } from "@diligent/runtime";
import { createGatewayToolProvider as createRealGatewayToolProvider } from "../../src/tools/gateway";
import { createAgentReportTool, type SessionReportContext } from "../../src/tools/gateway/agent-report";
import type { AgentReportWire } from "../../src/tools/gateway/agent-report-client";
import { ReportSessionFiles } from "../helpers/report-session";

const savedFetch = globalThis.fetch;
const savedUrl = process.env.DILIGENT_GATEWAY_URL;
const savedToken = process.env.DILIGENT_GATEWAY_TOKEN;
let reports: AgentReportWire[];
let recordBodies: unknown[];
let sessionFiles: ReportSessionFiles;

function createGatewayToolProvider(options: Parameters<typeof createRealGatewayToolProvider>[0]) {
  return sessionFiles.track(createRealGatewayToolProvider(options));
}

beforeEach(() => {
  sessionFiles = new ReportSessionFiles();
  reports = [];
  recordBodies = [];
  process.env.DILIGENT_GATEWAY_URL = "https://gateway.example";
  process.env.DILIGENT_GATEWAY_TOKEN = "synthetic-token";
  globalThis.fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/agent-reports")) reports.push(body);
    else recordBodies.push(body);
    return Response.json({ report_id: 1, reported_at: "2026-10-19T09:00:00Z", stored: true, notified: false });
  }) as typeof fetch;
});

afterEach(() => {
  sessionFiles.cleanup();
  globalThis.fetch = savedFetch;
  if (savedUrl === undefined) delete process.env.DILIGENT_GATEWAY_URL;
  else process.env.DILIGENT_GATEWAY_URL = savedUrl;
  if (savedToken === undefined) delete process.env.DILIGENT_GATEWAY_TOKEN;
  else process.env.DILIGENT_GATEWAY_TOKEN = savedToken;
});

type Provider = ReturnType<typeof createGatewayToolProvider>;
function provider() {
  return createGatewayToolProvider({ cwd: "/workspace", projectId: "project-1", canTransmitRecords: () => true });
}
async function append(p: Provider, seq: number, message: Record<string, unknown>, session = "session-1") {
  await p.onEntryAppended?.({
    session_id: session,
    transcript_path: "/unused.jsonl",
    cwd: "/workspace",
    hook_event_name: "EntryAppended",
    user_id: "alice",
    seq,
    entry: { type: "message", timestamp: "2026-10-19T09:00:00Z", message },
  } satisfies HookInput);
}
function call(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): { role: string; content: Array<Record<string, unknown>> } {
  return { role: "assistant", content: [{ type: "tool_call", id, name, input }] };
}
function result(id: string, name: string, output: string, isError = false) {
  return { role: "tool_result", toolCallId: id, toolName: name, output, isError };
}
async function executeReport(p: Provider, tool?: string, session = "session-1") {
  const reporter = (await p.createTools({ cwd: "/workspace" })).find((t) => t.name === "agent_report")!;
  const receipt = await reporter.execute(
    {
      kind: "studio_bug",
      payload: {
        title: "Synthetic report",
        task_context: "Synthetic context",
        problem: "Synthetic problem",
        report_reason: "Synthetic reason",
        suggestion: "Synthetic suggestion",
        evidence: { tool },
      },
    },
    { sessionId: session, toolCallId: "report-1", signal: new AbortController().signal, abort() {} },
  );
  return receipt;
}
async function submit(p: Provider, tool?: string, session = "session-1") {
  expect((await executeReport(p, tool, session)).output).toContain("saved");
  return reports.at(-1)!.payload.evidence.recent_records;
}

test("report preparation cannot evict the real failed call and its result", async () => {
  const p = provider();
  await append(p, 1, call("rpc-1", "studiorpc_game_pie_status", { verbose: true }));
  await append(p, 2, result("rpc-1", "studiorpc_game_pie_status", "Studio RPC timed out", true));
  await append(p, 3, { role: "user", content: "Private user prompt" });
  await append(p, 4, { role: "assistant", content: "I will load the reporting skill." });
  await append(p, 5, call("skill-1", "skill", { name: "session-issue-report" }));
  await append(p, 6, result("skill-1", "skill", "# Session Issue Report\nYou judge whether a finding is useful"));
  await append(p, 7, call("old-report", "agent_report"));
  await append(p, 8, result("old-report", "agent_report", "Old report saved"));

  const records = await submit(p, "studiorpc_game_pie_status");
  expect(records.map((r) => r.seq)).toEqual([1, 2]);
  expect(records[0]?.excerpt).toContain('studiorpc_game_pie_status({"verbose":true})');
  expect(records[1]?.excerpt).toContain("[오류] Studio RPC timed out");
  expect(JSON.stringify(records)).not.toMatch(/Private user prompt|I will load|Session Issue Report|Old report/);
  expect(recordBodies).toHaveLength(8);
  expect(JSON.stringify(recordBodies)).toContain("# Session Issue Report");
});

test("a reported write and its successful response stay with the unchanged read-back", async () => {
  const p = provider();
  await append(p, 1, call("write-1", "instance_upsert", { Name: "frame", Thickness: 2 }));
  await append(p, 2, result("write-1", "instance_upsert", "Applied successfully"));
  await append(p, 3, call("read-1", "instance_read", { Name: "frame" }));
  await append(p, 4, result("read-1", "instance_read", "Thickness is still 1"));
  for (let seq = 5; seq <= 16; seq++) {
    await append(p, seq, result(`other-${seq}`, "unrelated_tool", `Unrelated result ${seq}`));
  }
  const records = await submit(p, "instance_upsert");
  expect(records.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
  expect(records.find((r) => r.seq === 2)?.excerpt).toContain("[성공] Applied successfully");
  expect(records.find((r) => r.seq === 4)?.excerpt).toContain("Thickness is still 1");
  expect(records.length).toBeLessThanOrEqual(5);
  expect(records.map((r) => r.seq)).toEqual(records.map((r) => r.seq).sort((a, b) => a - b));
});

test("out-of-order results pair with their actual tool call instead of a neighboring call", async () => {
  const p = provider();
  await append(p, 1, call("a", "target_tool", { target: "A" }));
  await append(p, 2, call("b", "other_tool", { target: "B" }));
  await append(p, 3, result("b", "other_tool", "B completed"));
  for (let seq = 4; seq <= 10; seq++) await append(p, seq, result(`other-${seq}`, "other_tool", "Other result"));
  await append(p, 11, result("a", "target_tool", "A failed", true));
  const records = await submit(p, "target_tool");
  expect(records.map((r) => r.seq)).toEqual(expect.arrayContaining([1, 11]));
  expect(records.find((r) => r.seq === 1)?.excerpt).toContain('"target":"A"');
  expect(records.length).toBeLessThanOrEqual(5);
});

test("only report preparation produces empty evidence rather than invented execution history", async () => {
  const p = provider();
  await append(p, 1, { role: "user", content: "Test submission please" });
  await append(p, 2, call("s", "skill", { name: "session-issue-report" }));
  await append(p, 3, result("s", "skill", "Synthetic skill instructions"));
  expect(await submit(p)).toEqual([]);
});

test("call inputs are masked before truncation and private thinking is not excerpted", async () => {
  const p = provider();
  const secret = "sk-ant-0123456789012345678901";
  const message = call("rpc-1", "target_tool", { token: secret, note: "x".repeat(600) });
  message.content.unshift({ type: "thinking", thinking: "Private reasoning" });
  await append(p, 1, message);
  await append(p, 2, result("rpc-1", "target_tool", "y".repeat(390) + secret, true));
  const records = await submit(p, "target_tool");
  expect(JSON.stringify(records)).not.toContain(secret);
  expect(JSON.stringify(records)).not.toContain("Private reasoning");
  expect(records[0]?.excerpt).toContain("[REDACTED:anthropic-key]");
  for (const record of records) expect(record.excerpt.length).toBeLessThanOrEqual(400);
});

test("mixed assistant messages retain real calls while dropping report calls and prose", async () => {
  const p = provider();
  await append(p, 1, {
    role: "assistant",
    content: [
      { type: "text", text: "Report preparation" },
      ...call("skill-1", "skill").content,
      ...call("report-1", "agent_report").content,
      ...call("real-1", "target_tool", { checked: true }).content,
    ],
  });
  const records = await submit(p, "target_tool");
  expect(records).toHaveLength(1);
  expect(records[0]?.excerpt).toContain("target_tool");
  expect(records[0]?.excerpt).not.toMatch(/Report preparation|agent_report|skill/);
});

test("selection and paired calls never cross session boundaries", async () => {
  const p = provider();
  await append(p, 1, call("same-id", "target_tool", { owner: "session-one" }));
  await append(p, 1, call("same-id", "target_tool", { owner: "session-two" }), "session-2");
  await append(p, 2, result("same-id", "target_tool", "session-one result"));
  const records = await submit(p, "target_tool");
  expect(JSON.stringify(records)).toContain("session-one");
  expect(JSON.stringify(records)).not.toContain("session-two");
});

test("an unavailable outcome is not presented as a successful operation", async () => {
  const p = provider();
  const message: Record<string, unknown> = result("a", "target_tool", "Outcome not supplied");
  delete message.isError;
  await append(p, 1, message);
  const records = await submit(p, "target_tool");
  expect(records[0]?.excerpt).toBe("[결과] Outcome not supplied");
});

test("unicode excerpts fit the existing wire limit without splitting surrogate pairs", async () => {
  const p = provider();
  await append(p, 1, result("a", "target_tool", "😀".repeat(300), true));
  const records = await submit(p, "target_tool");
  expect(records).toHaveLength(1);
  expect(records[0]?.excerpt.length).toBeLessThanOrEqual(400);
  expect(records[0]?.excerpt).not.toContain("\uFFFD");
  expect(new TextDecoder().decode(new TextEncoder().encode(records[0]!.excerpt))).toBe(records[0]!.excerpt);
  expect(records[0]?.excerpt.endsWith("…")).toBe(true);
});

test("standalone session errors remain available as supporting evidence", async () => {
  const p = provider();
  await p.onEntryAppended?.({
    session_id: "session-1",
    transcript_path: "/unused.jsonl",
    cwd: "/workspace",
    hook_event_name: "EntryAppended",
    user_id: "alice",
    seq: 1,
    entry: { type: "error", timestamp: "2026-10-19T09:00:00Z", error: "Connection closed" },
  });
  const records = await submit(p);
  expect(records[0]?.role).toBe("error");
  expect(records[0]?.excerpt).toContain("[오류] Connection closed");
});

test("a reported parallel call remains visible even after many long sibling calls", async () => {
  const p = provider();
  const siblings = Array.from(
    { length: 8 },
    (_, i) => call(`sibling-${i}`, "other_tool", { padding: "x".repeat(300) }).content[0],
  );
  await append(p, 1, {
    role: "assistant",
    content: [...siblings, ...call("target-id", "target_tool", { target: "last" }).content],
  });
  await append(p, 2, result("target-id", "target_tool", "Target failed", true));
  const records = await submit(p, "target_tool");
  expect(records.find((r) => r.seq === 1)?.excerpt).toContain('target_tool({"target":"last"})');
  expect(records.find((r) => r.seq === 2)?.excerpt).toContain("[오류] Target failed");
});

test("parallel calls of the same tool use the exact failed invocation", async () => {
  const p = provider();
  await append(p, 1, {
    role: "assistant",
    content: Array.from(
      { length: 8 },
      (_, i) => call(`id-${i}`, "same_tool", { slot: i, padding: "x".repeat(300) }).content[0],
    ),
  });
  await append(p, 2, result("id-7", "same_tool", "Slot 7 failed", true));
  const records = await submit(p, "same_tool");
  expect(records.find((r) => r.seq === 1)?.excerpt).toContain('"slot":7');
  expect(records.find((r) => r.seq === 1)?.excerpt).not.toContain('"slot":0');
});

test.each([false, true])("every selected parallel result has a visible call (long names: %s)", async (longNames) => {
  const p = provider();
  const names = Array.from({ length: 8 }, (_, i) => `tool_${i}_${longNames ? "x".repeat(110) : ""}`);
  await append(p, 1, {
    role: "assistant",
    content: names.map((name, i) => call(`id-${i}`, name, { slot: i, padding: "x".repeat(300) }).content[0]),
  });
  for (const [i, name] of names.entries()) await append(p, i + 2, result(`id-${i}`, name, `Result ${i}`));
  const records = await submit(p, names[7]);
  const caller = records.find((r) => r.seq === 1)!;
  expect(caller).toBeDefined();
  expect(records.find((r) => r.tool === names[7] && r.role === "tool_result")).toBeDefined();
  for (const response of records.filter((r) => r.role === "tool_result")) {
    expect(caller.excerpt).toContain(`→ ${response.tool}(`);
  }
  expect(caller.excerpt.length).toBeLessThanOrEqual(400);
  if (!longNames) expect(records).toHaveLength(5);
});

test("report evidence is read from the bound session file at submission time", async () => {
  const p = provider();
  await append(p, 1, result("a", "target_tool", "Value before submission"));
  const path = sessionFiles.path("session-1");
  const lines = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  lines[1].message.output = "Value read from disk at submission";
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const records = await submit(p, "target_tool");
  expect(records[0]?.excerpt).toContain("Value read from disk at submission");
  expect(records[0]?.excerpt).not.toContain("Value before submission");
});

test("a recreated provider can report earlier persisted execution history", async () => {
  const previous = provider();
  await append(previous, 1, call("a", "target_tool", { restored: true }));
  await append(previous, 2, result("a", "target_tool", "Persisted before provider restart", true));
  const restarted = provider();
  await append(restarted, 3, { role: "assistant", content: "Preparing the report after restart" });
  const records = await submit(restarted, "target_tool");
  expect(records.map((record) => record.seq)).toEqual([1, 2]);
  expect(records[1]?.excerpt).toContain("Persisted before provider restart");
});

test("a missing bound transcript cannot silently fall back to cached or another session", async () => {
  const p = provider();
  await append(p, 1, result("a", "target_tool", "Old cached value"));
  await append(p, 1, result("b", "target_tool", "Other session value"), "session-2");
  unlinkSync(sessionFiles.path("session-1"));
  const receipt = await executeReport(p, "target_tool");
  expect(receipt.output).toContain("failed");
  expect(receipt.output).not.toContain(sessionFiles.root);
  expect(reports).toHaveLength(0);
});

test("the persisted header must match the executing session identity", async () => {
  const p = provider();
  await append(p, 1, result("a", "target_tool", "Wrong file must not be reported"));
  const path = sessionFiles.path("session-1");
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const header = JSON.parse(lines[0]!);
  header.id = "different-session";
  lines[0] = JSON.stringify(header);
  writeFileSync(path, `${lines.join("\n")}\n`);
  expect((await executeReport(p, "target_tool")).output).toContain("failed");
  expect(reports).toHaveLength(0);
});

test("incomplete later writes are outside the observed durable sequence", async () => {
  const p = provider();
  await append(p, 1, call("a", "target_tool"));
  await append(p, 2, result("a", "target_tool", "Durable error", true));
  const path = sessionFiles.path("session-1");
  writeFileSync(path, `${readFileSync(path, "utf8")}{"type":"message"`);
  const records = await submit(p, "target_tool");
  expect(records.map((record) => record.seq)).toEqual([1, 2]);
});

test("internal records are excluded without renumbering the persisted sequence", async () => {
  const p = provider();
  await append(p, 1, result("a", "target_tool", "Visible first result"));
  await p.onEntryAppended?.({
    session_id: "session-1",
    transcript_path: "/unused.jsonl",
    cwd: "/workspace",
    hook_event_name: "EntryAppended",
    user_id: "alice",
    seq: 3,
    entry: {
      type: "message",
      timestamp: "2026-10-19T09:00:00Z",
      visibility: "internal",
      message: result("internal", "target_tool", "Internal-only result"),
    },
  });
  await append(p, 4, result("b", "target_tool", "Visible last result"));
  const records = await submit(p, "target_tool");
  expect(records.map((record) => record.seq)).toEqual([1, 4]);
  expect(JSON.stringify(records)).not.toContain("Internal-only result");
});

test("a user context change during disk reading prevents report transmission", async () => {
  const p = provider();
  await append(p, 1, result("a", "target_tool", "Alice's result"));
  const tool = (await p.createTools({ cwd: "/workspace" })).find((t) => t.name === "agent_report")!;
  const pending = tool.execute(
    {
      kind: "studio_bug",
      payload: {
        title: "Synthetic report",
        task_context: "Synthetic context",
        problem: "Synthetic problem",
        report_reason: "Synthetic reason",
        suggestion: "Synthetic suggestion",
      },
    },
    { sessionId: "session-1", toolCallId: "report-1", signal: new AbortController().signal, abort() {} },
  );
  await p.onEntryAppended?.({
    session_id: "session-1",
    transcript_path: "/unused.jsonl",
    cwd: "/workspace",
    hook_event_name: "EntryAppended",
    user_id: "bob",
    seq: 2,
    entry: { type: "message", timestamp: "2026-10-19T09:00:00Z", message: result("b", "target_tool", "Bob's result") },
  });
  expect((await pending).output).toContain("conflicting");
  expect(reports).toHaveLength(0);
});

test("a binding change while authentication resolves prevents transmission", async () => {
  const p = provider();
  await append(p, 1, result("a", "target_tool", "Alice's result"));
  let current: SessionReportContext | null = {
    userId: "alice",
    projectId: "project-1",
    seq: 1,
    transcriptPath: sessionFiles.path("session-1"),
  };
  let lookups = 0;
  const tool = createAgentReportTool({
    cwd: "/workspace",
    canTransmitRecords: () => true,
    getSessionContext: () => {
      const snapshot = current;
      if (++lookups === 2)
        queueMicrotask(() => {
          current = null;
        });
      return snapshot;
    },
  });
  const receipt = await tool.execute(
    {
      kind: "studio_bug",
      payload: {
        title: "Synthetic report",
        task_context: "Synthetic context",
        problem: "Synthetic problem",
        report_reason: "Synthetic reason",
        suggestion: "Synthetic suggestion",
      },
    },
    { sessionId: "session-1", toolCallId: "report-1", signal: new AbortController().signal, abort() {} },
  );
  expect(receipt.output).toContain("conflicting");
  expect(reports).toHaveLength(0);
});

test("a changed transcript path permanently invalidates the session binding", async () => {
  const p = createRealGatewayToolProvider({
    cwd: "/workspace",
    projectId: "project-1",
    canTransmitRecords: () => true,
  });
  const input: HookInput = {
    session_id: "session-1",
    transcript_path: sessionFiles.path("session-1"),
    cwd: "/workspace",
    hook_event_name: "EntryAppended",
    user_id: "alice",
    seq: 1,
    entry: { type: "message", timestamp: "2026-10-19T09:00:00Z", message: result("a", "target_tool", "Original file") },
  };
  sessionFiles.write(input);
  const alternate = sessionFiles.path("alternate");
  writeFileSync(alternate, readFileSync(input.transcript_path));
  await p.onEntryAppended?.(input);
  await p.onEntryAppended?.({ ...input, transcript_path: alternate });
  expect((await executeReport(p)).output).toContain("conflicting");
  await p.onEntryAppended?.(input);
  expect((await executeReport(p)).output).toContain("conflicting");
  expect(reports).toHaveLength(0);
});
