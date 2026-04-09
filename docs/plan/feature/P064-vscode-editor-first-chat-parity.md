---
id: P064
status: backlog
created: 2026-04-09
---

# VS Code Editor-First Chat Parity with TUI

## Goal

Upgrade the VS Code extension so its conversation experience follows the same core interaction model as the TUI: explicit history hydration, a separate live-turn region, flowing assistant text, structured collapsible tool blocks, and editor-first conversation tabs that feel like a primary workspace surface.

After this work, a developer can use Diligent in VS Code with the same transcript semantics and streaming clarity as the TUI, while still benefiting from VS Code-native thread navigation and editor integration.

This plan is a **follow-up** to `P065: VS Code Extension Shared-Protocol Alignment`. It must be implemented only after the current extension correctly consumes the existing shared protocol as-is, without introducing any VS Code-specific protocol surface.

## Prerequisites

- `apps/vscode-extension/` already exists and uses editor-area `WebviewPanel` conversation tabs.
- `@diligent/protocol` remains the shared contract for thread lifecycle, notifications, and `AgentEvent` streaming.
- `ProtocolNotificationAdapter` continues to map protocol notifications into client-facing `AgentEvent` streams.
- `ThreadSession` and `ThreadStore` remain the extension-side coordination layer for process startup, subscriptions, thread reads, and global summaries.

## Artifact

Inside VS Code, the user opens a Diligent thread in the editor area and sees:

- a committed transcript area that hydrates prior thread history once,
- a distinct live region for the current turn,
- plain flowing assistant output instead of card-heavy rendering,
- collapsible structured tool/result blocks,
- explicit busy/thinking/tool status while a turn is running,
- editor-area tabs that can sit beside code editors without losing thread context.

Example interaction:

```text
User → opens a Diligent thread from the Threads tree
Agent → the panel hydrates prior history once and shows a visible resume divider
User → sends “summarize the diff and propose next steps”
Agent → assistant text streams into the live region, tool blocks appear incrementally, and the final transcript is committed when the turn ends
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `apps/vscode-extension/src/views/webview/` | Rework conversation rendering to mirror TUI transcript semantics: flowing text, live region separation, explicit hydration markers, collapsible secondary blocks, and lighter visual chrome |
| `apps/vscode-extension/src/views/conversation-panel-manager.ts` | Track per-panel hydration and panel-local conversation state instead of only pushing snapshot replacements |
| `apps/vscode-extension/src/state/thread-store.ts` | Extend thread state to support explicit hydration metadata, panel-friendly read caching, and richer per-thread status without overloading `activeThreadId` |
| `apps/vscode-extension/src/runtime/thread-session.ts` | Add focused helpers for explicit thread hydration, draft/new-thread flow, and streaming-safe panel updates |
| `apps/vscode-extension/src/extension.ts` | Replace refresh-heavy update paths with panel-targeted state transitions and keep tree/panel coordination editor-first |
| `apps/vscode-extension/test/` | Add tests for panel lifecycle, hydration behavior, and webview state reduction around streaming/tool rendering |
| `docs/guide/` | Document the editor-first VS Code UX and its relationship to the TUI/client protocol model |

### What does NOT change

- No new backend dedicated to VS Code; the extension must continue using `diligent app-server --stdio`.
- No protocol fork or VS Code-only server event format.
- No new VS Code-specific Diligent protocol layered beside the shared protocol; any remaining host↔webview bridge must stay transport-only.
- No VS Code Chat participant integration in this plan.
- No remote SSH / Dev Containers / Codespaces support in this phase.
- No full TUI feature parity for keyboard shortcuts or terminal-specific affordances such as ANSI scrollback behavior.
- No attachment picker or editor-selection injection in this plan; those remain a separate editor-integration follow-up.

## File Manifest

### apps/vscode-extension/src/

| File | Action | Description |
|------|--------|------------|
| `extension.ts` | MODIFY | Replace debounced whole-thread refresh assumptions with explicit hydrate/stream/commit orchestration for open panels |
| `runtime/thread-session.ts` | MODIFY | Add helpers for hydrate-on-open, draft/new-thread-safe prompt submission, and thread-scoped refresh ownership |
| `state/thread-store.ts` | MODIFY | Track per-thread hydration state, panel-safe read metadata, and reduce active-thread coupling |

### apps/vscode-extension/src/views/

| File | Action | Description |
|------|--------|------------|
| `conversation-panel-manager.ts` | MODIFY | Manage panel-local lifecycle, hydration markers, panel titles/status, and targeted host→webview updates |
| `thread-tree-provider.ts` | MODIFY | Surface richer active/busy state and keep thread-opening behavior aligned with editor-first conversations |

### apps/vscode-extension/src/views/webview/

| File | Action | Description |
|------|--------|------------|
| `protocol.ts` | MODIFY | Add explicit messages for hydrate/resume/live-region updates and any panel-local UI actions required |
| `app.ts` | MODIFY | Rebuild DOM renderer around TUI-inspired transcript/live-region separation and plain flowing output |
| `index.ts` | MODIFY | Wire new renderer bootstrap shape if needed |
| `styles.css` | MODIFY | Shift the visual style toward plain text flow with collapsible secondary sections and lighter message chrome |

### apps/vscode-extension/test/

| File | Action | Description |
|------|--------|------------|
| `views/conversation-panel-manager.test.ts` | CREATE | Verify one-panel-per-thread lifecycle, hydration dispatch, and targeted updates |
| `views/webview-state.test.ts` | CREATE | Verify live-region reduction, tool block behavior, and hydrate/commit transitions |
| `runtime/thread-session.test.ts` | MODIFY | Cover explicit hydrate/open behavior and new-thread prompt flow |

### docs/guide/

| File | Action | Description |
|------|--------|------------|
| `vscode-extension.md` | MODIFY | Document the new editor-first conversation UX, hydration semantics, and known limits |

## Implementation Tasks

### Task 1: Introduce an explicit panel conversation model

**Files:** `apps/vscode-extension/src/state/thread-store.ts`, `apps/vscode-extension/src/views/conversation-panel-manager.ts`, `apps/vscode-extension/src/views/webview/protocol.ts`
**Decisions:** D045, D088

Define a panel-facing state shape that separates committed transcript content from in-progress turn state. The current `ConversationViewState` mixes hydrated transcript data and transient streaming fields, but the host still mostly treats updates as replacement snapshots. This state model must remain **client-local derived state over shared protocol payloads**, not a new VS Code-specific protocol. Move to an explicit model that can represent:

- `historyItems`: committed transcript content
- `liveRegion`: streaming text/thinking/tool state for the running turn
- `hydration`: whether the panel is unopened, hydrating, hydrated, or stale
- optional UI markers such as `resumeBanner` / `continueBanner`

Code sketch:

```typescript
export type PanelHydrationState = "idle" | "hydrating" | "hydrated" | "stale";

