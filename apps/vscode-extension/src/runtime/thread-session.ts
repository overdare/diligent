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
  private readonly subscriptions = new Map<string, string>();
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
        stdin: handle.stdin as import("node:stream").Writable,
        stdout: handle.stdout as import("node:stream").Readable,
        stderr: handle.stderr as import("node:stream").Readable,
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
    await this.ensureSubscribed(response.threadId);
    await this.refreshThreads();
    return response.threadId;
  }

  async selectThread(threadId: string): Promise<ThreadReadResponse> {
    await this.ensureSubscribed(threadId);
    return this.readThread(threadId);
  }

  async readThread(threadId: string): Promise<ThreadReadResponse> {
    return this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId });
  }

  async sendPrompt(threadId: string, text: string): Promise<void> {
    await this.ensureSubscribed(threadId);
    await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, { threadId, message: text });
  }

  async interrupt(threadId: string): Promise<boolean> {
    const result = await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT, {
      threadId,
    });
    return result.interrupted;
  }

  async dispose(): Promise<void> {
    await this.rpc.dispose();
    await this.process.dispose();
    this.store.setConnection("stopped", null);
    this.started = false;
    this.subscriptions.clear();
  }

  private async ensureSubscribed(threadId: string): Promise<void> {
    if (this.subscriptions.has(threadId)) {
      return;
    }

    const subscription = await this.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_SUBSCRIBE, { threadId });
    this.subscriptions.set(threadId, subscription.subscriptionId);
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
