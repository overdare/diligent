# VS Code Extension

The Diligent VS Code extension adds a dedicated **Diligent** activity-bar container with:

- a native **Threads** tree view
- a webview-backed **Conversation** panel
- a local `diligent app-server --stdio` child process for runtime access

## Prerequisites

- VS Code 1.96 or newer
- a local `diligent` binary available on `PATH`, or a configured `diligent.binaryPath`
- Bun dependencies installed for this repo

## Build

From the repository root:

```bash
bun run vscode:build
```

This writes the packaged extension files to `packages/vscode/dist/`.

## Package a VSIX

```bash
bun run vscode:package
```

The generated artifact is written to:

```text
packages/vscode/dist/diligent.vsix
```

## Install from VSIX

1. Open VS Code.
2. Open the Extensions view.
3. Run **Extensions: Install from VSIX...**.
4. Select `packages/vscode/dist/diligent.vsix`.

After install, the Activity Bar shows a **Diligent** container.

## Configuration

### `diligent.binaryPath`

Absolute or shell-resolved path to the Diligent CLI binary.

### `diligent.serverArgs`

Extra arguments passed before `app-server --stdio`.

## Commands

- `Diligent: Start Server`
- `Diligent: New Thread`
- `Diligent: Send Prompt`
- `Diligent: Interrupt`
- `Diligent: Refresh Threads`
- `Diligent: Open Logs`

## Current limitations

- Remote SSH / Dev Containers / Codespaces are not supported in v1.
- The extension uses one local stdio app-server process per VS Code window.
- Logs are exposed through a temporary text document rather than a custom output channel.
- The conversation panel is a focused transcript/composer surface, not a full web client embed.

## Troubleshooting

### Server fails to start

- Confirm `diligent` runs in a terminal.
- Set `diligent.binaryPath` explicitly if the binary is not on `PATH`.
- Open **Diligent: Open Logs** after a failed start.

### Threads do not appear

- Run **Diligent: Refresh Threads**.
- Ensure the workspace folder is the intended Diligent project root.

### Prompts hang on approval/input

- Keep VS Code focused so native approval/input prompts are visible.
- Check whether another Diligent client already answered the pending server request.
