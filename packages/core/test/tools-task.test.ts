// @summary Tests for task tool sub-agent creation, tool filtering, resume, and result wrapping
import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStream } from "../src/event-stream";
import { resolvePaths } from "../src/infrastructure/diligent-dir";
import type { Model, ProviderEvent, ProviderResult, StreamFunction } from "../src/provider/types";
import type { Tool, ToolContext } from "../src/tool/types";
import { createTaskTool } from "../src/tools/task";
import type { AssistantMessage } from "../src/types";

const TEST_ROOT = join(tmpdir(), `diligent-task-test-${Date.now()}`);

const TEST_MODEL: Model = {
  id: "test-model",
  provider: "test",
  contextWindow: 100_000,
  maxOutputTokens: 4096,
};

function makeAssistant(text = "task done"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    model: TEST_MODEL.id,
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

function createMockStreamFn(responses: AssistantMessage[]): StreamFunction {
  let callIndex = 0;
  return (_model, _context, _options) => {
    const msg = responses[callIndex++] ?? makeAssistant();
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );
    queueMicrotask(() => {
      stream.push({ type: "start" });
      stream.push({ type: "text_delta", delta: msg.content[0].type === "text" ? msg.content[0].text : "" });
      stream.push({ type: "done", stopReason: "end_turn", message: msg });
    });
    return stream;
  };
}

function makeCtx(updates: string[] = []): ToolContext {
  return {
    toolCallId: "test-tc-1",
    signal: new AbortController().signal,
    approve: async () => "once" as const,
    onUpdate: (msg) => updates.push(msg),
  };
}

function makeDummyTool(name: string): Tool {
  const { z } = require("zod");
  return {
    name,
    description: `${name} tool`,
    parameters: z.object({}),
    execute: async () => ({ output: `${name} result` }),
  };
}

