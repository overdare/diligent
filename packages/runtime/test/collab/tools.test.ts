// @summary Tests for spawn_agent, wait, send_input, close_agent tool execute() methods
import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@diligent/core/tool-contract";
import { type AgentRegistry, createCollabTools, createSpawnAgentTool, createWaitTool } from "@diligent/runtime/collab";
import {
  formatAgentTypeParameterDescription,
  formatSpawnAgentToolDescription,
  getBuiltinAgentDefinitions,
} from "../../src/agent/agent-types";
import { resolveAvailableAgentDefinitions } from "../../src/agent/resolved-agent";
import {
  makeAssistant,
  makeCollabDeps,
  makeDeferredSessionManagerFactory,
  makeMockSessionManagerFactory,
} from "../helpers/collab";

function makeCtx(updates: string[] = []): ToolContext {
  return {
    toolCallId: "test-tc-1",
    signal: new AbortController().signal,
    abort: () => {},
    onUpdate: (msg) => updates.push(msg),
  };
}

describe("spawn_agent tool", () => {
  it("returns a non-empty thread_id when resume_id is empty", async () => {
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const result = await spawnTool.execute(
      { message: "do something", agent_type: "general", resume_id: "" },
      makeCtx(),
    );
    const parsed = JSON.parse(result.output);
    expect(typeof parsed.thread_id).toBe("string");
    expect(parsed.thread_id.length).toBeGreaterThan(0);
    expect(typeof parsed.nickname).toBe("string");
  });

  it("leaves a new spawn's omitted agent_type for the registry to default", async () => {
    let received: Parameters<AgentRegistry["spawn"]>[0] | undefined;
    const registry = {
      spawn: (params: Parameters<AgentRegistry["spawn"]>[0]) => {
        received = params;
        return { threadId: "thread-1", nickname: "Acacia" };
      },
    } as unknown as AgentRegistry;
    const spawnTool = createSpawnAgentTool(registry, getBuiltinAgentDefinitions());

    await spawnTool.execute({ message: "task" }, makeCtx());

    expect(received).toMatchObject({ prompt: "task", description: "", agentType: undefined });
  });

  it("does not materialize the general default when a resume omits agent_type", () => {
    const { tools } = createCollabTools(makeCollabDeps());
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const parsed = spawnTool.parameters.safeParse({ message: "continue", resume_id: "child-session" });

    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data).not.toHaveProperty("agent_type");
  });

  it("does not expose per-spawn model or tool overrides", () => {
    const { tools } = createCollabTools(makeCollabDeps());
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const shape = (spawnTool.parameters as { shape: Record<string, unknown> }).shape;

    expect(shape).not.toHaveProperty("model_class");
    expect(shape).not.toHaveProperty("allowed_tools");
  });

  it("passes resume_id when provided", async () => {
    const factory = makeMockSessionManagerFactory(makeAssistant("resumed"));
    const wrappedFactory: typeof factory = (config) => {
      const manager = factory!(config);
      manager.resume = async ({ sessionId }) => sessionId === "some-session-id";
      return manager;
    };
    const { tools, registry } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: wrappedFactory,
      }),
    );
    registry.restoreAgent("some-session-id", "LegacyAgent");
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const result = await spawnTool.execute(
      { message: "resume this", agent_type: "general", resume_id: "some-session-id" },
      makeCtx(),
    );
    const parsed = JSON.parse(result.output);
    expect(parsed.thread_id).toBe("some-session-id");
    expect(parsed.nickname).toBe("LegacyAgent");
  });

  it("exposes detailed role guidance in tool description", () => {
    const { tools } = createCollabTools(makeCollabDeps());
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    expect(spawnTool.description).toBe(formatSpawnAgentToolDescription());
    expect(spawnTool.description).toContain("Role selection guide:");
    expect(spawnTool.description).toContain("wait for them before yielding");
    expect(spawnTool.description).toContain("Nested subagents are disabled by default");
    expect(spawnTool.description).toContain(
      "act as the coordinator: monitor, synthesize, and decide the next step instead of doing the same work in parallel",
    );
    expect(spawnTool.description).toContain("Prompt contract:");
    expect(spawnTool.description).toContain("Result contract:");
    expect(spawnTool.description).toContain("Do not ask a child agent to spawn or coordinate additional sub-agents");
    expect(spawnTool.description).toContain("'general':");
    expect(spawnTool.description).toContain("'explore':");
    expect(spawnTool.description).not.toContain("'planner':");
  });

  it("exposes detailed role guidance in agent_type schema description", () => {
    const { tools } = createCollabTools(makeCollabDeps());
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const shape = (spawnTool.parameters as { shape: Record<string, { description?: string }> }).shape;
    expect(shape.agent_type.description).toBe(formatAgentTypeParameterDescription());
    expect(shape.agent_type.description).toContain("Available built-in roles");
    expect(shape.agent_type.description).toContain("'general':");
    expect(shape.agent_type.description).toContain("'explore':");
    expect(shape.agent_type.description).not.toContain("'planner':");
    expect(shape.allow_nested_agents.description).toContain("Explicit opt-in");
    expect(shape.message.description).toContain("full worker brief");
    expect(shape.message.description).toContain("expected deliverable or result shape");
  });

  it("limits the built-in explore agent to code location lookups", () => {
    const explore = getBuiltinAgentDefinitions().find((agent) => agent.name === "explore");
    expect(explore).toBeDefined();
    expect(explore?.description).toContain("codebase orientation agent");
    expect(explore?.systemPromptPrefix).toContain("not an investigator or reviewer");
    expect(explore?.systemPromptPrefix).toContain("Treat your findings as pointers");

    const description = formatSpawnAgentToolDescription();
    expect(description).toContain("file, symbol, definition, and reference lookups");
    expect(description).toContain("Never delegate code review, audit, correctness analysis");
    expect(description).not.toContain("authoritative codebase Q&A");
    expect(description).not.toContain("Trust explorer results without re-verification");
  });

  it("includes custom agents in tool description and schema description", () => {
    const agentDefinitions = resolveAvailableAgentDefinitions(getBuiltinAgentDefinitions(), [
      {
        name: "code-reviewer",
        description: "Reviews code changes",
        filePath: "/tmp/code-reviewer/AGENT.md",
        content: "Review code carefully.",
        tools: ["read", "glob"],
        defaultModelClass: "general",
        source: "project",
      },
    ]);
    const { tools } = createCollabTools(
      makeCollabDeps({
        agentDefinitions,
      }),
    );
    const spawnTool = tools.find((tool) => tool.name === "spawn_agent")!;
    const shape = (spawnTool.parameters as { shape: Record<string, { description?: string }> }).shape;
    expect(spawnTool.description).toBe(formatSpawnAgentToolDescription(agentDefinitions));
    expect(spawnTool.description).toContain("code-reviewer");
    expect(shape.agent_type.description).toBe(formatAgentTypeParameterDescription(agentDefinitions));
    expect(shape.agent_type.description).toContain("code-reviewer");
  });
});

