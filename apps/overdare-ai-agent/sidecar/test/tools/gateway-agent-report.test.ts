// @summary Verifies skill report transmission, identity isolation, and truthful receipts.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { HookInput } from "@diligent/runtime";
import { createGatewayToolProvider as createRealGatewayToolProvider } from "../../src/tools/gateway";
import type { AgentReportWire } from "../../src/tools/gateway/agent-report-client";
import { ReportSessionFiles } from "../helpers/report-session";

const previousFetch = globalThis.fetch;
const previousUrl = process.env.DILIGENT_GATEWAY_URL;
const previousToken = process.env.DILIGENT_GATEWAY_TOKEN;
const receipt = { report_id: 12, reported_at: "2026-10-14T01:00:01Z", stored: true, notified: false, reason: null };
const content = {
  kind: "studio_bug",
  payload: {
    title: "Property did not change",
    task_context: "Updating a frame",
    problem: "Success but unchanged read-back",
    report_reason: "Contract mismatch",
    suggestion: "Verify the applied value",
    cause: null,
    evidence: { tool: "instance_upsert", details: "Read-back confirmed unchanged" },
  },
};

interface Call {
  url: string;
  body: AgentReportWire;
  init?: RequestInit;
}
let calls: Call[] = [];
let reportResponse: unknown = receipt;
let sessionFiles: ReportSessionFiles;

function createGatewayToolProvider(options: Parameters<typeof createRealGatewayToolProvider>[0]) {
  return sessionFiles.track(createRealGatewayToolProvider(options));
}

beforeEach(() => {
  sessionFiles = new ReportSessionFiles();
  process.env.DILIGENT_GATEWAY_URL = "https://gateway.example";
  process.env.DILIGENT_GATEWAY_TOKEN = "synthetic-token";
  calls = [];
  reportResponse = receipt;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body)), init });
    return Response.json(url.endsWith("/agent-reports") ? reportResponse : { accepted: 1 });
  }) as typeof fetch;
});
afterEach(() => {
  sessionFiles.cleanup();
  globalThis.fetch = previousFetch;
  if (previousUrl === undefined) delete process.env.DILIGENT_GATEWAY_URL;
  else process.env.DILIGENT_GATEWAY_URL = previousUrl;
  if (previousToken === undefined) delete process.env.DILIGENT_GATEWAY_TOKEN;
  else process.env.DILIGENT_GATEWAY_TOKEN = previousToken;
});

function input(sessionId: string, seq: number, userId = "alice", output = "read-back"): HookInput {
  return {
    session_id: sessionId,
    transcript_path: "/unused.jsonl",
    cwd: "/workspace",
    hook_event_name: "EntryAppended",
    user_id: userId,
    seq,
    entry: {
      type: "message",
      timestamp: "2026-10-14T01:00:00Z",
      message: { role: "tool_result", toolName: "instance_read", output },
    },
  };
}
function context(sessionId = "session-1", toolCallId = "call-1", signal = new AbortController().signal) {
  return { sessionId, toolCallId, signal, abort: () => {} };
}
async function reporter(
  provider = createGatewayToolProvider({
    cwd: "/workspace",
    projectId: "project-1",
    canTransmitRecords: () => true,
  }),
) {
  const tools = await provider.createTools({ cwd: "/workspace" });
  const tool = tools.find((item) => item.name === "agent_report");
  expect(tool).toBeDefined();
  if (!tool) throw new Error("agent_report tool missing");
  return tool;
}
function reportCalls() {
  return calls.filter((call) => call.url.endsWith("/agent-reports"));
}

test.each([
  undefined,
  "",
  "   ",
])("does not bind a missing startup identity (%j) to a report session", async (userId) => {
  const provider = createGatewayToolProvider({ cwd: "/workspace", canTransmitRecords: () => true });
  await provider.onEntryAppended?.({ ...input("session-1", 1), user_id: userId });
  await provider.onEntryAppended?.(input("session-1", 2));
  const result = await (await reporter(provider)).execute(content, context());

  expect(result.output).toContain("saved");
  expect(reportCalls()[0]?.body.project_id).toBe("alice__workspace");
  expect(reportCalls()[0]?.body.seq).toBe(2);
  expect(calls.filter((call) => call.url.endsWith("/records"))).toHaveLength(1);
});

