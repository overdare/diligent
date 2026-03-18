// @summary Hydrates web thread render state from thread/read payload history

import {
  type ChildSession,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  ProtocolNotificationAdapter,
  type ThreadItem,
  type ThreadReadResponse,
} from "@diligent/protocol";
import type { PlanState, ThreadState } from "./thread-store";
import { reduceServerNotification } from "./thread-store";
import { parsePlanOutput, stringifyUnknown, updateItem, withItem, zeroUsage } from "./thread-utils";

function extractChildTools(child: ChildSession): Array<{
  toolCallId: string;
  toolName: string;
  status: "done";
  isError: boolean;
  inputText: string;
  outputText: string;
}> {
  const inputMap = new Map<string, unknown>();
  for (const msg of child.messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "object" && block !== null && "type" in block && block.type === "tool_call") {
          const tb = block as { id: string; input: unknown };
          inputMap.set(tb.id, tb.input);
        }
      }
    }
  }

  const tools: Array<{
    toolCallId: string;
    toolName: string;
    status: "done";
    isError: boolean;
    inputText: string;
    outputText: string;
  }> = [];
  for (const msg of child.messages) {
    if (msg.role === "tool_result") {
      const toolCallId = (msg as { toolCallId: string }).toolCallId;
      tools.push({
        toolCallId,
        toolName: (msg as { toolName: string }).toolName,
        status: "done",
        isError: (msg as { isError: boolean }).isError,
        inputText: stringifyUnknown(inputMap.get(toolCallId)),
        outputText: typeof (msg as { output?: string }).output === "string" ? (msg as { output: string }).output : "",
      });
    }
  }
  return tools;
}

function extractChildMessages(child: ChildSession): string[] {
  const messages: string[] = [];
  for (const msg of child.messages) {
    if (msg.role === "assistant") {
      messages.push(stringifyUnknown(msg));
    }
  }
  return messages;
}

function extractChildTimeline(child: ChildSession): Array<
  | {
      kind: "assistant";
      message: string;
    }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      status: "done";
      isError: boolean;
      inputText: string;
      outputText: string;
    }
> {
  const inputMap = new Map<string, unknown>();
  for (const msg of child.messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "object" && block !== null && "type" in block && block.type === "tool_call") {
          const tb = block as { id: string; input: unknown };
          inputMap.set(tb.id, tb.input);
        }
      }
    }
  }

  const timeline: Array<
    | {
        kind: "assistant";
        message: string;
      }
    | {
        kind: "tool";
        toolCallId: string;
        toolName: string;
        status: "done";
        isError: boolean;
        inputText: string;
        outputText: string;
      }
  > = [];

  for (const msg of child.messages) {
    if (msg.role === "assistant") {
      timeline.push({
        kind: "assistant",
        message: stringifyUnknown(msg),
      });
      continue;
    }

    if (msg.role === "tool_result") {
      const toolCallId = (msg as { toolCallId: string }).toolCallId;
      timeline.push({
        kind: "tool",
        toolCallId,
        toolName: (msg as { toolName: string }).toolName,
        status: "done",
        isError: (msg as { isError: boolean }).isError,
        inputText: stringifyUnknown(inputMap.get(toolCallId)),
        outputText: typeof (msg as { output?: string }).output === "string" ? (msg as { output: string }).output : "",
      });
    }
  }

  return timeline;
}

function parseSpawnOutput(output: string): { threadId?: string; nickname?: string } {
  try {
    const parsed = JSON.parse(output) as { thread_id?: string; nickname?: string };
    return { threadId: parsed.thread_id, nickname: parsed.nickname };
  } catch {
    return {};
  }
}

function parseWaitOutput(
  output: string,
): { agents: Array<{ threadId: string; status?: string; message?: string }>; timedOut: boolean } | null {
  try {
    const parsed = JSON.parse(output) as {
      status?: Record<string, { kind?: string; output?: string; error?: string }>;
      timed_out?: boolean;
    };
    if (!parsed.status) return null;
    const agents = Object.entries(parsed.status).map(([threadId, s]) => ({
      threadId,
      status: s.kind,
      message: s.output ?? s.error,
    }));
    return { agents, timedOut: parsed.timed_out ?? false };
  } catch {
    return null;
  }
}

