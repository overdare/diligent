// @summary Lightweight DOM renderer for the VS Code conversation webview surface
import { applyAgentEvents } from "@diligent/protocol";
import type { ContentBlock, ThreadItem } from "@diligent/protocol";
import { marked } from "marked";
import type { ConversationViewState, HostToWebviewMessage, WebviewToHostMessage } from "./protocol";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare global {
  interface Window {
    acquireVsCodeApi(): VsCodeApi;
  }
}

marked.setOptions({
  breaks: true,
  gfm: true,
});

function renderMarkdown(text: string): string {
  return sanitizeHtml(String(marked.parse(text)));
}

function renderExpandableRow(summary: string, body: string, open = false): string {
  return `<details class="tool-row"${open ? " open" : ""}><summary>${escapeHtml(summary)}</summary><pre>${escapeHtml(
    body,
  )}</pre></details>`;
}

function getToolSummary(item: {
  toolName: string;
  input?: unknown;
  render?: { inputSummary?: string } | undefined;
}): string {
  const renderSummary = item.render?.inputSummary?.trim();
  if (renderSummary) {
    return renderSummary;
  }

  return item.toolName.toUpperCase();
}

function renderBulletMessage(content: string, className = "message-assistant"): string {
  return `<section class="message ${className}"><div class="assistant-flow"><span class="assistant-bullet" aria-hidden="true">•</span><div class="message-body transcript">${content}</div></div></section>`;
}

function renderThinkingRow(text: string, open = false): string {
  return renderExpandableRow("THINKING", text, open);
}

function flushMarkdownBuffer(buffer: string[]): string | null {
  if (buffer.length === 0) {
    return null;
  }

  const text = buffer.join("\n\n");
  buffer.length = 0;
  return renderBulletMessage(`<div class="markdown-body">${renderMarkdown(text)}</div>`, "message-assistant");
}

function renderWebSearchResults(block: Extract<ContentBlock, { type: "web_search_result" }>): string {
  const items = block.results
    .map((result) => {
      const title = result.title ?? result.url;
      const meta = [result.pageAge, result.url].filter(Boolean).join(" · ");
      return `<li><div class="result-title">${escapeHtml(title)}</div>${
        meta ? `<div class="result-meta">${escapeHtml(meta)}</div>` : ""
      }${result.snippet ? `<div class="result-snippet">${renderMarkdown(result.snippet)}</div>` : ""}</li>`;
    })
    .join("");
  const error = block.error
    ? `<div class="error-inline">${escapeHtml(block.error.message ?? block.error.code)}</div>`
    : "";
  return `<details class="detail"><summary>Web search results (${block.results.length})</summary>${error}<ul class="result-list">${items}</ul></details>`;
}

function renderWebFetchResult(block: Extract<ContentBlock, { type: "web_fetch_result" }>): string {
  const title = block.document?.title ?? block.url;
  const excerpt = block.document?.text?.slice(0, 1200).trim();
  const error = block.error
    ? `<div class="error-inline">${escapeHtml(block.error.message ?? block.error.code)}</div>`
    : "";
  return `<details class="detail"><summary>Fetched page · ${escapeHtml(title)}</summary>${error}<div class="fetch-meta">${escapeHtml(
    block.url,
  )}</div>${excerpt ? `<div class="fetch-text markdown-body">${renderMarkdown(excerpt)}</div>` : ""}</details>`;
}

function renderAssistantMessageRows(blocks: ContentBlock[] | string): string[] {
  if (typeof blocks === "string") {
    return [renderBulletMessage(`<div class="markdown-body">${renderMarkdown(blocks)}</div>`, "message-assistant")];
  }

  const rows: string[] = [];
  const markdownBuffer: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "text":
        markdownBuffer.push(block.text);
        break;
      case "thinking": {
        const flushed = flushMarkdownBuffer(markdownBuffer);
        if (flushed) {
          rows.push(flushed);
        }
        rows.push(renderBulletMessage(renderThinkingRow(block.thinking), "message-thinking"));
        break;
      }
      case "tool_call": {
        const flushed = flushMarkdownBuffer(markdownBuffer);
        if (flushed) {
          rows.push(flushed);
        }
        rows.push(
          renderBulletMessage(
            renderExpandableRow(block.name.toUpperCase(), JSON.stringify(block.input, null, 2)),
            "message-tool",
          ),
        );
        break;
      }
      case "provider_tool_use": {
        const flushed = flushMarkdownBuffer(markdownBuffer);
        if (flushed) {
          rows.push(flushed);
        }
        rows.push(
          renderBulletMessage(
            renderExpandableRow(`${block.provider}/${block.name}`.toUpperCase(), JSON.stringify(block.input, null, 2)),
            "message-tool",
          ),
        );
        break;
      }
      case "web_search_result": {
        const flushed = flushMarkdownBuffer(markdownBuffer);
        if (flushed) {
          rows.push(flushed);
        }
        rows.push(renderBulletMessage(renderWebSearchResults(block), "message-tool"));
        break;
      }
      case "web_fetch_result": {
        const flushed = flushMarkdownBuffer(markdownBuffer);
        if (flushed) {
          rows.push(flushed);
        }
        rows.push(renderBulletMessage(renderWebFetchResult(block), "message-tool"));
        break;
      }
      case "local_image": {
        const flushed = flushMarkdownBuffer(markdownBuffer);
        if (flushed) {
          rows.push(flushed);
        }
        rows.push(renderBulletMessage(renderExpandableRow("IMAGE", block.fileName ?? block.path), "message-tool"));
        break;
      }
      case "image": {
        const flushed = flushMarkdownBuffer(markdownBuffer);
        if (flushed) {
          rows.push(flushed);
        }
        rows.push(renderBulletMessage(renderExpandableRow("IMAGE", "Inline image content"), "message-tool"));
        break;
      }
    }
  }

  const flushed = flushMarkdownBuffer(markdownBuffer);
  if (flushed) {
    rows.push(flushed);
  }

  if (rows.length === 0) {
    rows.push(renderBulletMessage(`<p class="muted">No assistant text.</p>`, "message-assistant"));
  }

  return rows;
}

