# Tech Debt Cleanup: 6 Items from Tech Lead Review d0cf5e0

## Context

Tech lead assessment (2026-03-03-d0cf5e0) identified multiple open findings. This plan addresses 6 of them in priority order. All are type/constant unification or debug artifact cleanup — no behavioral changes.

---

## Step 1: #16 — Sidecar debug log guard

**Files:**
- `apps/desktop/src-tauri/src/sidecar.rs` (lines 33, 36)

**Change:** Wrap the two `std::fs::write("/tmp/diligent-debug.log", ...)` calls in `#[cfg(debug_assertions)]` blocks. Leave `lib.rs:57` panic log as-is (panic logging in production is intentional).

---

## Step 2: #3 + #9 — Unify ProviderName + extract DEFAULT_PROVIDER

**Problem:** `ProviderName` defined in 3 places; `?? "anthropic"` scattered 11 times across 6 files.

**Core already depends on `@diligent/protocol`** — no new dependency needed.

### 2a: Delete duplicate ProviderName definitions in core

- `packages/core/src/provider/provider-manager.ts:13` — delete `export type ProviderName = ...`, import from `@diligent/protocol`
- `packages/core/src/auth/auth-store.ts:8` — delete `export type ProviderName = ...`, import from `@diligent/protocol`

### 2b: Fix re-export collision in core/src/index.ts

- Remove `AuthProviderName` alias (line 32) — no longer needed since both files import the same type
- Re-export single `ProviderName` from provider (which now re-exports from protocol)

### 2c: Export DEFAULT_PROVIDER from core

- Add `export const DEFAULT_PROVIDER: ProviderName = "anthropic"` in `packages/core/src/provider/provider-manager.ts`
- Re-export from `packages/core/src/index.ts`

### 2d: Replace all `?? "anthropic"` with `?? DEFAULT_PROVIDER`

11 occurrences in 6 files:
- `packages/core/src/provider/provider-manager.ts:101`
- `packages/cli/src/config.ts:38`
- `packages/cli/src/index.ts:64`
- `packages/cli/src/tui/app.ts:160,236`
- `packages/cli/src/tui/commands/builtin/provider.ts:56,202`
- `packages/cli/src/tui/commands/builtin/model.ts:18,43,77` (+ line 56 in filter)

---

## Step 3: #11 — Move ModelInfo to protocol

**Problem:** `ModelInfo` hand-maintained in `packages/web/src/shared/ws-protocol.ts:46-54`. Identical to core `Model` minus `defaultBudgetTokens`.

### 3a: Add ModelInfoSchema to protocol

- `packages/protocol/src/data-model.ts` — add `ModelInfoSchema` (Zod object with id, provider, contextWindow, maxOutputTokens, inputCostPer1M?, outputCostPer1M?, supportsThinking?)
- Export `ModelInfo` type

### 3b: Replace web-local ModelInfo

- `packages/web/src/shared/ws-protocol.ts` — delete local `ModelInfo`, import from `@diligent/protocol`
- Update all web imports (`auth-api.ts`, `use-provider-manager.ts`, `rpc-client.ts`, `InputDock.tsx`, `rpc-bridge.ts`) to import from `@diligent/protocol` or keep importing from `ws-protocol.ts` if it re-exports

---

## Step 4: #10 — Replace raw method strings with constants

**Scope:** 6 production files, ~76 raw string occurrences.

Import `DILIGENT_CLIENT_REQUEST_METHODS`, `DILIGENT_CLIENT_NOTIFICATION_METHODS`, `DILIGENT_SERVER_NOTIFICATION_METHODS`, `DILIGENT_SERVER_REQUEST_METHODS` from `@diligent/protocol`.

**Files (production code only, skip test files):**

| File | Raw strings | Constants needed |
|------|------------|-----------------|
| `packages/cli/src/tui/app.ts` | 16 | CLIENT_REQUEST, CLIENT_NOTIFICATION, SERVER_NOTIFICATION, SERVER_REQUEST |
| `packages/cli/src/tui/runner.ts` | 5 | CLIENT_REQUEST, CLIENT_NOTIFICATION |
| `packages/web/src/client/App.tsx` | ~25 | CLIENT_REQUEST, CLIENT_NOTIFICATION, SERVER_NOTIFICATION |
| `packages/web/src/client/lib/thread-store.ts` | 14 | SERVER_NOTIFICATION |
| `packages/web/src/server/rpc-bridge.ts` | 13 | CLIENT_REQUEST, SERVER_NOTIFICATION |
| `packages/web/src/client/lib/use-server-requests.ts` | 3 | SERVER_REQUEST |

---

## Step 5: #18 — Consolidate OAuth constants

**Problem:** `OAUTH_TOKEN_URL`, `CLIENT_ID`, `REDIRECT_URI` duplicated across 3 files.

### 5a: Create shared constants file

- Create `packages/core/src/auth/oauth/constants.ts` with:
  - `OAUTH_TOKEN_URL`
  - `CHATGPT_CLIENT_ID`
  - `CHATGPT_REDIRECT_URI`
  - `CHATGPT_AUTH_URL` (move from chatgpt-oauth.ts)

### 5b: Update consumers

- `token-exchange.ts` — delete local constants, import from `./constants`
- `refresh.ts` — delete local constants, import from `./constants`
- `chatgpt-oauth.ts` — delete local constants, import from `./constants`

---

## Verification

```bash
# Type check all packages
bun run typecheck   # or tsc --noEmit per package

# Run full test suite
bun test

# Grep to confirm no remaining issues
rg '?? "anthropic"' packages/     # should return 0
rg 'type ProviderName =' packages/ # should return only 1 (protocol)
rg 'OAUTH_TOKEN_URL' packages/     # should return only constants.ts + imports
```
