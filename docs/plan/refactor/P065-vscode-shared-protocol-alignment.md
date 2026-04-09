---
id: P065
status: backlog
created: 2026-04-09
---

# VS Code Extension Shared-Protocol Alignment

## Goal

Correct the current VS Code extension so it composes the existing shared Diligent protocol instead of drifting into a VS Code-specific event model. The first priority is to make the extension consume the runtime’s real shared protocol flow correctly, especially live `agent/event` streaming, before any higher-level UX upgrades are added.

After this work, the VS Code extension will use the shared protocol as its source of truth for hydration, live turn updates, and thread status, and any remaining host↔webview bridge will be a thin transport for shared payloads rather than a parallel protocol.

## Prerequisites

- `packages/runtime/src/app-server/server.ts` continues to emit the shared `DiligentServerNotification` stream.
- `packages/protocol/` remains the only frontend/backend protocol contract.
- `AgentEventNotificationSchema`, `ThreadReadResponseSchema`, and `DiligentServerNotificationSchema` remain the canonical UI-facing payload shapes.
- `apps/vscode-extension/` remains a thin client over `diligent app-server --stdio`.

## Artifact

Inside VS Code, opening a thread and sending a prompt uses the existing shared protocol flow end to end:

- `thread/read` hydrates committed history,
- `agent/event` drives live text/thinking/tool streaming,
- `thread/status/changed` and terminal turn notifications drive busy/idle state,
- the panel no longer depends on repeated debounced `thread/read` refreshes to simulate streaming.

Example interaction:

