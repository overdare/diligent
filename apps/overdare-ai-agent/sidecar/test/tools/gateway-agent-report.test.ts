// @summary Tests the agent failure report client, provider hook and tool.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import net from "node:net";
import type { ToolCallBlock } from "@diligent/core/message-contract";
import type { Model } from "@diligent/core/provider-contract";
import type { Tool } from "@diligent/core/tool-contract";
import { createLogger } from "@diligent/logging";
import type { AgentLoopHookFactoryContext, HookInput } from "@diligent/runtime";
import { resetHubTokenCache } from "../../src/tools/analytics";
import { createAgentReportToolProvider } from "../../src/tools/gateway/agent-report";
import {
  AGENT_REPORT_TOOL_NAME,
  buildAssessmentMessage,
  composeReportMarkdown,
  postAgentReport,
} from "../../src/tools/gateway/agent-report-client";

const realFetch = globalThis.fetch;
const realUrl = process.env.DILIGENT_GATEWAY_URL;
const realToken = process.env.DILIGENT_GATEWAY_TOKEN;
const realStudioEnv = { host: process.env.STUDIO_HOST, port: process.env.STUDIO_PORT };

interface FetchCall {
  url: string;
  method?: string;
  body: Record<string, unknown>;
  authorization?: string;
  contentType?: string;
}

function installFetchSpy(status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method,
      body: JSON.parse(String(init?.body ?? "{}")),
      authorization: headers.get("authorization") ?? undefined,
      contentType: headers.get("content-type") ?? undefined,
    });
    return new Response(
      JSON.stringify({ report_id: 1, reported_at: "2026-09-08T00:00:00Z", stored: true, notified: true }),
      {
        status,
      },
    );
  }) as unknown as typeof fetch;
  return calls;
}

