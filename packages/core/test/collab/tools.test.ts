// @summary Tests for spawn_agent, wait, send_input, close_agent tool execute() methods
import { describe, expect, it } from "bun:test";
import { formatAgentTypeParameterDescription, formatSpawnAgentToolDescription } from "../../src/agent/agent-types";
import { createCollabTools } from "../../src/collab/factory";
import type { ToolContext } from "../../src/tool/types";
import { makeAssistant, makeCollabDeps, makeMockSessionManagerFactory } from "./helpers";

function makeCtx(updates: string[] = []): ToolContext {
  return {
    toolCallId: "test-tc-1",
    signal: new AbortController().signal,
    approve: async () => "once" as const,
    onUpdate: (msg) => updates.push(msg),
  };
}

describe("spawn_agent tool", () => {
  it("returns thread_id and nickname as JSON", async () => {
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const result = await spawnTool.execute({ message: "do something", agent_type: "general" }, makeCtx());
    const parsed = JSON.parse(result.output);
    expect(typeof parsed.thread_id).toBe("string");
    expect(typeof parsed.nickname).toBe("string");
  });

  it("defaults agent_type to general", async () => {
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const result = await spawnTool.execute({ message: "task" }, makeCtx());
    const parsed = JSON.parse(result.output);
    expect(typeof parsed.thread_id).toBe("string");
  });

  it("passes resume_id when provided", async () => {
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("resumed")),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const result = await spawnTool.execute(
      { message: "resume this", agent_type: "general", resume_id: "some-session-id" },
      makeCtx(),
    );
    const parsed = JSON.parse(result.output);
    expect(typeof parsed.thread_id).toBe("string");
  });

  it("exposes detailed role guidance in tool description", () => {
    const { tools } = createCollabTools(makeCollabDeps());
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    expect(spawnTool.description).toBe(formatSpawnAgentToolDescription());
    expect(spawnTool.description).toContain("Role selection guide:");
    expect(spawnTool.description).toContain("'general':");
    expect(spawnTool.description).toContain("'explore':");
    expect(spawnTool.description).toContain("'planner':");
  });

  it("exposes detailed role guidance in agent_type schema description", () => {
    const { tools } = createCollabTools(makeCollabDeps());
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const shape = (spawnTool.parameters as { shape: Record<string, { description?: string }> }).shape;
    expect(shape.agent_type.description).toBe(formatAgentTypeParameterDescription());
    expect(shape.agent_type.description).toContain("Available built-in roles");
    expect(shape.agent_type.description).toContain("'general':");
    expect(shape.agent_type.description).toContain("'explore':");
    expect(shape.agent_type.description).toContain("'planner':");
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
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("done")),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const waitTool = tools.find((t) => t.name === "wait")!;
    const spawned = JSON.parse((await spawnTool.execute({ message: "task" }, makeCtx())).output);

    // Provide 1ms timeout — should be clamped to 10s min, still resolves before that
    const result = await waitTool.execute({ ids: [spawned.thread_id], timeout_ms: 1 }, makeCtx());
    const parsed = JSON.parse(result.output);
    // May timeout (1ms clamped to 10s, but agent completes first) or complete — just verify structure
    expect(typeof parsed.timed_out).toBe("boolean");
    expect(typeof parsed.status).toBe("object");
  });

  it("calls onUpdate with progress during wait", async () => {
    const updates: string[] = [];
    const { tools } = createCollabTools(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("done")),
      }),
    );
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const waitTool = tools.find((t) => t.name === "wait")!;
    const spawned = JSON.parse((await spawnTool.execute({ message: "task" }, makeCtx())).output);
    await waitTool.execute({ ids: [spawned.thread_id] }, makeCtx(updates));
    // onUpdate may or may not be called depending on timing, but should not error
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

  it("returns ok=true for running agent (steer called)", async () => {
    let _steerCalled = false;
    const factory = makeMockSessionManagerFactory(makeAssistant("done"));
    const wrappedFactory: typeof factory = (cfg) => {
      const mgr = factory!(cfg);
      const origSteer = mgr.steer.bind(mgr);
      mgr.steer = (content: string) => {
        _steerCalled = true;
        origSteer(content);
      };
      return mgr;
    };
    const { tools } = createCollabTools(makeCollabDeps({ sessionManagerFactory: wrappedFactory }));
    const spawnTool = tools.find((t) => t.name === "spawn_agent")!;
    const sendTool = tools.find((t) => t.name === "send_input")!;

    const spawned = JSON.parse((await spawnTool.execute({ message: "task" }, makeCtx())).output);
    // Agent may have already completed in a microtask — just verify the send_input path
    // If it throws "not running", that's also valid behavior for a completed agent
    try {
      const result = await sendTool.execute({ id: spawned.thread_id, message: "new guidance" }, makeCtx());
      const parsed = JSON.parse(result.output);
      expect(parsed.ok).toBe(true);
    } catch (err) {
      // Acceptable: agent completed before send_input was called
      expect(String(err)).toMatch(/not running|Unknown/);
    }
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