```text
User → opens a thread in the VS Code extension
Extension → performs one shared-protocol thread/read hydration
User → sends “explain the current architecture”
Runtime → emits shared agent/event notifications
Extension → applies those shared AgentEvents directly to the panel live state
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `apps/vscode-extension/src/runtime/thread-session.ts` | Correct notification handling so shared protocol notifications, especially `agent/event`, are consumed directly rather than reconstructed through stale assumptions |
| `apps/vscode-extension/src/extension.ts` | Remove refresh-heavy streaming emulation and make shared protocol events the first-class update path |
| `apps/vscode-extension/src/state/thread-store.ts` | Reduce only shared protocol state that belongs in the global extension store; stop using local store semantics as a substitute for protocol events |
| `apps/vscode-extension/src/views/conversation-panel-manager.ts` | Keep the panel bridge thin and drive panel updates from shared payloads instead of a bespoke view protocol |
| `apps/vscode-extension/src/views/webview/protocol.ts` | Minimize the bridge vocabulary and ensure it only transports shared protocol payloads or view-local UI commands, not new Diligent semantics |
| `apps/vscode-extension/src/views/webview/app.ts` | Consume shared `ThreadReadResponse` / `AgentEvent` data directly through a local reducer |
| `apps/vscode-extension/test/` | Add regression tests for shared-protocol streaming, hydration, and notification routing |
| `docs/guide/` | Document the VS Code extension as a consumer of the shared protocol rather than a protocol exception |

### What does NOT change

- No new VS Code-specific frontend/backend protocol in `packages/protocol/`.
- No new runtime notification family just for the VS Code extension.
- No editor UX redesign in this plan beyond what is necessary to validate correct shared-protocol behavior.
- No attachment/context-injection features in this phase.
- No sidebar/editor-surface redesign beyond preserving the existing editor-first panel model.

## Current Implementation Drift To Fix First

1. **Shared `agent/event` is not the primary live-stream path in the extension today.**
   - Runtime emits `DILIGENT_SERVER_NOTIFICATION_METHODS.AGENT_EVENT` as the canonical live event stream.
   - The extension currently routes notifications through `ProtocolNotificationAdapter.toAgentEvents(notification)`, but that adapter expects lower-level item notifications and does not map the already-wrapped `agent/event` notification.
   - Result: the extension falls back to debounced `thread/read` refreshes to simulate streaming.

2. **The extension currently treats repeated `thread/read` as a streaming mechanism.**
   - `thread/read` should be used for hydration/reconciliation, not as the primary real-time stream.

3. **The host↔webview bridge is acting like a second protocol layer.**
   - Messages such as `state/init`, `thread/read`, `thread/event`, and `connection/status` are currently the panel’s main source of truth.
   - This is acceptable only as a thin transport envelope; it should not become an alternate Diligent semantic model.

4. **Global extension state is over-involved in panel rendering.**
   - `ThreadStore` and `ConversationPanelManager` currently rebuild derived conversation snapshots too aggressively instead of letting shared protocol events update panel-local live state.

## File Manifest

### apps/vscode-extension/src/

| File | Action | Description |
|------|--------|------------|
| `extension.ts` | MODIFY | Make shared protocol notifications the primary update path and confine `thread/read` to hydrate/reconcile boundaries |
| `runtime/thread-session.ts` | MODIFY | Expose shared notifications cleanly and remove assumptions that require refresh-based live updates |
| `state/thread-store.ts` | MODIFY | Keep only shared summary/status state globally; stop over-deriving panel transcript state |

### apps/vscode-extension/src/views/

| File | Action | Description |
|------|--------|------------|
| `conversation-panel-manager.ts` | MODIFY | Route shared payloads to the correct panel and avoid rebuilding whole conversation snapshots unnecessarily |

### apps/vscode-extension/src/views/webview/

| File | Action | Description |
|------|--------|------------|
| `protocol.ts` | MODIFY | Recast the host/webview bridge as a thin transport for shared protocol payloads plus local UI commands |
| `app.ts` | MODIFY | Reduce `ThreadReadResponse` and `AgentEvent` directly into panel-local state |

### apps/vscode-extension/test/

| File | Action | Description |
|------|--------|------------|
| `runtime/thread-session.test.ts` | MODIFY | Verify `agent/event` notifications are surfaced directly and no refresh loop is required for live streaming |
| `views/conversation-panel-manager.test.ts` | CREATE | Verify panel routing from shared protocol payloads |
| `views/webview-state.test.ts` | CREATE | Verify panel-local reducer behavior from shared `ThreadReadResponse` and `AgentEvent` inputs |

### docs/guide/

| File | Action | Description |
|------|--------|------------|
| `vscode-extension.md` | MODIFY | Document the shared-protocol-first client model and the hydrate/stream/reconcile boundaries |

## Implementation Tasks

### Task 1: Make `agent/event` the canonical live-stream input

**Files:** `apps/vscode-extension/src/runtime/thread-session.ts`, `apps/vscode-extension/src/extension.ts`, `apps/vscode-extension/test/runtime/thread-session.test.ts`
**Decisions:** D046

Stop treating repeated `thread/read` calls as the main streaming mechanism. The extension should consume shared `agent/event` notifications as emitted by the runtime.

Concretely:

- branch on `notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.AGENT_EVENT`,
- route `notification.params.event` directly to the target panel,
- use `thread/read` only on panel open and turn-end reconciliation.

Code sketch:

```typescript
function handleNotification(notification: DiligentServerNotification): void {
  store.applyNotification(notification);

  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.AGENT_EVENT) {
    panelManager.postAgentEvent(notification.params.threadId, notification.params.event);
    return;
  }

  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
    void reconcileThread(notification.params.threadId);
  }
}
```

**Verify:** a running turn produces panel updates from incoming `agent/event` notifications without requiring intermediate `thread/read` refreshes.

### Task 2: Restrict `thread/read` to hydrate and reconcile boundaries

**Files:** `apps/vscode-extension/src/extension.ts`, `apps/vscode-extension/src/runtime/thread-session.ts`, `apps/vscode-extension/src/views/conversation-panel-manager.ts`
**Decisions:** D046

Define a strict client rule:

- **hydrate** on thread open,
- **stream** from shared `agent/event`,
- **reconcile** on turn completion/interruption or explicit recovery.

Remove the current timer-based refresh loop for streaming notifications.

Code sketch:

```typescript
async function openConversation(threadId: string): Promise<void> {
  panelManager.openThread(threadId);
  const read = await session.readThread(threadId);
  if (read) panelManager.postThreadRead(threadId, read);
}

