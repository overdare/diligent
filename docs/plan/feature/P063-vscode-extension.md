---
id: P063
status: backlog
created: 2026-04-07
decisions: [D046, D055, D098]
---

# P063: VS Code Extension (Dedicated Panel)

## Goal

Add an internal-use VS Code extension that gives Diligent a dedicated Activity Bar presence with a native thread list and a webview-backed conversation panel, while reusing the existing Diligent app-server and shared protocol.

After this work, a developer can install a VSIX, open a workspace, start Diligent inside VS Code, and interact with the same runtime capabilities already available through the existing clients without introducing a separate backend.

## Prerequisites

- `@diligent/protocol` remains the shared frontend/backend contract for initialize, thread, turn, tool, auth, and server-request flows.
- `packages/cli/src/index.ts` and `packages/cli/src/app-server-stdio.ts` continue to support `diligent app-server --stdio`.
- `packages/runtime/src/app-server/server.ts` remains the source of truth for thread lifecycle, approvals, user-input requests, and notification broadcasting.
- Bun workspace support remains available for adding a new `packages/vscode/` package.

## Artifact

Inside VS Code, the user sees a dedicated **Diligent** view container in the Activity Bar.

- `Threads` is a native tree view that lists top-level Diligent threads for the current workspace.
- `Conversation` is a webview view that renders the active thread transcript, tool activity, and a prompt composer.
- Starting a prompt launches a local Diligent app-server child process over stdio JSON-RPC and streams updates into the panel.
- Approval and user-input requests are handled by the extension and reflected back into the conversation state.

Example interaction:

```text
User → opens the Diligent sidebar in VS Code
User → selects “New Thread” and types “summarize the open changes”
Agent → thread starts through local app-server stdio transport
Agent → streaming output, tool calls, and thread status appear in the Conversation view
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/vscode/` | New VS Code extension package for activation, commands, thread tree, webview, and child-process RPC transport |
| `packages/protocol/` | Reuse existing request/notification schemas directly from the extension; add only narrowly scoped shared models if the extension reveals protocol gaps |
| `packages/cli/` | Keep `app-server --stdio` as the extension launch target; add only focused compatibility improvements if extension needs them |
| `docs/guide/` | Add extension-specific setup and operation guide once implemented |
| Root scripts / workspace config | Add build, test, and VSIX packaging scripts for the new extension package |

### What does NOT change

- No VS Code Chat participant integration in this plan.
- No Copilot-specific API usage or proposed VS Code APIs.
- No Marketplace-first publishing flow; initial distribution is internal only.
- No remote-first support for SSH / Dev Containers / Codespaces in v1.
- No attempt to embed the existing web app wholesale inside VS Code.
- No new Diligent-specific backend server separate from the current app-server model.
- No protocol fork for VS Code; the extension must consume the shared protocol.

## Proposed Shape

### UX structure

Use a custom VS Code **view container** named `Diligent` in the Activity Bar.

Inside that container:

1. `Threads` — native `TreeView`
   - better fit for session lists and status badges
   - aligns with VS Code guidance that tree views are ideal for hierarchical or list-like data
   - avoids using webviews for UI that the platform already supports

2. `Conversation` — `WebviewView`
   - used only for the custom transcript/composer/tool-rendering surface that native VS Code APIs do not cover cleanly
   - receives streamed thread events and user actions through an extension-host bridge

This split follows the current VS Code guidance: use a single sidebar container where possible, use native views for list-like content, and use webviews only when custom UI is necessary.

### Runtime connection model

The extension should launch a **local child process** using the existing CLI entrypoint:

```text
diligent app-server --stdio
```

The extension host owns:

- process lifecycle
- NDJSON framing
- JSON-RPC request/response correlation
- reconnect / disposal cleanup
- workspace cwd selection
- routing server requests (`approval/request`, `userInput/request`) into VS Code UI

This stays aligned with:

- D046: no extra server between current clients and core by default, while leaving room for IDE integration
- D055: IDE/RPC integration was explicitly deferred, not rejected
- current CLI/TUI transport, which already speaks stdio JSON-RPC to the app-server

### Packaging and distribution

Phase 1 should target **internal distribution** through packaged `.vsix` artifacts.

Primary install path:

- package the extension with `vsce package`
- install via **Install from VSIX** inside VS Code

Enterprise-friendly follow-up options can be documented later:

- preinstalling VSIX files
- allowed-extension policies
- Private Marketplace hosting

The initial implementation should not depend on those enterprise deployment paths to be usable.

## File Manifest

### packages/vscode/