test("a missing identity between turns does not poison confirmed report context", async () => {
  const provider = createGatewayToolProvider({ cwd: "/workspace", canTransmitRecords: () => true });
  await provider.onEntryAppended?.(input("session-1", 1));
  await provider.onEntryAppended?.({ ...input("session-1", 2, "alice", "Unattributed excerpt"), user_id: undefined });
  await provider.onEntryAppended?.(input("session-1", 3));
  const result = await (await reporter(provider)).execute(content, context());

  expect(result.output).toContain("saved");
  // On-demand evidence comes from the confirmed session file, including its background entries.
  // Missing hook identity still prevents that append from binding or transmitting a telemetry record.
  expect(reportCalls()[0]?.body.payload.evidence.recent_records.map((record) => record.seq)).toEqual([1, 2, 3]);
  expect(calls.filter((call) => call.url.endsWith("/records"))).toHaveLength(2);
});

test("keeps reports blocked after two confirmed owners use the same session", async () => {
  const provider = createGatewayToolProvider({ cwd: "/workspace", canTransmitRecords: () => true });
  const tool = await reporter(provider);
  await provider.onEntryAppended?.(input("session-1", 1, "alice"));
  await provider.onEntryAppended?.(input("session-1", 2, "bob"));
  expect((await tool.execute(content, context())).output).toContain("conflicting");
  await provider.onEntryAppended?.(input("session-1", 3, "alice"));
  expect((await tool.execute(content, context())).output).toContain("conflicting");
  expect(reportCalls()).toHaveLength(0);
});

test("posts through existing gateway auth and derives execution metadata", async () => {
  const provider = createGatewayToolProvider({
    cwd: "/workspace",
    projectId: "project-1",
    canTransmitRecords: () => true,
  });
  await provider.onEntryAppended?.(input("session-1", 7));
  const result = await (await reporter(provider)).execute(content, context());
  const request = reportCalls()[0];
  expect(request?.url).toBe("https://gateway.example/v1/agent-reports");
  expect(new Headers(request?.init?.headers).get("Authorization")).toBe("Bearer synthetic-token");
  expect(request?.body.session_id).toBe("session-1");
  expect(request?.body.project_id).toBe("project-1");
  expect(request?.body.seq).toBe(7);
  expect(request?.body.payload.cwd).toBe("/workspace");
  expect(request?.body.payload.evidence.recent_records[0]?.seq).toBe(7);
  expect(request?.body).not.toHaveProperty("user_id");
  expect(result.output).toContain("saved");
  expect(result.output).not.toContain("Slack delivered");
});

test("isolates two interleaved session project fallbacks and evidence", async () => {
  const provider = createGatewayToolProvider({ cwd: "/workspace", canTransmitRecords: () => true });
  await provider.onEntryAppended?.(input("session-a", 7, "alice", "Alice evidence"));
  await provider.onEntryAppended?.(input("session-b", 8, "bob", "Bob evidence"));
  const tool = await reporter(provider);
  await tool.execute(content, context("session-a", "call-a"));
  await tool.execute(content, context("session-b", "call-b"));
  const [a, b] = reportCalls();
  expect(a?.body.project_id).toBe("alice__workspace");
  expect(b?.body.project_id).toBe("bob__workspace");
  expect(a?.body.payload.evidence.recent_records[0]?.excerpt).toBe("[결과] Alice evidence");
  expect(b?.body.payload.evidence.recent_records[0]?.excerpt).toBe("[결과] Bob evidence");
  expect(a?.body.session_id).toBe("session-a");
  expect(b?.body.session_id).toBe("session-b");
});

test("does not guess a missing session or an unavailable project fallback", async () => {
  const tool = await reporter(createGatewayToolProvider({ cwd: "/workspace", canTransmitRecords: () => true }));
  const absent = await tool.execute(content, { ...context(), sessionId: undefined });
  const missingProject = await tool.execute(content, context());
  expect(reportCalls()).toHaveLength(0);
  expect(absent.output).toContain("session");
  expect(missingProject.output).toContain("context");
});

test("can report on a first turn with an explicit project and empty evidence", async () => {
  await (await reporter()).execute(content, context());
  expect(reportCalls()[0]?.body.payload.evidence.recent_records).toEqual([]);
  expect(reportCalls()[0]?.body).not.toHaveProperty("seq");
});

test("uses stable delivery ids and changes them across sessions", async () => {
  const tool = await reporter();
  await tool.execute(content, context());
  await tool.execute(content, context());
  await tool.execute(content, context("session-2"));
  const reports = reportCalls();
  expect(reports[0]?.body.client_report_id).toBe(reports[1]?.body.client_report_id);
  expect(reports[0]?.body.client_report_id).not.toBe(reports[2]?.body.client_report_id);
});