async function setupDir(): Promise<string> {
  const dir = join(TEST_ROOT, `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const paths = resolvePaths(dir);
  await mkdir(paths.sessions, { recursive: true });
  await mkdir(paths.knowledge, { recursive: true });
  await mkdir(paths.skills, { recursive: true });
  return dir;
}

afterEach(async () => {
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {}
});

describe("task tool", () => {
  it("creates and runs a sub-agent, wraps result in <task_result>", async () => {
    const dir = await setupDir();
    const response = makeAssistant("I have completed the analysis.");
    const tool = createTaskTool({
      cwd: dir,
      paths: resolvePaths(dir),
      model: TEST_MODEL,
      systemPrompt: "You are a helpful agent.",
      streamFunction: createMockStreamFn([response]),
      parentTools: [],
    });

    const result = await tool.execute(
      { description: "Analyze code", prompt: "Analyze the code", subagent_type: "general" },
      makeCtx(),
    );

    expect(result.output).toContain("<task_result");
    expect(result.output).toContain("I have completed the analysis.");
    expect(result.output).toContain("</task_result>");
    expect(result.metadata?.sessionId).toBeTruthy();
  });

  it("sessionId in output matches metadata", async () => {
    const dir = await setupDir();
    const tool = createTaskTool({
      cwd: dir,
      paths: resolvePaths(dir),
      model: TEST_MODEL,
      systemPrompt: "You are a helpful agent.",
      streamFunction: createMockStreamFn([makeAssistant("done")]),
      parentTools: [],
    });

    const result = await tool.execute(
      { description: "Test", prompt: "Test prompt", subagent_type: "general" },
      makeCtx(),
    );

    const sessionId = result.metadata?.sessionId as string;
    expect(result.output).toContain(`sessionId="${sessionId}"`);
  });

  describe("tool filtering (D064)", () => {
    it("general agent excludes the task tool itself", async () => {
      const dir = await setupDir();
      const capturedTools: string[] = [];

      const trackingStreamFn: StreamFunction = (_model, context, _options) => {
        capturedTools.push(...(context.tools ?? []).map((t) => t.name));
        const msg = makeAssistant("ok");
        const stream = new EventStream<ProviderEvent, ProviderResult>(
          (event) => event.type === "done" || event.type === "error",
          (event) => {
            if (event.type === "done") return { message: event.message };
            throw (event as { type: "error"; error: Error }).error;
          },
        );
        queueMicrotask(() => {
          stream.push({ type: "start" });
          stream.push({ type: "done", stopReason: "end_turn", message: msg });
        });
        return stream;
      };

      const taskTool = makeDummyTool("task");
      const readTool = makeDummyTool("read_file");
      const bashTool = makeDummyTool("bash");

      const tool = createTaskTool({
        cwd: dir,
        paths: resolvePaths(dir),
        model: TEST_MODEL,
        systemPrompt: "test",
        streamFunction: trackingStreamFn,
        parentTools: [taskTool, readTool, bashTool],
      });

      await tool.execute({ description: "test", prompt: "test", subagent_type: "general" }, makeCtx());

      expect(capturedTools).not.toContain("task");
      expect(capturedTools).toContain("read_file");
      expect(capturedTools).toContain("bash");
    });

    it("explore agent uses only PLAN_MODE_ALLOWED_TOOLS", async () => {
      const dir = await setupDir();
      const capturedTools: string[] = [];

      const trackingStreamFn: StreamFunction = (_model, context, _options) => {
        capturedTools.push(...(context.tools ?? []).map((t) => t.name));
        const msg = makeAssistant("explored");
        const stream = new EventStream<ProviderEvent, ProviderResult>(
          (event) => event.type === "done" || event.type === "error",
          (event) => {
            if (event.type === "done") return { message: event.message };
            throw (event as { type: "error"; error: Error }).error;
          },
        );
        queueMicrotask(() => {
          stream.push({ type: "start" });
          stream.push({ type: "done", stopReason: "end_turn", message: msg });
        });
        return stream;
      };

      const tool = createTaskTool({
        cwd: dir,
        paths: resolvePaths(dir),
        model: TEST_MODEL,
        systemPrompt: "test",
        streamFunction: trackingStreamFn,
        parentTools: [
          makeDummyTool("read_file"),
          makeDummyTool("glob"),
          makeDummyTool("grep"),
          makeDummyTool("ls"),
          makeDummyTool("bash"),
          makeDummyTool("write_file"),
        ],
      });

      await tool.execute({ description: "explore", prompt: "explore code", subagent_type: "explore" }, makeCtx());

      // PLAN_MODE_ALLOWED_TOOLS = read_file, glob, grep, ls
      expect(capturedTools).toContain("read_file");
      expect(capturedTools).toContain("glob");
      expect(capturedTools).toContain("grep");
      expect(capturedTools).toContain("ls");
      expect(capturedTools).not.toContain("bash");
      expect(capturedTools).not.toContain("write_file");
    });
  });

  it("explore agent prepends read-only system prompt prefix", async () => {
    const dir = await setupDir();
    const capturedPrompts: string[] = [];

    const trackingStreamFn: StreamFunction = (_model, context, _options) => {
      capturedPrompts.push(context.systemPrompt);
      const msg = makeAssistant("explored");
      const stream = new EventStream<ProviderEvent, ProviderResult>(
        (event) => event.type === "done" || event.type === "error",
        (event) => {
          if (event.type === "done") return { message: event.message };
          throw (event as { type: "error"; error: Error }).error;
        },
      );
      queueMicrotask(() => {
        stream.push({ type: "start" });
        stream.push({ type: "done", stopReason: "end_turn", message: msg });
      });
      return stream;
    };

    const tool = createTaskTool({
      cwd: dir,
      paths: resolvePaths(dir),
      model: TEST_MODEL,
      systemPrompt: "Base prompt.",
      streamFunction: trackingStreamFn,
      parentTools: [],
    });

    await tool.execute({ description: "explore", prompt: "look at code", subagent_type: "explore" }, makeCtx());

    expect(capturedPrompts[0]).toContain("read-only exploration agent");
    expect(capturedPrompts[0]).toContain("Base prompt.");
  });

  it("reports progress via onUpdate", async () => {
    const dir = await setupDir();
    const updates: string[] = [];
    const tool = createTaskTool({
      cwd: dir,
      paths: resolvePaths(dir),
      model: TEST_MODEL,
      systemPrompt: "test",
      streamFunction: createMockStreamFn([makeAssistant("done")]),
      parentTools: [],
    });

    await tool.execute({ description: "my task", prompt: "do something", subagent_type: "general" }, makeCtx(updates));

    // turn 1 is always emitted when the sub-agent loop starts
    expect(updates.some((u) => u.includes("turn 1"))).toBe(true);
  });

  it("resumes existing session when task_id provided", async () => {
    const dir = await setupDir();
    const streamFn = createMockStreamFn([makeAssistant("first"), makeAssistant("resumed")]);

    // First run — creates a session
    const tool1 = createTaskTool({
      cwd: dir,
      paths: resolvePaths(dir),
      model: TEST_MODEL,
      systemPrompt: "test",
      streamFunction: streamFn,
      parentTools: [],
    });

    const r1 = await tool1.execute(
      { description: "first run", prompt: "first prompt", subagent_type: "general" },
      makeCtx(),
    );

    const sessionId = r1.metadata?.sessionId as string;
    expect(sessionId).toBeTruthy();

    // Second run — resume with task_id
    const tool2 = createTaskTool({
      cwd: dir,
      paths: resolvePaths(dir),
      model: TEST_MODEL,
      systemPrompt: "test",
      streamFunction: streamFn,
      parentTools: [],
    });

    const r2 = await tool2.execute(
      { description: "resume run", prompt: "follow-up prompt", subagent_type: "general", task_id: sessionId },
      makeCtx(),
    );

    expect(r2.output).toContain("<task_result");
    expect(r2.output).toContain("resumed");
  });

  it("returns error result when sub-agent fails", async () => {
    const dir = await setupDir();

    const errorStreamFn: StreamFunction = (_model, _context, _options) => {
      const stream = new EventStream<ProviderEvent, ProviderResult>(
        (event) => event.type === "done" || event.type === "error",
        (event) => {
          if (event.type === "done") return { message: (event as { type: "done"; message: AssistantMessage }).message };
          throw (event as { type: "error"; error: Error }).error;
        },
      );
      queueMicrotask(() => {
        stream.push({ type: "error", error: new Error("Provider unavailable") });
      });
      return stream;
    };

    const tool = createTaskTool({
      cwd: dir,
      paths: resolvePaths(dir),
      model: TEST_MODEL,
      systemPrompt: "test",
      streamFunction: errorStreamFn,
      parentTools: [],
    });

    const result = await tool.execute(
      { description: "failing task", prompt: "fail please", subagent_type: "general" },
      makeCtx(),
    );

    expect(result.output).toContain("task_result");
    expect(result.metadata?.error).toBe(true);
  });
});