| File | Action | Description |
|------|--------|------------|
| `package.json` | CREATE | Extension manifest, scripts, VS Code contribution points, dependencies |
| `tsconfig.json` | CREATE | TypeScript config for the extension host and test sources |
| `src/extension.ts` | CREATE | Extension activation, command registration, provider wiring |
| `src/manifest.ts` | CREATE | Centralized extension IDs, command IDs, view IDs, and context keys |
| `src/runtime/diligent-process.ts` | CREATE | Spawn and manage `diligent app-server --stdio` child process |
| `src/runtime/rpc-client.ts` | CREATE | NDJSON-framed JSON-RPC client over child-process stdio |
| `src/runtime/thread-session.ts` | CREATE | Connection-scoped session controller for initialize, subscribe, read, turn start, interrupt |
| `src/state/thread-store.ts` | CREATE | Extension-side thread summaries, active thread, and connection state |
| `src/views/thread-tree-provider.ts` | CREATE | Native TreeView provider for thread listing and selection |
| `src/views/conversation-view-provider.ts` | CREATE | WebviewView provider, HTML bootstrapping, message bridge |
| `src/views/webview/protocol.ts` | CREATE | Typed bridge messages between extension host and webview |
| `src/views/webview/index.ts` | CREATE | Conversation UI entrypoint |
| `src/views/webview/app.ts` | CREATE | Conversation UI state/rendering root |
| `src/views/webview/styles.css` | CREATE | Theme-aware webview styling using VS Code tokens |
| `src/server-requests/approval.ts` | CREATE | Map approval requests to native VS Code UX |
| `src/server-requests/user-input.ts` | CREATE | Map user input requests to native VS Code UX |
| `test/runtime/rpc-client.test.ts` | CREATE | Unit tests for RPC framing and request/response behavior |
| `test/runtime/thread-session.test.ts` | CREATE | Unit tests for initialization, subscription, and active-thread flow |
| `test/integration/extension.integration.test.ts` | CREATE | VS Code extension integration smoke test |

### packages/protocol/

| File | Action | Description |
|------|--------|------------|
| `src/data-model.ts` | MODIFY? | Only if extension implementation reveals missing shared UI-facing fields |
| `test/protocol-flow.test.ts` | MODIFY? | Add coverage only if protocol-level deltas are required |

### packages/cli/

| File | Action | Description |
|------|--------|------------|
| `src/index.ts` | MODIFY? | Only if focused app-server entrypoint ergonomics need extension-facing hardening |
| `src/app-server-stdio.ts` | MODIFY? | Only if child-process lifecycle, stderr logging, or cwd handling requires small compatibility fixes |

### docs/guide/

| File | Action | Description |
|------|--------|------------|
| `vscode-extension.md` | CREATE | Setup, VSIX install, commands, limitations, and troubleshooting |

### repository root

| File | Action | Description |
|------|--------|------------|
| `package.json` | MODIFY | Add `vscode:build`, `vscode:test`, and `vscode:package` scripts |

## Implementation Tasks

### Task 1: Create the extension package and contribution manifest

**Files:** `packages/vscode/package.json`, `packages/vscode/tsconfig.json`, `packages/vscode/src/extension.ts`, `packages/vscode/src/manifest.ts`, `package.json`
**Decisions:** D055

Create a dedicated workspace package for the VS Code extension. The package must declare a custom view container, at least one native tree view, one webview view, and the initial command surface.

Recommended command set for v1:

- `diligent.startServer`
- `diligent.newThread`
- `diligent.sendPrompt`
- `diligent.interrupt`
- `diligent.refreshThreads`
- `diligent.openLogs`

Recommended contribution shape:

```typescript
export const EXTENSION_ID = "diligent.vscode";
export const VIEW_CONTAINER_ID = "diligent";
export const THREADS_VIEW_ID = "diligent.threads";
export const CONVERSATION_VIEW_ID = "diligent.conversation";

export const COMMANDS = {
  startServer: "diligent.startServer",
  newThread: "diligent.newThread",
  sendPrompt: "diligent.sendPrompt",
  interrupt: "diligent.interrupt",
  refreshThreads: "diligent.refreshThreads",
  openLogs: "diligent.openLogs",
} as const;
```

```json
{
  "activationEvents": [
    "onView:diligent.threads",
    "onView:diligent.conversation",
    "onCommand:diligent.newThread"
  ]
}
```

**Verify:** `bun run vscode:build` produces a loadable extension bundle and manifest with no unresolved contribution IDs.

### Task 2: Implement stdio child-process transport against the existing app-server

**Files:** `packages/vscode/src/runtime/diligent-process.ts`, `packages/vscode/src/runtime/rpc-client.ts`, `packages/vscode/src/runtime/thread-session.ts`, `packages/vscode/test/runtime/rpc-client.test.ts`
**Decisions:** D046, D055

