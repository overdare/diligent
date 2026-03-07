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
