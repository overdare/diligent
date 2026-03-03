---
id: P016
status: backlog
created: 2026-03-03
---

# Per-Tool Output Limits + Plan Mode Bash Allowlist/Denylist

## Goal

Replace the uniform 50KB/2000-line global truncation with per-tool defaults and user-configurable overrides (attractor spec §5.2), and re-enable bash in plan mode gated by regex-based command filtering (D087a).

## Prerequisites

- Truncation system in `tool/truncation.ts` (D025) — exists
- Collaboration modes in `agent/types.ts` (D087) — exists
- Config schema in `config/schema.ts` — exists

## Artifact

Per-tool limits:
```
# bash now truncates at 30KB/256 lines instead of 50KB/2000
$ diligent
> run a command that produces a lot of output
[bash output truncated at 30KB/256 lines with tail strategy]
```

Plan mode bash:
```
# plan mode: safe commands pass, destructive commands blocked
$ diligent --mode plan
> run git status
[git status output]

> run git push origin main
[Blocked in plan mode] Command matches deny pattern: ^git\s+(push|pull|...)
Command: git push origin main
```

Config override:
```jsonc
{
  "tools": {
    "bash": { "maxOutputBytes": 50000, "maxOutputLines": 500 }
  },
  "planMode": {
    "bashAllowlist": ["^bun\\s+test"],
    "bashDenylist": ["^git\\s+push"]
  }
}
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/core/src/tool/types.ts` | Add `ToolOutputLimits` interface + `outputLimits?` to `Tool`; add `mode?` to `ToolContext` |
| `packages/core/src/tool/truncation.ts` | Parameterize `shouldTruncate(output, maxBytes?, maxLines?)` |
| `packages/core/src/tool/executor.ts` | Add `ToolOutputConfig` type; resolve limits: config > tool.outputLimits > global |
| `packages/core/src/tool/bash-filter.ts` | CREATE: `BashCommandFilter` with default allow/deny patterns |
| `packages/core/src/tools/bash.ts` | Add `outputLimits`; convert to factory `createBashTool(planModeConfig?)`; integrate plan mode filter; remove inline truncation |
| `packages/core/src/tools/{read,grep,glob,ls,edit,write}.ts` | Add `outputLimits` per attractor spec table |
| `packages/core/src/tools/defaults.ts` | Accept `planModeConfig?`; use `createBashTool(planModeConfig)` |
| `packages/core/src/config/schema.ts` | Add `tools` (per-tool overrides) + `planMode` (bashAllowlist/bashDenylist) sections |
| `packages/core/src/config/runtime.ts` | Thread new config sections through `RuntimeConfig` |
| `packages/core/src/agent/types.ts` | Add `"bash"` to `PLAN_MODE_ALLOWED_TOOLS`; add `toolOutputConfig?` + `planMode?` to `AgentLoopConfig` |
| `packages/core/src/agent/loop.ts` | Pass `mode` into `ToolContext`; pass `toolOutputConfig` to `executeTool()` |
| `packages/cli/src/tui/app.ts` | Pass `toolOutputConfig` + `planMode` through to `AgentLoopConfig` |
| `packages/web/src/server/index.ts` | Same wiring as CLI |
| `packages/core/src/tool/index.ts` | Export new types |
| `packages/core/src/tools/index.ts` | Export `createBashTool` |

### What does NOT change

- Existing truncation strategies (head/tail/head_tail logic) — unchanged
- Tool discovery or registry mechanism — unchanged
- Approval system (D028) — unchanged; bash in plan mode still calls `ctx.approve()`
- execute/default mode behavior — bash filtering only activates when `ctx.mode === "plan"`
- Web frontend / TUI rendering — no UI changes

## File Manifest

### packages/core/src/tool/

| File | Action | Description |
|------|--------|------------|
| `types.ts` | MODIFY | Add `ToolOutputLimits`, `ToolModeKind`, `outputLimits?` on Tool, `mode?` on ToolContext |
| `truncation.ts` | MODIFY | Parameterize `shouldTruncate()` with optional maxBytes/maxLines |
| `executor.ts` | MODIFY | Add `ToolOutputConfig`; resolve per-tool limits; pass limits to truncation functions |
| `bash-filter.ts` | CREATE | `BashCommandFilter` class with default allowlist/denylist |
| `index.ts` | MODIFY | Export new types: `ToolOutputLimits`, `ToolModeKind`, `ToolOutputConfig`, `BashCommandFilter` |

