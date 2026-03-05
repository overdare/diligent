// @summary Tests for AgentRegistry: spawn, maxAgents, status tracking, shutdownAll
import { describe, expect, it } from "bun:test";
import { AgentRegistry } from "../../src/collab/registry";
import { isFinal } from "../../src/collab/types";
import type { SessionManagerConfig } from "../../src/session/manager";
import { makeAssistant, makeCollabDeps, makeMockSessionManagerFactory } from "./helpers";

describe("AgentRegistry", () => {
  it("spawn returns agentId and nickname immediately", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const { agentId, nickname } = registry.spawn({
      prompt: "do something",
      description: "test agent",
      agentType: "general",
    });
    expect(typeof agentId).toBe("string");
    expect(agentId.length).toBeGreaterThan(0);
    expect(typeof nickname).toBe("string");
    expect(nickname.length).toBeGreaterThan(0);
  });

  it("spawn starts agent as pending/running, not completed", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const { agentId } = registry.spawn({
      prompt: "slow task",
      description: "slow",
      agentType: "general",
    });
    const status = registry.getStatus(agentId);
    // Status may be pending or running immediately after spawn
    expect(status.kind === "pending" || status.kind === "running").toBe(true);
  });

  it("wait resolves when agent completes", async () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("finished")),
      }),
    );
    const { agentId } = registry.spawn({
      prompt: "task",
      description: "",
      agentType: "general",
    });
    const { status, timedOut } = await registry.wait([agentId], 5000);
    expect(timedOut).toBe(false);
    expect(status[agentId]).toBeDefined();
    expect(isFinal(status[agentId])).toBe(true);
  });

  it("wait returns completed status with output", async () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("my output")),
      }),
    );
    const { agentId } = registry.spawn({ prompt: "task", description: "", agentType: "general" });
    const { status } = await registry.wait([agentId], 5000);
    const s = status[agentId];
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
    expect(registry.getNickname("agent-0001")).toBeUndefined();
  });

  it("close aborts agent and returns final status", async () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("result")),
      }),
    );
    const { agentId } = registry.spawn({ prompt: "task", description: "", agentType: "general" });
    const finalStatus = await registry.close(agentId);
    expect(isFinal(finalStatus)).toBe(true);
    // Agent is retained with shutdown status (not deleted)
    expect(registry.getStatus(agentId)).toEqual({ kind: "shutdown" });
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
    registry.restoreAgent("agent-9999", "RestoredBot");
    expect(registry.getNickname("agent-9999")).toBe("RestoredBot");
    expect(registry.getStatus("agent-9999")).toEqual({ kind: "shutdown" });
  });

  it("restoreAgent skips if agent already exists", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    const { agentId, nickname } = registry.spawn({ prompt: "task", description: "", agentType: "general" });
    registry.restoreAgent(agentId, "DifferentNick");
    // Original nickname preserved — restore was a no-op
    expect(registry.getNickname(agentId)).toBe(nickname);
  });

  it("restored agents do not count toward maxAgents", () => {
    const registry = new AgentRegistry(
      makeCollabDeps({
        maxAgents: 2,
        sessionManagerFactory: makeMockSessionManagerFactory(makeAssistant("ok")),
      }),
    );
    registry.restoreAgent("agent-old-1", "Old1");
    registry.restoreAgent("agent-old-2", "Old2");
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
          return makeMockSessionManagerFactory(makeAssistant("ok"))(config);
        },
      }),
    );
    registry.spawn({ prompt: "test", description: "", agentType: "general" });
    expect(capturedConfig?.parentSession).toBe("parent-xyz");
  });
});
