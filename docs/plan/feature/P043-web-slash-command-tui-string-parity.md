---
id: P043
status: backlog
created: 2026-03-09
---

# Web Slash Commands — String-Only TUI Parity

## Goal

Web slash commands stop inventing Web-only behavior and instead match the string-command portion of the TUI command model. The Web input keeps autocomplete, but command selection never opens submenus or dialogs, Web-only `/mode` and `/effort` disappear, and supported TUI commands execute only through explicit string syntax.

## Prerequisites

- P042 autocomplete groundwork in `packages/web/src/client/lib/slash-commands.ts`, `InputDock.tsx`, and `SlashMenu.tsx`
- Existing Web thread actions in `packages/web/src/client/App.tsx` (`startNewThread()`, `openThread()`)
- Existing model switching through `useProviderManager().changeModel()` and `CONFIG_SET`
- Existing skill discovery in `InitializeResponse.skills` and server-side slash-skill rewriting in `packages/core/src/app-server/thread-handlers.ts`

## Artifact

```text
User types "/"
→ Autocomplete shows only Web-supported TUI commands plus dynamic skills
→ It does not show Web-only `/mode` or `/effort`

User types "/model claude-sonnet-4-6"
→ Web sends the existing model-switch path
→ Toast confirms the model switch

User clicks "/resume" in the autocomplete list
→ No picker opens
→ Web shows: "Usage: /resume <thread-id>"

User types "/resume thread-123"
→ Web opens the existing thread

User types "/write-plan sync slash commands"
→ Web sends the slash string as a normal turn
→ Server rewrites it into the existing skill-tool invocation flow
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/web/src/client/lib/` | Replace the Web-specific slash catalog with a string-only subset derived from TUI command names and semantics |
| `packages/web/src/client/components/` | Simplify autocomplete UI to a single command list with no inline option tree and no dialog-trigger affordances |
| `packages/web/src/client/` | Update slash execution to support only direct string-safe commands and existing dynamic skills |
| `packages/web/test/` | Lock the reduced command set and simplified menu behavior with unit/render tests |

### What does NOT change

- No new slash-command dialogs, pickers, or modal flows in Web
- No Web-only `/mode` or `/effort`; they are removed from slash parsing, menus, and execution
- No Web slash support for dialog-dependent commands the user excluded: `/provider`, `/tools`, `/delete`, `/skills`
- No Web slash support for browser-ambiguous TUI commands that do not have a clear string-only equivalent in this scope: `/status`, `/compact`, `/clear`, `/exit`, `/version`, `/config`, `/cost`, `/bug`, `/reload`
- No protocol schema changes; this plan reuses existing `THREAD_START`, `THREAD_RESUME`, `CONFIG_SET`, and skill invocation behavior
- No transcript-style system message rendering for slash results; command feedback stays in the existing toast/local UI patterns
- No changes to TUI slash commands

## File Manifest

### `packages/web/src/client/lib/`

| File | Action | Description |
|------|--------|------------|
| `slash-commands.ts` | MODIFY | Remove Web-only commands and submenu metadata; add usage metadata for arg-required commands |

### `packages/web/src/client/components/`

| File | Action | Description |
|------|--------|------------|
| `SlashMenu.tsx` | MODIFY | Collapse the menu to a flat command list with no option expansion UI |
| `InputDock.tsx` | MODIFY | Remove submenu state and keep only flat-list navigation/selection behavior |

### `packages/web/src/client/`

| File | Action | Description |
|------|--------|------------|
| `App.tsx` | MODIFY | Rework `handleSlashCommand()` to the supported TUI subset and usage-first behavior for missing args |

### `packages/web/test/`

| File | Action | Description |
|------|--------|------------|
| `slash-commands.test.ts` | MODIFY | Update command catalog and parser tests for the reduced command set |
| `components.test.tsx` | MODIFY | Update `SlashMenu` render expectations to the simplified flat-list UI |

## Implementation Tasks

### Task 1: Recut the Web slash catalog to the approved TUI subset

**Files:** `packages/web/src/client/lib/slash-commands.ts`
**Decisions:** D051, D052, D053

Replace the current Web-defined builtins with a narrow, explicit catalog that only contains commands the user approved for string-only Web support. In the current scoped plan that means:

- `/help`
- `/new`
- `/resume <thread-id>`
- `/model <model-id>`
- dynamic `/{skill-name} [args]`

