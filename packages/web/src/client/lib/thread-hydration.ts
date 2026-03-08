// @summary Hydrates web thread render state from thread/read payload history

import { isSummaryMessage, SUMMARY_PREFIX } from "@diligent/core/client";
import type { ChildSession, ThreadReadResponse } from "@diligent/protocol";
import { toWebImageUrl } from "../../shared/image-routes";
import type { PlanState, RenderItem, ThreadState, UsageState } from "./thread-store";

const COLLAB_RENDERED_TOOLS = new Set(["spawn_agent", "wait", "close_agent"]);

const zeroUsage: UsageState = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
};

function addSeen(state: ThreadState, key: string): ThreadState {
  if (state.seenKeys[key]) return state;
  return {
    ...state,
    seenKeys: {
      ...state.seenKeys,
      [key]: true,
    },
  };
}

function withItem(state: ThreadState, key: string, item: RenderItem): ThreadState {
  const seenState = addSeen(state, key);
  if (seenState === state) return state;
  return {
    ...seenState,
    items: [...seenState.items, item],
  };
}

function updateItem(state: ThreadState, itemId: string, updater: (item: RenderItem) => RenderItem): ThreadState {
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index < 0) return state;

  const nextItems = [...state.items];
  nextItems[index] = updater(nextItems[index]);
  return {
    ...state,
    items: nextItems,
  };
}

function stringifyUnknown(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractUserTextAndImages(content: unknown): {
  text: string;
  images: Array<{ url: string; fileName?: string; mediaType?: string }>;
} {
  if (typeof content === "string") {
    return { text: content, images: [] };
  }
  if (!Array.isArray(content)) {
    return { text: stringifyUnknown(content), images: [] };
  }

  const textParts: string[] = [];
  const images: Array<{ url: string; fileName?: string; mediaType?: string }> = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || !("type" in block)) continue;
    if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
      textParts.push((block as { text: string }).text);
    }
    if (block.type === "local_image") {
      const b = block as { path: string; fileName?: string; mediaType?: string };
      images.push({ url: toWebImageUrl(b.path), fileName: b.fileName, mediaType: b.mediaType });
    }
  }

  return { text: textParts.join("\n\n"), images };
}

function parsePlanOutput(output: string): PlanState | null | "closed" {
  try {
    const parsed = JSON.parse(output) as {
      closed?: boolean;
      title?: string;
      steps?: Array<{ text: string; status?: "pending" | "in_progress" | "done" }>;
    };
    if (parsed?.closed) return "closed";
    if (parsed && Array.isArray(parsed.steps)) {
      return {
        title: parsed.title ?? "Plan",
        steps: parsed.steps.map((s) => ({
          text: s.text,
          status: s.status ?? "pending",
        })),
      };
    }
  } catch {
    // not valid plan JSON
  }
  return null;
}

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
      const blocks = (msg as { content: Array<{ type: string; text?: string }> }).content;
      const text = blocks
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("");
      if (text.trim()) messages.push(text.trim());
    }
  }
  return messages;
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

function isFinalCollabStatus(status: string | undefined): status is "completed" | "errored" | "shutdown" {
  return status === "completed" || status === "errored" || status === "shutdown";
}

function parseCloseOutput(output: string): { threadId?: string; nickname?: string; status?: string } {
  try {
    const parsed = JSON.parse(output) as { thread_id?: string; nickname?: string; final_status?: { kind?: string } };
    return { threadId: parsed.thread_id, nickname: parsed.nickname, status: parsed.final_status?.kind };
  } catch {
    return {};
  }
}