function parseCloseOutput(output: string): { threadId?: string; nickname?: string; status?: string } {
  try {
    const parsed = JSON.parse(output) as { thread_id?: string; nickname?: string; final_status?: { kind?: string } };
    return { threadId: parsed.thread_id, nickname: parsed.nickname, status: parsed.final_status?.kind };
  } catch {
    return {};
  }
}

function setSpawnStatus(state: ThreadState, threadId: string, status: string): ThreadState {
  const spawn = state.items
    .filter((item) => item.kind === "collab" && item.eventType === "spawn" && item.childThreadId === threadId)
    .at(-1);
  if (!spawn || spawn.kind !== "collab") return state;
  return updateItem(state, spawn.id, (item) =>
    item.kind === "collab" && item.eventType === "spawn" ? { ...item, status } : item,
  );
}

function hydrateFromSnapshotItems(state: ThreadState, payload: ThreadReadResponse): ThreadState {
  const adapter = new ProtocolNotificationAdapter();
  const childBySessionId = new Map<string, ChildSession>();
  const childByNickname = new Map<string, ChildSession>();
  for (const child of payload.childSessions ?? []) {
    childBySessionId.set(child.sessionId, child);
    if (child.nickname) childByNickname.set(child.nickname, child);
  }

  const spawnToolCallToThreadId = new Map<string, string>();

  let current: ThreadState = {
    ...state,
    activeThreadCwd: payload.cwd,
    items: [],
    seenKeys: {},
    itemSlots: {},
    pendingSteers: [],
    activeTurnId: null,
    activeTurnStartedAt: null,
    activeReasoningStartedAt: null,
    activeReasoningDurationMs: 0,
    threadStatus: payload.isRunning ? "busy" : "idle",
    planState: null,
    usage: { ...zeroUsage },
    currentContextTokens: 0,
  };

  const applyItem = (method: "item/started" | "item/completed", item: ThreadItem): void => {
    const notification = {
      method,
      params: {
        threadId: state.activeThreadId ?? "hydrate",
        turnId: "hydrate",
        item,
      },
    } as const;
    const events = adapter.toAgentEvents(notification);
    current = reduceServerNotification(current, notification, events);
  };

  for (const error of payload.errors ?? []) {
    current = withItem(current, `history:error:${error.id}`, {
      id: `history:error:${error.id}`,
      kind: "error",
      message: error.error.message,
      name: error.error.name,
      fatal: error.fatal,
      turnId: error.turnId,
      timestamp: Date.parse(error.timestamp),
    });
  }

  for (const item of payload.items) {
    if (item.type === "userMessage") {
      const event = {
        type: "user_message" as const,
        itemId: item.itemId,
        message: item.message,
      };
      const notification = {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.AGENT_EVENT,
        params: {
          threadId: state.activeThreadId ?? "hydrate",
          turnId: "hydrate",
          event,
        },
      } as const;
      current = reduceServerNotification(current, notification, [event]);
      continue;
    }

    if (item.type === "agentMessage") {
      const usage = item.message.usage;
      const turnContextTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
      current = {
        ...current,
        usage: {
          ...current.usage,
          inputTokens: current.usage.inputTokens + usage.inputTokens,
          outputTokens: current.usage.outputTokens + usage.outputTokens,
          cacheReadTokens: current.usage.cacheReadTokens + usage.cacheReadTokens,
          cacheWriteTokens: current.usage.cacheWriteTokens + usage.cacheWriteTokens,
        },
        currentContextTokens: turnContextTokens > 0 ? turnContextTokens : current.currentContextTokens,
      };
      applyItem("item/started", item);
      applyItem("item/completed", item);
      continue;
    }

    if (item.type === "toolCall") {
      if (item.toolName === "spawn_agent" && typeof item.output === "string") {
        const spawn = parseSpawnOutput(item.output);
        const child =
          (spawn.threadId ? childBySessionId.get(spawn.threadId) : undefined) ??
          (spawn.nickname ? childByNickname.get(spawn.nickname) : undefined);
        const childThreadId = spawn.threadId ?? child?.sessionId;
        if (childThreadId) {
          spawnToolCallToThreadId.set(item.toolCallId, childThreadId);
        }
        current = withItem(current, `history:collab:spawn:${item.toolCallId}`, {
          id: `history:collab:spawn:${item.toolCallId}`,
          kind: "collab",
          eventType: "spawn",
          childThreadId,
          nickname: spawn.nickname ?? child?.nickname,
          agentType:
            typeof (item.input as { agent_type?: unknown })?.agent_type === "string"
              ? (item.input as { agent_type: string }).agent_type
              : undefined,
          description: child?.description ?? (item.input as { description?: string })?.description,
          prompt:
            typeof (item.input as { message?: unknown })?.message === "string"
              ? (item.input as { message: string }).message
              : undefined,
          status: "running",
          childTools: child ? extractChildTools(child) : [],
          childMessages: child ? extractChildMessages(child) : undefined,
          childTimeline: child ? extractChildTimeline(child) : undefined,
          timestamp: item.timestamp ?? item.startedAt ?? Date.now(),
        });
        continue;
      }

      if (item.toolName === "wait" && typeof item.output === "string") {
        const waitData = parseWaitOutput(item.output);
        const agents = waitData?.agents.map((agent) => {
          const child = childBySessionId.get(agent.threadId);
          return {
            threadId: agent.threadId,
            nickname: child?.nickname,
            status: agent.status,
            message: agent.message,
          };
        });
        current = withItem(current, `history:collab:wait:${item.toolCallId}`, {
          id: `history:collab:wait:${item.toolCallId}`,
          kind: "collab",
          eventType: "wait",
          agents,
          timedOut: waitData?.timedOut,
          childTools: [],
          childTimeline: undefined,
          timestamp: item.timestamp ?? item.startedAt ?? Date.now(),
        });
        for (const agent of waitData?.agents ?? []) {
          if (agent.status === "completed" || agent.status === "errored" || agent.status === "shutdown") {
            current = setSpawnStatus(current, agent.threadId, agent.status);
          }
        }
        continue;
      }

      if (item.toolName === "close_agent" && typeof item.output === "string") {
        const close = parseCloseOutput(item.output);
        const resolvedThreadId =
          close.threadId ??
          (close.nickname ? childByNickname.get(close.nickname)?.sessionId : undefined) ??
          spawnToolCallToThreadId.get(item.toolCallId);
        if (resolvedThreadId && close.status) {
          current = setSpawnStatus(current, resolvedThreadId, close.status);
        }
        current = withItem(current, `history:collab:close:${item.toolCallId}`, {
          id: `history:collab:close:${item.toolCallId}`,
          kind: "collab",
          eventType: "close",
          nickname: close.nickname,
          status: close.status,
          childTools: [],
          childTimeline: undefined,
          timestamp: item.timestamp ?? item.startedAt ?? Date.now(),
        });
        continue;
      }

      applyItem("item/started", item);
      if (typeof item.output === "string") {
        applyItem("item/completed", item);
      }
      continue;
    }

    if (item.type === "compaction") {
      current = withItem(current, `history:context:${item.itemId}`, {
        id: `history:context:${item.itemId}`,
        kind: "context",
        summary: item.summary,
        timestamp: item.timestamp ?? Date.now(),
      });
      continue;
    }

    if (item.type === "collabEvent") {
      current = withItem(current, `history:collab:${item.itemId}`, {
        id: `history:collab:${item.itemId}`,
        kind: "collab",
        eventType: item.eventKind,
        childThreadId: item.childThreadId,
        nickname: item.nickname,
        description: item.description,
        status: item.status,
        message: item.message,
        agents: item.agents,
        timedOut: item.timedOut,
        childTools: [],
        childTimeline: undefined,
        timestamp: item.timestamp ?? Date.now(),
      });
    }
  }

  let lastPlan: PlanState | null = null;
  for (const item of payload.items) {
    if (item.type === "toolCall" && item.toolName === "plan" && typeof item.output === "string") {
      const plan = parsePlanOutput(item.output);
      if (plan) {
        const allResolved = plan.steps.every((s) => s.status === "done" || s.status === "cancelled");
        lastPlan = allResolved ? null : plan;
      }
    }
  }

  return {
    ...current,
    planState: lastPlan,
    usage: {
      ...current.usage,
      totalCost: payload.totalCost ?? current.usage.totalCost,
    },
  };
}

export function hydrateFromThreadRead(state: ThreadState, payload: ThreadReadResponse): ThreadState {
  return hydrateFromSnapshotItems(state, payload);
}
