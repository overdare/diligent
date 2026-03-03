---
id: P005
status: done
created: 2026-03-01
---

status: done
---

# Plan: Persist Input History Across Restarts

## Context

Currently `InputEditor` stores command history in-memory (`private history: string[]`). When the program exits, all history is lost. The goal is to persist history to disk so arrow-key recall works across restarts.

## Approach

Add a standalone `InputHistory` class that wraps file-based persistence, then inject it into `InputEditor`.

### Storage Location

`~/.config/diligent/history` — follows the existing global config pattern (`~/.config/diligent/diligent.jsonc`).

### Format

Plain text, one entry per line. Simple, human-readable, easy to append.

## Files to Change

### 1. New: `packages/cli/src/tui/input-history.ts`

A small class that handles load/save:

```typescript
export class InputHistory {
  private entries: string[] = [];
  private maxSize: number;
  private filePath: string;

  constructor(filePath: string, maxSize = 100)

  async load(): Promise<void>       // Read file, populate entries
  add(text: string): void           // Dedupe last, push, trim, fire save
  getEntries(): string[]            // Return copy
  private async save(): Promise<void>  // Write entries to file
}
```

- `load()`: read file, split by newline, filter empty, take last `maxSize`
- `add()`: skip if same as last entry, push, trim to maxSize, call `save()` (fire-and-forget)
- `save()`: `mkdir -p` parent dir, write entries joined by `\n`

### 2. Modify: `packages/cli/src/tui/components/input-editor.ts`

- Add `InputEditorOptions.history?: InputHistory`
- In constructor: if history provided, set `this.history` from `history.getEntries()`; store reference as `this.persistentHistory`
- In `addToHistory()`: also call `this.persistentHistory?.add(text)`

### 3. Modify: `packages/cli/src/tui/app.ts`

- Import `InputHistory`
- In `App.start()` (before creating InputEditor, or call `loadHistory` in start):
  - Create `InputHistory` with path `~/.config/diligent/history`
  - Call `await history.load()`
  - Pass to InputEditor options

### 4. New/Modify: tests

- Add unit tests for `InputHistory` (load, add, dedup, max size, file I/O)
- Existing `input-editor.test.ts` tests remain unchanged (history option is optional)

## Verification

1. `bun test` — all existing tests pass
2. `bun run typecheck` — no type errors
3. Manual: run diligent, type some commands, exit, restart, press ↑ — previous commands appear
