// @summary Lightweight DOM renderer for the VS Code conversation webview surface
import type { ContentBlock, ThreadItem } from "@diligent/protocol";
import type { ConversationViewState, HostToWebviewMessage, WebviewToHostMessage } from "./protocol";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare global {
  interface Window {
    acquireVsCodeApi(): VsCodeApi;
  }
}

function renderContentBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "thinking":
          return `[thinking]\n${block.thinking}`;
        case "tool_call":
          return `[tool:${block.name}] ${JSON.stringify(block.input, null, 2)}`;
        case "provider_tool_use":
          return `[provider-tool:${block.name}] ${JSON.stringify(block.input, null, 2)}`;
        case "web_search_result":
          return block.results.map((result) => `- ${result.title ?? result.url}`).join("\n");
        case "web_fetch_result":
          return `${block.document?.title ?? block.url}`;
        case "local_image":
          return `[image] ${block.fileName ?? block.path}`;
        case "image":
          return `[image]`;
      }
    })
    .join("\n\n");
}

function renderThreadItem(item: ThreadItem): { title: string; body: string } {
  switch (item.type) {
    case "userMessage":
      return {
        title: "User",
        body:
          typeof item.message.content === "string" ? item.message.content : renderContentBlocks(item.message.content),
      };
    case "agentMessage":
      return {
        title: "Assistant",
        body: renderContentBlocks(item.message.content),
      };
    case "toolCall":
      return {
        title: `Tool · ${item.toolName}`,
        body: item.output ?? JSON.stringify(item.input, null, 2),
      };
    case "knowledge":
      return { title: "Knowledge", body: item.content };
    case "compaction":
      return { title: "Compaction", body: item.displaySummary ?? item.summary };
    case "loopDetection":
      return { title: "Loop Detection", body: `${item.toolName} repeated ${item.patternLength} times` };
    case "collabEvent":
      return {
        title: `Collab · ${item.eventKind}`,
        body: item.message ?? item.description ?? item.childThreadId ?? "",
      };
  }
}

export function createConversationApp(root: HTMLElement): void {
  const vscode = window.acquireVsCodeApi();
  let state: ConversationViewState = {
    connection: "stopped",
    activeThreadId: null,
    activeThreadTitle: null,
    threadStatus: null,
    items: [],
    isLoading: false,
    lastError: null,
  };

  const render = () => {
    const itemsHtml = state.items.length
      ? state.items
          .map((item) => {
            const rendered = renderThreadItem(item);
            return `<section class="message"><div class="message-title">${escapeHtml(rendered.title)}</div><pre>${escapeHtml(
              rendered.body,
            )}</pre></section>`;
          })
          .join("")
      : `<div class="empty">Open or create a thread to start chatting with Diligent.</div>`;

    root.innerHTML = `
      <div class="app">
        <header class="header">
          <h1>${escapeHtml(state.activeThreadTitle ?? "No active thread")}</h1>
          <div class="status">Connection: ${escapeHtml(state.connection)}${
            state.threadStatus ? ` · Thread: ${escapeHtml(state.threadStatus)}` : ""
          }</div>
          ${state.lastError ? `<div class="status error">${escapeHtml(state.lastError)}</div>` : ""}
        </header>
        <main class="messages">${itemsHtml}</main>
        <form class="composer" id="composer">
          <textarea id="prompt" placeholder="Ask Diligent something..."></textarea>
          <div class="composer-actions">
            <button type="submit">Send</button>
            <button type="button" class="secondary" id="new-thread">New Thread</button>
            <button type="button" class="secondary" id="interrupt">Interrupt</button>
            <button type="button" class="secondary" id="logs">Logs</button>
          </div>
        </form>
      </div>
    `;

    const form = root.querySelector<HTMLFormElement>("#composer");
    const textarea = root.querySelector<HTMLTextAreaElement>("#prompt");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = textarea?.value.trim() ?? "";
      if (!text) {
        return;
      }
      vscode.postMessage({ type: "prompt/submit", text });
      if (textarea) {
        textarea.value = "";
      }
    });
    root.querySelector<HTMLButtonElement>("#new-thread")?.addEventListener("click", () => {
      vscode.postMessage({ type: "thread/new" });
    });
    root.querySelector<HTMLButtonElement>("#interrupt")?.addEventListener("click", () => {
      vscode.postMessage({ type: "turn/interrupt" });
    });
    root.querySelector<HTMLButtonElement>("#logs")?.addEventListener("click", () => {
      vscode.postMessage({ type: "logs/open" });
    });
  };

  window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
    const message = event.data;
    switch (message.type) {
      case "state/init":
        state = message.state;
        render();
        return;
      case "thread/read":
        state = {
          ...state,
          items: message.payload.items,
          threadStatus: message.payload.isRunning ? "busy" : "idle",
          isLoading: false,
        };
        render();
        return;
      case "thread/event":
        if (message.event.method === "error") {
          state = { ...state, lastError: message.event.params.error.message };
          render();
        }
        return;
      case "connection/status":
        state = { ...state, connection: message.status };
        render();
        return;
      case "error":
        state = { ...state, lastError: message.message, isLoading: false };
        render();
        return;
    }
  });

  render();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