### packages/core/src/tools/

| File | Action | Description |
|------|--------|------------|
| `read.ts` | MODIFY | Add `outputLimits: { maxBytes: 50_000, maxLines: 2_000, truncateDirection: "head" }` |
| `bash.ts` | MODIFY | Add `outputLimits`; factory conversion; plan mode filter; remove inline truncation |
| `grep.ts` | MODIFY | Add `outputLimits: { maxBytes: 20_000, maxLines: 200, truncateDirection: "head" }` |
| `glob.ts` | MODIFY | Add `outputLimits: { maxBytes: 20_000, maxLines: 500, truncateDirection: "tail" }` |
| `ls.ts` | MODIFY | Add `outputLimits: { maxBytes: 20_000, maxLines: 500, truncateDirection: "tail" }` |
| `edit.ts` | MODIFY | Add `outputLimits: { maxBytes: 10_000, truncateDirection: "head" }` |
| `write.ts` | MODIFY | Add `outputLimits: { maxBytes: 1_000, truncateDirection: "head" }` |
| `defaults.ts` | MODIFY | Accept `planModeConfig?` param; use `createBashTool(planModeConfig)` |
| `index.ts` | MODIFY | Export `createBashTool` |

### packages/core/src/config/

| File | Action | Description |
|------|--------|------------|
| `schema.ts` | MODIFY | Add `tools` and `planMode` sections to `DiligentConfigSchema` |
| `runtime.ts` | MODIFY | Add `toolOutputConfig` and `planMode` to `RuntimeConfig`; wire from loaded config |

### packages/core/src/agent/

| File | Action | Description |
|------|--------|------------|
| `types.ts` | MODIFY | Add `"bash"` to `PLAN_MODE_ALLOWED_TOOLS`; add `toolOutputConfig?` + `planMode?` to `AgentLoopConfig` |
| `loop.ts` | MODIFY | Set `ctx.mode = activeMode` when constructing ToolContext; pass `config.toolOutputConfig` to `executeTool()` |

### packages/cli/src/tui/

| File | Action | Description |
|------|--------|------------|
| `app.ts` | MODIFY | Thread `toolOutputConfig` + `planMode` from RuntimeConfig into AgentLoopConfig |

### packages/web/src/server/

| File | Action | Description |
|------|--------|------------|
| `index.ts` | MODIFY | Same wiring as CLI app.ts |

### packages/core/src/tool/\_\_tests\_\_/ (new directory)

| File | Action | Description |
|------|--------|------------|
| `truncation.test.ts` | CREATE | Per-tool limit resolution tests |
| `bash-filter.test.ts` | CREATE | BashCommandFilter allow/deny/priority tests |

### packages/core/src/tools/\_\_tests\_\_/

| File | Action | Description |
|------|--------|------------|
| `bash-plan-mode.test.ts` | CREATE | End-to-end bash tool with plan mode context |

## Implementation Tasks

### Task 1: Foundation types

**Files:** `packages/core/src/tool/types.ts`
**Decisions:** D013, D025, D087, D087a

Add `ToolOutputLimits` and `ToolModeKind`, extend `Tool` and `ToolContext`:

```typescript
// Avoid importing ModeKind from agent/types.ts (circular dep risk)
export type ToolModeKind = "default" | "plan" | "execute";

export interface ToolOutputLimits {
  maxBytes?: number;
  maxLines?: number;
  truncateDirection?: "head" | "tail" | "head_tail";
}

export interface Tool<TParams extends z.ZodType = any> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>, ctx: ToolContext) => Promise<ToolResult>;
  outputLimits?: ToolOutputLimits;  // NEW
}

export interface ToolContext {
  toolCallId: string;
  signal: AbortSignal;
  approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  ask?: (request: UserInputRequest) => Promise<UserInputResponse>;
  onUpdate?: (partialResult: string) => void;
  mode?: ToolModeKind;  // NEW: current collaboration mode
}
```

