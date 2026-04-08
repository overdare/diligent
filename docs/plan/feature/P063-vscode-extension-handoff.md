---
id: P063-HANDOFF
parent: P063
created: 2026-04-07
status: active
---

# P063 Hand-off: VS Code Extension UX Shift to Editor-Area Conversation

## Why this hand-off exists

The current VS Code extension implementation successfully creates a dedicated Diligent activity-bar container, a native `Threads` tree view, and a conversation surface backed by a webview. However, the user clarified that the long-term UX direction should **not** keep the main chat experience confined to the extension sidebar.

Instead, the user wants the conversation surface to live at the **same hierarchy level as code editors** — meaning the main chat should open in the editor area as a tab/panel alongside files, diffs, and other primary work surfaces.

This hand-off records the current state, the validated technical direction, and the next implementation steps so follow-up work can continue without rediscovery.

## User preference to preserve

- Keep a Diligent presence in the VS Code shell.
- Sidebar usage is acceptable for **thread discovery/navigation**.
- The main **conversation body** should not remain a subordinate sidebar panel.
- The chat should open in the **editor area**, at the same perceived level as code editing.

In practical VS Code terms, the preferred shape is:

- sidebar: native `Threads` tree view
- editor area: `WebviewPanel`-based conversation tabs

## Current implementation state

Current package location:

- `apps/vscode-extension/`

Current implemented pieces:

- extension manifest and VSIX packaging
- activity-bar view container
- native thread tree
- sidebar conversation webview (`WebviewView`)
- local `diligent app-server --stdio` process transport
- NDJSON JSON-RPC client
- approval and user-input request handling via native VS Code UI
- active-thread refresh to make conversation updates appear without manually reselecting the thread

Current known UX limitation:

- conversation is still implemented as a **sidebar `WebviewView`**, not an editor-area tab

## Direction change

### Replace

- sidebar `Conversation` implemented via `WebviewView`

### With

- editor-area conversation implemented via `WebviewPanel`

### Keep

- `Threads` tree in the sidebar
- existing app-server transport
- existing thread/session store concepts
- existing webview rendering assets as a basis

## Recommended target UX

### Sidebar

`Threads` remains the native navigation surface.

User actions:

- click thread → reveal existing conversation tab or open a new one
- `New Thread` → create a thread and open a new editor-area conversation tab

### Editor area

Each conversation opens as a tab-like surface in the main editor area.

Desired properties:

- behaves like a primary work surface, not a utility panel
- can be split next to code editors
- can keep multiple thread tabs open
- restores/reveals existing thread panel instead of duplicating tabs for the same thread

## Recommended architecture

### 1. Keep the thread tree provider

Retain:

- `src/views/thread-tree-provider.ts`

Adjust its command behavior so thread selection opens/reveals editor panels instead of relying on sidebar conversation state.

### 2. Introduce a panel manager

Add a dedicated manager, e.g.:

- `src/views/conversation-panel-manager.ts`

Responsibilities:

- maintain `Map<threadId, WebviewPanel>`
- create panels for new/opened threads
- reveal already-open panels for known thread IDs
- dispose panel references when tabs close
- route host→webview messages to the correct panel instance

### 3. Reuse the current webview UI bundle

The existing webview client under:

- `src/views/webview/`

should be reused where possible.

The main change is not the rendering technology, but **where it is hosted**:

- from `WebviewView` in the sidebar
- to `WebviewPanel` in the editor area

### 4. Make thread state panel-scoped

The current implementation has a single active-thread-centric conversation flow.

For editor-area tabs, the architecture should move toward:

- one panel per thread
- panel receives updates only for its thread
- thread store remains shared for summaries and global connection state
- panel-local view state owns the rendered transcript lifecycle

### 5. Streaming model

Short-term acceptable behavior:

- continue debounced `thread/read` refresh for active thread/panel updates

Preferred next step:

- directly apply `item/started`, `item/delta`, `item/completed`, `turn/*` notifications into panel-local state

That will produce true live streaming without repeated `thread/read` round-trips.

## Concrete next tasks

### Task A — convert conversation host from `WebviewView` to `WebviewPanel`

Files likely affected:

- `apps/vscode-extension/src/extension.ts`
- `apps/vscode-extension/src/views/conversation-view-provider.ts`
- new: `apps/vscode-extension/src/views/conversation-panel-manager.ts`

Target outcome:

- remove `Conversation` sidebar registration from the critical path
- opening a thread creates/reveals an editor tab

### Task B — update manifest contributions

Current manifest still declares:

- `diligent.conversation` as a contributed view

Decide one of these:

1. remove the sidebar conversation view entirely, or
2. keep it temporarily only as a fallback/debug surface

Recommended direction:

- remove it once the panel flow is stable

### Task C — wire tree selection to open editor tabs

Current tree item behavior is still tied to the old conversation flow.

Update it so:

- thread click → `openConversationPanel(threadId)`
- `New Thread` → create thread, then open panel

### Task D — support one-panel-per-thread lifecycle

Needed behavior:

- if panel exists: reveal it
- if not: create it
- when panel closes: unregister from panel registry

### Task E — route streaming to the correct panel

Current logic is still globally active-thread oriented.

Follow-up work should:

- identify the thread for each incoming notification
- refresh or patch only the matching panel
- avoid requiring sidebar reselection/resume behavior

## Implementation notes from current debugging

### Important fix already made

The extension previously bundled `@diligent/runtime` transitively into the extension host, which pulled in `Bun.*` runtime references and likely broke activation/rendering.

This has already been corrected by replacing runtime NDJSON usage with a local helper:

- `apps/vscode-extension/src/runtime/ndjson.ts`

Do not regress this by reintroducing Bun-only runtime dependencies into the extension host bundle.

### Packaging state

Current packaging works:

- `bun run vscode:package`

Current artifact:

- `apps/vscode-extension/dist/diligent.vsix`

Packaging is already slimmed to the necessary runtime files.

## Suggested file-level changes for the next person

### Likely add

- `apps/vscode-extension/src/views/conversation-panel-manager.ts`

### Likely refactor heavily

- `apps/vscode-extension/src/extension.ts`
- `apps/vscode-extension/src/views/conversation-view-provider.ts`

### Likely keep mostly intact

- `apps/vscode-extension/src/views/webview/*`
- `apps/vscode-extension/src/runtime/diligent-process.ts`
- `apps/vscode-extension/src/runtime/rpc-client.ts`
- `apps/vscode-extension/src/runtime/thread-session.ts`
- `apps/vscode-extension/src/state/thread-store.ts`

## Acceptance criteria for the next phase

1. Clicking a thread opens or reveals a conversation in the **editor area**, not only in the sidebar.
2. Creating a new thread opens a new editor-area conversation tab.
3. The conversation can sit side-by-side with code editors.
4. Streaming updates appear in the open conversation tab without requiring thread reselection.
5. One thread does not spawn duplicate tabs unless intentionally opened separately by design.
6. The sidebar remains useful for thread discovery, but the main chat experience is editor-first.

## Recommended short summary for the next implementer

The extension works enough to package/install, but the current sidebar conversation surface is no longer the desired final UX. Keep the sidebar `Threads` tree, move the conversation to editor-area `WebviewPanel` tabs, preserve the existing stdio transport, and evolve the current active-thread refresh/streaming path into panel-scoped live updates.
