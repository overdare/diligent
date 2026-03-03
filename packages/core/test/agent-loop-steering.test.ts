// @summary Tests for agent loop with steering injection and tool execution
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agentLoop } from "../src/agent/loop";
import type { AgentEvent, AgentLoopConfig } from "../src/agent/types";
import { EventStream } from "../src/event-stream";
import type { Model, ProviderEvent, ProviderResult, StreamContext, StreamFunction } from "../src/provider/types";
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

function createMockStreamFunction(responses: AssistantMessage[]): StreamFunction & { contexts: StreamContext[] } {
  let callIndex = 0;
  const contexts: StreamContext[] = [];

  const fn: StreamFunction = (_model, context, _options) => {
    contexts.push(context);
    const msg = responses[callIndex++];
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );

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

  return Object.assign(fn, { contexts });
}

const echoTool: Tool = {
  name: "echo",
  description: "Echo a message",
  parameters: z.object({ message: z.string() }),
  async execute(args: { message: string }) {
    return { output: args.message };
  },
};

describe("agentLoop steering", () => {
  test("steering messages injected before LLM call are visible in context", async () => {
    // First call: LLM makes a tool call. Second call: LLM responds with text.
    const toolCallMsg = makeAssistant(
      [{ type: "tool_call", id: "tc_1", name: "echo", input: { message: "hi" } }],
      "tool_use",
    );
    const responseMsg = makeAssistant([{ type: "text", text: "done" }]);
    const streamFn = createMockStreamFunction([toolCallMsg, responseMsg]);

    let callCount = 0;
    const steeringMessages: Message[] = [];

    // Queue a steering message that will be drained before the first LLM call
    steeringMessages.push({
      role: "user",
      content: "change direction",
      timestamp: Date.now(),
    });

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [echoTool],
      streamFunction: streamFn,
      getSteeringMessages: () => {
        callCount++;
        // Only return messages on first drain
        if (callCount === 1) {
          return steeringMessages.splice(0);
        }
        return [];
      },
    };

    const messages: Message[] = [{ role: "user", content: "hello", timestamp: Date.now() }];
    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    // Should have emitted steering_injected event
    const steeringEvents = events.filter((e) => e.type === "steering_injected");
    expect(steeringEvents.length).toBeGreaterThanOrEqual(1);
    expect((steeringEvents[0] as { type: "steering_injected"; messageCount: number }).messageCount).toBe(1);

    // The steering message should be visible in the second LLM call's context
    // (first call sees original + steering, tool result; second call sees all)
    expect(streamFn.contexts[0].messages.length).toBeGreaterThanOrEqual(2); // user + steering
    const secondCallMsgs = streamFn.contexts[0].messages;
    const hasSteeringMsg = secondCallMsgs.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("change direction"),
    );
    expect(hasSteeringMsg).toBe(true);
  });

  test("steering messages injected after tool execution", async () => {
    // Two tool call rounds, then text response
    const toolCallMsg1 = makeAssistant(
      [{ type: "tool_call", id: "tc_1", name: "echo", input: { message: "first" } }],
      "tool_use",
    );
    const toolCallMsg2 = makeAssistant(
      [{ type: "tool_call", id: "tc_2", name: "echo", input: { message: "second" } }],
      "tool_use",
    );
    const responseMsg = makeAssistant([{ type: "text", text: "done" }]);
    const streamFn = createMockStreamFunction([toolCallMsg1, toolCallMsg2, responseMsg]);

    let drainCount = 0;

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [echoTool],
      streamFunction: streamFn,
      getSteeringMessages: () => {
        drainCount++;
        // Inject a steering message after the first tool execution (drain #2: after tools in turn 1)
        if (drainCount === 2) {
          return [
            {
              role: "user" as const,
              content: "redirect after tools",
              timestamp: Date.now(),
            },
          ];
        }
        return [];
      },
    };

    const messages: Message[] = [{ role: "user", content: "go", timestamp: Date.now() }];
    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    const steeringEvents = events.filter((e) => e.type === "steering_injected");
    expect(steeringEvents.length).toBeGreaterThanOrEqual(1);

    // The second LLM call should see the steering message in its context
    expect(streamFn.contexts.length).toBeGreaterThanOrEqual(2);
    const secondCallMsgs = streamFn.contexts[1].messages;
    const hasSteeringMsg = secondCallMsgs.some(
      (m) =>
        m.role === "user" && typeof m.content === "string" && m.content.includes("redirect after tools"),
    );
    expect(hasSteeringMsg).toBe(true);
  });

  test("empty steering queue is a no-op", async () => {
    const responseMsg = makeAssistant([{ type: "text", text: "hello" }]);
    const streamFn = createMockStreamFunction([responseMsg]);

    let drainCount = 0;

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [],
      streamFunction: streamFn,
      getSteeringMessages: () => {
        drainCount++;
        return []; // Always empty
      },
    };

    const messages: Message[] = [{ role: "user", content: "hi", timestamp: Date.now() }];
    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    // No steering_injected events should be emitted
    const steeringEvents = events.filter((e) => e.type === "steering_injected");
    expect(steeringEvents).toHaveLength(0);

    // getSteeringMessages was called (at least once: before LLM)
    expect(drainCount).toBeGreaterThanOrEqual(1);
  });

  test("steering during thinking with no tool calls continues loop (codex-rs pattern)", async () => {
    // Scenario: tool start → steer → tool end → inject → thinking → steer → steer → thinking end
    // The LLM response after thinking has NO tool calls.
    // Without the fix, the 2 steers queued during thinking would be lost.
    const toolCallMsg = makeAssistant(
      [{ type: "tool_call", id: "tc_1", name: "echo", input: { message: "working" } }],
      "tool_use",
    );
    // Second response: no tool calls (text-only), steers arrive during this call
    const textOnlyMsg = makeAssistant([{ type: "text", text: "thinking done" }]);
    // Third response: LLM addresses the steers
    const finalMsg = makeAssistant([{ type: "text", text: "addressed steers" }]);
    const streamFn = createMockStreamFunction([toolCallMsg, textOnlyMsg, finalMsg]);

    let drainCount = 0;

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [echoTool],
      streamFunction: streamFn,
      getSteeringMessages: () => {
        drainCount++;
        // drain #1: before first LLM call → empty
        // drain #2: after tool execution → empty
        // drain #3: before second LLM call → empty
        // drain #4: no-tool-call path after second response → 2 steers arrived during thinking
        if (drainCount === 4) {
          return [
            { role: "user" as const, content: "steer A", timestamp: Date.now() },
            { role: "user" as const, content: "steer B", timestamp: Date.now() },
          ];
        }
        return [];
      },
    };

    const messages: Message[] = [{ role: "user", content: "start", timestamp: Date.now() }];
    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    // steering_injected should have been emitted for the 2 steers
    const steeringEvents = events.filter((e) => e.type === "steering_injected");
    expect(steeringEvents.length).toBeGreaterThanOrEqual(1);
    const injectedCount = steeringEvents.reduce(
      (sum, e) => sum + (e as { type: "steering_injected"; messageCount: number }).messageCount,
      0,
    );
    expect(injectedCount).toBe(2);

    // The loop should have continued — 3 LLM calls total
    expect(streamFn.contexts.length).toBe(3);

    // Third LLM call should see both steer messages
    const thirdCallMsgs = streamFn.contexts[2].messages;
    const steerA = thirdCallMsgs.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content === "steer A",
    );
    const steerB = thirdCallMsgs.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content === "steer B",
    );
    expect(steerA).toBe(true);
    expect(steerB).toBe(true);
  });

  test("steer during first text-only response injects and continues loop", async () => {
    // Exact scenario: User Msg → Thinking Start → Steering → Thinking End (no tools)
    // First response: text-only, steer arrives during streamAssistantResponse
    // Second response: LLM addresses the steer
    const firstMsg = makeAssistant([{ type: "text", text: "initial thoughts" }]);
    const secondMsg = makeAssistant([{ type: "text", text: "addressed steer" }]);
    const streamFn = createMockStreamFunction([firstMsg, secondMsg]);

    let drainCount = 0;

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [echoTool],
      streamFunction: streamFn,
      getSteeringMessages: () => {
        drainCount++;
        // drain #1: before first LLM call → empty
        // drain #2: no-tool-call path after first response → steer arrived during thinking
        if (drainCount === 2) {
          return [{ role: "user" as const, content: "please focus on X", timestamp: Date.now() }];
        }
        return [];
      },
    };

    const messages: Message[] = [{ role: "user", content: "hello", timestamp: Date.now() }];
    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    // steering_injected should fire
    const steeringEvents = events.filter((e) => e.type === "steering_injected");
    expect(steeringEvents.length).toBe(1);
    expect((steeringEvents[0] as { type: "steering_injected"; messageCount: number }).messageCount).toBe(1);

    // Loop continued — 2 LLM calls
    expect(streamFn.contexts.length).toBe(2);

    // Second LLM call should see the steer message
    const secondCallMsgs = streamFn.contexts[1].messages;
    const hasSteer = secondCallMsgs.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content === "please focus on X",
    );
    expect(hasSteer).toBe(true);
  });

  test("no tool calls and no pending steers ends loop normally", async () => {
    const responseMsg = makeAssistant([{ type: "text", text: "done" }]);
    const streamFn = createMockStreamFunction([responseMsg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [],
      streamFunction: streamFn,
      getSteeringMessages: () => [],
    };

    const messages: Message[] = [{ role: "user", content: "hi", timestamp: Date.now() }];
    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    // Only 1 LLM call — loop broke normally
    expect(streamFn.contexts.length).toBe(1);
    expect(events.some((e) => e.type === "steering_injected")).toBe(false);
  });

  test("no getSteeringMessages callback is a no-op", async () => {
    const responseMsg = makeAssistant([{ type: "text", text: "hello" }]);
    const streamFn = createMockStreamFunction([responseMsg]);

    const config: AgentLoopConfig = {
      model: TEST_MODEL,
      systemPrompt: [{ label: "test", content: "test" }],
      tools: [],
      streamFunction: streamFn,
      // No getSteeringMessages
    };

    const messages: Message[] = [{ role: "user", content: "hi", timestamp: Date.now() }];
    const loop = agentLoop(messages, config);
    const events: AgentEvent[] = [];
    for await (const event of loop) {
      events.push(event);
    }

    // No steering_injected events
    const steeringEvents = events.filter((e) => e.type === "steering_injected");
    expect(steeringEvents).toHaveLength(0);
  });
});