/** A Studio RPC stub that answers every call with an empty result, so `readHubToken` finds none. */
function startTokenlessRpcServer(): Promise<{ stop: () => Promise<void> }> {
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      const { id } = JSON.parse(chunk.toString("utf-8")) as { id: number };
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: {} })}\n`);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Stub RPC server did not bind to a TCP port"));
        return;
      }
      process.env.STUDIO_HOST = "127.0.0.1";
      process.env.STUDIO_PORT = String(address.port);
      resolve({ stop: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

beforeEach(() => {
  process.env.DILIGENT_GATEWAY_URL = "http://127.0.0.1:8000";
  process.env.DILIGENT_GATEWAY_TOKEN = "test-token";
  // The hub-token cache is process-wide; analytics.test.ts runs first and fills it.
  resetHubTokenCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realUrl === undefined) delete process.env.DILIGENT_GATEWAY_URL;
  else process.env.DILIGENT_GATEWAY_URL = realUrl;
  if (realToken === undefined) delete process.env.DILIGENT_GATEWAY_TOKEN;
  else process.env.DILIGENT_GATEWAY_TOKEN = realToken;
  if (realStudioEnv.host === undefined) delete process.env.STUDIO_HOST;
  else process.env.STUDIO_HOST = realStudioEnv.host;
  if (realStudioEnv.port === undefined) delete process.env.STUDIO_PORT;
  else process.env.STUDIO_PORT = realStudioEnv.port;
});

const SIGNAL = {
  kind: "repeated_error" as const,
  tool: "instance_upsert",
  count: 4,
  fingerprint: "repeated_error:instance_upsert",
};

describe("composeReportMarkdown", () => {
  test("renders the header from hook-owned facts and the body from the model", () => {
    const md = composeReportMarkdown({
      title: "Thickness passed as a string",
      signal: SIGNAL,
      cause: "ambiguous_prompt",
      sessionId: "sess-1",
      seq: 168,
      release: "1.4.2",
      summary: 'Tried "2px" four times.',
    });
    expect(md).toBe(
      [
        "## Thickness passed as a string",
        "kind: repeated_error · tool: instance_upsert · count: 4 · cause: ambiguous_prompt",
        "session: sess-1 · seq: 168 · release: 1.4.2",
        "",
        'Tried "2px" four times.',
      ].join("\n"),
    );
  });

  test("omits absent tool/seq/release", () => {
    const md = composeReportMarkdown({
      title: "t",
      signal: { kind: "aborted", count: 1, fingerprint: "aborted" },
      cause: "model_error",
      sessionId: "sess-1",
      summary: "s",
    });
    expect(md).toContain("kind: aborted · tool: - · count: 1 · cause: model_error");
    expect(md).toContain("session: sess-1 · seq: - · release: -");
  });
});

describe("buildAssessmentMessage", () => {
  test("is a system-reminder naming the signal and the tool", () => {
    const text = buildAssessmentMessage(SIGNAL);
    expect(text.startsWith("<system-reminder>")).toBe(true);
    expect(text.endsWith("</system-reminder>")).toBe(true);
    expect(text).toContain("kind=repeated_error");
    expect(text).toContain("tool=instance_upsert");
    expect(text).toContain("count=4");
    expect(text).toContain(AGENT_REPORT_TOOL_NAME);
    expect(text).toContain("do not quote the user");
  });

  test("aborted uses the interrupted-turn wording", () => {
    expect(buildAssessmentMessage({ kind: "aborted", count: 1, fingerprint: "aborted" })).toContain("did not complete");
  });
});

describe("postAgentReport", () => {
  const wire = {
    client_report_id: "11111111-1111-1111-1111-111111111111",
    session_id: "sess-1",
    project_id: "proj-1",
    seq: 168,
    event_ts: "2026-09-08T00:00:00.000Z",
    kind: "repeated_error" as const,
    tool: "instance_upsert",
    cause: "ambiguous_prompt" as const,
    title: "t",
    summary_md: "s",
    evidence: { count: 4 },
    release: "1.4.2",
  };

  test("POSTs the wire body with the bearer token", async () => {
    const calls = installFetchSpy();
    await postAgentReport(wire);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:8000/v1/agent-reports");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].contentType).toBe("application/json");
    expect(calls[0].authorization).toBe("Bearer test-token");
    expect(calls[0].body).toEqual(wire);
  });

  test("masks secrets in the title and the summary before transmit", async () => {
    const secret = "sk-ant-api03-0123456789abcdefghijklmnopqrstuvwxyz";
    const calls = installFetchSpy();
    await postAgentReport({ ...wire, title: `leaked ${secret}`, summary_md: `also ${secret} here` });
    expect(calls[0].body.title).toBe("leaked [REDACTED:anthropic-key]");
    expect(calls[0].body.summary_md).toBe("also [REDACTED:anthropic-key] here");
  });

  test("throws on a non-2xx response", async () => {
    installFetchSpy(503);
    await expect(postAgentReport(wire)).rejects.toThrow("503");
  });

  test("throws when no token is available", async () => {
    delete process.env.DILIGENT_GATEWAY_TOKEN;
    // Without the env override `resolveToken()` falls back to Studio RPC. Point it at a stub that
    // answers with no token: a refused connection would instead sit on the RPC's own 5s timeout.
    const rpc = await startTokenlessRpcServer();
    const calls = installFetchSpy();
    try {
      await expect(postAgentReport(wire)).rejects.toThrow("token");
      expect(calls).toHaveLength(0);
    } finally {
      await rpc.stop();
    }
  });
});

function hookContext(overrides: Partial<AgentLoopHookFactoryContext> = {}): AgentLoopHookFactoryContext {
  return {
    cwd: "/tmp/project",
    agentKind: "main",
    model: {} as Model,
    tools: [{ name: AGENT_REPORT_TOOL_NAME } as Tool],
    logger: createLogger({ scope: "test" }),
    ...overrides,
  };
}

function entryInput(toolCallId: string, overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: "sess-1",
    transcript_path: "/tmp/sess-1.jsonl",
    cwd: "/tmp/project",
    hook_event_name: "EntryAppended",
    user_id: "alice",
    seq: 168,
    entry: {
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2026-09-08T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_call", id: toolCallId, name: AGENT_REPORT_TOOL_NAME, input: {} }],
        stopReason: "tool_use",
      },
    },
    ...overrides,
  };
}

const rollbackCall: ToolCallBlock = { type: "tool_call", id: "tc-rb", name: "studiorpc_rollback", input: {} };
const rollbackResult = {
  role: "tool_result" as const,
  toolCallId: "tc-rb",
  toolName: "studiorpc_rollback",
  output: "",
  isError: false,
  timestamp: 0,
};

async function toolOf(provider: ReturnType<typeof createAgentReportToolProvider>): Promise<Tool> {
  const tools = await provider.createTools({ cwd: "/tmp/project" });
  const tool = tools.find((t) => t.name === AGENT_REPORT_TOOL_NAME);
  if (!tool) throw new Error("tool missing");
  return tool;
}

const toolCtx = (toolCallId: string) => ({ toolCallId, signal: new AbortController().signal, abort: () => {} });

describe("createAgentReportToolProvider — hook gating", () => {
  test("no hook when the tool is experiment-disabled (absent from context.tools)", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    expect(provider.createAgentLoopHooks?.(hookContext({ tools: [] }))).toEqual([]);
  });

  test("no hook for child agents", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    expect(provider.createAgentLoopHooks?.(hookContext({ agentKind: "child" }))).toEqual([]);
  });

  test("hook id is agent-report", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    expect(provider.createAgentLoopHooks?.(hookContext())?.[0]?.id).toBe("agent-report");
  });
});

describe("createAgentReportToolProvider — injection", () => {
  test("beforeTurn injects once per armed signal", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    expect(hook.beforeTurn?.({ messages: [], turnId: "t1", compactedThisTurn: false })).toBeUndefined();

    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    const injections = hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    expect(injections).toHaveLength(1);
    expect(injections?.[0].source).toBe("agent-report");
    expect(String(injections?.[0].content)).toContain("kind=rollback");

    expect(hook.beforeTurn?.({ messages: [], turnId: "t3", compactedThisTurn: false })).toBeUndefined();
  });

  test("restore clears armed state and per-session dedup", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.restore?.({ messages: [] });
    // armed signal dropped …
    expect(hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false })).toBeUndefined();
    // … and the fingerprint can fire again in the restored session
    hook.onToolResult?.({ turnId: "t2", toolCall: rollbackCall, result: rollbackResult });
    expect(hook.beforeTurn?.({ messages: [], turnId: "t3", compactedThisTurn: false })).toHaveLength(1);
  });
});

describe("createAgentReportToolProvider — tool", () => {
  test("does nothing when no signal is under assessment", async () => {
    const calls = installFetchSpy();
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const tool = await toolOf(provider);
    const out = await tool.execute({ cause: "model_error", title: "t", summary: "s" }, toolCtx("tc-1"));
    expect(out.output).toContain("nothing reported");
    expect(calls).toHaveLength(0);
  });

  test("sends nothing without consent", async () => {
    const calls = installFetchSpy();
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => false });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    const tool = await toolOf(provider);
    const out = await tool.execute({ cause: "model_error", title: "t", summary: "s" }, toolCtx("tc-1"));
    expect(out.output).toContain("disabled");
    expect(calls).toHaveLength(0);
  });

  test("files the report bound to the session that appended its tool call", async () => {
    const calls = installFetchSpy();
    const provider = createAgentReportToolProvider({
      cwd: "/tmp/project",
      projectId: "proj-1",
      canTransmitRecords: () => true,
    });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    await provider.onEntryAppended?.(entryInput("tc-report"));

    const tool = await toolOf(provider);
    const out = await tool.execute(
      { cause: "user_error", title: "Rolled back a correct change", summary: "key sk-ant-0123456789012345678901" },
      toolCtx("tc-report"),
    );
    expect(out.output).toContain("filed");
    expect(calls).toHaveLength(1);
    const body = calls[0].body;
    expect(calls[0].url).toBe("http://127.0.0.1:8000/v1/agent-reports");
    expect(body.session_id).toBe("sess-1");
    expect(body.seq).toBe(168);
    expect(body.project_id).toBe("proj-1");
    expect(body.kind).toBe("rollback");
    expect(body.tool).toBe("studiorpc_rollback");
    expect(body.cause).toBe("user_error");
    expect(body.evidence).toEqual({ count: 1 });
    expect(String(body.summary_md)).toContain("## Rolled back a correct change");
    expect(String(body.summary_md)).toContain("[REDACTED:anthropic-key]");
    expect(typeof body.client_report_id).toBe("string");

    // the signal is consumed: a second call reports nothing
    const again = await tool.execute({ cause: "user_error", title: "t", summary: "s" }, toolCtx("tc-report"));
    expect(again.output).toContain("nothing reported");
    expect(calls).toHaveLength(1);
  });

  test("falls back to the latest appended session when the tool call id is unknown", async () => {
    const calls = installFetchSpy();
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    await provider.onEntryAppended?.(entryInput("other", { session_id: "sess-9", seq: 3 }));
    const tool = await toolOf(provider);
    await tool.execute({ cause: "model_error", title: "t", summary: "s" }, toolCtx("unknown"));
    expect(calls[0].body.session_id).toBe("sess-9");
    // no explicit project id → synthetic `<user>_<cwd>` id, separators replaced
    expect(calls[0].body.project_id).toBe("alice__tmp_project");
  });

  test("gateway failure is reported in the output, never thrown", async () => {
    installFetchSpy(503);
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    await provider.onEntryAppended?.(entryInput("tc-report"));
    const tool = await toolOf(provider);
    const out = await tool.execute({ cause: "model_error", title: "t", summary: "s" }, toolCtx("tc-report"));
    expect(out.output).toContain("could not be delivered");
  });
});
