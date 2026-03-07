# Tech Lead Assessment: packages/web Frontend Sustainability

**Date**: 2026-03-02
**Commit**: 594ac2a
**Scope**: packages/web — frontend (client, shared, design system) sustainability
**Previous**: 2026-03-02-8494f69-web.md (same-day, pre-remediation)

---

## Sustainability Verdict

**GREEN-YELLOW** — The web frontend is in a notably healthy state for a 7-commit, single-day package. Previous YELLOW issues have been partially resolved: `tools.ts` DRY violation is fixed, `toSafeFallback` correctness bug is fixed, `Mode` import in `ws-protocol.ts` is fixed. Two compounding issues remain (Mode inline literals in `rpc-bridge.ts`/`rpc-client.ts`, ModelInfo type duplication), and one architectural gap (App.tsx God Component trajectory) needs early intervention before Phase 5.

---

## Previous Review Delta

| Finding (2026-03-02-8494f69) | Status Now | Evidence |
|------------------------------|-----------|---------|
| `tools.ts` duplicates CLI tool assembly | **FIXED** | `tools.ts:2` — now re-exports `buildDefaultTools` from `@diligent/core` |
| `toSafeFallback` sends wrong type for `userInput/request` | **FIXED** | `rpc-bridge.ts:37-49` — dispatches per request method |
| `Mode` inline in `ws-protocol.ts` | **FIXED** | `ws-protocol.ts:8` — imports `Mode` from `@diligent/protocol` |
| `Mode` inline in `rpc-bridge.ts` and `rpc-client.ts` | **OPEN** | 4 occurrences of `"default" \| "plan" \| "execute"` literal |
| `ModelInfo` type duplication | **OPEN** | `ws-protocol.ts:46-54` — hand-maintained copy |
| WS reconnect creates new thread | **FIXED** | `App.tsx:113-123` — resumes `prevThreadId` via `activeThreadIdRef` |
| `threadOwners` cleanup on thread switch | **FIXED** | `rpc-bridge.ts:186-190`, `197-201` — deletes old mapping |
| `app-config.ts` zero test coverage | **FIXED** | `app-config.test.ts` — 3 tests covering model, compaction, mode defaults |

**Remediation rate: 6/8 (75%).** The remaining 2 are type-sync items that compound slowly.

---

## Structural Integrity

### 1. Clean 3-Layer Separation — Holding Well
**Impact**: Foundational strength

The client → shared → server separation is clean and enforced by import direction:
- `src/client/` imports from `src/shared/` and `@diligent/protocol`, never from `src/server/`
- `src/server/` imports from `src/shared/`, `@diligent/protocol`, and `@diligent/core`
- `src/shared/` imports only from `@diligent/protocol`

No circular imports detected. This is the correct architecture for a package that must eventually support both Vite dev-server and Tauri sidecar deployments.

### 2. Mode Type Inline Literals (4 remaining occurrences)
**Impact**: Compounds over time — breaks silently when new modes are added

```
rpc-client.ts:27    mode: "default" | "plan" | "execute"
rpc-bridge.ts:21    mode: "default" | "plan" | "execute"
rpc-bridge.ts:66    private readonly initialMode: "default" | "plan" | "execute"
rpc-bridge.ts:206   mode?: "default" | "plan" | "execute"
```

Protocol already exports `Mode` from `@diligent/protocol` (used correctly in `ws-protocol.ts:8`, `App.tsx:6`, `InputDock.tsx:3`). The server/bridge files use inline literals instead. If a new mode is added (e.g., "review"), these 4 locations fail silently — the TypeScript compiler won't flag them because `"default"` still matches `string`.

**Fix cost now**: 5 minutes — import `Mode` from `@diligent/protocol`.
**Fix cost if ignored through Phase 5**: Each new mode addition requires a manual audit of every file in the package.

### 3. ModelInfo Type Duplication
**Impact**: Compounds with each new provider — field sync required in 3 places

`ModelInfo` in `ws-protocol.ts:46-54` is a hand-maintained projection of core's `Model` type. The mapping happens in `app-config.ts` when building the `ConnectedMessage`. Today these diverge in:
- Core `Model` has `defaultBudgetTokens`, `supportsThinking` — `ModelInfo` has `supportsThinking` but not `defaultBudgetTokens`
- Core `Model` has `provider` as optional — `ModelInfo` has it as required `string`

This works today with 3 providers and ~10 models. When Phase 5 adds MCP-registered models or user-defined model aliases, the manual mapping becomes a source of silent bugs.

