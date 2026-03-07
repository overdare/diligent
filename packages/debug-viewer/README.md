# @diligent/debug-viewer

Standalone web UI for inspecting `.diligent/` session data. No agent connection needed — reads session JSONL files directly.

## Structure

```
src/
  server/
    index.ts        Serves the SPA + exposes session file API
    sample-data/    Sample sessions for development
  client/
    components/     Session list, event timeline, message inspector
    hooks/          Data fetching hooks
    lib/            Session parser, formatters
  shared/           Shared types
```

## Dev

```bash
bun run dev     # Dev server
bun run build   # Production build
```