async function reconcileThread(threadId: string): Promise<void> {
  const read = await session.readThread(threadId);
  if (read) panelManager.postThreadRead(threadId, read);
}
```

**Verify:** opening a thread performs one read; a running turn uses event streaming; completion triggers a final read.

### Task 3: Make the host↔webview bridge a thin transport, not a second protocol

**Files:** `apps/vscode-extension/src/views/webview/protocol.ts`, `apps/vscode-extension/src/views/conversation-panel-manager.ts`, `apps/vscode-extension/src/views/webview/app.ts`
**Decisions:** D055

Keep the host/webview bridge because VS Code requires one, but constrain it:

- shared protocol payloads (`ThreadReadResponse`, `AgentEvent`, `DiligentServerNotification`) should cross the bridge unchanged whenever possible,
- local message types should represent transport/UI concerns only, not new Diligent semantics,
- do not define new VS Code-specific equivalents for hydration, thread lifecycle, or streaming events when the shared protocol already expresses them.

Code sketch:

```typescript
export type HostToWebviewMessage =
  | { type: "init"; threadId: string | null; connection: ExtensionConnectionState }
  | { type: "threadRead"; payload: ThreadReadResponse }
  | { type: "agentEvent"; event: AgentEvent }
  | { type: "notification"; payload: DiligentServerNotification }
  | { type: "error"; message: string };
```

The point is not the exact names above, but the rule: the payloads remain shared-protocol payloads rather than a new extension-defined domain model.

**Verify:** webview reducer tests accept shared payloads directly and do not require bespoke intermediate event translation.

### Task 4: Reduce panel-local state from shared protocol inputs

**Files:** `apps/vscode-extension/src/views/webview/app.ts`, `apps/vscode-extension/test/views/webview-state.test.ts`
**Decisions:** D055

Refactor the webview state management so committed transcript state comes from `ThreadReadResponse.items`, while live state comes from shared `AgentEvent` values.

Code sketch:

```typescript
function applyThreadRead(state: ConversationViewState, payload: ThreadReadResponse): ConversationViewState;
function applyAgentEvent(state: ConversationViewState, event: AgentEvent): ConversationViewState;
```

This keeps protocol semantics visible in the reducer and makes later TUI-parity work safer.

**Verify:** tests cover hydrate, live text delta, tool update, turn completion reconciliation, and error propagation.

### Task 5: Rebase follow-up VS Code UX plans on the shared-protocol-first model

**Files:** `docs/plan/feature/P064-vscode-editor-first-chat-parity.md`, `docs/guide/vscode-extension.md`
**Decisions:** D046, D055

Update the follow-up UX plan so it explicitly depends on this alignment work and does not propose any new VS Code-specific protocol semantics.

**Verify:** follow-up plans describe UX improvements as client-side composition over the existing shared protocol, not as protocol expansion.

## Acceptance Criteria

1. The VS Code extension consumes shared `agent/event` notifications directly for live turn updates.
2. The extension no longer depends on repeated debounced `thread/read` refreshes to simulate streaming.
3. `thread/read` is used only for open-time hydration, final reconciliation, or explicit recovery.
4. The host↔webview bridge transports shared protocol payloads rather than inventing a second Diligent event model.
5. Follow-up VS Code plans explicitly prohibit new VS Code-specific protocol surfaces.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Shared notification routing in the extension host | `bun test apps/vscode-extension/test/runtime/thread-session.test.ts` |
| Unit | Panel routing for `AgentEvent` and `ThreadReadResponse` | `bun test apps/vscode-extension/test/views/conversation-panel-manager.test.ts` |
| Unit | Webview reducer behavior from shared payloads | `bun test apps/vscode-extension/test/views/webview-state.test.ts` |
| Manual | Open thread, stream a turn, verify no refresh-driven jitter | Run the extension in VS Code and observe a live turn |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Current `ProtocolNotificationAdapter` usage hides `agent/event` handling mismatch | Live streaming remains broken after partial refactor | Handle `agent/event` explicitly in the host and add regression tests around actual runtime notification shapes |
| Removing refresh timers exposes missing terminal reconciliation | Panels may end with stale committed transcript | Keep explicit final reconcile reads on turn end/interruption |
| Bridge cleanup is mistaken for protocol expansion | Drift persists under different names | State clearly in code/docs that the bridge is transport-only and must carry shared payloads unchanged where possible |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D046 | Frontend behavior should not invent a separate backend/runtime path | Entire plan; shared-protocol-first alignment |
| D055 | UI-specific choices should be resolved at implementation time without overcommitting architecture | Tasks 3 and 4 |