export interface ConversationLiveRegion {
  statusText: string | null;
  text: string;
  thinking: string;
  toolName: string | null;
  toolInput: string | null;
  toolOutput: string;
}

export interface ConversationViewState {
  connection: ExtensionConnectionState;
  threadId: string | null;
  threadTitle: string | null;
  threadStatus: string | null;
  hydration: PanelHydrationState;
  historyItems: ThreadItem[];
  liveRegion: ConversationLiveRegion;
  resumeBanner: string | null;
  lastError: string | null;
}

export type HostToWebviewMessage =
  | { type: "state/init"; state: ConversationViewState }
  | { type: "thread/read"; payload: ThreadReadResponse }
  | { type: "agent/event"; event: AgentEvent }
  | { type: "error"; message: string };
```

**Verify:** panel manager can initialize a panel without immediately requiring a full `thread/read` payload, and tests confirm hydrate status is derived locally from shared payload arrival rather than invented protocol events.

### Task 2: Replace refresh-driven panel updates with hydrate + targeted streaming

**Files:** `apps/vscode-extension/src/extension.ts`, `apps/vscode-extension/src/runtime/thread-session.ts`, `apps/vscode-extension/src/views/conversation-panel-manager.ts`, `apps/vscode-extension/test/runtime/thread-session.test.ts`, `apps/vscode-extension/test/views/conversation-panel-manager.test.ts`
**Decisions:** D046, D089, D091, D092

The current extension often falls back to debounced `thread/read` refreshes when a notification arrives. Keep `thread/read` as the hydration/consistency source, but make it explicit and based on the already-existing shared protocol flow established in P065:

1. **On open**: hydrate the panel once with `thread/read`.
2. **During streaming**: apply shared `agent/event` payloads incrementally to the panel-local live region.
3. **On turn completion/interruption**: reconcile with a final `thread/read` commit.

This keeps the TUI-like separation between committed transcript and live turn output while preserving protocol correctness.

Code sketch:

```typescript
export class ThreadSession {
  async hydrateThread(threadId: string): Promise<ThreadReadResponse>;
  async sendPrompt(text: string, options?: { threadId?: string; createIfMissing?: boolean }): Promise<string>;
}

