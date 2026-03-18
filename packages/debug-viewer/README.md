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

## Internal Windows EXE distribution

Build a standalone Windows bundle (no Bun required on user machines):

```bash
bun run build:windows-exe
```

Output directory:

```text
dist/debug-viewer-windows/
  debug-viewer.exe
  client/
  run-debug-viewer.bat
  README.txt
```

Data directory resolution at runtime:

1. If `--data-dir` is provided, it is used.
2. Otherwise, it searches from current working directory (for `.diligent`).
3. If not found, it falls back to `<exe folder>/.diligent`.
