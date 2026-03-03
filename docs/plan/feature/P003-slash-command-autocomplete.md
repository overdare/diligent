---
id: P003
status: done
created: 2026-02-27
---

status: done
---

# Slash Command Inline Autocomplete

## Context

Current Tab completion works but is invisible — the user must press Tab and guess what's available. The goal is to show a real-time dropdown of matching commands as the user types after `/`, with arrow-key navigation and selection. This makes commands discoverable and faster to use.

## Approach: InputEditor-internal completion menu

Keep the completion popup self-contained inside `InputEditor`. No overlay system changes needed — the popup renders as part of InputEditor's `render()` output, appearing above the input line. This avoids the complexity of changing overlay input routing (overlays capture ALL input, but we need typing to still reach InputEditor).

## Files to modify

| File | Change |
|------|--------|
| `packages/cli/src/tui/commands/registry.ts` | Add `completeDetailed()` returning `CompletionItem[]` |
| `packages/cli/src/tui/components/input-editor.ts` | Add completion popup state, rendering, and keyboard handling |
| `packages/cli/src/tui/app.ts` | Wire `onCompleteDetailed` callback |
| `packages/cli/src/tui/commands/__tests__/registry.test.ts` | Tests for `completeDetailed()` |
| `packages/cli/src/tui/components/__tests__/input-editor.test.ts` | Tests for popup behavior |

## Step 1: CommandRegistry.completeDetailed()

Add a new type and method to `registry.ts`:

```typescript
export interface CompletionItem {
  name: string;
  description: string;
}

completeDetailed(partial: string): CompletionItem[] {
  const all = [...this.commands.keys(), ...this.aliases.keys()];
  return all
    .filter(n => n.startsWith(partial))
    .sort()
    .map(name => {
      const cmd = this.get(name);
      return { name, description: cmd?.description ?? "" };
    });
}
```

Keep existing `complete()` method untouched (still used by Tab prefix logic internally).

## Step 2: InputEditor completion popup

### New option

```typescript
export interface InputEditorOptions {
  // ... existing
  onCompleteDetailed?: (partial: string) => CompletionItem[];
}
```

### Internal state

```typescript
private completionItems: CompletionItem[] = [];
private completionIndex = 0;
private completionVisible = false;
private completionScrollOffset = 0;
```

### Trigger: `updateCompletion()`

Called after every text mutation (printable char, backspace, delete, Ctrl+U/W/K, setText):

```typescript
private updateCompletion(): void {
  if (
    this.text.startsWith("/") &&
    !this.text.startsWith("//") &&
    !this.text.includes(" ") &&
    this.options.onCompleteDetailed
  ) {
    const partial = this.text.slice(1);
    this.completionItems = this.options.onCompleteDetailed(partial);
    this.completionVisible = this.completionItems.length > 0;
    this.completionIndex = 0;
    this.completionScrollOffset = 0;
  } else {
    this.completionVisible = false;
    this.completionItems = [];
  }
}
```

### Key handling changes (when `completionVisible`)

| Key | Behavior |
|-----|----------|
| **Up/Down** | Navigate completion list (intercept before history navigation) |
| **Tab** | Accept selected item → fill `/{name} `, update popup |
| **Enter** | Accept selected item → fill `/{name}` and submit |
| **Escape** | Close popup, keep typed text |
| Typing | Normal insert + `updateCompletion()` |

### Rendering

Popup lines appear above the separator in InputEditor's `render()` output:

```
 ▸ help     Get help with using the agent       ← cyan (selected)
   model    Change the model
   new      Start a new conversation
──────────────────────────────────────────
› /h█
──────────────────────────────────────────
```

- Max 8 visible items with scroll indicators (`↑ N more` / `↓ N more`)
- Selected item: `▸` marker in cyan
- Description: dimmed, right of name
- No box borders (lightweight, inline feel)

## Step 3: App wiring

In `app.ts` constructor, add the new callback alongside the existing one:

```typescript
this.inputEditor = new InputEditor(
  {
    onSubmit: (text) => this.handleSubmit(text),
    onCancel: () => this.handleCancel(),
    onExit: () => this.shutdown(),
    onComplete: (partial) => this.commandRegistry.complete(partial),
    onCompleteDetailed: (partial) => this.commandRegistry.completeDetailed(partial),
  },
  requestRender,
);
```

Note: `reloadConfig()` rebuilds the `commandRegistry` but `onCompleteDetailed` is a closure that calls `this.commandRegistry`, so it automatically picks up the new registry.

## Step 4: Tests

### Registry tests
- `completeDetailed()` returns items with name + description
- Includes aliases with resolved description
- Empty partial returns all commands
- No match returns empty array

### InputEditor tests
- Popup appears when typing `/` (via `onCompleteDetailed`)
- Popup filters as more characters are typed
- Up/Down navigates selection index
- Tab accepts completion and fills text
- Enter accepts completion and submits
- Escape closes popup
- Popup hidden when text doesn't start with `/`
- Popup hidden after space in input
- Popup renders correct number of lines (base 4 + popup items)

## Verification

```bash
bun test                  # All tests pass
bun run typecheck         # No type errors
bun run lint              # Clean
```

Manual: run `bun run packages/cli/src/main.ts`, type `/` and verify the popup appears with all commands, type more to filter, use arrow keys to navigate, Tab to accept, Enter to execute.