export function hydrateFromThreadRead(state: ThreadState, payload: ThreadReadResponse): ThreadState {
  const resolvedToolCallIds = new Set<string>();
  if (payload.isRunning) {
    for (const message of payload.messages) {
      if (message.role === "tool_result") {
        resolvedToolCallIds.add((message as { toolCallId: string }).toolCallId);
      }
    }
  }

  const childBySessionId = new Map<string, ChildSession>();
  const childByNickname = new Map<string, ChildSession>();
  for (const child of payload.childSessions ?? []) {
    childBySessionId.set(child.sessionId, child);
    if (child.nickname) childByNickname.set(child.nickname, child);
  }

  const spawnResultByToolCallId = new Map<string, { threadId: string; nickname?: string; child?: ChildSession }>();
  const settledThreadIds = new Set<string>();
  const finalStatusByThreadId = new Map<string, string>();
  for (const message of payload.messages) {
    if (message.role === "tool_result" && message.toolName === "spawn_agent") {
      const { threadId, nickname } = parseSpawnOutput(message.output);
      if (threadId) {
        const child = childBySessionId.get(threadId) ?? (nickname ? childByNickname.get(nickname) : undefined);
        spawnResultByToolCallId.set(message.toolCallId, { threadId, nickname, child });
      }
    }
    if (message.role === "tool_result" && message.toolName === "wait") {
      const waitData = parseWaitOutput(message.output);
      if (waitData) {
        for (const a of waitData.agents) {
          // wait() timeout can report non-final snapshots (pending/running).
          // Only final statuses should settle spawn rows during hydration.
          if (isFinalCollabStatus(a.status)) {
            settledThreadIds.add(a.threadId);
            finalStatusByThreadId.set(a.threadId, a.status);
          }
        }
      }
    }
    if (message.role === "tool_result" && message.toolName === "close_agent") {
      const close = parseCloseOutput(message.output);
      const resolvedThreadId =
        close.threadId ?? (close.nickname ? childByNickname.get(close.nickname)?.sessionId : undefined);
      if (resolvedThreadId) {
        settledThreadIds.add(resolvedThreadId);
        if (close.status) finalStatusByThreadId.set(resolvedThreadId, close.status);
      }
    }
  }

  const hydratedUsage: UsageState = { ...zeroUsage };
  let lastInputTokens = 0;
  for (const message of payload.messages) {
    if (message.role === "assistant") {
      const u = (
        message as {
          usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
        }
      ).usage;
      if (u) {
        hydratedUsage.inputTokens += u.inputTokens;
        hydratedUsage.outputTokens += u.outputTokens;
        hydratedUsage.cacheReadTokens += u.cacheReadTokens;
        hydratedUsage.cacheWriteTokens += u.cacheWriteTokens;
        if (u.inputTokens > 0) lastInputTokens = u.inputTokens;
      }
    }
  }

  const base: ThreadState = {
    ...state,
    items: [],
    seenKeys: {},
    itemSlots: {},
    usage: hydratedUsage,
    currentContextTokens: lastInputTokens,
    planState: null,
    pendingSteers: [],
    threadStatus: payload.isRunning ? "busy" : "idle",
  };

  let current = base;

  for (const message of payload.messages) {
    if (message.role === "user") {
      if (isSummaryMessage(message)) {
        const summary = (message.content as string).slice(SUMMARY_PREFIX.length + 1);
        current = withItem(current, `history:context:${message.timestamp}`, {
          id: `history:context:${message.timestamp}`,
          kind: "context",
          summary,
          timestamp: message.timestamp,
        });
        continue;
      }
      const { text, images } = extractUserTextAndImages(message.content);
      current = withItem(current, `history:user:${message.timestamp}`, {
        id: `history:user:${message.timestamp}`,
        kind: "user",
        text,
        images,
        timestamp: message.timestamp,
      });
      continue;
    }

    if (message.role === "assistant") {
      let text = "";
      let thinking = "";
      for (const block of message.content) {
        if (block.type === "text") text += block.text;
        if (block.type === "thinking") thinking += block.thinking;
      }

      current = withItem(current, `history:assistant:${message.timestamp}`, {
        id: `history:assistant:${message.timestamp}`,
        kind: "assistant",
        text,
        thinking,
        thinkingDone: true,
        timestamp: message.timestamp,
      });

      for (const block of message.content) {
        if (block.type !== "tool_call") continue;
        if (block.name === "spawn_agent") {
          const spawnInfo = spawnResultByToolCallId.get(block.id);
          const child = spawnInfo?.child;
          const childThreadId = spawnInfo?.threadId ?? child?.sessionId;
          const isSettled = childThreadId ? settledThreadIds.has(childThreadId) : false;
          const spawnStatus = childThreadId ? (finalStatusByThreadId.get(childThreadId) ?? "running") : "running";
          current = withItem(current, `history:collab:spawn:${block.id}`, {
            id: `history:collab:spawn:${block.id}`,
            kind: "collab",
            eventType: "spawn",
            childThreadId,
            nickname: spawnInfo?.nickname ?? child?.nickname,
            description: child?.description ?? (block.input as { description?: string })?.description,
            status: isSettled ? spawnStatus : "running",
            childTools: child ? extractChildTools(child) : [],
            childMessages: child ? extractChildMessages(child) : undefined,
            timestamp: message.timestamp,
          });
          continue;
        }
        if (COLLAB_RENDERED_TOOLS.has(block.name)) continue;

        const inProgress = payload.isRunning && !resolvedToolCallIds.has(block.id);
        current = withItem(current, `history:toolcall:${block.id}:${message.timestamp}`, {
          id: `history:tool:${block.id}`,
          kind: "tool",
          toolName: block.name,
          inputText: stringifyUnknown(block.input),
          outputText: "",
          isError: false,
          status: inProgress ? "streaming" : "done",
          timestamp: message.timestamp,
          toolCallId: block.id,
          startedAt: message.timestamp,
        });
      }
      continue;
    }

    if (message.toolName === "wait") {
      const waitData = parseWaitOutput(message.output);
      const agents = waitData?.agents.map((a) => {
        const child = childBySessionId.get(a.threadId);
        return {
          threadId: a.threadId,
          nickname: child?.nickname,
          status: a.status,
          message: a.message ? a.message.split("\n")[0].slice(0, 160) : undefined,
        };
      });
      current = withItem(current, `history:collab:wait:${message.toolCallId}`, {
        id: `history:collab:wait:${message.toolCallId}`,
        kind: "collab",
        eventType: "wait",
        agents,
        timedOut: waitData?.timedOut,
        childTools: [],
        timestamp: message.timestamp,
      });
      continue;
    }

    if (message.toolName === "close_agent") {
      const closeData = parseCloseOutput(message.output);
      current = withItem(current, `history:collab:close:${message.toolCallId}`, {
        id: `history:collab:close:${message.toolCallId}`,
        kind: "collab",
        eventType: "close",
        nickname: closeData.nickname,
        status: closeData.status,
        childTools: [],
        timestamp: message.timestamp,
      });
      continue;
    }

    if (message.toolName === "spawn_agent") {
      continue;
    }

    const existingToolItem = current.items.find(
      (item) => item.kind === "tool" && item.toolCallId === message.toolCallId,
    );

    const msgRender = (message as { render?: import("@diligent/protocol").ToolRenderPayload }).render;

    if (existingToolItem?.kind === "tool") {
      current = updateItem(current, existingToolItem.id, (item) =>
        item.kind === "tool"
          ? {
              ...item,
              outputText: message.output,
              isError: message.isError,
              status: "done",
              timestamp: message.timestamp,
              durationMs: Math.max(0, message.timestamp - item.startedAt),
              render: msgRender ?? item.render,
            }
          : item,
      );
      continue;
    }

    current = withItem(current, `history:tool:${message.toolCallId}:${message.timestamp}`, {
      id: `history:tool:${message.toolCallId}`,
      kind: "tool",
      toolName: message.toolName,
      inputText: "",
      outputText: message.output,
      isError: message.isError,
      status: "done",
      timestamp: message.timestamp,
      toolCallId: message.toolCallId,
      startedAt: message.timestamp,
      durationMs: 0,
      render: msgRender,
    });
  }

  let lastPlan: PlanState | null = null;
  for (const message of payload.messages) {
    if (message.role === "tool_result" && message.toolName === "plan") {
      const plan = parsePlanOutput(message.output);
      if (plan === "closed") {
        lastPlan = null;
      } else if (plan) {
        lastPlan = plan;
      }
    }
  }
  current = { ...current, planState: lastPlan };

  return current;
}