export class ConversationPanelManager {
  markHydrating(threadId: string): void;
  postThreadRead(threadId: string, payload: ThreadReadResponse): void;
  postAgentEvent(threadId: string, event: AgentEvent): void;
  reconcileThread(threadId: string, payload: ThreadReadResponse): void;
}
```

Implementation rule: only hydrate on open/reconcile boundaries, not for every streaming notification. This is the key shift away from the current refresh-heavy model.

**Verify:** opening a thread causes exactly one hydrate read; streaming notifications update only the target panel; turn completion triggers one reconciliation read; non-open threads do not cause redundant reads.

### Task 3: Rebuild the webview renderer around TUI transcript semantics

**Files:** `apps/vscode-extension/src/views/webview/app.ts`, `apps/vscode-extension/src/views/webview/styles.css`, `apps/vscode-extension/src/views/webview/index.ts`, `apps/vscode-extension/test/views/webview-state.test.ts`
**Decisions:** D045, D055

Refactor the webview renderer so the default reading experience matches the TUI preferences already captured for the VS Code UX:

- assistant output should read as plain flowing text rather than stacked cards,
- secondary detail-heavy blocks should use collapsible affordances,
- live thinking/tool activity should stay in a distinct live region below committed history,
- resumed/hydrated history should show a small divider rather than silently snapping into place.

Keep the renderer DOM-based; do not introduce a framework migration as part of this plan.

Code sketch:

```typescript
function renderTranscript(state: ConversationViewState): string {
  return [
    renderResumeBanner(state.resumeBanner),
    renderHistory(state.historyItems),
    renderLiveRegion(state.liveRegion),
  ]
    .filter(Boolean)
    .join("");
}

function renderAssistantFlow(blocks: ContentBlock[] | string): string[];
function renderToolDisclosure(summary: string, detail: string, open?: boolean): string;
function reduceAgentEvents(state: ConversationViewState, events: AgentEvent[]): ConversationViewState;
```

Rendering rules:

- markdown/text blocks merge into a single flowing assistant section when adjacent,
- thinking/tool/provider-web blocks render as collapsible disclosures,
- `message_end` clears the live region but does not duplicate already committed content,
- empty-thread state remains lightweight and editor-friendly.

**Verify:** unit tests cover adjacent text block coalescing, live tool disclosure rendering, message-end live-region clearing, and resume divider visibility after hydration.

### Task 4: Add draft/new-thread semantics that match the editor-first UX

**Files:** `apps/vscode-extension/src/extension.ts`, `apps/vscode-extension/src/runtime/thread-session.ts`, `apps/vscode-extension/src/views/conversation-panel-manager.ts`, `apps/vscode-extension/src/views/thread-tree-provider.ts`, `apps/vscode-extension/src/views/webview/protocol.ts`
**Decisions:** D040, D092

Align new-thread behavior with the product pattern already used elsewhere: opening a new conversation should create an editor-first draft-like workspace, while durable thread state is established when the first real prompt is sent or when runtime requirements force eager thread creation.

Because the current protocol already exposes `thread/start`, the extension can implement a practical intermediate shape entirely through existing shared protocol requests:

- `New Thread` opens a blank editor-area panel immediately,
- the panel is not required to appear selected in the tree until a real thread exists,
- on first submit, the host either binds to the pre-created thread id or creates a new one transparently,
- once the first prompt is sent, the thread list refreshes and the panel title updates from placeholder to real summary.

Code sketch:

```typescript
export interface DraftConversationHandle {
  draftKey: string;
  threadId: string | null;
  title: string;
}