`/mode` and `/effort` are removed entirely so Web no longer exposes commands that TUI does not have. Because `buildCommandList()` will stop reserving `mode` and `effort`, a skill with one of those names will once again be visible on Web, matching current TUI collision rules.

Add lightweight metadata for usage/arg requirements instead of submenu options.

```typescript
export interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
  requiresArgs?: boolean;
  isSkill?: boolean;
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show available commands" },
  { name: "new", description: "Start a new session" },
  {
    name: "resume",
    description: "Resume thread",
    usage: "/resume <thread-id>",
    requiresArgs: true,
  },
  {
    name: "model",
    description: "Switch model",
    usage: "/model <model-id>",
    requiresArgs: true,
  },
];
```

Keep `parseSlashCommand()`, `filterCommands()`, and `isSlashPrefix()` behavior unchanged unless test coverage shows a necessary adjustment. The parser should remain string-first and should not introduce option-tree parsing.

**Verify:** Unit tests show that `/mode` and `/effort` are gone, `/resume` and `/model` are present, and skills named `mode` or `effort` are no longer filtered out as builtin collisions.

### Task 2: Simplify the autocomplete UI to a flat list only

**Files:** `packages/web/src/client/components/SlashMenu.tsx`, `packages/web/src/client/components/InputDock.tsx`
**Decisions:** D051

Remove the submenu-specific state and rendering introduced by P042:

- `SlashCommandOption`
- `expandedCommand`
- `subSelectedIndex`
- inline option rows and chevrons
- `onSelectOption()` plumbing

The autocomplete should remain, but it becomes a single list of command rows. Mouse click and `Enter` still trigger the selected command immediately. `Tab` can keep filling `/<command> ` into the input as a convenience for arg-required commands, but `Enter` and click should not open any dialog or nested picker.

```typescript
interface SlashMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
}

const [slashMenuOpen, setSlashMenuOpen] = useState(false);
const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
const [slashFiltered, setSlashFiltered] = useState<SlashCommand[]>([]);
```

Keyboard handling becomes simpler:

- `ArrowUp` / `ArrowDown`: move through one list
- `Enter`: execute highlighted command
- `Tab`: insert `/<command> ` into the input
- `Escape`: close the menu

This preserves autocomplete discoverability while enforcing the user's "string command only" rule.

**Verify:** `SlashMenu` renders a flat list, no longer emits submenu markup, and keyboard navigation works with a single selected index only.

### Task 3: Rework Web slash execution to string-only command semantics

**Files:** `packages/web/src/client/App.tsx`
**Decisions:** D051, D052, D053, D087

Update `handleSlashCommand()` so Web executes only the supported TUI-subset commands and treats argless selection of arg-required commands as a usage response rather than a dialog trigger.

```typescript
const handleSlashCommand = useCallback(
  async (name: string, arg?: string) => {
    switch (name) {
      case "help":
        dispatch({ type: "show_info_toast", payload: "Commands: /help, /new, /resume, /model, /<skill>" });
        return;
      case "new":
        await startNewThread();
        return;
      case "resume":
        if (!arg) {
          dispatch({ type: "show_info_toast", payload: "Usage: /resume <thread-id>" });
          return;
        }
        await openThread(arg);
        return;
      case "model":
        if (!arg) {
          dispatch({ type: "show_info_toast", payload: "Usage: /model <model-id>" });
          return;
        }
        if (!providerMgr.availableModels.some((model) => model.id === arg)) {
          dispatch({ type: "show_info_toast", payload: `Unknown model: ${arg}` });
          return;
        }
        await providerMgr.changeModel(arg);
        dispatch({ type: "show_info_toast", payload: `Model switched to ${arg}` });
        return;
      default:
        await runSkillSlashCommandIfKnown(name, arg);
    }
  },
  [startNewThread, openThread, providerMgr],
);
```

Implementation notes:

- Reuse `openThread()` for `/resume <thread-id>` instead of inventing a new path
- Reuse `providerMgr.availableModels` + `providerMgr.changeModel()` for `/model <model-id>` instead of opening the existing model selector
- Keep dynamic skill handling exactly as it works today: Web sends the slash string as a normal turn, and the server rewrites it into a forced skill-tool instruction
- Remove `/mode` and `/effort` branches entirely
- Unsupported commands should resolve as unknown/unavailable rather than opening sidebars or modals

