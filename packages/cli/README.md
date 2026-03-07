# @diligent/cli

CLI entry point and TUI. Thin client — all agent logic lives in `@diligent/core`.

## Structure

```
src/
  index.ts              Entry point, CLI arg parsing
  config.ts             CLI-specific config
  config-writer.ts      Write config changes back to disk
  provider-manager.ts   CLI-side provider setup
  app-server-stdio.ts   Spawns DiligentAppServer as a child process (stdio JSON-RPC)
  tui/
    app.ts              Root TUI app component
    runner.ts           Ink render loop
    rpc-client.ts       StdioAppServerRpcClient
    thread-manager.ts   Thread state + lifecycle
    setup-wizard.ts     First-run provider setup
    components/         Chat, tool output, status bar, overlays
    commands/           Slash command implementations
    framework/          Component base, layout, input handling
    tools/              Tool output renderers
```

## Transport

The CLI spawns `diligent app-server --stdio` as a child process and communicates over stdin/stdout using NDJSON-framed JSON-RPC 2.0. stdout is protocol-only; all diagnostics go to stderr.