**Verify:** `bun run typecheck` — no errors.

---

### Task 2: Parameterize `shouldTruncate()`

**Files:** `packages/core/src/tool/truncation.ts`
**Decisions:** D025

Change signature (backward compatible — no-args still uses globals):

```typescript
export function shouldTruncate(
  output: string,
  maxBytes: number = MAX_OUTPUT_BYTES,
  maxLines: number = MAX_OUTPUT_LINES,
): boolean {
  const bytes = new TextEncoder().encode(output).length;
  if (bytes > maxBytes) return true;
  const lines = countLines(output);
  if (lines > maxLines) return true;
  return false;
}
```

**Verify:** `bun run typecheck`.

---

### Task 3: Per-tool limit resolution in executor

**Files:** `packages/core/src/tool/executor.ts`
**Decisions:** D025

Add `ToolOutputConfig` type and limit resolution:

```typescript
export interface ToolOutputConfig {
  [toolName: string]: { maxOutputBytes?: number; maxOutputLines?: number } | undefined;
}

function resolveOutputLimits(
  toolName: string,
  toolDefaults: ToolOutputLimits | undefined,
  configOverrides: ToolOutputConfig | undefined,
): { maxBytes: number; maxLines: number; direction: "head" | "tail" | "head_tail" } {
  const override = configOverrides?.[toolName];
  return {
    maxBytes: override?.maxOutputBytes ?? toolDefaults?.maxBytes ?? MAX_OUTPUT_BYTES,
    maxLines: override?.maxOutputLines ?? toolDefaults?.maxLines ?? MAX_OUTPUT_LINES,
    direction: toolDefaults?.truncateDirection ?? "tail",
  };
}

export async function executeTool(
  registry: ToolRegistry,
  toolCall: ToolCallBlock,
  ctx: ToolContext,
  toolOutputConfig?: ToolOutputConfig,  // NEW param
): Promise<ToolResult> {
  // ... validation unchanged ...

  const result = await tool.execute(parsed.data, ctx);

  // D025: Resolve per-tool limits: config > tool.outputLimits > global
  const limits = resolveOutputLimits(toolCall.name, tool.outputLimits, toolOutputConfig);
  const direction = result.truncateDirection ?? limits.direction;

  if (shouldTruncate(result.output, limits.maxBytes, limits.maxLines)) {
    const truncated =
      direction === "head"
        ? truncateHead(result.output, limits.maxBytes, limits.maxLines)
        : direction === "head_tail"
          ? truncateHeadTail(result.output, limits.maxBytes, limits.maxLines)
          : truncateTail(result.output, limits.maxBytes, limits.maxLines);

    const savedPath = await persistFullOutput(result.output);

    return {
      output: truncated.output + TRUNCATION_WARNING +
        `\n(truncated from ${truncated.originalLines} lines / ${truncated.originalBytes} bytes. Full output at: ${savedPath})`,
      metadata: {
        ...result.metadata,
        truncated: true,
        truncatedFrom: { bytes: truncated.originalBytes, lines: truncated.originalLines },
        fullOutputPath: savedPath,
      },
      truncateDirection: direction,
    };
  }

  return result;
}
```

**Verify:** `bun run typecheck`.

---

### Task 4: Add `outputLimits` to each tool

**Files:** `tools/read.ts`, `tools/bash.ts`, `tools/grep.ts`, `tools/glob.ts`, `tools/ls.ts`, `tools/edit.ts`, `tools/write.ts`
**Decisions:** attractor spec §5.2

Per-tool defaults table (from attractor spec + additions):

| Tool | maxBytes | maxLines | truncateDirection |
|------|----------|----------|-------------------|
| read_file | 50,000 | 2,000 | head |
| bash | 30,000 | 256 | tail |
| grep | 20,000 | 200 | head |
| glob | 20,000 | 500 | tail |
| ls | 20,000 | 500 | tail |
| edit | 10,000 | — | head |
| write | 1,000 | — | head |

Add `outputLimits` property to each tool object. Example for `read.ts`:

```typescript
return {
  name: "read_file",
  description: "...",
  parameters: ReadParams,
  outputLimits: { maxBytes: 50_000, maxLines: 2_000, truncateDirection: "head" },
  async execute(args, ctx): Promise<ToolResult> { /* unchanged */ },
};
```

For `bash.ts`: also **remove the inline truncation at lines 86–89** (the `MAX_OUTPUT_BYTES` byte-slice). The executor's safety net now handles it with the correct per-tool limits. Remove the now-unused `MAX_OUTPUT_BYTES` import.

**Verify:** `bun run typecheck`. Remove `truncated` variable in bash.ts that was only used by the removed inline truncation.

---

### Task 5: Config schema additions

**Files:** `packages/core/src/config/schema.ts`

Add inside `DiligentConfigSchema`:

```typescript
// Per-tool output limit overrides
tools: z.record(
  z.string(),
  z.object({
    maxOutputBytes: z.number().int().positive().optional(),
    maxOutputLines: z.number().int().positive().optional(),
  })
).optional(),

// Plan mode bash command filtering (D087a)
planMode: z.object({
  bashAllowlist: z.array(z.string()).optional(),
  bashDenylist: z.array(z.string()).optional(),
}).optional(),
```

**Verify:** `bun run typecheck`. Check that `DiligentConfig["tools"]` and `DiligentConfig["planMode"]` resolve correctly.

---

### Task 6: `BashCommandFilter` (new file)

**Files:** `packages/core/src/tool/bash-filter.ts` (CREATE)
**Decisions:** D087a

```typescript
// @summary Regex-based command filter for bash tool in plan mode (D087a)

export interface BashFilterConfig {
  allowlist?: string[];
  denylist?: string[];
}

const DEFAULT_PLAN_BASH_ALLOWLIST = [
  "^git\\s+(status|log|diff|show|branch|remote|tag|rev-parse|ls-files|blame)",
  "^(ls|cat|head|tail|wc|file|stat|which|type|echo|pwd|date|uname)",
  "^(find|grep|rg|fd|tree|du|df)",
  "^(node|bun|deno|python|ruby)\\s+--version",
  "^(npm|yarn|pnpm|bun)\\s+(list|ls|why|info)",
  "^bun\\s+run\\s+(typecheck|lint|test)",
];

const DEFAULT_PLAN_BASH_DENYLIST = [
  "^git\\s+(push|pull|fetch|merge|rebase|reset|checkout|switch|restore|clean|stash)",
  "^(rm|rmdir|mv|cp)\\s",
  "^(curl|wget|ssh|scp)\\s",
  "(sudo|su)\\s",
  "^(docker|kubectl|terraform|pulumi)",
  "^(npm|yarn|pnpm|bun)\\s+(install|add|remove|uninstall|publish)",
  "^bun\\s+run\\s+build",
];

export class BashCommandFilter {
  private readonly denyPatterns: RegExp[];
  private readonly allowPatterns: RegExp[];

  constructor(config?: BashFilterConfig) {
    const denylist = config?.denylist ?? DEFAULT_PLAN_BASH_DENYLIST;
    const allowlist = config?.allowlist ?? DEFAULT_PLAN_BASH_ALLOWLIST;
    this.denyPatterns = denylist.map((p) => new RegExp(p));
    this.allowPatterns = allowlist.map((p) => new RegExp(p));
  }

  /** Deny-first: denylist → allowlist → default-deny */
  isAllowed(command: string): { allowed: boolean; reason?: string } {
    const trimmed = command.trim();

    for (const pattern of this.denyPatterns) {
      if (pattern.test(trimmed)) {
        return { allowed: false, reason: `Command matches deny pattern: ${pattern.source}` };
      }
    }

    for (const pattern of this.allowPatterns) {
      if (pattern.test(trimmed)) {
        return { allowed: true };
      }
    }

    return { allowed: false, reason: "Command not in plan mode allowlist" };
  }
}
```

**Verify:** Unit tests in Task 11.

---

### Task 7: Convert `bashTool` to factory + integrate plan mode filter

**Files:** `packages/core/src/tools/bash.ts`
**Decisions:** D087a