Implement a transport layer that launches `diligent app-server --stdio` and communicates using the same NDJSON-framed JSON-RPC model already used by CLI/TUI.

Key requirements:

- resolve the executable path explicitly
- start the process lazily on first user action or first visible view usage
- bind process lifetime to the VS Code window/workspace session
- deserialize notifications with `@diligent/protocol` schemas
- support request/response correlation and cancellation
- surface stderr logs for diagnostics

Code sketch:

```typescript
export interface DiligentProcessOptions {
  cwd: string;
  command: string;
  args: string[];
}

export class DiligentRpcClient {
  async start(options: DiligentProcessOptions): Promise<void>;
  async request<TMethod extends DiligentClientRequestMethod>(
    method: TMethod,
    params: DiligentClientRequestParams<TMethod>,
  ): Promise<DiligentClientResponseResult<TMethod>>;
  onNotification(listener: (message: DiligentServerNotification) => void): vscode.Disposable;
  onServerRequest(listener: (message: JSONRPCRequest) => Promise<JSONRPCResponse>): vscode.Disposable;
  async dispose(): Promise<void>;
}
```

**Verify:** mocked child-process tests cover framing, partial chunks, shutdown, request correlation, and notification dispatch.

### Task 3: Build extension-side state and thread list UX

**Files:** `packages/vscode/src/state/thread-store.ts`, `packages/vscode/src/views/thread-tree-provider.ts`, `packages/vscode/src/extension.ts`, `packages/vscode/test/runtime/thread-session.test.ts`
**Decisions:** D055

Create an extension-side store that tracks:

- connection status
- available models from `initialize`
- thread summaries from `thread/list`
- active thread ID
- active thread status
- last known errors

Use a native `TreeView` for threads rather than building the list inside a webview. This keeps list rendering platform-native and limits webview usage to the custom transcript surface.

Code sketch:

```typescript
export interface ExtensionThreadState {
  connection: "stopped" | "starting" | "ready" | "error";
  activeThreadId: string | null;
  threads: SessionSummary[];
  lastError: string | null;
}

export class ThreadTreeProvider implements vscode.TreeDataProvider<ThreadTreeItem> {
  refresh(state: ExtensionThreadState): void;
  getTreeItem(element: ThreadTreeItem): vscode.TreeItem;
  getChildren(element?: ThreadTreeItem): ProviderResult<ThreadTreeItem[]>;
}
```

**Verify:** selecting a tree item loads the thread into the conversation view and updates the active-thread context key for commands.

### Task 4: Build the dedicated conversation view bridge and UI shell

**Files:** `packages/vscode/src/views/conversation-view-provider.ts`, `packages/vscode/src/views/webview/protocol.ts`, `packages/vscode/src/views/webview/index.ts`, `packages/vscode/src/views/webview/app.ts`, `packages/vscode/src/views/webview/styles.css`

Implement a `WebviewView` for the conversation surface. The extension host is the authority for VS Code APIs, process control, and server requests. The webview should remain a render-and-intent surface.

Webview responsibilities:

- render transcript items
- render tool activity blocks
- show thread status
- collect prompt input
- display empty/loading/error states

Extension-host responsibilities:

- perform RPC calls
- translate notifications into webview state patches
- own command execution
- own log handling and diagnostics

Bridge shape:

```typescript
export type HostToWebviewMessage =
  | { type: "state/init"; state: ConversationViewState }
  | { type: "thread/event"; event: DiligentServerNotification }
  | { type: "thread/read"; payload: ThreadReadResult }
  | { type: "connection/status"; status: ExtensionThreadState["connection"] }
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "prompt/submit"; text: string }
  | { type: "thread/select"; threadId: string }
  | { type: "thread/new" }
  | { type: "turn/interrupt" }
  | { type: "logs/open" };
```

**Verify:** a prompt submitted from the conversation webview produces a new turn, streamed deltas appear in order, and the view restores correctly when hidden/shown.

### Task 5: Map server requests into VS Code-native UX

**Files:** `packages/vscode/src/server-requests/approval.ts`, `packages/vscode/src/server-requests/user-input.ts`, `packages/vscode/src/runtime/thread-session.ts`, `packages/vscode/src/views/conversation-view-provider.ts`
**Decisions:** D098

Handle `approval/request` and `userInput/request` without inventing a new runtime-side capability boundary. The extension consumes the existing protocol, presents UI in VS Code, and returns the protocol-shaped response.

Recommended v1 behavior:

