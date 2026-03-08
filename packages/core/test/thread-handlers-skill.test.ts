// @summary Tests slash skill invocation rewrite in thread/turn start handler
import { describe, expect, it } from "bun:test";
import type { DiligentServerNotification } from "@diligent/protocol";
import { handleTurnStart, type ThreadRuntime } from "../src/app-server/thread-handlers";
import { EventStream } from "../src/event-stream";
import type { DiligentPaths } from "../src/infrastructure/diligent-dir";

describe("handleTurnStart slash skill rewriting", () => {
  it("rewrites /skill-name messages into a forced skill-tool instruction", async () => {
    let capturedUserMessage: { content: string | unknown[] } | null = null;

    const runtime: ThreadRuntime = {
      id: "thread-1",
      cwd: "/tmp/project",
      mode: "default",
      effort: "medium",
      manager: {
        run: (userMessage: { content: string | unknown[] }) => {
          capturedUserMessage = userMessage;
          return new EventStream(
            () => false,
            () => [],
          ) as ReturnType<ThreadRuntime["manager"]["run"]>;
        },
      } as ThreadRuntime["manager"],
      abortController: null,
      currentTurnId: null,
      isRunning: false,
    };

    const notifications: DiligentServerNotification[] = [];

    await handleTurnStart(
      {
        activeThreadId: "thread-1",
        threads: new Map([["thread-1", runtime]]),
        knownCwds: new Set(["/tmp/project"]),
        resolvePaths: async () =>
          ({
            root: "/tmp/project/.diligent",
            sessions: "/tmp/project/.diligent/sessions",
            knowledge: "/tmp/project/.diligent/knowledge",
            skills: "/tmp/project/.diligent/skills",
            images: "/tmp/project/.diligent/images",
          }) as DiligentPaths,
        createThreadRuntime: async () => runtime,
        resolveThreadRuntime: async () => runtime,
        getLatestEffortForCwd: async () => "medium",
        emit: async (notification) => {
          notifications.push(notification);
        },
        consumeStream: async () => {},
        resolveToolsContext: async () => ({ cwd: "/tmp/project", tools: undefined }),
        getSkillNames: () => ["tidy-plan"],
        setActiveThreadId: () => {},
      },
      {
        threadId: "thread-1",
        message: "/tidy-plan validate me",
      },
      undefined,
      new Map(),
    );

    expect(capturedUserMessage).not.toBeNull();
    expect(typeof capturedUserMessage?.content).toBe("string");
    const text = capturedUserMessage?.content as string;
    expect(text).toContain('call the "skill" tool with {"name":"tidy-plan"}');
    expect(text).toContain("validate me");
    expect(notifications.some((n) => n.method === "item/started")).toBe(true);
  });

  it("does not rewrite slash commands when name is not an available skill", async () => {
    let capturedUserMessage: { content: string | unknown[] } | null = null;

    const runtime: ThreadRuntime = {
      id: "thread-1",
      cwd: "/tmp/project",
      mode: "default",
      effort: "medium",
      manager: {
        run: (userMessage: { content: string | unknown[] }) => {
          capturedUserMessage = userMessage;
          return new EventStream(
            () => false,
            () => [],
          ) as ReturnType<ThreadRuntime["manager"]["run"]>;
        },
      } as ThreadRuntime["manager"],
      abortController: null,
      currentTurnId: null,
      isRunning: false,
    };

    await handleTurnStart(
      {
        activeThreadId: "thread-1",
        threads: new Map([["thread-1", runtime]]),
        knownCwds: new Set(["/tmp/project"]),
        resolvePaths: async () =>
          ({
            root: "/tmp/project/.diligent",
            sessions: "/tmp/project/.diligent/sessions",
            knowledge: "/tmp/project/.diligent/knowledge",
            skills: "/tmp/project/.diligent/skills",
            images: "/tmp/project/.diligent/images",
          }) as DiligentPaths,
        createThreadRuntime: async () => runtime,
        resolveThreadRuntime: async () => runtime,
        getLatestEffortForCwd: async () => "medium",
        emit: async () => {},
        consumeStream: async () => {},
        resolveToolsContext: async () => ({ cwd: "/tmp/project", tools: undefined }),
        getSkillNames: () => ["tidy-plan"],
        setActiveThreadId: () => {},
      },
      {
        threadId: "thread-1",
        message: "/help",
      },
      undefined,
      new Map(),
    );

    expect(capturedUserMessage).not.toBeNull();
    expect(capturedUserMessage?.content).toBe("/help");
  });
});