Convert the exported constant to a factory function (keep `bashTool` as a default-config export for backward compat):

```typescript
import { BashCommandFilter } from "../tool/bash-filter";
import type { BashFilterConfig } from "../tool/bash-filter";

export function createBashTool(planModeConfig?: BashFilterConfig): Tool<typeof BashParams> {
  const bashFilter = new BashCommandFilter(planModeConfig);

  return {
    name: "bash",
    description: "Execute a shell command...",
    parameters: BashParams,
    outputLimits: { maxBytes: 30_000, maxLines: 256, truncateDirection: "tail" },
    async execute(args, ctx): Promise<ToolResult> {
      // D087a: Plan mode command filtering
      if (ctx.mode === "plan") {
        const check = bashFilter.isAllowed(args.command);
        if (!check.allowed) {
          return {
            output: `[Blocked in plan mode] ${check.reason}\nCommand: ${args.command}`,
            metadata: { error: true, blockedByPlanMode: true },
          };
        }
      }

      const approval = await ctx.approve({ /* ... */ });
      if (approval === "reject") { /* ... */ }

      // ... rest of execute unchanged, minus the removed inline truncation ...
    },
  };
}

// Backward compat: default instance with no plan mode config
export const bashTool = createBashTool();
```

Update `defaults.ts` to accept and pass through `planModeConfig`:

```typescript
export function buildDefaultTools(
  cwd: string,
  paths?: DiligentPaths,
  taskDeps?: ...,
  collabDeps?: ...,
  planModeConfig?: BashFilterConfig,  // NEW
): { tools: Tool[]; registry?: AgentRegistry } {
  const tools: Tool[] = [
    createBashTool(planModeConfig),
    createReadTool(),
    // ... rest unchanged
  ];
}
```

**Verify:** `bun run typecheck`. Plan mode bash calls flow through filter.

---

### Task 8: Add bash to `PLAN_MODE_ALLOWED_TOOLS` + wire mode/config

**Files:** `packages/core/src/agent/types.ts`, `packages/core/src/agent/loop.ts`
**Decisions:** D087, D087a

In `types.ts`:

```typescript
export const PLAN_MODE_ALLOWED_TOOLS = new Set([
  "read_file", "glob", "grep", "ls", "request_user_input",
  "bash",  // D087a: re-enabled with command filtering
]);

export interface AgentLoopConfig {
  // ... existing ...
  toolOutputConfig?: Record<string, { maxOutputBytes?: number; maxOutputLines?: number }>;
  planMode?: { bashAllowlist?: string[]; bashDenylist?: string[] };
}
```

In `loop.ts`, at the ToolContext construction (line ~184):

```typescript
const ctx: ToolContext = {
  toolCallId: toolCall.id,
  signal: config.signal ?? new AbortController().signal,
  approve: async (request) => {
    if (config.approve) return config.approve(request);
    return "once";
  },
  ask: config.ask ? (request) => config.ask!(request) : undefined,
  onUpdate: (partial) => { /* ... */ },
  mode: activeMode,  // NEW
};
```

At `executeTool()` call (line ~203):

```typescript
const result = await executeTool(registry, toolCall, ctx, config.toolOutputConfig);
```

**Verify:** `bun run typecheck`. `PLAN_MODE_ALLOWED_TOOLS` now includes bash.

---

### Task 9: Wire config through RuntimeConfig → AgentLoopConfig

**Files:** `packages/core/src/config/runtime.ts`, `packages/cli/src/tui/app.ts`, `packages/web/src/server/index.ts`

In `runtime.ts`, add to `RuntimeConfig` interface and `loadRuntimeConfig()` return:

```typescript
export interface RuntimeConfig {
  // ... existing ...
  toolOutputConfig?: Record<string, { maxOutputBytes?: number; maxOutputLines?: number }>;
  planMode?: { bashAllowlist?: string[]; bashDenylist?: string[] };
}

// In loadRuntimeConfig return:
return {
  // ... existing ...
  toolOutputConfig: config.tools,
  planMode: config.planMode,
};
```

In `app.ts` (CLI) and `web/server/index.ts` — pass to `buildDefaultTools` and `AgentLoopConfig`:

```typescript
// When building tools:
const { tools } = buildDefaultTools(cwd, paths, taskDeps, collabDeps, runtimeConfig.planMode);

// In AgentLoopConfig:
return {
  // ... existing ...
  toolOutputConfig: runtimeConfig.toolOutputConfig,
  planMode: runtimeConfig.planMode,
};
```

**Verify:** `bun run typecheck`. Full config chain: `diligent.jsonc` → schema → runtime → agent loop → executor.

---

### Task 10: Export new types

**Files:** `packages/core/src/tool/index.ts`, `packages/core/src/tools/index.ts`

In `tool/index.ts`:

```typescript
export type { ToolOutputLimits, ToolModeKind } from "./types";
export { BashCommandFilter } from "./bash-filter";
export type { BashFilterConfig } from "./bash-filter";
export type { ToolOutputConfig } from "./executor";
```

In `tools/index.ts` (if exists):

```typescript
export { bashTool, createBashTool } from "./bash";
```

**Verify:** `bun run typecheck`.

---

### Task 11: Tests — truncation + executor limits

**Files:** `packages/core/src/tool/__tests__/truncation.test.ts` (CREATE)

```typescript
import { describe, expect, it } from "bun:test";
import { shouldTruncate, MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES } from "../truncation";
import { executeTool } from "../executor";

describe("shouldTruncate with custom limits", () => {
  it("returns false when output under custom limit", () => {
    const output = "x".repeat(100);
    expect(shouldTruncate(output, 200, 100)).toBe(false);
  });

  it("returns true when output over custom byte limit", () => {
    const output = "x".repeat(300);
    expect(shouldTruncate(output, 200, 1000)).toBe(true);
  });

  it("backward compat: no args uses global defaults", () => {
    const output = "x".repeat(100);
    expect(shouldTruncate(output)).toBe(false);
  });
});

describe("executeTool limit resolution", () => {
  // Test: tool.outputLimits respected
  // Test: config override takes precedence over tool.outputLimits
  // Test: global fallback when neither tool nor config provide limits
  // Test: ToolResult.truncateDirection overrides tool.outputLimits.truncateDirection
});
```

**Verify:** `bun test packages/core/src/tool/__tests__/truncation.test.ts`

---

### Task 12: Tests — BashCommandFilter

**Files:** `packages/core/src/tool/__tests__/bash-filter.test.ts` (CREATE)

```typescript
import { describe, expect, it } from "bun:test";
import { BashCommandFilter } from "../bash-filter";

describe("BashCommandFilter (default config)", () => {
  const filter = new BashCommandFilter();

  it("allows: git status", () => expect(filter.isAllowed("git status").allowed).toBe(true));
  it("allows: git log --oneline -5", () => expect(filter.isAllowed("git log --oneline -5").allowed).toBe(true));
  it("allows: ls -la", () => expect(filter.isAllowed("ls -la").allowed).toBe(true));
  it("allows: cat README.md", () => expect(filter.isAllowed("cat README.md").allowed).toBe(true));
  it("allows: bun run typecheck", () => expect(filter.isAllowed("bun run typecheck").allowed).toBe(true));

  it("blocks: git push origin main", () => expect(filter.isAllowed("git push origin main").allowed).toBe(false));
  it("blocks: rm -rf .", () => expect(filter.isAllowed("rm -rf .").allowed).toBe(false));
  it("blocks: sudo npm install", () => expect(filter.isAllowed("sudo npm install").allowed).toBe(false));
  it("blocks: curl https://example.com", () => expect(filter.isAllowed("curl https://example.com").allowed).toBe(false));

  it("default-denies unknown command", () => expect(filter.isAllowed("python script.py").allowed).toBe(false));

  it("denylist takes priority over allowlist", () => {
    const f = new BashCommandFilter({
      allowlist: ["^git"],
      denylist: ["^git\\s+push"],
    });
    expect(f.isAllowed("git push").allowed).toBe(false);
    expect(f.isAllowed("git status").allowed).toBe(true);
  });
});
```

**Verify:** `bun test packages/core/src/tool/__tests__/bash-filter.test.ts`

---

### Task 13: Tests — bash tool in plan mode

