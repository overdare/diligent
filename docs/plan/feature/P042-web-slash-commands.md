---
id: P042
status: done
created: 2026-03-08
---

# Web Slash Commands — Autocomplete + Execution

## Goal

Web users can type `/` in the chat input to see a filtered autocomplete dropdown of available commands, select one with keyboard or mouse, and execute it — matching TUI slash-command discoverability without leaving the chat input flow.

## Prerequisites

- Existing `InputDock` + `TextArea` components (already exist)
- RPC client with `MODE_SET`, `EFFORT_SET`, `THREAD_START`, `THREAD_DELETE` etc. (already wired)
- `Select.tsx` dropdown patterns for styling reference (already exist)

## Artifact

```
User types "/" in chat input
→ Autocomplete dropdown appears above the input with all commands
User continues typing "/mo"
→ Dropdown filters to show "/mode" and "/model"
User presses ↓ to select "/mode", then Enter (or clicks)
→ "/mode" submenu shows options: default, plan, execute
User selects "plan"
→ Mode switches to plan, input clears, toast confirms "Mode set to plan"
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| packages/web/src/client/components/ | New `SlashMenu.tsx` autocomplete dropdown component |
| packages/web/src/client/components/InputDock.tsx | Integrate slash menu trigger, intercept submit for commands |
| packages/web/src/client/App.tsx | Command execution handlers, pass callbacks to InputDock |
| packages/web/src/client/lib/ | New `slash-commands.ts` — command definitions + parser |
| packages/web/test/ | Tests for parser and component rendering |

### What does NOT change

- No TUI changes (TUI already has full slash command support)
- No protocol changes (all needed RPC methods already exist)
- No new shared package — commands are web-specific thin wrappers around existing RPC calls
- No `/resume`, `/delete`, `/tools`, `/config`, `/skills`, `/status`, `/cost` (core set only for now)
- No slash command history or frecency (future enhancement)

## File Manifest

### packages/web/src/client/lib/

| File | Action | Description |
|------|--------|------------|
| `slash-commands.ts` | CREATE | Command definitions, parser, filter logic |

### packages/web/src/client/components/

| File | Action | Description |
|------|--------|------------|
| `SlashMenu.tsx` | CREATE | Autocomplete dropdown component |
| `InputDock.tsx` | MODIFY | Wire slash menu, intercept command submit |
| `TextArea.tsx` | MODIFY | Expose ref for cursor position; forward onKeyDown for arrow interception |

### packages/web/src/client/

| File | Action | Description |
|------|--------|------------|
| `App.tsx` | MODIFY | Add command execution handlers, pass to InputDock |

### packages/web/test/

| File | Action | Description |
|------|--------|------------|
| `slash-commands.test.ts` | CREATE | Parser and filter tests |
| `components.test.tsx` | MODIFY | Add SlashMenu render tests |

## Implementation Tasks

### Task 1: Command definitions and parser

**Files:** `packages/web/src/client/lib/slash-commands.ts`
**Decisions:** D051 (registry pattern with handler functions)

Define the command catalog and parsing logic. Commands are simple objects — execution is handled by the caller via callbacks.

```typescript
export interface SlashCommand {
  name: string;
  description: string;
  /** Sub-options for commands like /mode, /effort */
  options?: { label: string; value: string; description?: string }[];
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "help",
    description: "Show available commands",
  },
  {
    name: "new",
    description: "Start a new conversation",
  },
  {
    name: "mode",
    description: "Set collaboration mode",
    options: [
      { label: "Default", value: "default", description: "Normal conversation" },
      { label: "Plan", value: "plan", description: "Plan before acting" },
      { label: "Execute", value: "execute", description: "Execute without asking" },
    ],
  },
  {
    name: "effort",
    description: "Set thinking effort",
    options: [
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
      { label: "Max", value: "max" },
    ],
  },
  {
    name: "model",
    description: "Change the model",
  },
];

export interface ParsedSlashCommand {
  name: string;
  args: string | undefined;
}

/** Returns null if not a slash command (doesn't start with / or starts with //) */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { name: trimmed.slice(1), args: undefined };
  return { name: trimmed.slice(1, spaceIdx), args: trimmed.slice(spaceIdx + 1).trim() || undefined };
}

/** Filter commands by partial name (after the /) */
export function filterCommands(partial: string): SlashCommand[] {
  const lower = partial.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(lower));
}