The underlying collaboration-mode feature remains available via the existing Web controls; only the Web slash entry point is removed.

**Verify:** `/new` starts a thread, `/resume <thread-id>` opens an existing thread, `/model <model-id>` switches model, `/mode` is no longer recognized, and dynamic skills still execute through `TURN_START`.

### Task 4: Lock the reduced surface with regression tests

**Files:** `packages/web/test/slash-commands.test.ts`, `packages/web/test/components.test.tsx`
**Decisions:** D051, D052, D053

Update tests so the new command surface is explicit and hard to regress.

Key cases:

- `BUILTIN_COMMANDS` contains only `help`, `new`, `resume`, `model`
- `buildCommandList()` appends skills after those builtins
- skills named `mode` or `effort` are allowed again because Web no longer claims those names
- `parseSlashCommand("/resume thread-1")` parses correctly
- `parseSlashCommand("/model claude-sonnet-4-6")` parses correctly
- `SlashMenu` renders a flat list and no submenu rows/options
- the static render output no longer contains submenu chevrons or option labels from `/mode` and `/effort`

Manual verification should cover both menu-driven and typed-string flows:

1. Type `/` and confirm only the allowed commands appear
2. Click `/model` and confirm usage is shown instead of a dialog
3. Type `/model <id>` and confirm the selected model changes
4. Type `/resume <id>` and confirm the thread opens
5. Type `/write-plan ...` and confirm the skill path still works

**Verify:** `bun test` in `packages/web` passes with the updated assertions.

## Acceptance Criteria

1. `bun test` passes for the Web package after the slash command changes.
2. Typing `/` in the Web input shows only `/help`, `/new`, `/resume`, `/model`, plus discovered skill commands.
3. `/mode` and `/effort` are removed from the Web slash menu and no longer execute as slash commands.
4. Selecting `/model` or `/resume` from autocomplete does not open a submenu, modal, or picker.
5. Running `/model <model-id>` changes the active model through the existing Web model-switch path.
6. Running `/resume <thread-id>` reuses the existing thread-open path and navigates to that thread when found.
7. Running `/model` or `/resume` without args shows a usage message instead of opening UI.
8. Dynamic skill commands still execute by sending the slash string to `TURN_START` and relying on the existing server-side skill rewrite.
9. Unsupported commands excluded by this plan (`/provider`, `/tools`, `/delete`, `/skills`, `/status`, `/compact`, `/clear`, `/exit`, `/version`, `/config`, `/cost`, `/bug`, `/reload`) do not appear in the Web slash menu.
10. No new dialog-based slash command behavior is introduced in Web.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Slash command catalog, parser, filtering, skill merge behavior | `bun test packages/web/test/slash-commands.test.ts` |
| Render | Flat `SlashMenu` markup and absence of submenu UI | `bun test packages/web/test/components.test.tsx` |
| Integration | `/new`, `/resume <thread-id>`, `/model <model-id>`, skill invocation | Manual browser run against the existing Web app server |
| Manual | Unsupported command removal and no-dialog behavior | Type `/`, click commands, confirm only usage toasts or direct execution occur |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Immediate execution of arg-required commands feels awkward from autocomplete | Users may click `/model` or `/resume` and think nothing useful happened | Show explicit usage toasts and keep `Tab` completion so users can fill `/<command> ` before typing args |
| Web and TUI catalogs drift again later | Future additions may reintroduce Web-only slash commands | Lock the approved Web builtin list with tests and keep the scope intentionally narrow |
| `/model <id>` can target a model that is not currently available | Users see silent failures or confusing state | Validate against `providerMgr.availableModels` before calling `changeModel()` and show a direct toast on failure |
| Removing `/mode` and `/effort` surprises existing Web users | Some users may rely on the old shortcuts | Keep the existing mode/effort UI controls unchanged; remove only the slash entry points |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D051 | Slash commands — registry pattern with handler functions | Task 1 command metadata shape, Task 2 flat-list menu contract, Task 3 dispatch structure |
| D052 | Skills — SKILL.md with frontmatter, progressive disclosure | Task 1 dynamic skill merge remains metadata-driven |
| D053 | Skill invocation — implicit with explicit slash fallback | Task 3 keeps `/{skill-name}` handling as the explicit Web fallback |
| D087 | Collaboration modes — codex-rs style modal agent behavior | Task 3 removes only the Web slash entry point for modes, not the core collaboration-mode feature |