**Recommendation**: Create `ModelInfo` as a Zod schema in `@diligent/protocol` and derive both sides from it. This is a ~30min task that eliminates the entire class of sync bugs.

### 4. `config/set` Escape Hatch in RpcBridge
**Impact**: Cosmetic now, compounds if more config methods are added

`rpc-bridge.ts:146-173` handles `config/set` as a special case outside the normal `appServer.handleRequest()` dispatch. This works but creates a precedent: every new config endpoint needs another if-block in the bridge. The codex-rs reference implementation uses typed RPC methods for all config operations.

If Phase 5 adds `config/get`, `config/watch`, or `permission/set`, this pattern becomes a maintenance burden. For now it's a single method, so the urgency is low.

---

## Velocity Trajectory

### 5. Exceptional Build Speed with Zero Throwaway
**Trend**: Strongly positive

| Metric | Value | Assessment |
|--------|-------|-----------|
| Total commits | 7 | Focused scope |
| Files created | 64 | High output |
| Files deleted | 0 | Zero throwaway |
| Total insertions | ~5,265 | Substantial but coherent |
| Total deletions | ~792 | Healthy refactoring (15% churn) |
| Tests | 20 pass / 0 fail / 47 assertions | Solid coverage |
| Rework ratio | 0% (file-level) | No false starts |

The entire web package was created in a single day with no abandoned components, no scrapped approaches, and no structural rewrites. This is unusually clean for a UI package and suggests the design was well-thought-out before implementation began.

### 6. Batch Commit Pattern — Rollback Risk
**Trend**: Flat concern

Two commits account for 76% of all code:
- `d88e9d4` — 38 files, +2,850 lines (initial scaffold)
- `8494f69` — 28 files, +1,149 lines (model selection + display components)

These are large for rollback purposes. If a bug is found in one component from `8494f69`, reverting means losing all 28 files. This is acceptable during bootstrapping (Phase 0 of the web package) but should not continue into feature work. Target 1-3 files per commit going forward.

### 7. Design System — Well-Extracted
**Trend**: Improving

The design token system (`tokens.css` + `tailwind.config.ts`) is clean and consistent:
- 7 semantic colors via CSS custom properties with RGB channels for Tailwind opacity
- 5-step spacing scale
- 3-step border radius scale
- IBM Plex Sans/Mono font family
- Custom `max-width` scale for message layout

29 components consistently use these tokens. No hardcoded hex colors or pixel values found in component files. This is the right foundation — new components can be styled consistently without visual regression.

---

## Forward Compatibility

### 8. App.tsx God Component Trajectory
**Horizon**: Breaks in Phase 5 when MCP tools, multi-agent, and settings UI are added
**Impact**: Blocks sustainable feature addition

`App.tsx` is currently 354 lines and serves as:
1. State container (useReducer + 7 useState hooks)
2. RPC lifecycle manager (connect, reconnect, initialize)
3. Thread manager (start, open, resume)
4. Approval prompt handler
5. Question prompt handler
6. Model change handler
7. Layout orchestrator

This is natural for a Phase 0 web package — everything starts in one file. But Phase 5 will add:
- MCP server connection UI
- Multi-agent delegation view
- Settings/config panel
- Permission rule editor
- Knowledge browser

If each new feature adds another useState + handler + JSX section to App.tsx, it will become a 1000+ line file where every change risks breaking unrelated features.

**Fix now** (~2 hours): Extract `useRpc()` custom hook (RPC lifecycle, connection state), `useThreadManager()` hook (thread CRUD), `useServerRequests()` hook (approval + question handling). App.tsx becomes a pure layout component that composes hooks.

**Fix later** (Phase 5): Major refactor touching every handler, state variable, and callback. High regression risk because everything is co-located.

### 9. RenderItem Discriminated Union — Extensible But Missing Types
**Horizon**: Breaks in Phase 5a (MCP tools) and Phase 5b (multi-agent)

`thread-store.ts:26-50` defines `RenderItem` with 3 kinds: `user`, `assistant`, `tool`. Phase 5 will need:
- `mcp_tool` — MCP tool calls look different from built-in tools (server prefix, possibly remote execution indicator)
- `system` — System messages (compaction notices, mode changes, knowledge injection)
- `delegation` — Sub-agent task cards (Phase 5b)

The discriminated union pattern is correct and extensible — adding a new kind requires:
1. Add the new variant to `RenderItem`
2. Handle it in `reduceServerNotification`
3. Handle it in `hydrateFromThreadRead`
4. Render it in `MessageList`/`StreamBlock`