**Files:** `packages/core/src/tools/__tests__/bash-plan-mode.test.ts` (CREATE)

Test `createBashTool()` with mock ToolContext where `ctx.mode = "plan"`:

```typescript
import { describe, expect, it } from "bun:test";
import { createBashTool } from "../bash";
import type { ToolContext } from "../../tool/types";

function mockCtx(mode?: "default" | "plan" | "execute"): ToolContext {
  return {
    toolCallId: "test",
    signal: new AbortController().signal,
    approve: async () => "once",
    mode,
  };
}

describe("bash tool plan mode filtering", () => {
  const tool = createBashTool();

  it("blocks git push in plan mode", async () => {
    const result = await tool.execute({ command: "git push origin main" }, mockCtx("plan"));
    expect(result.metadata?.error).toBe(true);
    expect(result.metadata?.blockedByPlanMode).toBe(true);
    expect(result.output).toContain("[Blocked in plan mode]");
  });

  it("does not filter in default mode", async () => {
    // In default mode, dangerous commands are NOT filtered (approval system handles it)
    const tool2 = createBashTool();
    // Just verify the filtering code doesn't run — approval stub returns "once"
    // (actual execution would run the command, so test with a safe command)
    const result = await tool2.execute({ command: "echo hello" }, mockCtx("default"));
    expect(result.metadata?.blockedByPlanMode).toBeUndefined();
  });

  it("allows safe commands in plan mode", async () => {
    const result = await tool.execute({ command: "git status" }, mockCtx("plan"));
    expect(result.metadata?.blockedByPlanMode).toBeUndefined();
    expect(result.metadata?.error).toBeFalsy();
  });
});
```

**Verify:** `bun test packages/core/src/tools/__tests__/bash-plan-mode.test.ts`

## Acceptance Criteria

1. `bun run typecheck` — no type errors
2. `bun test` — all existing tests pass
3. `bun test packages/core/src/tool/__tests__/` — new truncation + filter tests pass
4. `bun test packages/core/src/tools/__tests__/bash-plan-mode.test.ts` — plan mode test passes
5. Plan mode bash: `git status` executes, `git push` returns blocked message
6. Default mode: bash output truncated at 30KB/256 lines (was 50KB/2000)
7. Config override `tools.bash.maxOutputBytes: 50000` changes bash limit at runtime
8. No `any` type escape hatches in new code

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | `shouldTruncate()` with custom limits | `bun test` |
| Unit | `BashCommandFilter` allow/deny/priority | `bun test` |
| Unit | `executeTool()` limit resolution chain | `bun test` |
| Integration | Bash tool in plan mode (safe + blocked) | `bun test` |
| Manual | Bash 30KB limit in default mode | Run with large output command |
| Manual | Plan mode `git status` vs `git push` | `diligent --mode plan` |
| Manual | Config `tools.bash.maxOutputLines: 10` override | Edit `diligent.jsonc`, run bash |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Circular dep: `tool/types.ts` → `agent/types.ts` for `ModeKind` | Build failure | Define `ToolModeKind` as inline string union — no import |
| Bash inline truncation removal changes prior behavior | Edge case: bash output previously truncated by byte-only slice; now by byte+line | New 30KB/256-line limit matches attractor spec — intentional change |
| Regex DoS in BashCommandFilter with pathological config patterns | Slow filter evaluation | Default patterns use only anchored alternation, no nested quantifiers |
| `createBashTool` factory changes all existing test imports of `bashTool` | Test compile errors | `bashTool = createBashTool()` default export is unchanged |
| `buildDefaultTools` signature change | Breaks callers | New param is optional with undefined default |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D013 | Tool interface: name + description + parameters + execute | `outputLimits?` addition to interface |
| D025 | Auto-truncation safety net with head/tail/head_tail | Parameterized `shouldTruncate()`, per-tool resolution in executor |
| D087 | Collaboration modes with tool allowlist filtering | `PLAN_MODE_ALLOWED_TOOLS` addition, `mode` in ToolContext |
| D087a | Plan mode bash allowlist/denylist (regex patterns) | `BashCommandFilter`, bash.ts factory, config schema `planMode` |