async function openDraftConversation(): Promise<DraftConversationHandle>;
async function submitDraftPrompt(handle: DraftConversationHandle, text: string): Promise<string>;
```

This task is intentionally scoped to the extension UX only; it must not force a protocol redesign or introduce a VS Code-specific protocol concept for draft state.

**Verify:** `New Thread` opens an editor tab immediately; the tree remains stable until first send; first prompt transitions the panel from draft title to thread-backed title without opening a duplicate tab.

### Task 5: Document the client contract and add focused tests

**Files:** `docs/guide/vscode-extension.md`, `apps/vscode-extension/test/views/conversation-panel-manager.test.ts`, `apps/vscode-extension/test/views/webview-state.test.ts`, `apps/vscode-extension/test/runtime/thread-session.test.ts`
**Decisions:** D055, D097

Capture the intended client behavior so future work does not regress back to snapshot-heavy or sidebar-style UX. Document:

- why the VS Code client stays editor-first,
- how hydration differs from live streaming,
- how the thread tree and conversation panels coordinate,
- what is intentionally still missing (attachments, remote support, deeper editor context).

Add focused tests around the panel manager and state reduction rather than relying only on manual VS Code runs.

**Verify:** docs explain the hydrate/stream/reconcile lifecycle and tests cover the primary non-visual client state transitions.

## Acceptance Criteria

1. Opening a thread in VS Code hydrates prior history explicitly before live streaming begins.
2. The conversation panel maintains a distinct live region for in-progress assistant/thinking/tool output.
3. Assistant output renders as plain flowing text with collapsible treatment for secondary detail-heavy content.
4. Streaming updates are applied incrementally to the matching open panel without requiring repeated full-thread refreshes during the turn.
5. Turn completion or interruption reconciles the panel with a final committed transcript state.
6. `New Thread` opens an editor-first blank conversation surface without causing duplicate thread tabs on first send.
7. Thread tree selection continues to open/reveal editor-area panels rather than reintroducing sidebar-bound chat behavior.
8. Focused extension tests cover hydration, live-region updates, and panel lifecycle behavior.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Panel manager lifecycle and thread-targeted message routing | `bun test apps/vscode-extension/test/views/conversation-panel-manager.test.ts` |
| Unit | Webview state reduction for hydrate/live/commit transitions | `bun test apps/vscode-extension/test/views/webview-state.test.ts` |
| Unit | Thread session hydrate/new-thread/send flow | `bun test apps/vscode-extension/test/runtime/thread-session.test.ts` |
| Manual | Editor-first thread open, streaming, interrupt, and new-thread behavior in VS Code | `bun run vscode:build` then run the extension in VS Code Extension Development Host |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Streaming events and final `thread/read` reconciliation duplicate content | User sees repeated assistant/tool output | Keep committed transcript and live region separate; clear live region on commit only after reconcile |
| Draft/new-thread semantics drift from tree/store assumptions | Duplicate tabs or mismatched thread selection | Introduce explicit draft handle/panel identity rather than overloading `threadId` as soon as the panel opens |
| Panel-local state diverges from runtime truth after missed events | Open panel shows stale busy/live status | Use hydrate on open and reconcile on terminal turn events as the consistency boundary |
| Over-coupling panel state to `activeThreadId` breaks multi-tab editor usage | Selecting one panel mutates unrelated panel behavior | Track per-panel state independently; keep `activeThreadId` only as tree/navigation metadata |
| UX work accidentally reintroduces a VS Code-specific protocol model | Future clients drift and shared protocol loses authority | Treat all new state as client-local derivation over existing shared protocol payloads; keep protocol changes out of scope |
| Renderer refactor becomes a framework rewrite | Plan scope expands and delays UX improvement | Keep the current DOM renderer and refactor only state shape plus HTML/CSS structure |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D045 | TUI rendering uses an inline custom component model focused on readable transcript flow | Tasks 1 and 3 for TUI-inspired transcript semantics |
| D046 | Shared runtime/backend behavior should not fork for frontend-specific logic | Task 2 and scope boundaries |
| D055 | UI/library details should be resolved during implementation, not by overcommitting architecture early | Tasks 3 and 5 |
| D088 | Clarification/user-input remains a distinct frontend/runtime flow, not mixed with approval semantics | Task 1 message modeling |
| D089 | Thread fork is a user-facing session-management concern separate from internal tree structure | Task 2 future-safe thread lifecycle notes |
| D091 | Thread archive remains append-only session state, not a client-side hiding trick | Task 2 future-safe thread list assumptions |
| D092 | Thread naming is protocol-managed and should drive panel titles once a thread becomes durable | Task 4 draft/new-thread transition |
