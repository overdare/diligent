---
id: P038
status: backlog
created: 2026-03-07
---
# P038: AppServer Factory — Eliminate Web/CLI Config Duplication

## Context

`DiligentAppServer` is a transport-neutral JSON-RPC server. Both Web and CLI create it with nearly identical `DiligentAppServerConfig` — the same `allModels` mapping, `buildAgentConfig` callback, `modelConfig` object, `resolvePaths`, and `compaction` are copy-pasted between:

- `packages/web/src/server/index.ts` (lines 47–114)
- `packages/cli/src/app-server-stdio.ts` (lines 30–88)

Both `buildTools` re-exports (`web/src/server/tools.ts`, `cli/src/tui/tools.ts`) are literally `export { buildDefaultTools as buildTools } from "@diligent/core"`.

The only real differences are:
1. `toImageUrl` — web only
2. `openBrowser` — CLI only
3. `getInitializeResult` — web provides custom one
4. `--yolo` permission override — CLI only

This duplication will break as the config surface grows. Solution: a factory function in core.

## Plan

### Task 1: Add `getModelInfoList()` utility

**File:** `packages/core/src/provider/models.ts`

Add a function that maps `KNOWN_MODELS` to the protocol-facing `ModelInfo` shape. This eliminates the duplicated `.map()` in both web and CLI.

```typescript
export function getModelInfoList(): ModelInfo[] {
  return KNOWN_MODELS.map((m) => ({
    id: m.id,
    provider: m.provider,
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    inputCostPer1M: m.inputCostPer1M,
    outputCostPer1M: m.outputCostPer1M,
    supportsThinking: m.supportsThinking,
    supportsVision: m.supportsVision,
  }));
}
```

Export from `packages/core/src/provider/index.ts` and `packages/core/src/index.ts`.

### Task 2: Create `createAppServerConfig()` factory

**New file:** `packages/core/src/app-server/factory.ts`

```typescript
interface CreateAppServerConfigOptions {
  cwd: string;
  runtimeConfig: RuntimeConfig;
  overrides?: Partial<Pick<DiligentAppServerConfig,
    'serverName' | 'serverVersion' | 'getInitializeResult' |
    'openBrowser' | 'toImageUrl'>>;
}

export function createAppServerConfig(opts: CreateAppServerConfigOptions): DiligentAppServerConfig
```

The factory:
- Calls `getModelInfoList()` once
- Builds `resolvePaths`, `buildAgentConfig`, `modelConfig`, `compaction`, `providerManager` from `runtimeConfig`
- Merges `overrides` for transport-specific fields
- `buildAgentConfig` internally calls `buildDefaultTools()` directly (no re-export wrapper needed)

Export from `packages/core/src/app-server/index.ts` and `packages/core/src/index.ts`.

### Task 3: Simplify CLI `app-server-stdio.ts`

**File:** `packages/cli/src/app-server-stdio.ts`

Before (~60 lines of config assembly):
```typescript
const allModels = KNOWN_MODELS.map(...);
return new DiligentAppServer({
  resolvePaths: ...,
  buildAgentConfig: async (...) => { ... },
  modelConfig: { ... },
  compaction: ...,
  providerManager: ...,
  openBrowser,
});
```

After (~10 lines):
```typescript
import { createAppServerConfig, DiligentAppServer, openBrowser } from "@diligent/core";

const config = createAppServerConfig({
  cwd: options.cwd,
  runtimeConfig,
  overrides: { openBrowser },
});
return new DiligentAppServer(config);
```

Where `runtimeConfig` is obtained from `loadRuntimeConfig()` (dropping the `loadConfig()` wrapper since the factory handles everything). The `--yolo` override applies to `runtimeConfig.permissionEngine` before passing to the factory.

**Delete:** `packages/cli/src/tui/tools.ts` (dead code — only re-exported `buildDefaultTools`).

### Task 4: Simplify Web `server/index.ts`

**File:** `packages/web/src/server/index.ts`

Before (~70 lines of config assembly):
```typescript
const allModels = KNOWN_MODELS.map(...);
const appServerConfig: DiligentAppServerConfig = {
  cwd,
  getInitializeResult: async () => ({...}),
  resolvePaths: ...,
  buildAgentConfig: async (...) => { ... },
  modelConfig: { ... },
  compaction: ...,
  providerManager: ...,
  toImageUrl: ...,
};
```

After (~20 lines):
```typescript
import { createAppServerConfig, DiligentAppServer, getModelInfoList } from "@diligent/core";

const baseConfig = createAppServerConfig({
  cwd,
  runtimeConfig,
  overrides: {
    toImageUrl: (absPath) => toWebImageUrl(absPath),
    getInitializeResult: async () => ({
      cwd,
      mode: runtimeConfig.mode,
      effort: "medium",
      currentModel: runtimeConfig.model?.id,
      availableModels: getModelInfoList().filter(...),
    }),
  },
});

// Wrap buildAgentConfig to capture registry for shutdown
let registry: AgentRegistry | undefined;
const origBuild = baseConfig.buildAgentConfig;
baseConfig.buildAgentConfig = async (args) => {
  const result = await origBuild(args);
  if (result.registry) registry = result.registry;
  return result;
};

const appServer = new DiligentAppServer(baseConfig);
```

**Delete:** `packages/web/src/server/tools.ts` (dead code).

### Task 5: Add factory test

**New file:** `packages/core/test/app-server-factory.test.ts`

Test that:
- `createAppServerConfig` produces valid config from mock `RuntimeConfig`
- Overrides merge correctly (`toImageUrl`, `openBrowser`)
- `modelConfig.onModelChange` updates `runtimeConfig.model`
- `buildAgentConfig` throws when model is undefined

## Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/provider/models.ts` | Add `getModelInfoList()` |
| `packages/core/src/provider/index.ts` | Export new function |
| `packages/core/src/app-server/factory.ts` | **New** — factory function |
| `packages/core/src/app-server/index.ts` | Export factory |
| `packages/core/src/index.ts` | Export factory + `getModelInfoList` |
| `packages/cli/src/app-server-stdio.ts` | Simplify to use factory |
| `packages/cli/src/tui/tools.ts` | **Delete** |
| `packages/web/src/server/index.ts` | Simplify to use factory |
| `packages/web/src/server/tools.ts` | **Delete** |
| `packages/core/test/app-server-factory.test.ts` | **New** — factory tests |

## Verification

```bash
cd packages/core && bun test
cd packages/cli && bun test
cd packages/web && bun test
bun run typecheck
```

Also manually verify:
- `bun run packages/cli/src/index.ts app-server --stdio` starts and accepts JSON-RPC
- `bun run packages/web/src/server/index.ts` starts and WebSocket connects
