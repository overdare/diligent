// @summary Connection-scoped session controller for initialize, thread selection, subscribe, read, and turn flow
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  InitializeResponse,
  RequestId,
  ThreadReadResponse,
} from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS, DILIGENT_VERSION } from "@diligent/protocol";
import type { ThreadStore } from "../state/thread-store";
import type { DiligentProcess, DiligentProcessOptions } from "./diligent-process";
import { DiligentRpcClient } from "./rpc-client";

export interface ThreadSessionConfig {
  cwd: string;
  clientName?: string;
  clientVersion?: string;
  processOptions: DiligentProcessOptions;
}

export interface ThreadSessionServerRequestHandlers {
  approvalRequest: (
    params: Extract<DiligentServerRequest, { method: "approval/request" }>["params"],
  ) => Promise<Extract<DiligentServerRequestResponse, { method: "approval/request" }>["result"]>;
  userInputRequest: (
    params: Extract<DiligentServerRequest, { method: "userInput/request" }>["params"],
  ) => Promise<Extract<DiligentServerRequestResponse, { method: "userInput/request" }>["result"]>;
}

export class ThreadSession {
  private readonly rpc = new DiligentRpcClient();
  private subscriptionId: string | null = null;
  private started = false;

  constructor(
    private readonly process: DiligentProcess,
    private readonly store: ThreadStore,
    private readonly config: ThreadSessionConfig,
    private readonly serverRequestHandlers: ThreadSessionServerRequestHandlers,
    private readonly onNotification?: (notification: DiligentServerNotification) => void,
    private readonly onStderr?: (line: string) => void,
  ) {}

  async start(): Promise<InitializeResponse> {
    if (!this.started) {
      this.store.setConnection("starting", null);
      const handle = this.process.start(this.config.processOptions);
      await this.rpc.start({
        stdin: handle.stdin,
        stdout: handle.stdout,
        stderr: handle.stderr,
        kill: () => handle.kill(),
        exit: handle.exit,
      });
      this.rpc.onNotification((notification) => {
        this.store.applyNotification(notification);
        this.onNotification?.(notification);
      });
      this.rpc.onServerRequest((requestId, request) => this.handleServerRequest(requestId, request));
      this.rpc.onStderr((line) => this.onStderr?.(line));
      this.started = true;
    }

    const initialize = await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE, {
      clientName: this.config.clientName ?? "vscode",
      clientVersion: this.config.clientVersion ?? DILIGENT_VERSION,
      protocolVersion: 1,
    });
    this.store.setInitialize(initialize);
    this.store.setConnection("ready", null);
    return initialize;
  }

  async refreshThreads(): Promise<void> {
    const response = await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST, {});
    this.store.setThreads(response.data.filter((thread) => !thread.parentSession));
  }

  async createThread(): Promise<string> {
    const response = await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
      cwd: this.config.cwd,
      mode: "default",
    });
    await this.selectThread(response.threadId);
    await this.refreshThreads();
    return response.threadId;
  }

  async selectThread(threadId: string): Promise<ThreadReadResponse> {
    if (this.subscriptionId) {
      await this.rpc
        .request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_UNSUBSCRIBE, { subscriptionId: this.subscriptionId })
        .catch(() => undefined);
      this.subscriptionId = null;
    }
    const subscription = await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_SUBSCRIBE, { threadId });
    this.subscriptionId = subscription.subscriptionId;
    this.store.setActiveThread(threadId);
    const read = await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId });
    this.store.setThreadRead(threadId, read);
    return read;
  }

  async sendPrompt(text: string): Promise<void> {
    const state = this.store.snapshot();
    const threadId = state.activeThreadId ?? (await this.createThread());
    await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, { threadId, message: text });
  }

  async interrupt(): Promise<boolean> {
    const result = await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT, {
      threadId: this.store.snapshot().activeThreadId ?? undefined,
    });
    return result.interrupted;
  }

  async dispose(): Promise<void> {
    await this.rpc.dispose();
    await this.process.dispose();
    this.store.setConnection("stopped", null);
    this.started = false;
    this.subscriptionId = null;
  }

  private async handleServerRequest(
    _requestId: RequestId,
    request: DiligentServerRequest,
  ): Promise<DiligentServerRequestResponse> {
    switch (request.method) {
      case "approval/request":
        return {
          method: request.method,
          result: await this.serverRequestHandlers.approvalRequest(request.params),
        };
      case "userInput/request":
        return {
          method: request.method,
          result: await this.serverRequestHandlers.userInputRequest(request.params),
        };
    }
  }
}
