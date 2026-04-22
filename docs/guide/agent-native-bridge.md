# AgentNativeBridge

This guide defines the `AgentNativeBridge` contract for injecting host-local context into a web-based chat composer.

The goal is to let multiple hosts such as Unreal Engine WebBrowser and the VS Code extension tell the chat UI what the user is currently looking at or targeting, without creating a client-specific Diligent backend protocol.

## Goals

- represent host-local context with one web UI model
- support both explicit command targets and passive viewing context
- allow multiple context items at once
- keep host↔web UI transport thin and client-local
- avoid introducing a VS Code-specific or Unreal-specific Diligent protocol surface

## Non-goals

- replacing the shared Diligent frontend/backend protocol in `@diligent/protocol`
- defining runtime/server semantics for how the backend must interpret every context item
- requiring one transport mechanism across all hosts
- requiring automatic send on context change; the default model is composer attachment

## Architecture position

`AgentNativeBridge` is a host-local bridge between an embedding surface and a web chat UI.

Examples:

- Unreal Engine host code → embedded WebBrowser page
- VS Code extension host → VS Code webview conversation panel

This bridge is not part of the shared Diligent app-server protocol. It is a local adapter layer that feeds UI state into the composer before the normal shared protocol turn flow begins.

This follows the architecture rule in `ARCHITECTURE.md`: clients may add client-local transport bridges and UI reducers, but they must not invent a separate Diligent protocol beside the shared protocol.

## Core model

The chat composer stores host-injected context as `contextItems`.

External hosts call the bridge with a simpler input shape. The web client normalizes that input into the internal `AgentContextItem` model.

```ts
export type AgentNativeBridgeInputItem =
	| {
		GUID: string;
		ClassType: string;
		Name: string;
	  }
	| {
		uri: string;
		Name: string;
		languageId?: string;
		selection?: {
			startLine: number;
			startCharacter: number;
			endLine: number;
			endCharacter: number;
		};
	  };
```

```ts
export type AgentContextItem =
	| StudioRpcInstanceContextItem
	| VsCodeFileContextItem;

export interface StudioRpcInstanceContextItem {
	kind: "instance";
	source: "studiorpc";
	GUID: string;
	ClassType: string;
	Name: string;
}

export interface VsCodeFileContextItem {
	kind: "file";
	source: "vscode";
	uri: string;
	Name: string;
	languageId?: string;
	selection?: {
		startLine: number;
		startCharacter: number;
		endLine: number;
		endCharacter: number;
	};
}
```

### Rationale

- external callers should not need to send `kind` or `source`
- `kind` identifies the semantic item type.
- `source` identifies the host family that produced the item.
- StudioRPC-backed items preserve existing field names: `GUID`, `ClassType`, `Name`.
- VS Code file items model viewing context without pretending files have GUID-style identity.
- `Name` remains available on all variants so the composer can render a simple chip label without per-host mandatory special casing.

## Composer state

The web chat composer tracks text separately from attached host context.

```ts
export interface ChatComposerState {
	text: string;
	contextItems: AgentContextItem[];
}
```

Context injection appends or merges items into `contextItems`. It does not automatically send the message.

## Bridge API

The web UI exposes a small global API named `AgentNativeBridge`.

```ts
export interface AgentNativeBridgeApi {
	updateContextItems(items: AgentContextItem[]): void;
}
```

### API semantics

#### `updateContextItems(items)`

- replaces the current composer context snapshot with `items`
- should tolerate empty arrays; `[]` means clear current context
- should ignore malformed items and keep only valid items
- should deduplicate items according to the identity rules below

## Identity and deduplication

The composer should avoid adding duplicate chips when the same host event arrives repeatedly.

Recommended identity keys:

- `instance` → `instance:${GUID}`
- `file` with selection → `file:${uri}:${startLine}:${startCharacter}:${endLine}:${endCharacter}`
- `file` without selection → `file:${uri}`

If a new item arrives with the same identity key, the default behavior is replace-in-place rather than append-duplicate.

## Transport model

The transport from host code into the web UI is host-specific. The UI-facing model and semantics remain shared.

### Unreal Engine

Unreal Engine uses `UWebBrowser::ExecuteJavascript(...)` to call the bridge API inside the loaded page.

Example:

```cpp
Browser->ExecuteJavascript(
	TEXT("window.AgentNativeBridge.updateContextItems([{GUID:'guid-1',ClassType:'Part',Name:'Spawn_A'}]);")
);
```

### VS Code

The VS Code extension should use the standard host↔webview messaging bridge:

- extension host → `webview.postMessage(...)`
- webview page → `window.addEventListener("message", ...)`

The webview page then forwards the payload to `window.AgentNativeBridge.updateContextItems(...)`.

Example extension host payload:

```ts
panel.webview.postMessage({
	type: "agent-native-bridge/add-context-items",
	items: [
		{
			uri: document.uri.toString(),
			Name: vscode.workspace.asRelativePath(document.uri, false),
			languageId: document.languageId,
		},
	],
});
```

Example webview forwarding:

```ts
window.addEventListener("message", (event) => {
	const message = event.data;
	if (message?.type === "agent-native-bridge/add-context-items") {
		window.AgentNativeBridge?.updateContextItems(message.items ?? []);
	}
});
```

## Host-specific mappings

### StudioRPC / Unreal selection

For external bridge callers, instance items are passed without `kind`/`source` and normalized internally.

```ts
const item: AgentNativeBridgeInputItem = {
	GUID: "2c8b9a4e-3d3d-4d89-9d1d-123456789abc",
	ClassType: "Part",
	Name: "SpawnPoint_A",
};
```

Use this when the user clicked or selected one or more concrete scene objects that an agent command may act on.

### VS Code active file

For external bridge callers, file items are passed without `kind`/`source` and normalized internally.

```ts
const item: AgentNativeBridgeInputItem = {
	uri: "file:///workspace/packages/runtime/src/app/server.ts",
	Name: "packages/runtime/src/app/server.ts",
	languageId: "typescript",
};
```

If selection data is available and meaningful, include it:

```ts
const itemWithSelection: AgentNativeBridgeInputItem = {
	uri: "file:///workspace/packages/runtime/src/app/server.ts",
	Name: "packages/runtime/src/app/server.ts",
	languageId: "typescript",
	selection: {
		startLine: 12,
		startCharacter: 0,
		endLine: 24,
		endCharacter: 1,
	},
};
```

Use this when the user opened a file, focused a new editor, or selected a relevant range.

## Recommended host behaviors

### Unreal / StudioRPC hosts

- call `updateContextItems([...])` whenever the selection changes
- call `updateContextItems([])` when a selection is explicitly cleared
- do not automatically send a prompt when selection changes

### VS Code hosts

- call `updateContextItems([...])` when the active editor changes
- optionally include selection when the current range matters
- avoid flooding the UI on every cursor movement unless selection-aware mode is intentionally enabled
- dedup repeated focus events for the same file/range

## UI behavior requirements

The composer UI should:

- render one removable chip per `contextItem`
- preserve typed text when context items are added or cleared
- include current `contextItems` in the eventual message payload
- support mixed-item attachments, such as one StudioRPC instance and one VS Code file at the same time

Example payload shape sent from the client to the shared Diligent backend flow:

```json
{
	"message": "move these spawn points to match the file logic",
	"contextItems": [
		{
			"kind": "instance",
			"source": "studiorpc",
			"GUID": "guid-1",
			"ClassType": "Part",
			"Name": "Spawn_A"
		},
		{
			"kind": "file",
			"source": "vscode",
			"uri": "file:///workspace/spawn.ts",
			"Name": "spawn.ts",
			"languageId": "typescript"
		}
	]
}
```

This document defines the UI-side contract only. Whether `contextItems` should eventually become part of `@diligent/protocol` depends on broader product work and is outside the scope of this guide.

## Validation rules

Hosts should only send fields valid for the selected `kind`.

Minimum required fields:

- `instance` → `kind`, `source`, `GUID`, `ClassType`, `Name`
- `file` → `kind`, `source`, `uri`, `Name`

The web UI should ignore malformed items rather than throwing.

## Extensibility

Future item kinds may include:

- `symbol`
- `asset`
- `component`
- `selection-set`

Extension rules:

1. add a new `kind`
2. preserve `source`
3. keep `Name` when practical for basic chip rendering
4. define a stable identity key for deduplication
5. do not overload existing item kinds with unrelated fields

## Change checklist

If the bridge contract changes:

1. update this guide
2. update the host adapter implementation for each affected client
3. update the web/VS Code conversation UI reducer or bridge listener
4. update any shared client-side types if the contract is centralized in code
5. only update `@diligent/protocol` if the data must cross the app-server boundary as a shared backend contract

## Summary

`AgentNativeBridge` standardizes host-to-web composer context injection around one shared UI model:

- `AgentContextItem` is the canonical attached-context type
- `instance` covers StudioRPC object targets
- `file` covers VS Code viewing context
- `updateContextItems` is the required bridge method
- host transports differ, but the composer-facing contract remains the same
