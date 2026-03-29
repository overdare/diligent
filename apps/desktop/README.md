# apps/desktop

Tauri v2 desktop application that wraps the Diligent web UI as a native Mac/Windows app.

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

## Packaging customization via `--package`

When running desktop packaging with `--package <dir>`, you can override app branding from `<dir>/package.json`:

```json
{
  "diligent": {
    "projectName": "OVERDARE Agent",
    "desktopIcons": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- `projectName`: bundle/app display name override
- `desktopIcons`: icon file paths relative to the package directory; only existing files are applied. Packaging copies them to a temporary Tauri icon directory, so existing `src-tauri/icons/*` files are not overwritten.
