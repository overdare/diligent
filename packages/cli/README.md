# CLI

Terminal UI — the interactive TUI frontend for Diligent.

```
src/
  tui/
    app.ts           Main TUI application
    runner.ts        TUI runner / entry point
    theme.ts         Color theme definitions
    markdown.ts      Markdown rendering for terminal
    tools.ts         TUI-specific tool wiring
    framework/       Ink-based component framework
    components/      UI components (chat, input, status bar, overlays)
    commands/        Slash commands
    tools/           TUI tool adapters
  config.ts          CLI config management
  config-writer.ts   Config file writer
  provider-manager.ts  Provider/model selection
  index.ts           Package entry point
docs/                Design review notes
test/                Unit tests
```