function renderThreadItem(item: ThreadItem): string {
  switch (item.type) {
    case "userMessage": {
      const content =
        typeof item.message.content === "string"
          ? item.message.content
          : item.message.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("\n\n");
      return `<section class="message message-user"><div class="message-label">You</div><div class="message-body markdown-body">${renderMarkdown(
        content,
      )}</div></section>`;
    }
    case "agentMessage":
      return renderAssistantMessageRows(item.message.content).join("");
    case "toolCall":
      return renderBulletMessage(
        renderExpandableRow(getToolSummary(item), item.output ?? JSON.stringify(item.input, null, 2), false),
        "message-tool",
      );
    case "knowledge":
      return `<section class="message message-meta"><div class="message-label">Knowledge</div><div class="message-body markdown-body">${renderMarkdown(
        item.content,
      )}</div></section>`;
    case "compaction":
      return `<section class="message message-meta"><div class="message-label">Compaction</div><div class="message-body markdown-body">${renderMarkdown(
        item.displaySummary ?? item.summary,
      )}</div></section>`;
    case "loopDetection":
      return `<section class="message message-meta message-loop-divider"><div class="message-label">Loop detection</div><div class="message-body"><p>${escapeHtml(
        `${item.toolName} repeated ${item.patternLength} times`,
      )}</p></div></section>`;
    case "collabEvent":
      return `<section class="message message-meta"><div class="message-label">Collab · ${escapeHtml(
        item.eventKind,
      )}</div><div class="message-body markdown-body">${renderMarkdown(item.message ?? item.description ?? item.childThreadId ?? "")}</div></section>`;
  }
}