/** Check if input is a slash command prefix (for triggering autocomplete) */
export function isSlashPrefix(text: string): boolean {
  return text.startsWith("/") && !text.startsWith("//") && !text.includes(" ");
}
```

**Verify:** Unit tests pass for parser and filter functions.

### Task 2: SlashMenu autocomplete component

**Files:** `packages/web/src/client/components/SlashMenu.tsx`

A floating dropdown that renders above the input. Shows filtered commands, supports keyboard navigation and mouse selection. When a command has sub-options (like `/mode`), selecting it shows a secondary level.

```typescript
interface SlashMenuProps {
  /** Filtered commands to display */
  commands: SlashCommand[];
  /** Currently highlighted index */
  selectedIndex: number;
  /** Called when user selects a command (click or Enter) */
  onSelect: (command: SlashCommand) => void;
  /** Called when user selects a sub-option */
  onSelectOption: (command: SlashCommand, value: string) => void;
}
```

Styling follows existing patterns:
- `absolute bottom-full mb-2 z-30` — positioned above input
- `rounded-xl border border-text/10 bg-bg/95 shadow-panel backdrop-blur`
- Selected item: `bg-accent/15 text-text`
- Hover: `hover:bg-surface/80`
- Command name in `text-text text-xs font-medium`, description in `text-muted text-xs`
- Max 6 visible items with overflow scroll
- Sub-options appear as inline expansion under the selected command

**Verify:** Component renders with correct ARIA attributes (`role="listbox"`, `role="option"`).

### Task 3: Integrate into InputDock

**Files:** `packages/web/src/client/components/InputDock.tsx`, `packages/web/src/client/components/TextArea.tsx`

Wire the slash menu into the input flow:

1. **TextArea changes:** Accept `onKeyDown` prop so InputDock can intercept arrow keys and Enter when the menu is open. The TextArea should forward `ref` for focus management.

2. **InputDock state:**
   ```typescript
   const [slashMenuOpen, setSlashMenuOpen] = useState(false);
   const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
   const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
   ```

3. **Input change handler:** When input changes, check `isSlashPrefix(value)` → if true, compute `filterCommands(value.slice(1))`, open menu. Otherwise close.

4. **Key interception (when menu open):**
   - `ArrowUp` / `ArrowDown`: Navigate selection (prevent default)
   - `Enter`: Select highlighted command (prevent send)
   - `Escape`: Close menu, keep text
   - `Tab`: Accept command name into input

5. **Command selection flow:**
   - Simple command (no options): Call `onCommand(name)`, clear input
   - Command with options (mode/effort): Show sub-options inline, then call `onCommand(name, value)` on sub-selection
   - `/model`: Special — trigger the existing model selector dropdown focus

**Verify:** Typing `/` shows the menu; arrow keys navigate; Enter selects.

### Task 4: Command execution in App.tsx

**Files:** `packages/web/src/client/App.tsx`

Add a `handleSlashCommand` function that maps command names to RPC calls:

```typescript
const handleSlashCommand = useCallback(
  async (name: string, arg?: string) => {
    switch (name) {
      case "help":
        // Show toast with command list (or a small modal)
        toast("Available commands: /help, /new, /mode, /effort, /model");
        break;
      case "new":
        await startNewThread();
        break;
      case "mode":
        if (arg && ["default", "plan", "execute"].includes(arg)) {
          await rpc.request(MODE_SET, { threadId, mode: arg });
          toast(`Mode set to ${arg}`);
        }
        break;
      case "effort":
        if (arg && ["low", "medium", "high", "max"].includes(arg)) {
          await rpc.request(EFFORT_SET, { threadId, effort: arg });
          toast(`Effort set to ${arg}`);
        }
        break;
      case "model":
        // Focus the model selector in InputDock
        // (Handled in InputDock — trigger model dropdown open)
        break;
    }
    setInput("");
  },
  [threadId, rpc, startNewThread],
);
```

Also intercept in `sendMessage()`: if text parses as a known slash command, route to `handleSlashCommand` instead of sending as a message.

**Verify:** `/new` creates a new thread; `/mode plan` switches mode; `/effort high` changes effort.

### Task 5: Tests

**Files:** `packages/web/test/slash-commands.test.ts`, `packages/web/test/components.test.tsx`

Parser tests:
- `parseSlashCommand("/help")` → `{ name: "help", args: undefined }`
- `parseSlashCommand("/mode plan")` → `{ name: "mode", args: "plan" }`
- `parseSlashCommand("hello")` → `null`
- `parseSlashCommand("//escaped")` → `null`
- `filterCommands("mo")` → `[mode, model]`
- `filterCommands("")` → all commands
- `isSlashPrefix("/m")` → true
- `isSlashPrefix("/mode plan")` → false (has space)

Component tests:
- SlashMenu renders command list
- SlashMenu highlights selected index with accent class
- SlashMenu includes proper ARIA roles

**Verify:** `bun test` passes in web package.

## Acceptance Criteria

1. `bun test` — all existing + new tests pass
2. Typing `/` in web chat input shows autocomplete dropdown with all 5 commands
3. Typing filters the dropdown in real-time
4. Arrow keys navigate, Enter selects, Escape dismisses
5. `/new` creates a new thread
6. `/mode plan` switches to plan mode with toast confirmation
7. `/effort high` changes effort with toast confirmation
8. `/help` shows available commands
9. `/model` opens the model selector
10. Regular messages starting with `//` are sent as-is (escape hatch)
11. No `any` type escape hatches in new code

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Parser + filter functions | `bun test` — pure function tests |
| Unit | SlashMenu render output | `bun test` — renderToStaticMarkup |
| Integration | Command execution flow | Manual — type commands, verify RPC calls |
| Manual | Autocomplete UX | Run web dev, type `/`, verify dropdown behavior |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Keyboard event conflicts between TextArea and SlashMenu | Enter sends message instead of selecting command | Explicit `onKeyDown` interception with `preventDefault()` when menu is open |
| Focus management when menu opens/closes | Menu steals focus from input | Keep focus on TextArea always; menu is display-only, keyboard routed from TextArea |
| IME composition conflicts (CJK input after `/`) | Menu flickers during composition | Check `isComposing` before triggering autocomplete |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D051 | Slash commands — registry pattern with handler functions | Task 1: command definitions follow same shape |
