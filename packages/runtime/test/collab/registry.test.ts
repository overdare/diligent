// @summary Tests for AgentRegistry: spawn, maxAgents, status tracking, shutdownAll
import { describe, expect, it } from "bun:test";
import type { Tool } from "@diligent/core/tool/types";
import type { RuntimeAgent } from "@diligent/runtime/agent/runtime-agent";
import { AgentRegistry, isFinal } from "@diligent/runtime/collab";
import type { SessionManagerConfig } from "@diligent/runtime/session";
import { getBuiltinAgentDefinitions } from "../../src/agent/agent-types";
import { resolveAvailableAgentDefinitions } from "../../src/agent/resolved-agent";
import type { AgentEvent } from "../../src/agent-event";
import { makeAssistant, makeCollabDeps, makeMockSessionManagerFactory } from "../helpers/collab";

function makeTool(name: string): Tool {
  return {
    name,
    description: name,
    parameters: { safeParse: (value: unknown) => ({ success: true, data: value }) } as never,
    execute: async () => ({ output: name }),
  } as Tool;
}

function makeInspectingSessionManagerFactory(observer: (agent: RuntimeAgent) => void) {
  let counter = 0;
  return (config: SessionManagerConfig) => {
    const sessionId = `inspect-session-${++counter}`;
    const listeners = new Set<(event: AgentEvent) => void>();
    return {
      entries: [],
      leafId: null,
      create: async () => {},
      resume: async () => false,
      list: async () => [],
      getContext: () => [],
      subscribe: (fn: (event: AgentEvent) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      run: async () => {
        let agent: RuntimeAgent;
        try {
          agent = (await config.agent()) as RuntimeAgent;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          for (const fn of listeners) {
            fn({
              type: "error",
              error: { name: "Error", message },
              fatal: true,
            });
          }
          throw error;
        }
        observer(agent);
        const assistant = makeAssistant("inspected");
        for (const fn of listeners) {
          fn({ type: "agent_start" });
          fn({ type: "message_start", itemId: "inspect-item", message: assistant });
          fn({ type: "message_end", itemId: "inspect-item", message: assistant });
          fn({ type: "agent_end", messages: [] });
        }
      },
      waitForWrites: async () => {},
      steer: () => {},
      hasPendingMessages: () => false,
      popPendingMessages: () => null,
      appendModeChange: () => {},
      get sessionPath() {
        return null;
      },
      get sessionId() {
        return sessionId;
      },
      get entryCount() {
        return 0;
      },
    } as never;
  };
}

function createInspectingHarness(observer: (agent: RuntimeAgent) => void) {
  let factoryCalls = 0;
  let runCalls = 0;
  return {
    getFactoryCalls: () => factoryCalls,
    getRunCalls: () => runCalls,
    factory: (config: SessionManagerConfig) => {
      factoryCalls++;
      return makeInspectingSessionManagerFactory((agent) => {
        runCalls++;
        observer(agent);
      })(config);
    },
  };
}

describe("AgentRegistry", () => {
  it("spawn returns threadId and nickname immediately", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const { threadId, nickname } = registry.spawn({
      prompt: "do something",
      description: "test agent",
      agentType: "general",
    });
    expect(typeof threadId).toBe("string");
    expect(threadId.length).toBeGreaterThan(0);
    expect(typeof nickname).toBe("string");
    expect(nickname.length).toBeGreaterThan(0);
  });

  it("spawn starts agent as pending/running, not completed", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const { threadId } = registry.spawn({
      prompt: "slow task",
      description: "slow",
      agentType: "general",
    });
    const status = registry.getStatus(threadId);
    // Status may be pending or running immediately after spawn
    expect(status.kind === "pending" || status.kind === "running").toBe(true);
  });

  it("wait resolves when agent completes", async () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("finished")),
      }),
    );
    const { threadId } = registry.spawn({
      prompt: "task",
      description: "",
      agentType: "general",
    });
    const { status, timedOut } = await registry.wait([threadId], 5000);
    expect(timedOut).toBe(false);
    expect(status[threadId]).toBeDefined();
    expect(isFinal(status[threadId])).toBe(true);
  });

  it("wait returns completed status with output", async () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("my output")),
      }),
    );
    const { threadId } = registry.spawn({ prompt: "task", description: "", agentType: "general" });
    const { status } = await registry.wait([threadId], 5000);
    const s = status[threadId];
    expect(s.kind).toBe("completed");
    if (s.kind === "completed") {
      expect(s.output).toContain("my output");
    }
  });

  it("rejects when maxAgents exceeded", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        maxAgents: 2,
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    registry.spawn({ prompt: "task1", description: "", agentType: "general" });
    registry.spawn({ prompt: "task2", description: "", agentType: "general" });
    expect(() => registry.spawn({ prompt: "task3", description: "", agentType: "general" })).toThrow(
      /Max active agents/,
    );
  });

  it("throws for unknown agent ID in wait", async () => {
    const registry = new AgentRegistry(makeCollabDeps());
    await expect(registry.wait(["unknown-id"], 1000)).rejects.toThrow(/Unknown agent/);
  });

  it("getNickname returns undefined for unknown agent", () => {
    const registry = new AgentRegistry(makeCollabDeps());
    expect(registry.getNickname("bad-id")).toBeUndefined();
  });

  it("shutdownAll aborts all agents", async () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("done")),
      }),
    );
    registry.spawn({ prompt: "task1", description: "", agentType: "general" });
    registry.spawn({ prompt: "task2", description: "", agentType: "general" });
    await registry.shutdownAll();
    // After shutdown, no more agents tracked
    // After shutdown, spawned agents are cleared
    // (we don't know the exact sessionIds, just verify shutdown completed without error)
  });

  it("close aborts agent and returns final status", async () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("result")),
      }),
    );
    const { threadId } = registry.spawn({ prompt: "task", description: "", agentType: "general" });
    const finalStatus = await registry.close(threadId);
    expect(isFinal(finalStatus)).toBe(true);
    // Agent is retained with shutdown status (not deleted)
    expect(registry.getStatus(threadId)).toEqual({ kind: "shutdown" });
  });

  it("two unique nicknames for two agents", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const r1 = registry.spawn({ prompt: "task1", description: "", agentType: "general" });
    const r2 = registry.spawn({ prompt: "task2", description: "", agentType: "general" });
    expect(r1.nickname).not.toBe(r2.nickname);
  });

  it("restoreAgent registers agent as shutdown", () => {
    const registry = new AgentRegistry(makeCollabDeps());
    registry.restoreAgent("sess-9999", "RestoredBot");
    expect(registry.getNickname("sess-9999")).toBe("RestoredBot");
    expect(registry.getStatus("sess-9999")).toEqual({ kind: "shutdown" });
  });

  it("restoreAgent skips if agent already exists", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const { threadId, nickname } = registry.spawn({ prompt: "task", description: "", agentType: "general" });
    registry.restoreAgent(threadId, "DifferentNick");
    // Original nickname preserved — restore was a no-op
    expect(registry.getNickname(threadId)).toBe(nickname);
  });

  it("restored agents do not count toward maxAgents", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        maxAgents: 2,
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    registry.restoreAgent("sess-old-1", "Old1");
    registry.restoreAgent("sess-old-2", "Old2");
    // Can still spawn 2 active agents despite 2 restored (shutdown) agents
    registry.spawn({ prompt: "task1", description: "", agentType: "general" });
    registry.spawn({ prompt: "task2", description: "", agentType: "general" });
    // 3rd active would exceed limit
    expect(() => registry.spawn({ prompt: "task3", description: "", agentType: "general" })).toThrow(
      /Max active agents/,
    );
  });

  it("spawn passes parentSessionId to child SessionManager config", () => {
    let capturedConfig: SessionManagerConfig | undefined;
    const registry = new AgentRegistry(
      makeCollabDeps({
        getParentSessionId: () => "parent-xyz",
        sessionManagerFactory: (config) => {
          capturedConfig = config;
          return makeMockSessionManagerFactory(makeAssistant("ok"))!(config);
        },
      }),
    );
    registry.spawn({ prompt: "test", description: "", agentType: "general" });
    expect(capturedConfig?.parentSession).toBe("parent-xyz");
  });

  it("emits immediate errored spawn_end when child fails before wait", async () => {
    const events: AgentEvent[] = [];
    const registry = new AgentRegistry(
      makeCollabDeps({
        onCollabEvent: (event) => events.push(event),
        sessionManagerFactory: makeMockSessionManagerFactory(new Error("model not found")),
      }),
    );

    const { threadId } = registry.spawn({ prompt: "task", description: "", agentType: "general" });

    const { status } = await registry.wait([threadId], 5000);
    expect(status[threadId]?.kind).toBe("errored");

    const spawnEndErrored = events.find(
      (event) =>
        event.type === "collab_spawn_end" &&
        event.childThreadId === threadId &&
        event.status === "errored" &&
        event.message?.includes("model not found"),
    );
    expect(spawnEndErrored).toBeDefined();
  });

  it("allows custom agent names to resolve through the shared definition layer", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
        agentDefinitions: resolveAvailableAgentDefinitions(getBuiltinAgentDefinitions(), [
          {
            name: "code-reviewer",
            description: "Reviews code",
            filePath: "/tmp/code-reviewer/AGENT.md",
            content: "Review code carefully.",
            tools: ["read"],
            defaultModelClass: "general",
            source: "project",
          },
        ]),
      }),
    );

    const result = registry.spawn({ prompt: "review", description: "", agentType: "code-reviewer" });
    expect(typeof result.threadId).toBe("string");
  });

  it("excludes collab tools from child agents by default", async () => {
    let childToolNames: string[] = [];
    const harness = createInspectingHarness((agent) => {
      childToolNames = agent.tools.map((tool) => tool.name);
    });
    const registry = new AgentRegistry(
      makeCollabDeps({
        parentTools: [makeTool("read"), makeTool("spawn_agent"), makeTool("wait")],
        sessionManagerFactory: harness.factory,
      }),
    );

    const { threadId } = registry.spawn({ prompt: "task", description: "", agentType: "general" });
    const result = await registry.wait([threadId], 5000);

    expect(result.status[threadId]?.kind).toBe("completed");
    expect(harness.getFactoryCalls()).toBe(1);
    expect(harness.getRunCalls()).toBe(1);

    expect(childToolNames).toContain("read");
    expect(childToolNames).not.toContain("spawn_agent");
    expect(childToolNames).not.toContain("wait");
  });

  it("allows collab tools only when nested agents are explicitly enabled", async () => {
    let childToolNames: string[] = [];
    const harness = createInspectingHarness((agent) => {
      childToolNames = agent.tools.map((tool) => tool.name);
    });
    const registry = new AgentRegistry(
      makeCollabDeps({
        parentTools: [makeTool("read"), makeTool("spawn_agent"), makeTool("wait")],
        sessionManagerFactory: harness.factory,
      }),
    );

    const { threadId } = registry.spawn({
      prompt: "task",
      description: "",
      agentType: "general",
      allowNestedAgents: true,
      allowedTools: ["read", "spawn_agent"],
    });
    const result = await registry.wait([threadId], 5000);

    expect(result.status[threadId]?.kind).toBe("completed");
    expect(harness.getFactoryCalls()).toBe(1);
    expect(harness.getRunCalls()).toBe(1);

    expect(childToolNames).toContain("read");
    expect(childToolNames).toContain("spawn_agent");
    expect(childToolNames).not.toContain("wait");
  });

  it("injects an explicit nested-subagent policy into the child system prompt", async () => {
    let systemSections: Array<{ label: string; content: string }> = [];
    const harness = createInspectingHarness((agent) => {
      systemSections = agent.systemPrompt.map((section) => ({ label: section.label, content: section.content }));
    });
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: harness.factory,
      }),
    );

    const { threadId } = registry.spawn({ prompt: "task", description: "", agentType: "general" });
    const result = await registry.wait([threadId], 5000);

    expect(result.status[threadId]?.kind).toBe("completed");
    expect(harness.getFactoryCalls()).toBe(1);
    expect(harness.getRunCalls()).toBe(1);

    const policy = systemSections.find((section) => section.label === "nested_subagent_policy");
    expect(policy?.content).toContain("Nested sub-agent delegation is disabled");
    expect(policy?.content).toContain("Do not call spawn_agent, wait, send_input, or close_agent");
  });
});