export function createConversationApp(root: HTMLElement): void {
  const vscode = window.acquireVsCodeApi();
  let composerDraft = "";
  let composerScrollTop = 0;
  let didHydrateThread = false;
  let pendingInitialScroll = false;
  let state: ConversationViewState = {
    connection: "stopped",
    threadId: null,
    threadTitle: null,
    threadStatus: null,
    items: [],
    liveText: "",
    liveThinking: "",
    liveToolName: null,
    liveToolInput: null,
    liveToolOutput: "",
    overlayStatus: null,
    isLoading: false,
    lastError: null,
  };

  const renderLiveRegion = () => {
    const parts: string[] = [];

    if (state.overlayStatus) {
      parts.push(`<div class="live-status">${escapeHtml(state.overlayStatus)}</div>`);
    }

    if (state.liveThinking.trim()) {
      parts.push(renderBulletMessage(renderThinkingRow(state.liveThinking, true), "message-tool message-live"));
    }

    if (state.liveText.trim()) {
      parts.push(
        renderBulletMessage(
          `<div class="markdown-body">${renderMarkdown(state.liveText)}</div>`,
          "message-assistant message-live",
        ),
      );
    }

    if (state.liveToolName) {
      const toolBody = [state.liveToolInput, state.liveToolOutput].filter(Boolean).join("\n\n");
      parts.push(
        renderBulletMessage(
          renderExpandableRow(`${state.liveToolName.toUpperCase()} · running`, toolBody || "Waiting for output…", true),
          "message-tool message-live",
        ),
      );
    }

    return parts.length ? `<div class="live-region">${parts.join("")}</div>` : "";
  };

  const render = () => {
    const activeElement = document.activeElement;
    const activePrompt =
      activeElement instanceof HTMLTextAreaElement && activeElement.id === "prompt" ? activeElement : null;
    const selectionStart = activePrompt?.selectionStart ?? null;
    const selectionEnd = activePrompt?.selectionEnd ?? null;
    if (activePrompt) {
      composerDraft = activePrompt.value;
    }

    const itemsHtml = state.items.length
      ? state.items.map((item) => renderThreadItem(item)).join("")
      : `<div class="empty">Open or create a thread to start chatting with Diligent.</div>`;
    const liveHtml = renderLiveRegion();

    root.innerHTML = `
      <div class="app">
        <header class="header">
          <div class="header-row">
            <div>
              <h1>${escapeHtml(state.threadTitle ?? "No active thread")}</h1>
              <div class="status">Connection: ${escapeHtml(state.connection)}${
                state.threadStatus ? ` · Thread: ${escapeHtml(state.threadStatus)}` : ""
              }</div>
            </div>
            <div class="header-actions">
              <button type="button" class="icon-button" id="new-thread" title="Start New Thread" aria-label="Start New Thread">＋</button>
              <button type="button" class="icon-button" id="logs" title="Open Logs" aria-label="Open Logs">≡</button>
            </div>
          </div>
          ${state.lastError ? `<div class="status error">${escapeHtml(state.lastError)}</div>` : ""}
        </header>
        <main class="messages">${itemsHtml}${liveHtml}</main>
        <form class="composer" id="composer">
          <div class="composer-row">
            <textarea id="prompt" placeholder="Ask Diligent something..."></textarea>
            ${
              state.threadStatus === "busy"
                ? `<button type="button" class="icon-button composer-icon composer-action" id="interrupt" title="Interrupt" aria-label="Interrupt">■</button>`
                : `<button type="submit" class="icon-button composer-icon composer-action composer-send" id="send" title="Send" aria-label="Send">↑</button>`
            }
          </div>
        </form>
      </div>
    `;

    const form = root.querySelector<HTMLFormElement>("#composer");
    const textarea = root.querySelector<HTMLTextAreaElement>("#prompt");
    if (textarea) {
      textarea.value = composerDraft;
      textarea.scrollTop = composerScrollTop;
      if (activePrompt) {
        textarea.focus();
        if (selectionStart !== null && selectionEnd !== null) {
          textarea.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }

    const submitPrompt = () => {
      const text = textarea?.value.trim() ?? "";
      if (!text) {
        return;
      }
      vscode.postMessage({ type: "prompt/submit", text });
      composerDraft = "";
      composerScrollTop = 0;
      if (textarea) {
        textarea.value = "";
      }
    };

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitPrompt();
    });
    textarea?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }
      event.preventDefault();
      submitPrompt();
    });
    textarea?.addEventListener("input", () => {
      composerDraft = textarea.value;
      composerScrollTop = textarea.scrollTop;
    });
    textarea?.addEventListener("scroll", () => {
      composerScrollTop = textarea.scrollTop;
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

    const messages = root.querySelector<HTMLElement>(".messages");
    if (messages && pendingInitialScroll && state.items.length > 0) {
      const scrollToBottom = () => {
        messages.scrollTop = messages.scrollHeight;
      };
      scrollToBottom();
      requestAnimationFrame(() => {
        scrollToBottom();
        requestAnimationFrame(() => {
          scrollToBottom();
          pendingInitialScroll = false;
          didHydrateThread = true;
        });
      });
    }
  };

  window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
    const message = event.data;
    switch (message.type) {
      case "state/init":
        if (message.state.threadId !== state.threadId) {
          didHydrateThread = false;
          pendingInitialScroll = false;
        }
        state = message.state;
        render();
        return;
      case "agent/events":
        state = applyAgentEvents(state, message.events);
        render();
        return;
      case "thread/read":
        if (!didHydrateThread && message.payload.items.length > 0) {
          pendingInitialScroll = true;
        }
        state = {
          ...state,
          items: message.payload.items,
          threadStatus: message.payload.isRunning ? "busy" : "idle",
          overlayStatus: message.payload.isRunning ? (state.overlayStatus ?? "Working…") : null,
          liveText: message.payload.isRunning ? state.liveText : "",
          liveThinking: message.payload.isRunning ? state.liveThinking : "",
          liveToolName: message.payload.isRunning ? state.liveToolName : null,
          liveToolInput: message.payload.isRunning ? state.liveToolInput : null,
          liveToolOutput: message.payload.isRunning ? state.liveToolOutput : "",
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

function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  const allowedTags = new Set([
    "A",
    "BLOCKQUOTE",
    "BR",
    "CODE",
    "DEL",
    "EM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "LI",
    "OL",
    "P",
    "PRE",
    "STRONG",
    "TABLE",
    "TBODY",
    "TD",
    "TH",
    "THEAD",
    "TR",
    "UL",
  ]);

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const elements: Element[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    elements.push(currentNode as Element);
    currentNode = walker.nextNode();
  }

  for (const element of elements) {
    const href = element.tagName === "A" ? element.getAttribute("href") : null;

    if (!allowedTags.has(element.tagName)) {
      const parent = element.parentNode;
      if (!parent) {
        continue;
      }
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }
      parent.removeChild(element);
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      element.removeAttribute(attribute.name);
    }

    if (element.tagName === "A") {
      if (href && /^(https?:|mailto:)/i.test(href)) {
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
  }

  return template.innerHTML;
}
