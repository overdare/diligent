// @summary App-level thread state reducer and actions extracted from App orchestrator

import type {
  AgentEvent,
  ClientError,
  DiligentServerNotification,
  LocalImageBlock,
  Mode,
  PendingSteer,
  SessionSummary,
  ThreadGoalResponse,
  ThreadHistoryResponse,
  ThreadReadResponse,
} from "@diligent/protocol";
import { normalizeToolName } from "@diligent/protocol";
import { applyGoalSnapshot, mergeHistoryItems } from "@diligent/runtime/client";
import type { AgentContextItem } from "./agent-native-bridge";
import {
  createErrorRenderItem,
  hydrateFromThreadRead,
  initialThreadState,
  type RenderItem,
  reduceServerNotification,
  type ThreadState,
} from "./thread-store";
import { COLLAB_RENDERED_TOOLS } from "./thread-utils";

export type PendingImage = LocalImageBlock & { webUrl: string };

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Collab records resolve against other records (a later wait or close settles an earlier spawn's status),
 * so a page containing them is hydrated together with everything already loaded.
 */
function pageNeedsFullHydration(items: ThreadHistoryResponse["items"]): boolean {
  return items.some(
    (item) =>
      item.type === "collabEvent" ||
      (item.type === "toolCall" && COLLAB_RENDERED_TOOLS.has(normalizeToolName(item.toolName))),
  );
}

/** Re-hydrated items that did not change keep their identity so their rows skip rendering. */
function keepIfUnchanged(next: RenderItem, live: RenderItem): RenderItem {
  return sameValue(next, live) ? live : next;
}

export type AppAction =
  | { type: "notification"; payload: { notification: DiligentServerNotification; events: AgentEvent[] } }
  | { type: "hydrate"; payload: { threadId: string; mode: Mode; history: ThreadReadResponse } }
  | { type: "select_history"; payload: { threadId: string } }
  | { type: "history_page"; payload: { threadId: string; page: ThreadHistoryResponse; older?: boolean } }
  | { type: "thread_metadata"; payload: { threadId: string; history: ThreadReadResponse } }
  | { type: "reset_draft"; payload: { mode: Mode } }
  | { type: "set_threads"; payload: SessionSummary[] }
  | { type: "set_mode"; payload: Mode }
  | {
      type: "local_user";
      payload: { id: string; text: string; images: PendingImage[]; contextItems?: AgentContextItem[] };
    }
  | { type: "bind_user_message_id"; payload: { renderItemId: string; messageId: string } }
  | { type: "local_steer"; payload: PendingSteer }
  | { type: "cancel_pending_steer"; payload: { steerId: string } }
  | { type: "update_pending_steer"; payload: { steerId: string; content: string } }
  | { type: "consume_first_pending_steer" }
  | { type: "optimistic_thread"; payload: { threadId: string; message: string } }
  | { type: "show_info_toast"; payload: string }
  | { type: "clear_toast" }
  | { type: "client_error"; payload: { id: string; error: ClientError } }
  | { type: "compaction_error" }
  | { type: "set_goal_snapshot"; payload: ThreadGoalResponse & { threadId: string } };

export function appReducer(state: ThreadState, action: AppAction): ThreadState {
  const isDraftOptimisticThread = (thread: SessionSummary): boolean =>
    thread.path.length === 0 &&
    thread.cwd.length === 0 &&
    (thread.messageCount ?? 0) <= 1 &&
    Boolean(thread.firstUserMessage);
  const isVisibleThread = (thread: SessionSummary): boolean => {
    if (thread.messageCount === undefined || thread.messageCount > 0) return true;
    if (thread.firstUserMessage) return true;
    return false;
  };

  if (action.type === "notification")
    return reduceServerNotification(state, action.payload.notification, action.payload.events);
  if (action.type === "select_history") {
    return {
      ...initialThreadState,
      activeThreadId: action.payload.threadId,
      runtimeReady: false,
      threadList: state.threadList,
    };
  }
  if (action.type === "history_page") {
    const { threadId, page, older } = action.payload;
    if (state.activeThreadId !== threadId) return state;
    let disjointRecentPage = false;
    if (!older && state.historyLoaded && page.items.length > 0) {
      const previous = new Map(state.historyItems.map((item) => [item.itemId, item]));
      disjointRecentPage = !page.items.some((item) => {
        const known = previous.get(item.itemId);
        if (!known) return false;
        // Tool starts and results share an ID but are different persisted records.
        return (
          item.type !== "toolCall" ||
          (known.type === "toolCall" &&
            known.timestamp === item.timestamp &&
            typeof known.output === typeof item.output)
        );
      });
    }
    const historyItems = older
      ? mergeHistoryItems(page.items, state.historyItems)
      : mergeHistoryItems(state.historyItems, page.items);
    // Re-hydrating everything per older page grows with the loaded history and stalls fast scrolling;
    // a self-contained older page is hydrated alone and merged in front of the existing items.
    const pageOnly = older && state.historyLoaded && !pageNeedsFullHydration(page.items);
    const hydrated = hydrateFromThreadRead(state, {
      cwd: page.cwd,
      items: pageOnly ? page.items : historyItems,
      hasFollowUp: false,
      entryCount: 0,
      isRunning: state.threadStatus === "busy",
      currentEffort: "medium",
    });
    const key = (item: RenderItem): string =>
      item.kind === "tool"
        ? `tool:${item.toolCallId}`
        : (item.kind === "user" || item.kind === "assistant") && item.messageId
          ? `${item.kind}:${item.messageId}`
          : item.id;
    const current = new Map(state.items.map((item) => [key(item), item]));
    const mergeLive = (item: RenderItem, live: RenderItem): RenderItem => {
      // Prepending must not rewind streaming output or discard child-agent detail.
      if (live.kind === "collab" && item.kind === "collab") {
        if (older || state.threadStatus === "busy") return { ...item, ...live };
        return {
          ...item,
          childTools: live.childTools,
          childTimeline: live.childTimeline,
          childMessages: live.childMessages,
        };
      }
      if (older || state.threadStatus === "busy") {
        if (live.kind === "tool" && item.kind === "tool") {
          const completed = item.status === "done" && live.status !== "done";
          return {
            ...item,
            ...live,
            ...(completed
              ? {
                  outputText: item.outputText,
                  outputImages: item.outputImages,
                  durationMs: item.durationMs,
                  status: item.status,
                  isError: item.isError,
                }
              : {}),
            inputText:
              older || !live.inputText || live.inputText === "{}" ? item.inputText || live.inputText : live.inputText,
            render: older ? (item.render ?? live.render) : (live.render ?? item.render),
            startedAt: Math.min(item.startedAt, live.startedAt),
          };
        }
        return live;
      }
      return { ...item, id: live.id };
    };
    const items = hydrated.items.map((item) => {
      const live = current.get(key(item));
      current.delete(key(item));
      if (!live) return item;
      return keepIfUnchanged(mergeLive(item, live), live);
    });
    items.push(...current.values());
    return {
      ...state,
      activeThreadCwd: page.cwd,
      historyItems,
      items,
      historyLoaded: true,
      historyCursor: older || !state.historyLoaded || disjointRecentPage ? page.nextCursor : state.historyCursor,
      ...(!state.historyLoaded
        ? { usage: hydrated.usage, currentContextTokens: hydrated.currentContextTokens, planState: hydrated.planState }
        : {}),
      seenKeys: { ...hydrated.seenKeys, ...state.seenKeys },
      itemSlots: { ...hydrated.itemSlots, ...state.itemSlots },
    };
  }
  if (action.type === "thread_metadata") {
    if (state.activeThreadId !== action.payload.threadId) return state;
    const metadata = action.payload.history;
    const goal = applyGoalSnapshot(
      { goal: state.goal, sequence: state.goalSequence },
      { goal: metadata.goal ?? null, sequence: metadata.goalSequence ?? 0 },
    );
    return {
      ...state,
      runtimeReady: true,
      activeThreadCwd: metadata.cwd,
      mode: metadata.currentMode ?? state.mode,
      threadStatus: metadata.isRunning ? "busy" : "idle",
      ...(!metadata.isRunning
        ? {
            activeTurnId: null,
            activeTurnStartedAt: null,
            activeReasoningStartedAt: null,
            activeReasoningDurationMs: 0,
            isCompacting: false,
            itemSlots: {},
          }
        : {}),
      pendingSteers: metadata.pendingSteers ?? state.pendingSteers,
      usage: { ...state.usage, totalCost: metadata.totalCost ?? state.usage.totalCost },
      goal: goal.goal,
      goalSequence: goal.sequence,
    };
  }
  if (action.type === "hydrate") {
    const mode = action.payload.history.currentMode ?? action.payload.mode;
    const hydrated = hydrateFromThreadRead(
      {
        ...state,
        activeThreadId: action.payload.threadId,
        activeThreadCwd: action.payload.history.cwd,
        mode,
      },
      action.payload.history,
    );
    if (state.activeThreadId !== action.payload.threadId) return hydrated;
    const snapshot = applyGoalSnapshot(
      { goal: state.goal, sequence: state.goalSequence },
      { goal: hydrated.goal, sequence: hydrated.goalSequence },
    );
    return { ...hydrated, goal: snapshot.goal, goalSequence: snapshot.sequence };
  }
  if (action.type === "reset_draft") {
    return {
      ...initialThreadState,
      mode: action.payload.mode,
      threadList: state.threadList,
      pendingSteers: state.pendingSteers,
    };
  }
  if (action.type === "set_mode") return { ...state, mode: action.payload };
  if (action.type === "set_threads") {
    const optimisticMessages = new Map(
      state.threadList.filter((t) => t.firstUserMessage).map((t) => [t.id, t.firstUserMessage!]),
    );
    const serverThreadIds = new Set(action.payload.map((t) => t.id));
    const merged = action.payload
      .map((t) =>
        !t.firstUserMessage && optimisticMessages.has(t.id)
          ? { ...t, firstUserMessage: optimisticMessages.get(t.id) }
          : t,
      )
      .filter(isVisibleThread);
    const missingOptimistic = state.threadList.filter((t) => isDraftOptimisticThread(t) && !serverThreadIds.has(t.id));
    return { ...state, threadList: [...missingOptimistic, ...merged] };
  }
  if (action.type === "local_user") {
    const text = action.payload.text;
    const userItem: RenderItem = {
      id: action.payload.id,
      kind: "user",
      text,
      contextItems: action.payload.contextItems ?? [],
      images: action.payload.images.map((image) => ({
        url: image.webUrl,
        path: image.path,
        fileName: image.fileName,
        mediaType: image.mediaType,
      })),
      timestamp: Date.now(),
    };
    return { ...state, items: [...state.items, userItem] };
  }
  if (action.type === "bind_user_message_id") {
    return {
      ...state,
      items: state.items.map((item) =>
        item.kind === "user" && item.id === action.payload.renderItemId
          ? { ...item, messageId: action.payload.messageId }
          : item,
      ),
    };
  }
  if (action.type === "local_steer") {
    return { ...state, pendingSteers: [...state.pendingSteers, action.payload] };
  }
  if (action.type === "cancel_pending_steer") {
    return {
      ...state,
      pendingSteers: state.pendingSteers.filter((steer) => steer.id !== action.payload.steerId),
    };
  }
  if (action.type === "update_pending_steer") {
    return {
      ...state,
      pendingSteers: state.pendingSteers.map((steer) =>
        steer.id === action.payload.steerId ? { ...steer, content: action.payload.content } : steer,
      ),
    };
  }
  if (action.type === "consume_first_pending_steer") {
    return state.pendingSteers.length === 0 ? state : { ...state, pendingSteers: state.pendingSteers.slice(1) };
  }
  if (action.type === "optimistic_thread") {
    const { threadId, message } = action.payload;
    const now = new Date().toISOString();
    const existing = state.threadList.find((t) => t.id === threadId);
    if (existing) {
      if (existing.firstUserMessage) return state;
      return {
        ...state,
        threadList: state.threadList.map((t) =>
          t.id === threadId ? { ...t, firstUserMessage: message, modified: now } : t,
        ),
      };
    }
    const optimistic: SessionSummary = {
      id: threadId,
      path: "",
      cwd: "",
      created: now,
      modified: now,
      messageCount: 1,
      firstUserMessage: message,
    };
    return { ...state, threadList: [optimistic, ...state.threadList] };
  }
  if (action.type === "show_info_toast") {
    return {
      ...state,
      toast: {
        id: `info-${Date.now()}`,
        kind: "info",
        message: action.payload,
      },
    };
  }
  if (action.type === "clear_toast") return { ...state, toast: null };
  if (action.type === "client_error") {
    return {
      ...state,
      items: [...state.items, createErrorRenderItem(action.payload.id, action.payload.error, Date.now())],
    };
  }
  if (action.type === "compaction_error") return { ...state, isCompacting: false };
  if (action.type === "set_goal_snapshot") {
    if (action.payload.threadId !== state.activeThreadId) return state;
    const next = applyGoalSnapshot({ goal: state.goal, sequence: state.goalSequence }, action.payload);
    return { ...state, goal: next.goal, goalSequence: next.sequence };
  }
  return state;
}
