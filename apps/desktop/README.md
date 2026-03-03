# Desktop

Tauri v2 native desktop application that wraps the Diligent web UI as a native Mac/Windows app.

Tauri (Rust + System WebView) runs a sidecar (diligent-web-server compiled with bun) that serves the React SPA and WebSocket JSON-RPC endpoint, with the WebView connecting to the dynamically assigned port.

```
loading/    Splash screen shown while sidecar boots
scripts/    Build tooling
src-tauri/
  src/        Rust backend source
  binaries/   Binary configurations
  capabilities/
  gen/        Generated files
  icons/      Application icons
  resources/  Static resources
```
