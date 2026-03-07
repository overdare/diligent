// @summary Tests for core agent loop execution and tool calling
import { describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import { agentLoop } from "../src/agent/loop";
import type { AgentEvent, AgentLoopConfig } from "../src/agent/types";
import { EventStream } from "../src/event-stream";
import type {
  Model,
  ProviderEvent,
  ProviderResult,
  StreamContext,
  StreamFunction,
  StreamOptions,
} from "../src/provider/types";
import type { Tool } from "../src/tool/types";
import type { AssistantMessage, Message } from "../src/types";

const TEST_MODEL: Model = {
  id: "test-model",
  provider: "test",
  contextWindow: 100_000,
  maxOutputTokens: 4096,
};

function makeAssistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "end_turn",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    model: TEST_MODEL.id,
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason,
    timestamp: Date.now(),
  };
}

function createMockStreamFunction(
  responses: AssistantMessage[],
): StreamFunction & { contexts: StreamContext[]; options: StreamOptions[] } {
  let callIndex = 0;
  const contexts: StreamContext[] = [];
  const options: StreamOptions[] = [];

  const fn: StreamFunction = (_model, context, streamOptions) => {
    contexts.push(context);
    options.push(streamOptions);
    const msg = responses[callIndex++];
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );

    // Simulate async streaming
    setTimeout(() => {
      stream.push({ type: "start" });
      for (const block of msg.content) {
        if (block.type === "text") {
          stream.push({ type: "text_delta", delta: block.text });
          stream.push({ type: "text_end", text: block.text });
        } else if (block.type === "tool_call") {
          stream.push({ type: "tool_call_start", id: block.id, name: block.name });
          stream.push({
            type: "tool_call_end",
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
      stream.push({ type: "done", stopReason: msg.stopReason, message: msg });
    }, 0);

    return stream;
  };

  return Object.assign(fn, { contexts, options });
}

const echoTool: Tool = {
  name: "echo",
  description: "Echo a message",
  parameters: z.object({ message: z.string() }),
  async execute(args: { message: string }) {
    return { output: args.message };
  },
};

/** A read-only tool that supports parallel execution and records timing */
function createParallelTool(name: string, delayMs = 50): Tool & { calls: number[] } {
  const calls: number[] = [];
  return {
    name,
    description: `Parallel tool ${name}`,
    parameters: z.object({ query: z.string() }),
    supportParallel: true,
    async execute(args: { query: string }) {
      const start = Date.now();
      calls.push(start);
      await new Promise((r) => setTimeout(r, delayMs));
      return { output: `${name}:${args.query}` };
    },
    calls,
  };
}

/** A sequential tool (no supportParallel flag) */
const sequentialTool: Tool = {
  name: "seq_tool",
  description: "Sequential tool",
  parameters: z.object({ data: z.string() }),
  async execute(args: { data: string }) {
    return { output: `seq:${args.data}` };
  },
};

describe("agentLoop", () => {
  test("text-only response: single turn", async () => {
    const msg = makeAssistant([{ type: "text", text: "Hello!" }]);
    const streamFn = createMockStreamFunction([msg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [],
      streamFunction: streamFn,
    };

    const messages: Message[] = [{ role: "user", content: "hi", timestamp: Date.now() }];

    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("turn_start");
    expect(types).toContain("message_start");
    expect(types).toContain("message_end");
    expect(types).toContain("turn_end");
    expect(types).toContain("agent_end");

    const result = await loop.result();
    expect(result.length).toBeGreaterThan(1); // user + assistant
  });

  test("tool call: two turns (LLM → tool → LLM → response)", async () => {
    const toolCallMsg = makeAssistant(
      [{ type: "tool_call", id: "tc_1", name: "echo", input: { message: "hello" } }],
      "tool_use",
    );
    const responseMsg = makeAssistant([{ type: "text", text: "The echo returned: hello" }]);
    const streamFn = createMockStreamFunction([toolCallMsg, responseMsg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [echoTool],
      streamFunction: streamFn,
    };

    const messages: Message[] = [{ role: "user", content: "echo hello", timestamp: Date.now() }];

    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("tool_start");
    expect(types).toContain("tool_end");

    // Should have two turn_start events
    expect(types.filter((t) => t === "turn_start")).toHaveLength(2);

    const toolEnd = events.find((e) => e.type === "tool_end") as Extract<AgentEvent, { type: "tool_end" }>;
    expect(toolEnd.toolName).toBe("echo");
    expect(toolEnd.output).toBe("hello");

    // Verify StreamContext received correct tool definitions
    expect(streamFn.contexts.length).toBeGreaterThanOrEqual(1);
    const tools = streamFn.contexts[0].tools;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("echo");
    expect(tools[0].description).toBe("Echo a message");
    expect(tools[0].inputSchema).toHaveProperty("properties");
    expect((tools[0].inputSchema as Record<string, unknown>).properties).toHaveProperty("message");
  });

  test("passes maxTokens derived from reservePercent and model limits", async () => {
    const msg = makeAssistant([{ type: "text", text: "Hello!" }]);
    const streamFn = createMockStreamFunction([msg]);

    const config: AgentLoopConfig = {
      model: { ...TEST_MODEL, contextWindow: 100_000, maxOutputTokens: 5_000 },
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [],
      streamFunction: streamFn,
      reservePercent: 16,
      maxTurns: 1,
    };

    const loop = agentLoop([{ role: "user", content: "hi", timestamp: Date.now() }], config);
    for await (const _event of loop) {
    }

    expect(streamFn.options).toHaveLength(1);
    expect(streamFn.options[0].maxTokens).toBe(5_000);
  });

  test("caps maxTokens to buffered context when model output limit is higher", async () => {
    const msg = makeAssistant([{ type: "text", text: "Hello!" }]);
    const streamFn = createMockStreamFunction([msg]);

    const config: AgentLoopConfig = {
      model: { ...TEST_MODEL, contextWindow: 100_000, maxOutputTokens: 40_000 },
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [],
      streamFunction: streamFn,
      reservePercent: 16,
      maxTurns: 1,
    };

    const loop = agentLoop([{ role: "user", content: "hi", timestamp: Date.now() }], config);
    for await (const _event of loop) {
    }

    expect(streamFn.options).toHaveLength(1);
    expect(streamFn.options[0].maxTokens).toBe(16_000);
  });

  test("maxTurns safety: loop exits after max turns", async () => {
    // Create an infinite tool call loop
    const toolCallMsg = makeAssistant(
      [{ type: "tool_call", id: "tc_1", name: "echo", input: { message: "loop" } }],
      "tool_use",
    );
    const streamFn = createMockStreamFunction([toolCallMsg, toolCallMsg, toolCallMsg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [echoTool],
      streamFunction: streamFn,
      maxTurns: 2,
    };

    const messages: Message[] = [{ role: "user", content: "loop", timestamp: Date.now() }];

    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    // Should have exactly 2 turn_starts
    const turnStarts = events.filter((e) => e.type === "turn_start");
    expect(turnStarts).toHaveLength(2);
  });

  test("logs request and response summaries with debug identifiers", async () => {
    const originalLog = console.log;
    const logSpy = mock(() => {});
    console.log = logSpy as typeof console.log;

    try {
      const msg = makeAssistant([
        { type: "text", text: "Hello!" },
        { type: "tool_call", id: "tc_1", name: "edit", input: { file_path: "a.ts" } },
      ]);
      const streamFn = createMockStreamFunction([msg]);
      const config: AgentLoopConfig = {
        model: TEST_MODEL,
        systemPrompt: [{ label: "test", content: "test" }],
        tools: [],
        streamFunction: streamFn,
        maxTurns: 1,
        effort: "max",
        debugThreadId: "thread-123",
        debugTurnId: "turn-abc",
      };

      const messages: Message[] = [{ role: "user", content: "hi", timestamp: Date.now() }];
      const loop = agentLoop(messages, config);
      for await (const _event of loop) {
      }

      expect(logSpy).toHaveBeenCalled();
      const requestCall = logSpy.mock.calls.find(
        (args) => args[0] === "[AgentLoop]%s Sending %d messages to %s, last 5: %s",
      );
      expect(requestCall).toBeDefined();
      expect(requestCall?.[1]).toBe(" thread=thread-123 turn=turn-abc effort=max");

      const responseCall = logSpy.mock.calls.find(
        (args) =>
          args[0] === "[AgentLoop]%s Response summary: stop=%s elapsed=%dms text=%d thinking=%d toolCalls=%d tools=%s",
      );
      expect(responseCall).toBeDefined();
      expect(responseCall?.[1]).toBe(" thread=thread-123 turn=turn-abc effort=max");
      expect(responseCall?.[2]).toBe("end_turn");
      expect(typeof responseCall?.[3]).toBe("number");
      expect((responseCall?.[3] as number) >= 0).toBe(true);
      expect(responseCall?.slice(4)).toEqual([6, 0, 1, "edit"]);
    } finally {
      console.log = originalLog;
    }
  });

  test("tool schemas: Zod types converted to valid JSON Schema in StreamContext", async () => {
    const complexTool: Tool = {
      name: "complex",
      description: "Tool with diverse param types",
      parameters: z.object({
        query: z.string().describe("Search query"),
        limit: z.number().optional().describe("Max results"),
        recursive: z.boolean().describe("Recurse into subdirs"),
        extensions: z.array(z.string()).describe("File extensions"),
        mode: z.enum(["exact", "fuzzy", "regex"]).describe("Match mode"),
      }),
      async execute() {
        return { output: "ok" };
      },
    };

    const msg = makeAssistant([{ type: "text", text: "done" }]);
    const streamFn = createMockStreamFunction([msg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [complexTool],
      streamFunction: streamFn,
    };

    const loop = agentLoop([{ role: "user", content: "test", timestamp: Date.now() }], config);
    for await (const _ of loop) {
      /* drain */
    }

    const tools = streamFn.contexts[0].tools;
    expect(tools).toHaveLength(1);

    const schema = tools[0].inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const required = schema.required as string[];

    // Required fields: query, recursive, extensions, mode (not limit — it's optional)
    expect(required).toContain("query");
    expect(required).toContain("recursive");
    expect(required).toContain("extensions");
    expect(required).toContain("mode");
    expect(required).not.toContain("limit");

    // Type correctness
    expect(props.query.type).toBe("string");
    expect(props.limit.type).toBe("number");
    expect(props.recursive.type).toBe("boolean");
    expect(props.extensions.type).toBe("array");
    expect(props.mode).toHaveProperty("enum");
    expect(props.mode.enum as string[]).toEqual(["exact", "fuzzy", "regex"]);

    // Descriptions preserved
    expect(props.query.description).toBe("Search query");
    expect(props.extensions.description).toBe("File extensions");
  });

  test("unknown tool: error result fed back to LLM", async () => {
    const toolCallMsg = makeAssistant([{ type: "tool_call", id: "tc_1", name: "nonexistent", input: {} }], "tool_use");
    const responseMsg = makeAssistant([{ type: "text", text: "Sorry, that tool doesn't exist" }]);
    const streamFn = createMockStreamFunction([toolCallMsg, responseMsg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [echoTool],
      streamFunction: streamFn,
    };

    const messages: Message[] = [{ role: "user", content: "use fake tool", timestamp: Date.now() }];

    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    const toolEnd = events.find((e) => e.type === "tool_end") as Extract<AgentEvent, { type: "tool_end" }>;
    expect(toolEnd.isError).toBe(true);
    expect(toolEnd.output).toContain("Unknown tool");
  });

  test("parallel tools: all supportParallel=true → parallel execution (all tool_start before tool_end)", async () => {
    const toolA = createParallelTool("ptool_a", 50);
    const toolB = createParallelTool("ptool_b", 50);

    const toolCallMsg = makeAssistant(
      [
        { type: "tool_call", id: "tc_1", name: "ptool_a", input: { query: "hello" } },
        { type: "tool_call", id: "tc_2", name: "ptool_b", input: { query: "world" } },
      ],
      "tool_use",
    );
    const responseMsg = makeAssistant([{ type: "text", text: "done" }]);
    const streamFn = createMockStreamFunction([toolCallMsg, responseMsg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [toolA, toolB],
      streamFunction: streamFn,
    };

    const loop = agentLoop([{ role: "user", content: "go", timestamp: Date.now() }], config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    const types = events.map((e) => e.type);

    // All tool_start events should appear before any tool_end
    const firstToolEnd = types.indexOf("tool_end");
    const toolStarts = types.filter((t) => t === "tool_start");
    const toolStartIndices: number[] = [];
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "tool_start") toolStartIndices.push(i);
    }

    expect(toolStarts).toHaveLength(2);
    expect(toolStartIndices.every((idx) => idx < firstToolEnd)).toBe(true);

    // Both tools should have been called (timing: starts should be close together)
    expect(toolA.calls).toHaveLength(1);
    expect(toolB.calls).toHaveLength(1);
    const timeDiff = Math.abs(toolA.calls[0] - toolB.calls[0]);
    // If truly parallel, start times should be within ~10ms of each other
    expect(timeDiff).toBeLessThan(30);
  });

  test("mixed tools: sequential + parallel → sequential fallback", async () => {
    const toolA = createParallelTool("ptool_a", 50);

    const toolCallMsg = makeAssistant(
      [
        { type: "tool_call", id: "tc_1", name: "ptool_a", input: { query: "hello" } },
        { type: "tool_call", id: "tc_2", name: "seq_tool", input: { data: "world" } },
      ],
      "tool_use",
    );
    const responseMsg = makeAssistant([{ type: "text", text: "done" }]);
    const streamFn = createMockStreamFunction([toolCallMsg, responseMsg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [toolA, sequentialTool],
      streamFunction: streamFn,
    };

    const loop = agentLoop([{ role: "user", content: "go", timestamp: Date.now() }], config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    const types = events.map((e) => e.type);

    // Sequential: tool_start, tool_end, tool_start, tool_end (interleaved)
    const toolEvents = types.filter((t) => t === "tool_start" || t === "tool_end");
    expect(toolEvents).toEqual(["tool_start", "tool_end", "tool_start", "tool_end"]);
  });

  test("single parallel tool: no parallel path (length must be > 1)", async () => {
    const toolA = createParallelTool("ptool_a", 10);

    const toolCallMsg = makeAssistant(
      [{ type: "tool_call", id: "tc_1", name: "ptool_a", input: { query: "solo" } }],
      "tool_use",
    );
    const responseMsg = makeAssistant([{ type: "text", text: "done" }]);
    const streamFn = createMockStreamFunction([toolCallMsg, responseMsg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [toolA],
      streamFunction: streamFn,
    };

    const loop = agentLoop([{ role: "user", content: "go", timestamp: Date.now() }], config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    // Works correctly — single tool still executes
    const toolEnds = events.filter((e) => e.type === "tool_end") as Extract<AgentEvent, { type: "tool_end" }>[];
    expect(toolEnds).toHaveLength(1);
    expect(toolEnds[0].output).toBe("ptool_a:solo");
  });

  test("tool without supportParallel flag: treated as sequential (default false)", async () => {
    // echoTool has no supportParallel flag
    const toolCallMsg = makeAssistant(
      [
        { type: "tool_call", id: "tc_1", name: "echo", input: { message: "a" } },
        { type: "tool_call", id: "tc_2", name: "echo", input: { message: "b" } },
      ],
      "tool_use",
    );
    const responseMsg = makeAssistant([{ type: "text", text: "done" }]);
    const streamFn = createMockStreamFunction([toolCallMsg, responseMsg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [echoTool],
      streamFunction: streamFn,
    };

    const loop = agentLoop([{ role: "user", content: "go", timestamp: Date.now() }], config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    // Sequential: interleaved tool_start/tool_end
    const toolEvents = types.filter((t) => t === "tool_start" || t === "tool_end");
    expect(toolEvents).toEqual(["tool_start", "tool_end", "tool_start", "tool_end"]);
  });
});