test("masks report prose and recent evidence before clipping", async () => {
  const provider = createGatewayToolProvider({
    cwd: "/workspace",
    projectId: "project-1",
    canTransmitRecords: () => true,
  });
  const secret = "sk-ant-0123456789012345678901";
  await provider.onEntryAppended?.(input("session-1", 3, "alice", "x".repeat(390) + secret));
  await (await reporter(provider)).execute(
    {
      ...content,
      payload: { ...content.payload, title: "Secret " + secret },
    },
    context(),
  );
  expect(JSON.stringify(reportCalls()[0]?.body)).not.toContain(secret);
  expect(reportCalls()[0]?.body.payload.title).toContain("[REDACTED:anthropic-key]");
  expect(reportCalls()[0]?.body.payload.evidence.recent_records[0]?.excerpt.length).toBeLessThanOrEqual(400);
});

test("sorts the bounded supporting tail by sequence rather than arrival order", async () => {
  const provider = createGatewayToolProvider({
    cwd: "/workspace",
    projectId: "project-1",
    canTransmitRecords: () => true,
  });
  for (const seq of [8, 3, 7, 2, 6, 5, 4]) await provider.onEntryAppended?.(input("session-1", seq));
  await (await reporter(provider)).execute(content, context());
  const body = reportCalls()[0]?.body;
  expect(body?.seq).toBe(8);
  expect(body?.payload.evidence.recent_records.map((record) => record.seq)).toEqual([4, 5, 6, 7, 8]);
});

test("does not include full user prompts or reporter outputs in supporting evidence", async () => {
  const provider = createGatewayToolProvider({
    cwd: "/workspace",
    projectId: "project-1",
    canTransmitRecords: () => true,
  });
  await provider.onEntryAppended?.({
    ...input("session-1", 1),
    entry: {
      type: "message",
      timestamp: "2026-10-14T01:00:00Z",
      message: { role: "user", content: "Private complete user prompt" },
    },
  });
  await provider.onEntryAppended?.({
    ...input("session-1", 2),
    entry: {
      type: "message",
      timestamp: "2026-10-14T01:00:00Z",
      message: { role: "tool_result", toolName: "agent_report", output: "Old report output" },
    },
  });
  await (await reporter(provider)).execute(content, context());
  const evidence = JSON.stringify(reportCalls()[0]?.body.payload.evidence);
  expect(evidence).not.toContain("Private complete user prompt");
  expect(evidence).not.toContain("Old report output");
});

test("skips transmission when consent is absent or withdrawn during auth", async () => {
  for (const check of [
    () => false,
    (() => {
      let checks = 0;
      return () => ++checks === 1;
    })(),
  ]) {
    const tool = await reporter(
      createGatewayToolProvider({
        cwd: "/workspace",
        projectId: "project-1",
        canTransmitRecords: check,
      }),
    );
    const result = await tool.execute(content, context());
    expect(result.output).toContain("consent");
  }
  expect(reportCalls()).toHaveLength(0);
});

test.each(["no_consent", "duplicate"])("does not claim a new save for %s", async (reason) => {
  reportResponse = { ...receipt, report_id: null, stored: false, reason };
  const result = await (await reporter()).execute(content, context());
  expect(result.output).not.toContain("Report saved");
  expect(result.output).toContain(reason === "duplicate" ? "duplicate" : "consent");
});

test.each([
  { ...receipt, report_id: null },
  { ...receipt, stored: false, notified: true },
  { unexpected: "response" },
])("rejects contradictory or malformed receipts", async (response) => {
  reportResponse = response;
  const result = await (await reporter()).execute(content, context());
  expect(result.output).not.toContain("Report saved");
  expect(result.output).toContain("failed");
});

test("cancellation prevents transmission without aborting the original task", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await (await reporter()).execute(content, context("session-1", "call-1", controller.signal));
  expect(reportCalls()).toHaveLength(0);
  expect(result.abortRequested).not.toBe(true);
  expect(result.output).toContain("canceled");
});

test.each([401, 413, 422, 429, 503])("reports HTTP %i failure without leaking secrets", async (status) => {
  globalThis.fetch = (async () => new Response("token=synthetic-secret", { status })) as typeof fetch;
  const result = await (await reporter()).execute(content, context());
  expect(result.output).toContain(String(status));
  expect(result.output).not.toContain("synthetic-secret");
  expect(result.abortRequested).not.toBe(true);
});

test("input schema rejects model-supplied execution identity", async () => {
  const tool = await reporter();
  expect(tool.parameters.safeParse({ ...content, session_id: "other" }).success).toBe(false);
  expect(
    tool.parameters.safeParse({
      ...content,
      payload: { ...content.payload, cwd: "/another-project" },
    }).success,
  ).toBe(false);
});
