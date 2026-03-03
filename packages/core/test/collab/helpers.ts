// @summary Test helpers for collab tests: mock SessionManager and stream factories

import type { AgentEvent } from "../../src/agent/types";
import type { CollabToolDeps } from "../../src/collab/types";
import { EventStream } from "../../src/event-stream";
import type { DiligentPaths } from "../../src/infrastructure/diligent-dir";
import type { Model, ProviderEvent, ProviderResult, StreamFunction } from "../../src/provider/types";
import type { SessionManagerConfig } from "../../src/session/manager";
import type { AssistantMessage, Message } from "../../src/types";

export const TEST_MODEL: Model = {
  id: "test-model",
  provider: "test",
  contextWindow: 100_000,
  maxOutputTokens: 4096,
};

export const TEST_PATHS: DiligentPaths = {
  root: "/tmp/collab-test",
  sessions: "/tmp/collab-test/.diligent/sessions",
  knowledge: "/tmp/collab-test/.diligent/knowledge",
  skills: "/tmp/collab-test/.diligent/skills",
};

export function makeAssistant(text = "done"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    model: TEST_MODEL.id,
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

export function makeStreamFn(responses: AssistantMessage[]): StreamFunction {
  let callIndex = 0;
  return (_model, _ctx, _opts) => {
    const msg = responses[callIndex++] ?? makeAssistant();
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (e) => e.type === "done" || e.type === "error",
      (e) => {
        if (e.type === "done") return { message: e.message };
        throw (e as { type: "error"; error: Error }).error;
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

export function makeErrorStreamFn(errorMsg = "Provider error"): StreamFunction {
  return (_model, _ctx, _opts) => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (e) => e.type === "done" || e.type === "error",
      (e) => {
        if (e.type === "done") return { message: (e as { type: "done"; message: AssistantMessage }).message };
        throw (e as { type: "error"; error: Error }).error;
      },
    );
    queueMicrotask(() => {
      stream.push({ type: "error", error: new Error(errorMsg) });
    });
    return stream;
  };
}

/**
 * Create a controllable mock SessionManager factory.
 * The factory returns mock session managers that produce a fixed EventStream.
 */
export function makeMockSessionManagerFactory(
  response: AssistantMessage | Error,
): CollabToolDeps["sessionManagerFactory"] {
  return (_config: SessionManagerConfig) => {
    const assistantMsg = response instanceof Error ? makeAssistant("error fallback") : response;
    const shouldError = response instanceof Error;
    const errorMsg = response instanceof Error ? response.message : "";

    return {
      entries: [] as import("../../src/session/types").SessionEntry[],
      leafId: null as string | null,
      create: async () => {},
      resume: async () => false,
      list: async () => [],
      getContext: () => [] as Message[],
      run: (_userMessage: Message) => {
        const outerStream = new EventStream<AgentEvent, Message[]>(
          (e) => e.type === "agent_end",
          (e) => (e as { type: "agent_end"; messages: Message[] }).messages,
        );

        queueMicrotask(async () => {
          outerStream.push({ type: "agent_start" });
          if (shouldError) {
            outerStream.push({
              type: "error",
              error: { message: errorMsg, name: "Error" },
              fatal: true,
            });
          } else {
            const itemId = "mock-item-1";
            outerStream.push({ type: "message_start", itemId, message: assistantMsg });
            outerStream.push({ type: "message_end", itemId, message: assistantMsg });
          }
          outerStream.push({ type: "agent_end", messages: [] });
          outerStream.end([]);
        });
        return outerStream;
      },
      waitForWrites: async () => {},
      steer: (_content: string) => {},
      followUp: (_content: string) => {},
      hasFollowUp: () => false,
      appendModeChange: () => {},
      get sessionPath(): string | null {
        return null;
      },
      get sessionId(): string {
        return "mock-session-id";
      },
      get entryCount(): number {
        return 0;
      },
    } as unknown as import("../../src/session/manager").SessionManager;
  };
}

export function makeCollabDeps(overrides: Partial<CollabToolDeps> = {}): CollabToolDeps {
  return {
    cwd: "/tmp/collab-test",
    paths: TEST_PATHS,
    model: TEST_MODEL,
    systemPrompt: "You are a helpful agent.",
    streamFunction: makeStreamFn([makeAssistant("sub-agent done")]),
    parentTools: [],
    maxAgents: 8,
    ...overrides,
  };
}
