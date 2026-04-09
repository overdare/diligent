// @summary Extension-side thread/session store shared by the tree view and conversation webview
import type {
  DiligentServerNotification,
  InitializeResponse,
  SessionSummary,
  ThreadStatus,
} from "@diligent/protocol";

export type ExtensionConnectionState = "stopped" | "starting" | "ready" | "error";

export interface ExtensionThreadState {
  connection: ExtensionConnectionState;
  availableModels: InitializeResponse["availableModels"];
  focusedThreadId: string | null;
  threadStatuses: Record<string, ThreadStatus | null | undefined>;
  threads: SessionSummary[];
  lastError: string | null;
}

type Listener = (state: ExtensionThreadState) => void;

export class ThreadStore {
  private state: ExtensionThreadState = {
    connection: "stopped",
    availableModels: [],
    focusedThreadId: null,
    threadStatuses: {},
    threads: [],
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

  setFocusedThread(threadId: string | null): void {
    this.state = {
      ...this.state,
      focusedThreadId: threadId,
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
        return;
      }
      case "agent/event": {
        if (notification.params.threadStatus) {
          this.setThreadStatus(notification.params.threadId, notification.params.threadStatus);
          return;
        }
        if (notification.params.event.type === "status_change") {
          this.setThreadStatus(notification.params.threadId, notification.params.event.status);
        }
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