describe("wait tool", () => {
  it("returns status and timed_out=false on completion", async () => {
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("done")),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const waitTool = tools.find((t) => t.name === "wait")!;

    const spawned = JSON.parse((await spawnTool.execute({ message: "task" }, makeCtx())).output);
    const result = await waitTool.execute({ ids: [spawned.thread_id] }, makeCtx());
    const parsed = JSON.parse(result.output);
    expect(parsed.timed_out).toBe(false);
    expect(parsed.status[spawned.thread_id]).toBeDefined();
  });

  it("clamps timeout_ms to minimum", async () => {
    let receivedTimeout: number | undefined;
    const registry = {
      wait: async (_ids: string[], timeoutMs: number) => {
        receivedTimeout = timeoutMs;
        return { status: { "thread-1": { kind: "running" as const } }, timedOut: true };
      },
      getNickname: () => "Acacia",
      getProgress: () => undefined,
    } as unknown as AgentRegistry;
    const waitTool = createWaitTool(registry);

    await waitTool.execute({ ids: ["thread-1"], timeout_ms: 1 }, makeCtx());

    expect(receivedTimeout).toBe(60_000);
  });

  it("forwards registry progress through the tool context", async () => {
    const updates: string[] = [];
    const registry = {
      wait: async (_ids: string[], _timeoutMs: number, onUpdate?: (summary: string) => void) => {
        onUpdate?.("Acacia running");
        return { status: { "thread-1": { kind: "running" as const } }, timedOut: true };
      },
      getNickname: () => "Acacia",
      getProgress: () => undefined,
    } as unknown as AgentRegistry;
    const waitTool = createWaitTool(registry);

    await waitTool.execute({ ids: ["thread-1"] }, makeCtx(updates));

    expect(updates).toEqual(["Acacia running"]);
  });

  it("reports a progress digest for agents still running when the wait times out", async () => {
    const deferred = makeDeferredSessionManagerFactory();
    const { tools, registry } = createCollabTools(makeCollabDeps({ sessionManagerFactory: deferred.factory }));
    const waitTool = tools.find((tool) => tool.name === "wait")!;
    const { threadId } = registry.spawn({ prompt: "work", description: "work", agentType: "general" });
    await deferred.controls[0]!.started;
    const child = deferred.controls[0]!;
    child.emit({ type: "turn_start", turnId: "turn-1" });
    child.emit({ type: "message_end", itemId: "m1", message: makeAssistant("Checking the failing test first.") });
    child.emit({ type: "tool_start", itemId: "t1", toolCallId: "read-1", toolName: "read", input: {} });
    child.emit({ type: "tool_end", itemId: "t1", toolCallId: "read-1", toolName: "read", output: "", isError: false });
    child.emit({ type: "turn_start", turnId: "turn-2" });
    child.emit({ type: "tool_start", itemId: "t2", toolCallId: "exec-1", toolName: "exec", input: {} });
    child.emit({
      type: "tool_start",
      itemId: "t3",
      toolCallId: "exec-1#1",
      toolName: "bash",
      input: {},
      parentToolCallId: "exec-1",
    });

    // An aborted wait returns the same timed-out snapshot as an expired timeout, without a one-minute delay.
    const controller = new AbortController();
    controller.abort();
    const result = await waitTool.execute({ ids: [threadId] }, { ...makeCtx(), signal: controller.signal });
    const parsed = JSON.parse(result.output) as {
      timed_out: boolean;
      progress: Record<string, { turns: number; tool_calls: number; current_tool?: { name: string } }>;
      summary: string[];
    };

    expect(parsed.timed_out).toBe(true);
    expect(parsed.progress[threadId]).toMatchObject({
      turns: 2,
      tool_calls: 3,
      current_tool: { name: "exec > bash" },
      last_message: "Checking the failing test first.",
    });
    expect(parsed.summary[0]).toStartWith(`${registry.getNickname(threadId)}: Still running — turn 2, 3 tool calls`);
    expect(parsed.summary[0]).toContain("running exec > bash for");
    child.complete("done");
  });

  it("orders status keys and summary lines by requested ids, not reverse completion", async () => {
    const deferred = makeDeferredSessionManagerFactory();
    const { tools, registry } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: deferred.factory,
      }),
    );
    const waitTool = tools.find((tool) => tool.name === "wait")!;
    const first = registry.spawn({ prompt: "first", description: "first", agentType: "general" });
    const second = registry.spawn({ prompt: "second", description: "second", agentType: "general" });
    await Promise.all(deferred.controls.map((control) => control.started));

    const waiting = waitTool.execute({ ids: [second.threadId, first.threadId] }, makeCtx());
    deferred.controls[0]!.complete("first output");
    await Promise.resolve();
    deferred.controls[1]!.complete("second output");
    const parsed = JSON.parse((await waiting).output) as {
      status: Record<string, { kind: string; output?: string }>;
      summary: string[];
    };

    expect(Object.keys(parsed.status)).toEqual([second.threadId, first.threadId]);
    expect(parsed.summary).toEqual([
      `${registry.getNickname(second.threadId)}: Completed — second output`,
      `${registry.getNickname(first.threadId)}: Completed — first output`,
    ]);
  });

  it("preserves full nested agent output while keeping summary concise", async () => {
    const longOutput = "x".repeat(2_500);
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant(longOutput)),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const waitTool = tools.find((t) => t.name === "wait")!;

    const spawned = JSON.parse((await spawnTool.execute({ message: "task" }, makeCtx())).output);
    const result = await waitTool.execute({ ids: [spawned.thread_id] }, makeCtx());
    const parsed = JSON.parse(result.output) as {
      status: Record<string, { kind: string; output?: string }>;
    };

    const status = parsed.status[spawned.thread_id];
    expect(status.kind).toBe("completed");
    expect(status.output).toBe(longOutput);
    expect(parsed.summary[0]).toContain("Completed —");
  });

  it("returns oversized wait output intact at tool layer", async () => {
    const veryLongOutput = "x".repeat(80_000);
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant(veryLongOutput)),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const waitTool = tools.find((t) => t.name === "wait")!;

    const spawned = JSON.parse((await spawnTool.execute({ message: "task" }, makeCtx())).output);
    const result = await waitTool.execute({ ids: [spawned.thread_id] }, makeCtx());
    const parsed = JSON.parse(result.output) as {
      status: Record<string, { kind: string; output?: string }>;
    };
    const status = parsed.status[spawned.thread_id];
    expect(status.kind).toBe("completed");
    expect(status.output).toBe(veryLongOutput);
  });

  it("throws for unknown agent ID", async () => {
    const { tools } = createCollabTools(makeCollabDeps());
    const waitTool = tools.find((t) => t.name === "wait")!;
    await expect(waitTool.execute({ ids: ["nonexistent"] }, makeCtx())).rejects.toThrow(/Unknown agent/);
  });
});

