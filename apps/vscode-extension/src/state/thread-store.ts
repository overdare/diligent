// @summary Extension-side thread/session store shared by the tree view and conversation webview
import type {
  DiligentServerNotification,
  InitializeResponse,
  SessionSummary,
  ThreadReadResponse,
  ThreadStatus,
} from "@diligent/protocol";

export type ExtensionConnectionState = "stopped" | "starting" | "ready" | "error";

export interface ExtensionThreadState {
  connection: ExtensionConnectionState;
  availableModels: InitializeResponse["availableModels"];
  activeThreadId: string | null;
  activeThreadStatus: ThreadStatus | null;
  threadStatuses: Record<string, ThreadStatus | null | undefined>;
  threads: SessionSummary[];
  threadReads: Record<string, ThreadReadResponse | undefined>;
  lastError: string | null;
}

type Listener = (state: ExtensionThreadState) => void;

export class ThreadStore {
  private state: ExtensionThreadState = {
    connection: "stopped",
    availableModels: [],
    activeThreadId: null,
    activeThreadStatus: null,
    threadStatuses: {},
    threads: [],
    threadReads: {},
    lastError: null,
  };

  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ExtensionThreadState {
    return {
      ...this.state,
      threads: [...this.state.threads],
      threadStatuses: { ...this.state.threadStatuses },
      threadReads: { ...this.state.threadReads },
    };
  }

  setConnection(connection: ExtensionConnectionState, lastError: string | null = this.state.lastError): void {
    this.state = { ...this.state, connection, lastError };
    this.emit();
  }

  setInitialize(response: InitializeResponse): void {
    this.state = {
      ...this.state,
      availableModels: response.availableModels ?? [],
      lastError: null,
    };
    this.emit();
  }

  setThreads(threads: SessionSummary[]): void {
    this.state = { ...this.state, threads: [...threads] };
    this.emit();
  }

  setActiveThread(threadId: string | null): void {
    this.state = {
      ...this.state,
      activeThreadId: threadId,
      activeThreadStatus: threadId ? (this.state.threadStatuses[threadId] ?? null) : null,
    };
    this.emit();
  }

  setThreadRead(threadId: string, read: ThreadReadResponse): void {
    const nextStatus: ThreadStatus = read.isRunning ? "busy" : "idle";
    this.state = {
      ...this.state,
      activeThreadStatus: this.state.activeThreadId === threadId ? nextStatus : this.state.activeThreadStatus,
      threadStatuses: {
        ...this.state.threadStatuses,
        [threadId]: nextStatus,
      },
      threadReads: {
        ...this.state.threadReads,
        [threadId]: read,
      },
    };
    this.emit();
  }

  setLastError(lastError: string | null): void {
    this.state = { ...this.state, lastError };
    this.emit();
  }

  applyNotification(notification: DiligentServerNotification): void {
    switch (notification.method) {
      case "thread/status/changed": {
        this.setThreadStatus(notification.params.threadId, notification.params.status);
        return;
      }
      case "thread/started": {
        this.state = { ...this.state, activeThreadId: notification.params.threadId };
        this.emit();
        return;
      }
      case "error": {
        this.state = { ...this.state, lastError: notification.params.error.message };
        this.emit();
        return;
      }
      case "turn/started": {
        this.setThreadStatus(notification.params.threadId, notification.params.threadStatus ?? "busy");
        return;
      }
      case "turn/completed":
      case "turn/interrupted": {
        this.setThreadStatus(notification.params.threadId, notification.params.threadStatus ?? "idle");
        return;
      }
      default:
        return;
    }
  }

  private setThreadStatus(threadId: string, status: ThreadStatus): void {
    this.state = {
      ...this.state,
      activeThreadStatus: this.state.activeThreadId === threadId ? status : this.state.activeThreadStatus,
      threadStatuses: {
        ...this.state.threadStatuses,
        [threadId]: status,
      },
    };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
