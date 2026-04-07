# apps/overdare-agent

Tauri v2 desktop application that wraps the OVERDARE AI Agent web UI as a native Mac/Windows app.

## Architecture

```
Tauri (Rust + System WebView)
  ├── sidecar: diligent-web-server (bun build --compile)
  │   ├── Serves React SPA static files from dist/client
  │   ├── DiligentAppServer (in-process)
  │   └── WebSocket JSON-RPC at /rpc
  └── WebView → http://127.0.0.1:{dynamic-port}
```

The sidecar starts on port 0 (OS-assigned), prints `DILIGENT_PORT=<n>` to stdout, and the Rust host reads that line to know where to navigate the WebView.

## Desktop notifications

The desktop shell can show native OS notifications for background work:

- turn completed in a non-active conversation
- approval requested for a non-active conversation
- user input requested for a non-active conversation

Notifications are only sent while the desktop window is not foregrounded/visible.
Clicking a desktop notification opens the related conversation in the app.
You can enable or disable this behavior from the in-app Config panel.

## Dev Commands

```bash
# Build sidecar + launch with hot-reload WebView
bun run dev

# Full production build (.dmg / .exe)
bun run build
```

Or from repo root:

```bash
bun run desktop:dev
bun run desktop:build
```

## App-owned packaging metadata

Packaging reads branding and storage metadata directly from `apps/overdare-agent/package.json`:

```json
{
  "diligent": {
    "projectName": "OVERDARE AI Agent",
    "desktopIcons": [
      "src-tauri/icons/32x32.png",
      "src-tauri/icons/128x128.png",
      "src-tauri/icons/128x128@2x.png",
      "src-tauri/icons/icon.icns",
      "src-tauri/icons/icon.ico"
    ],
    "desktopStorageNamespace": "overdare"
  }
}
```

- `projectName`: bundle/app display name
- `desktopIcons`: icon file paths relative to the app directory; only existing files are applied
- `desktopStorageNamespace`: packaged desktop storage namespace owned by this app