- approval requests → `showInformationMessage` or `showWarningMessage` with explicit choices
- single-choice input → `showQuickPick`
- multi-choice input → `showQuickPick({ canPickMany: true })`
- freeform input → `showInputBox`
- if the conversation webview is visible, also reflect prompt state there for continuity

Code sketch:

```typescript
export async function resolveApprovalRequest(
  params: ApprovalRequestParams,
): Promise<ApprovalResponseResult> {
  return { decision: "once" };
}

export async function resolveUserInputRequest(
  params: UserInputRequestParams,
): Promise<UserInputResponseResult> {
  return { answers: {} };
}
```

**Verify:** approval and user-input prompts round-trip successfully and unblock the pending server request without leaving stale UI state.

### Task 6: Package, test, and document the internal distribution workflow

**Files:** `packages/vscode/test/integration/extension.integration.test.ts`, `docs/guide/vscode-extension.md`, `package.json`

Add repeatable package/test scripts and document internal installation.

Expected scripts:

```json
{
  "scripts": {
    "vscode:build": "bun run --cwd packages/vscode build",
    "vscode:test": "bun run --cwd packages/vscode test",
    "vscode:package": "bun run --cwd packages/vscode package"
  }
}
```

Guide topics:

- prerequisites
- how to generate a VSIX
- how to install from VSIX
- how to point the extension at the Diligent binary
- current limitations
- troubleshooting child-process startup and logs

**Verify:** a teammate can install the generated VSIX in a clean VS Code window and start a Diligent thread without local code changes.

## Acceptance Criteria

1. A new `packages/vscode/` extension package exists and builds successfully.
2. Installing the generated VSIX adds a dedicated `Diligent` view container in the VS Code Activity Bar.
3. The extension launches `diligent app-server --stdio` locally and completes `initialize` successfully.
4. The `Threads` native tree view lists top-level threads for the current workspace and allows switching the active thread.
5. The `Conversation` webview view can create a thread, submit a prompt, and display streamed responses for the active thread.
6. Approval and user-input server requests complete end-to-end from runtime → extension UI → runtime.
7. The extension does not require a protocol fork or a new dedicated backend server.
8. Internal packaging via VSIX is documented and repeatable.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | NDJSON framing, request correlation, process shutdown, state-store updates | `bun test packages/vscode/test/runtime/` |
| Integration | Extension activation, view registration, command wiring, process boot | VS Code extension test runner (`@vscode/test-electron`) |
| Integration | End-to-end prompt flow against spawned app-server in a fixture workspace | extension integration test with real child process |
| Manual | Install VSIX, open workspace, create thread, send prompt, handle approval | clean VS Code profile + local Diligent binary |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Webview overreach leads to a mini web app fork | High maintenance and poor UX consistency | Keep thread list native; restrict webview to transcript/composer only |
| Child-process startup is brittle across local environments | Extension appears broken at launch | Make binary path configurable, surface stderr logs, add startup diagnostics command |
| Multi-client thread updates produce duplicate or stale UI state | Confusing thread transitions | Reuse protocol subscription semantics and normalize all state changes through one extension-side store |
| Approval and user-input requests block invisibly when the view is hidden | User perceives hang | Use native VS Code modal/non-modal prompts from extension host as the authoritative fallback |
| Remote/Codespaces scenarios break due to local-process assumptions | Internal users hit non-obvious failures | Document remote support as out of scope for v1 and detect unsupported environments explicitly |
| Packaging drifts from normal repo workflows | Extension becomes hard to ship internally | Add root scripts and one documented VSIX packaging path |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D046 | No server between TUI and core by default; app-server can be added later for IDE integration | transport model and app-server reuse |
| D055 | IDE/RPC integration was deferred rather than designed away | package creation, extension host integration, command surface |
| D098 | Plugin-SDK capability boundary is intentionally narrow | server-request handling and scope control |

## External References Used For This Plan

- VS Code Contribution Points: https://code.visualstudio.com/api/references/contribution-points
- VS Code Webviews UX Guidelines: https://code.visualstudio.com/api/ux-guidelines/webviews
- VS Code Sidebars UX Guidelines: https://code.visualstudio.com/api/ux-guidelines/sidebars
- VS Code Activation Events: https://code.visualstudio.com/api/references/activation-events
- Supporting Remote Development and GitHub Codespaces: https://code.visualstudio.com/api/advanced-topics/remote-extensions
- Continuous Integration for Extensions: https://code.visualstudio.com/api/working-with-extensions/continuous-integration
- Manage Extensions in Enterprise Environments: https://code.visualstudio.com/docs/enterprise/extensions
- VS Code Private Marketplace announcement: https://code.visualstudio.com/blogs/2025/11/18/PrivateMarketplace/
