// @summary Tests for agent mode filtering and tool allowlisting
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agentLoop } from "../src/agent/loop";
import type { AgentLoopConfig } from "../src/agent/types";
import { MODE_SYSTEM_PROMPT_SUFFIXES, PLAN_MODE_ALLOWED_TOOLS } from "../src/agent/types";
import { EventStream } from "../src/event-stream";
import type { Model, ProviderEvent, ProviderResult, StreamContext, StreamFunction } from "../src/provider/types";
import type { Tool } from "../src/tool/types";
import type { AssistantMessage } from "../src/types";

const TEST_MODEL: Model = {
  id: "test-model",
  provider: "test",
  contextWindow: 100_000,
  maxOutputTokens: 4096,
};

function makeAssistant(text = "done"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    model: TEST_MODEL.id,
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: z.object({}),
    execute: async () => ({ output: "ok" }),
  };
}

function makeCaptureStreamFn(): { fn: StreamFunction; capturedContexts: StreamContext[] } {
  const capturedContexts: StreamContext[] = [];
  const fn: StreamFunction = (_model, context, _opts) => {
    capturedContexts.push(context);
    const msg = makeAssistant();
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (e) => e.type === "done" || e.type === "error",
      (e) => {
        if (e.type === "done") return { message: e.message };
        throw (e as { type: "error"; error: Error }).error;
      },
    );
    queueMicrotask(() => {
      stream.push({ type: "start" });
      stream.push({ type: "done", stopReason: "end_turn", message: msg });
    });
    return stream;
  };
  return { fn, capturedContexts };
}

const ALL_TOOLS = ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "ls", "add_knowledge"].map(makeTool);

describe("PLAN_MODE_ALLOWED_TOOLS", () => {
  test("contains only read-only tools", () => {
    expect(PLAN_MODE_ALLOWED_TOOLS.has("read_file")).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("glob")).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("grep")).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("ls")).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("bash")).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("write_file")).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("edit_file")).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("add_knowledge")).toBe(false);
  });
});

describe("agentLoop mode filtering", () => {
  test("default mode: all tools passed to stream function", async () => {
    const { fn, capturedContexts } = makeCaptureStreamFn();
    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: ALL_TOOLS,
      streamFunction: fn,
      mode: "default",
    };
    const stream = agentLoop([], config);
    for await (const _ of stream) {
    }
    await stream.result();

    expect(capturedContexts).toHaveLength(1);
    const toolNames = capturedContexts[0].tools.map((t) => t.name);
    expect(toolNames).toContain("bash");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("edit_file");
    expect(toolNames).toContain("add_knowledge");
  });

  test("plan mode: only read-only tools passed to stream function", async () => {
    const { fn, capturedContexts } = makeCaptureStreamFn();
    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: ALL_TOOLS,
      streamFunction: fn,
      mode: "plan",
    };
    const stream = agentLoop([], config);
    for await (const _ of stream) {
    }
    await stream.result();

    expect(capturedContexts).toHaveLength(1);
    const toolNames = capturedContexts[0].tools.map((t) => t.name);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("glob");
    expect(toolNames).toContain("grep");
    expect(toolNames).toContain("ls");
    expect(toolNames).not.toContain("bash");
    expect(toolNames).not.toContain("write_file");
    expect(toolNames).not.toContain("edit_file");
    expect(toolNames).not.toContain("add_knowledge");
  });

  test("execute mode: all tools passed to stream function", async () => {
    const { fn, capturedContexts } = makeCaptureStreamFn();
    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: ALL_TOOLS,
      streamFunction: fn,
      mode: "execute",
    };
    const stream = agentLoop([], config);
    for await (const _ of stream) {
    }
    await stream.result();

    expect(capturedContexts).toHaveLength(1);
    const toolNames = capturedContexts[0].tools.map((t) => t.name);
    expect(toolNames).toContain("bash");
    expect(toolNames).toContain("write_file");
  });

  test("mode undefined defaults to default behavior", async () => {
    const { fn, capturedContexts } = makeCaptureStreamFn();
    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: ALL_TOOLS,
      streamFunction: fn,
      // mode not set
    };
    const stream = agentLoop([], config);
    for await (const _ of stream) {
    }
    await stream.result();

    expect(capturedContexts).toHaveLength(1);
    const toolNames = capturedContexts[0].tools.map((t) => t.name);
    expect(toolNames).toContain("bash");
  });
});

describe("agentLoop mode prompt injection", () => {
  test("default mode: systemPrompt unchanged", async () => {
    const { fn, capturedContexts } = makeCaptureStreamFn();
    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "my system prompt" }],
      tools: [],
      streamFunction: fn,
      mode: "default",
    };
    const stream = agentLoop([], config);
    for await (const _ of stream) {
    }
    await stream.result();

    const sections = capturedContexts[0].systemPrompt;
    expect(sections).toHaveLength(1);
    expect(sections[0].content).toBe("my system prompt");
  });

  test("plan mode: systemPrompt has collaboration_mode section appended", async () => {
    const { fn, capturedContexts } = makeCaptureStreamFn();
    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "my system prompt" }],
      tools: [],
      streamFunction: fn,
      mode: "plan",
    };
    const stream = agentLoop([], config);
    for await (const _ of stream) {
    }
    await stream.result();

    const sections = capturedContexts[0].systemPrompt;
    expect(sections[0].content).toBe("my system prompt");
    const modeSection = sections.find((s) => s.tag === "collaboration_mode");
    expect(modeSection).toBeDefined();
    expect(modeSection!.content).toBe(MODE_SYSTEM_PROMPT_SUFFIXES.plan);
  });

  test("execute mode: systemPrompt has collaboration_mode section appended", async () => {
    const { fn, capturedContexts } = makeCaptureStreamFn();
    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "my system prompt" }],
      tools: [],
      streamFunction: fn,
      mode: "execute",
    };
    const stream = agentLoop([], config);
    for await (const _ of stream) {
    }
    await stream.result();

    const sections = capturedContexts[0].systemPrompt;
    expect(sections[0].content).toBe("my system prompt");
    const modeSection = sections.find((s) => s.tag === "collaboration_mode");
    expect(modeSection).toBeDefined();
    expect(modeSection!.content).toBe(MODE_SYSTEM_PROMPT_SUFFIXES.execute);
  });
});