This is O(4) files per new kind, which is reasonable. **No action needed now** — the pattern is forward-compatible. Just noting it as a planned extension point.

### 10. ProviderManager Duplication (Web vs CLI)
**Horizon**: Compounds with each provider addition
**Impact**: Already demonstrated — 3rd copy of `ProviderName` type

`packages/web/src/server/provider-manager.ts` is a simplified copy of `packages/cli/src/provider-manager.ts`. Both:
- Define `type ProviderName = "anthropic" | "openai" | "gemini"` (also in `packages/core/src/auth/auth-store.ts`)
- Manage API keys per provider
- Cache stream functions
- Handle OAuth refresh

The web version is simpler (no wizard, no hints, no mask), but the core logic — key management + stream creation + OAuth — is identical. When a 4th provider is added, 3 files need updating. When the OAuth flow changes, 2 implementations must stay in sync.

**Recommendation**: Extract `ProviderRegistry` to `@diligent/core` with the shared key/stream/OAuth logic. CLI and web each wrap it with their own UX layer. This aligns with D046's deferred note about shared infrastructure.

### 11. Test Quality — Behavior-Coupled, Refactor-Safe
**Horizon**: Positive through Phase 5

Current tests are well-structured:
- `thread-store.test.ts` — Tests the reducer by notification sequence, not internal state shape. Will survive internal refactoring.
- `rpc-bridge.test.ts` — Tests request-response roundtrip behavior via fake server. Will survive RPC protocol evolution.
- `app-config.test.ts` — Tests config loading with real filesystem. Validates integration correctness.
- `components.test.tsx` — Tests static rendering. Intentionally thin — appropriate for visual components.

**Gap**: No test for WebSocket reconnect + thread resume flow (`App.tsx:105-131`). This is the most complex client-side behavior and the one most likely to regress. A test using a mock WebSocket that simulates disconnect → reconnect → resume would catch the exact class of bug that was fixed from the previous review.

### 12. Korean/CJK IME Handling — Well-Implemented
**Impact**: Cosmetic — good practice already in place

`InputDock.tsx:97-107` correctly handles IME composition with both `compositionStart`/`compositionEnd` events and `nativeEvent.isComposing` check. This prevents the common double-submit bug on Korean keyboard Enter. The Send button also checks `composingRef.current` (`InputDock.tsx:187`). This is a detail that most React chat UIs get wrong.

---

## Priority Actions

### 1. Extract App.tsx into composable hooks (before Phase 5)
**Files**: `packages/web/src/client/App.tsx` → `lib/use-rpc.ts`, `lib/use-thread.ts`, `lib/use-server-requests.ts`
**Why**: App.tsx at 354 lines is manageable. At 800+ lines (Phase 5 estimate) it becomes the #1 velocity bottleneck. Extracting hooks now is a clean 2-hour task. Later it's a risky refactor.

### 2. Fix Mode inline literals (immediate, 5 minutes)
**Files**: `rpc-client.ts:27`, `rpc-bridge.ts:21,66,206`
**Why**: Import `Mode` from `@diligent/protocol`. Eliminates silent breakage when modes change.

### 3. Move ModelInfo to @diligent/protocol (before next provider addition)
**Files**: `ws-protocol.ts:46-54` → `packages/protocol/src/data-model.ts`
**Why**: Hand-syncing type fields across 3 locations is unsustainable. A Zod schema in protocol eliminates the entire class.

### 4. Extract ProviderRegistry to @diligent/core (before 4th provider)
**Files**: `packages/web/src/server/provider-manager.ts`, `packages/cli/src/provider-manager.ts` → `packages/core/src/providers/registry.ts`
**Why**: Core key/stream/OAuth logic duplicated between CLI and web. Each new provider doubles the maintenance cost.

### 5. Add reconnect + resume integration test
**Files**: `test/rpc-client.test.ts` (extend existing)
**Why**: The reconnect-resume flow in App.tsx:105-131 is the most complex client behavior and was already the subject of a bug fix. A regression test prevents re-introduction.

---

## Summary

The packages/web frontend is in strong shape for its maturity level. The 75% remediation rate from the previous review demonstrates responsive development. The design system is well-extracted, the 3-layer architecture is clean, and the test suite (20 tests, 47 assertions) covers the right behaviors. The primary risk is the App.tsx God Component trajectory — manageable today, but it will become the dominant source of friction if not decomposed before Phase 5 adds MCP, multi-agent, and settings features. The type-sync issues (Mode literals, ModelInfo, ProviderName) are low-severity individually but compound with each new provider or mode addition.