describe("send_input tool", () => {
  it("throws for unknown agent", async () => {
    const { tools } = createCollabTools(makeCollabDeps());
    const sendTool = tools.find((t) => t.name === "send_input")!;
    await expect(sendTool.execute({ id: "bad-id", message: "hello" }, makeCtx())).rejects.toThrow(/Unknown agent/);
  });

  it("steers a running agent and interrupts its tools only when asked", async () => {
    const deferred = makeDeferredSessionManagerFactory();
    const { tools, registry } = createCollabTools(makeCollabDeps({ sessionManagerFactory: deferred.factory }));
    const sendTool = tools.find((t) => t.name === "send_input")!;
    const { threadId } = registry.spawn({ prompt: "work", description: "work", agentType: "general" });
    await deferred.controls[0]!.started;

    const queued = await sendTool.execute({ id: threadId, message: "after this step" }, makeCtx());
    const urgent = await sendTool.execute({ id: threadId, message: "stop now", interrupt: true }, makeCtx());

    expect(JSON.parse(queued.output)).toEqual({
      ok: true,
      nickname: registry.getNickname(threadId),
      message: "after this step",
    });
    expect(JSON.parse(urgent.output)).toMatchObject({ ok: true, interrupt_requested: true });
    expect(deferred.controls[0]!.steering).toEqual([
      { message: "after this step", interrupted: false },
      { message: "stop now", interrupted: true },
    ]);
    deferred.controls[0]!.complete("done");
  });

  it("tells the caller to resume a finished agent with spawn_agent instead of failing opaquely", async () => {
    const deferred = makeDeferredSessionManagerFactory();
    const { tools, registry } = createCollabTools(makeCollabDeps({ sessionManagerFactory: deferred.factory }));
    const sendTool = tools.find((t) => t.name === "send_input")!;
    const { threadId } = registry.spawn({ prompt: "work", description: "work", agentType: "general" });
    await deferred.controls[0]!.started;
    deferred.controls[0]!.complete("done");
    await registry.wait([threadId], 1_000);

    const result = await sendTool.execute({ id: threadId, message: "one more thing" }, makeCtx());

    expect(result.metadata?.error).toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({
      ok: false,
      status: "completed",
      resume_with: { tool: "spawn_agent", resume_id: threadId, message: "one more thing" },
    });
    expect(deferred.controls[0]!.steering).toEqual([]);
  });
});

describe("close_agent tool", () => {
  it("returns thread_id, nickname and final_status", async () => {
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("done")),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const closeTool = tools.find((t) => t.name === "close_agent")!;

    const spawned = JSON.parse((await spawnTool.execute({ message: "task" }, makeCtx())).output);
    const result = await closeTool.execute({ id: spawned.thread_id }, makeCtx());
    const parsed = JSON.parse(result.output);
    expect(parsed.thread_id).toBe(spawned.thread_id);
    expect(typeof parsed.nickname).toBe("string");
    expect(parsed.final_status).toBeDefined();
    expect(typeof parsed.final_status.kind).toBe("string");
  });

  it("throws for unknown agent", async () => {
    const { tools } = createCollabTools(makeCollabDeps());
    const closeTool = tools.find((t) => t.name === "close_agent")!;
    await expect(closeTool.execute({ id: "bad-id" }, makeCtx())).rejects.toThrow(/Unknown agent/);
  });
});
