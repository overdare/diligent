---
id: P060
status: backlog
created: 2026-04-04
---

# P060: Desktop Storage Namespace Packaging

## Goal

Packaged builds can choose their own hidden storage namespace at package time so Diligent-based products do not collide on user machine state. A branded package such as an OVERDARE CLI distribution can use `.overdare` instead of `.diligent` consistently for both packaged global state and packaged runtime project-local state.

The runtime changes in this plan should stay limited to reusable namespace-aware path abstractions, and P060 activates them only through the packaged OVERDARE CLI build flow. In other words, the abstraction may be reusable by future callers, while the required behavior change in this plan remains scoped to packaged launcher / packaged runtime execution led by `apps/overdare-cli`.

When a packaged product first switches to a non-default namespace, the packaged launcher layer in `apps/overdare-cli` should perform a one-time conditional migration only if the target namespace does not exist and the legacy `.diligent` namespace does exist. Runtime stays migration-free in this plan.

## Prerequisites

- Packaging pipeline MVP (P044)
- OVERDARE CLI runtime bootstrap/update/path ownership in `apps/overdare-cli/src/update.rs`, `init.rs`, and `webserver.rs`
- Existing OVERDARE packaging/build entrypoints in `apps/overdare-cli/` and root packaging scripts

## Artifact

```text
$ bun run scripts/build-overdare-sidecar.ts

Packaged OVERDARE CLI starts and stores its runtime state under:
- ~/.overdare/config.jsonc
- ~/.overdare/plugins/
- ~/.overdare/logs/
- ~/.overdare/updates/runtime/
- <startup-cwd>/.overdare/config.jsonc
- <startup-cwd>/.overdare/sessions/
- <startup-cwd>/.overdare/knowledge/
- <startup-cwd>/.overdare/skills/

The same packaged binary does not read from or write to ~/.diligent/ or <startup-cwd>/.diligent/ after launcher-owned migration/selection settles on the branded namespace.
```

Here `<startup-cwd>` means the startup cwd value passed by the packaged launcher into the runtime webserver command via `--cwd`, which runtime then uses as the base for project-local storage resolution.

Launcher-owned conditional first-run migration rule:

- if `~/.overdare` does not exist and `~/.diligent` does exist, move `~/.diligent` → `~/.overdare`
- if `<startup-cwd>/.overdare` does not exist and `<startup-cwd>/.diligent` does exist, move `<startup-cwd>/.diligent` → `<startup-cwd>/.overdare`
- if the target namespace already exists, do not merge or overwrite legacy data
- if both source and target exist, keep the target as source of truth and leave legacy data untouched
- if migration is skipped because the target already exists or no legacy directory exists, continue silently without user-facing notice or diagnostic logging

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `apps/overdare-cli/src/init.rs` | Replace hardcoded `~/.diligent` setup/deploy paths with a single namespace-aware global directory helper and launcher-owned migration ordering. |
| `apps/overdare-cli/src/update.rs` | Replace hardcoded global config/update/runtime paths with the shared namespace-aware helper. |
| `apps/overdare-cli/src/webserver.rs` | Perform local namespace migration before launching the runtime webserver and pass the selected namespace/cwd coherently. |
| `apps/overdare-cli/src/cli.rs` | Coordinate startup ordering so migration and namespace selection settle before runtime launch. |
| `packages/runtime/src/infrastructure/diligent-dir.ts` | Introduce a reusable namespace-aware runtime path helper and use it for packaged runtime project-local resolution. |
| `packages/runtime/src/config/loader.ts` | Make runtime config lookup namespace-aware so packaged runtime startup can activate the selected namespace. |
| `packages/runtime/src/config/runtime.ts` | Thread the reusable namespace-aware config/auth/userId/skills loading through packaged runtime startup. |
| `packages/runtime/src/auth/auth-store.ts` | Make auth storage path resolution namespace-aware for packaged runtime activation. |
| `packages/runtime/src/config/user-id.ts` | Make persisted userId path resolution namespace-aware for packaged runtime activation. |
| `packages/runtime/src/skills/discovery.ts` | Make global/project skill root resolution namespace-aware for packaged runtime activation. |
| `packages/web/src/shared/image-routes.ts` and `packages/web/src/server/index.ts` | Keep packaged runtime persisted image and route behavior aligned with the selected local namespace rooted at startup cwd, assuming the launcher already handled migration before launch. |
| `apps/overdare-cli/test/**` | Add focused Rust tests for namespace resolution, migration behavior, and runtime launch env propagation. |
| `packages/runtime/test/**` | Add focused namespace tests for runtime path helpers used by packaged OVERDARE CLI. |
| `README.md` / packaging docs | Document the package/build-time namespace selection and clarify that P060 activates the namespace abstraction only for packaged OVERDARE CLI state. |

### What does NOT change

- No change to un-packaged CLI/TUI/Web development behavior.
- No change to runtime project-local storage under `./.diligent/` for ordinary non-packaged source checkout workflows.
- No change to non-packaged callers unless they explicitly opt into the new runtime namespace abstraction in a future follow-up.
- No rename of internal package names, Rust module names, TypeScript symbols, or binary protocol names.
- No attempt to make end-user runtime namespace configurable after packaging; this plan is package/build-time selection only.
- No bidirectional sync, partial merge, or ongoing dual-write between `.diligent` and the branded namespace.
- No overwrite of an existing target namespace directory during migration.
- No runtime-owned migration helper or runtime startup migration orchestration in this plan.

## File Manifest

### apps/overdare-cli/src/

| File | Action | Description |
|------|--------|------------|
| `cli.rs` | MODIFY | Coordinate namespace selection, migration ordering, and runtime startup entrypoints. |
| `init.rs` | MODIFY | Route default deployment, plugin deployment, and init logs through a namespace-aware global dir. |
| `update.rs` | MODIFY | Route update manifest/config/runtime paths through a namespace-aware global dir. |
| `webserver.rs` | MODIFY | Route runtime launch and startup-cwd-local migration through the shared namespace-aware helpers. |

### apps/overdare-cli/test/

| File | Action | Description |
|------|--------|------------|
| `**/*` | MODIFY / CREATE | Add Rust tests for namespace resolution, migration behavior, and launch argument/env propagation. |

### scripts/

| File | Action | Description |
|------|--------|------------|
| `build-overdare-sidecar.ts` | MODIFY | Thread packaged storage namespace into the compiled runtime build used by OVERDARE CLI. |
| packaging/build scripts | MODIFY | Pass the same namespace env through packaged CLI build flows and include it in build fingerprints if applicable. |

### packages/runtime/src/infrastructure/

| File | Action | Description |
|------|--------|------------|
| `diligent-dir.ts` | MODIFY | Resolve project-local paths from a reusable namespace-aware helper instead of a hardcoded `.diligent`, while P060 activates it only for packaged runtime flows. |

### packages/runtime/src/config/

| File | Action | Description |
|------|--------|------------|
| `loader.ts` | MODIFY | Use namespace-aware global/project config paths. |
| `runtime.ts` | MODIFY | Pass namespace-aware helpers into packaged runtime startup flow. |
| `user-id.ts` | MODIFY | Use namespace-aware persisted userId path. |

### packages/web/src/

| File | Action | Description |
|------|--------|------------|
| `server/index.ts` | MODIFY | Consume launcher-selected namespace-aware local paths consistently from launcher-passed startup cwd without owning migration. |

### packages/web/src/shared/

| File | Action | Description |
|------|--------|------------|
| `image-routes.ts` | MODIFY | Preserve persisted image route expectations under the selected local namespace rooted at startup cwd. |

### packages/runtime/src/auth/

| File | Action | Description |
|------|--------|------------|
| `auth-store.ts` | MODIFY | Use namespace-aware auth.jsonc path for packaged runtime auth loading. |

### packages/runtime/src/skills/

| File | Action | Description |
|------|--------|------------|
| `discovery.ts` | MODIFY | Use namespace-aware global/project skill discovery roots for packaged runtime activation. |

### packages/runtime/test/

| File | Action | Description |
|------|--------|------------|
| `infrastructure/diligent-dir.test.ts` | MODIFY | Verify namespace-aware path resolution keeps default `.diligent` and supports packaged overrides. |
| `config/loader.test.ts` | MODIFY | Verify global/project config loading uses the selected namespace. |
| `auth/auth-store.test.ts` | MODIFY | Verify auth path resolution uses the selected namespace. |
| `skills/discovery.test.ts` | MODIFY | Verify global/project skill roots use the selected namespace. |
| `config/runtime.test.ts` | MODIFY | Verify packaged runtime startup keeps global and local namespace resolution aligned. |

### Root / docs

| File | Action | Description |
|------|--------|------------|
| `README.md` | MODIFY | Document packaged OVERDARE CLI `storageNamespace` metadata and usage. |

## Implementation Tasks

### Task 1: Define packaged OVERDARE CLI namespace selection

**Files:** `apps/overdare-cli/src/cli.rs`, `apps/overdare-cli/test/**`, packaging/build scripts as needed
**Decisions:** D033, D042

Define one packaged storage namespace for OVERDARE CLI builds and normalize how the launcher/runtime consume it without coupling it to visible product naming.

The exact configuration source can be a build script constant, packaging metadata, or another packaged-build input, but the plan requires one explicit resolved namespace per packaged build and a default of `diligent` when no branded override is supplied.

Normalization rules should be explicit and deterministic:

- accept a bare namespace such as `overdare`
- trim whitespace
- lowercase it
- reject path separators and dots in the stored value
- derive actual on-disk hidden directory names later as `.${namespace}`

This keeps the packaged-build input stable and avoids leaking filesystem formatting concerns into every caller.

Invalid configured values should fail the packaged build immediately. Do not silently fall back to `diligent` when branded input is present but invalid.

**Verify:** `cargo test --manifest-path apps/overdare-cli/Cargo.toml`

### Task 2: Thread namespace through OVERDARE CLI packaging/build scripts

**Files:** `scripts/build-overdare-sidecar.ts`, CLI packaging/build scripts, `apps/overdare-cli` build flow helpers if added
**Decisions:** D042

Teach the OVERDARE CLI packaging entrypoints to resolve one storage namespace per packaged build and pass it into every compiled runtime/launcher step.

```typescript
const storageNamespace = resolvePackagedStorageNamespace();

run(`bun build --compile --target=${plat.bunTarget} ${serverEntry} --outfile ${outPath}`, ROOT, {
  DILIGENT_STORAGE_NAMESPACE: storageNamespace,
});
```

Update any packaged CLI build fingerprint so cache invalidation notices namespace changes:

```typescript
const buildFingerprint = [
  `runtimeVersion=${version}`,
  `updateUrl=${updateUrlEnv}`,
  `storageNamespace=${storageNamespace}`,
].join(";");
```

This task should keep namespace handling package-selected. Do not change ordinary workspace runtime startup or developer flows unless the packaged env variable is present. The packaged build script is the only required activator in this plan, even though the downstream runtime abstraction may be reusable by future callers.

**Verify:** targeted packaging-script tests for resolved env values; manual dry run with and without branded namespace input.

### Task 3: Add launcher-owned conditional namespace migration

**Files:** `apps/overdare-cli/src/cli.rs`, `apps/overdare-cli/src/init.rs`, `apps/overdare-cli/src/webserver.rs`, shared Rust helper module if added
**Decisions:** D042

Add one migration rule only:

- if target namespace is absent and legacy `.diligent` exists, move legacy directory to target namespace
- otherwise do nothing

This should be implemented as an explicit Rust helper inside the packaged launcher layer and used for both home-global state and startup-cwd-local state before the runtime webserver is launched. Runtime should only consume the selected namespace after launcher startup has already settled migration.

Illustrative Rust shape:

```rust
pub enum MigrationOutcome {
    Migrated { from: PathBuf, to: PathBuf },
    SkippedNoLegacy,
    SkippedTargetExists,
}

pub fn migrate_namespace_if_needed(legacy: PathBuf, target: PathBuf) -> Result<MigrationOutcome, String> {
    // target exists -> skip
    // legacy missing -> skip
    // else rename legacy -> target
}
```

Migration should happen before any new namespace directories are created. That ordering is critical; otherwise the target would exist first and block migration forever.

Failure handling is intentionally strict:

- global migration failure should surface an error and block further packaged runtime startup
- local migration failure should fail packaged runtime launch from the CLI rather than falling back to legacy or creating a fresh target namespace
- skipped migration outcomes (`skipped-no-legacy`, `skipped-target-exists`) should remain silent with no user-facing notice and no extra diagnostic logging

**Verify:** Rust unit tests for all three outcomes; manual migration smoke test from a machine/repo that only has `.diligent`.

### Task 4: Make runtime helpers namespace-aware so packaged OVERDARE CLI can activate them for both global and local state

**Files:** `packages/runtime/src/infrastructure/diligent-dir.ts`, `packages/runtime/src/config/loader.ts`, `packages/runtime/src/config/runtime.ts`, `packages/runtime/src/auth/auth-store.ts`, `packages/runtime/src/config/user-id.ts`, `packages/runtime/src/skills/discovery.ts`, `packages/runtime/test/infrastructure/diligent-dir.test.ts`, `packages/runtime/test/config/loader.test.ts`, `packages/runtime/test/auth/auth-store.test.ts`, `packages/runtime/test/skills/discovery.test.ts`
**Decisions:** D033, D042

The packaged OVERDARE CLI launches `packages/web/src/server/index.ts`, which calls `ensureDiligentDir(cwd)` and `loadRuntimeConfig(cwd, paths)`. The CLI launcher already passes startup cwd into the runtime via `--cwd`, and runtime uses that value as the base for project-local storage. That means packaged CLI work cannot stop at Rust-only path changes; the runtime helpers used inside the runtime process must also resolve the selected namespace for both global and startup-cwd-local storage.

The important boundary is activation vs. reusability:

- the runtime helper/Options shape introduced here should be reusable by future callers
- the only caller required to supply a non-default namespace in P060 is the packaged OVERDARE CLI flow
- ordinary non-packaged runtime behavior remains on `.diligent` because no new caller is asked to opt in during this plan

Introduce one runtime helper for storage namespace resolution with a safe default:

```typescript
export const DEFAULT_STORAGE_NAMESPACE = "diligent";

export function resolveStorageNamespace(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DILIGENT_STORAGE_NAMESPACE?.trim().toLowerCase();
  if (!value) return DEFAULT_STORAGE_NAMESPACE;
  if (!/^[a-z0-9-]+$/.test(value)) {
    throw new Error(`Invalid DILIGENT_STORAGE_NAMESPACE: ${value}`);
  }
  return value;
}

export function resolveProjectDirName(env: NodeJS.ProcessEnv = process.env): string {
  return `.${resolveStorageNamespace(env)}`;
}
```

Then use it in the packaged-runtime-relevant helpers for this rollout:

- `diligent-dir.ts`: `resolvePaths(projectRoot, env?)`
- `config/loader.ts`: `~/.<namespace>/config.jsonc` and `./.<namespace>/config.jsonc`
- `auth/auth-store.ts`: `~/.<namespace>/auth.jsonc`
- `user-id.ts`: `~/.<namespace>/user-id`
- `skills/discovery.ts`: `./.<namespace>/skills` and `~/.<namespace>/skills`
- `runtime.ts`: pass through the updated helper calls without changing external behavior when env is absent
- `packages/web/src/server/index.ts`: continue using `ensureDiligentDir(cwd)` / `loadRuntimeConfig(cwd, paths)`, but now those helpers must create and consume `./.overdare` when the packaged env is set, assuming the launcher already handled any legacy migration before launch

Because the packaged runtime is compiled with `DILIGENT_STORAGE_NAMESPACE`, these helper changes affect packaged OVERDARE CLI behavior while preserving existing `.diligent` bootstrap for ordinary dev/runtime flows. The helper itself is reusable, but P060 activates it only through the packaged CLI build/startup path. The required packaged result is symmetry: if global is `~/.overdare`, local must also be `./.overdare` relative to startup cwd. If only legacy `.diligent` data exists, launcher-owned Task 3 moves it first.

**Verify:** `bun test` for the focused runtime tests above, plus a packaged runtime smoke test confirming it consumes `./.overdare` after launcher-owned migration when the packaged namespace is set.

### Task 5: Centralize packaged launcher global-dir resolution in Rust

**Files:** `apps/overdare-cli/src/init.rs`, `apps/overdare-cli/src/update.rs`, `apps/overdare-cli/src/webserver.rs`, shared Rust helper module if added
**Decisions:** D042

Replace repeated `home.join(".diligent")` helpers with one compile-time or runtime-selected namespace-aware helper used by every packaged launcher path consumer.

```rust
pub const DEFAULT_STORAGE_NAMESPACE: &str = "diligent";

pub fn storage_namespace() -> &'static str {
    match option_env!("DILIGENT_STORAGE_NAMESPACE") {
        Some(value) if !value.trim().is_empty() => value,
        _ => DEFAULT_STORAGE_NAMESPACE,
    }
}

pub fn global_storage_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME").map(PathBuf::from);

    home.map(|h| h.join(format!(".{}", storage_namespace())))
}
```

Then update all packaged launcher path usage sites to rely on the shared helper:

- `init.rs`: deployed bootstrap/plugins/config/logs
- `update.rs`: `config.jsonc`, `updates/`, `runtime/`, `version.json`
- `webserver.rs`: runtime launch env/args, cwd-local migration coordination, and any logging tied to runtime startup

Do not add dual-read behavior. After launcher-owned conditional migration, the packaged build should use exactly one namespace.

**Verify:** `cargo test` or `cargo check` in `apps/overdare-cli/`, plus focused unit tests for helper output and migration ordering.

### Task 6: Keep launcher/runtime behavior aligned with the selected namespace

**Files:** `scripts/build-overdare-sidecar.ts`, `apps/overdare-cli/src/webserver.rs`, `apps/overdare-cli/src/update.rs`
**Decisions:** D042

Ensure the packaged runtime binary and the CLI launcher use the same namespace so update/runtime paths remain coherent.

The packaged OVERDARE CLI system effectively has three launcher-owned storage consumers:

1. CLI init/setup
2. CLI updater
3. Bun-compiled runtime webserver launched by the CLI

This task must guarantee that all three resolve the same paths for desktop-only state.

Implementation direction:

```typescript
function buildSidecar(plat: PlatformTarget, storageNamespace: string): void {
  run(`bun build --compile --target=${plat.bunTarget} ${serverEntry} --outfile ${outPath}`, ROOT, {
    DILIGENT_STORAGE_NAMESPACE: storageNamespace,
  });
}
```

This task assumes Task 3 and Task 4 are implemented. The preferred outcome is coherence: packaged OVERDARE CLI should not split its state between `~/.overdare` and `~/.diligent`, or between `./.overdare` and `./.diligent`. By the time the runtime starts, any required migration should already be completed by the launcher.

**Verify:** manual packaged smoke test — install/run packaged OVERDARE CLI, confirm logs, updates, deployed bootstrap, sessions, knowledge, skills, and project config land under the selected namespace only, with one-time migration when only legacy data exists.

### Task 7: Document packaged OVERDARE CLI namespace semantics

**Files:** `README.md`, related packaging docs if/when restored

Document the new package metadata field and its deliberately narrow scope:

```json
{
  "diligent": {
    "projectName": "OVERDARE AI Agent",
    "storageNamespace": "overdare"
  }
}
```

The docs should state clearly:

- this is used by packaged OVERDARE CLI flows
- it changes packaged global state roots from `~/.diligent` to `~/.overdare`
- it changes packaged runtime project-local roots from `./.diligent` to `./.overdare` relative to launcher-passed startup cwd
- the CLI launcher migrates legacy `.diligent` only when the branded target does not yet exist
- invalid `storageNamespace` metadata fails packaging instead of falling back silently
- it does not change ordinary non-packaged source checkout bootstrap unless the packaged env is present
- the underlying runtime namespace abstraction may be reused later, but that wider adoption is not part of this rollout
- it is intended to avoid collisions between Diligent-based packaged products

If a dedicated branded packaging plan/doc is restored later, point it at this plan instead of leaving storage namespace as an implied future detail.

**Verify:** documentation examples match implemented metadata names and path behavior.

## Acceptance Criteria

1. A packaged OVERDARE CLI build with branded namespace `overdare` produces launcher/runtime binaries that agree on `DILIGENT_STORAGE_NAMESPACE=overdare`.
2. If `~/.overdare` is absent and `~/.diligent` exists, packaged launcher startup moves `~/.diligent` to `~/.overdare` before creating new global state.
3. If `<startup-cwd>/.overdare` is absent and `<startup-cwd>/.diligent` exists, the launcher moves `<startup-cwd>/.diligent` to `<startup-cwd>/.overdare` before launching the packaged runtime.
4. If the target namespace already exists, no merge or overwrite occurs; packaged runtime uses the target namespace as-is.
5. Packaged launcher paths for config, logs, plugin deployment, and updates resolve under `~/.overdare/` instead of `~/.diligent/`.
6. Packaged runtime paths for config, sessions, knowledge, skills, and images resolve under `./.overdare/` instead of `./.diligent/`.
7. A package without explicit `storageNamespace` metadata continues to use `.diligent` for both global and local state, and non-packaged callers remain unchanged in this plan.
8. No dual-write or directory-merge logic is added.
9. Invalid `storageNamespace` metadata causes packaging to fail rather than silently falling back to `.diligent`.
10. If global migration fails, packaged launcher startup surfaces an error and blocks packaged runtime startup.
11. If local migration fails, the launcher aborts packaged runtime launch rather than falling back to legacy paths or creating a fresh target namespace.
12. Skipped migration outcomes (`target exists`, `no legacy`) do not emit user-facing notices or extra diagnostic logging.
13. Packaging-script tests and launcher/runtime validation pass.
14. Documentation explains the conditional migration rule and the resulting single active namespace.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Packaged namespace parsing, normalization, and invalid-value failure | focused packaging-script tests and/or `cargo test --manifest-path apps/overdare-cli/Cargo.toml` |
| Unit | Packaging env propagation | `bun test` for updated/new script tests around package/build-exe-only helpers |
| Unit | Launcher-owned conditional migration helper | `cargo test` for focused CLI migration helper coverage |
| Unit | Runtime helper namespace resolution | `bun test` for runtime path helpers under default and overridden namespace |
| Unit | Rust global-dir helper | `cargo test` for helper behavior with default and overridden namespace |
| Integration | Launcher/runtime path coherence | package a branded OVERDARE CLI build and inspect generated runtime/config/log/update plus startup-cwd-local `.overdare/` locations |
| Manual | Conditional migration | test four cases: legacy-only, target-only, both-exist, neither-exists for both global and local directories, including the silent-skip policy |
| Manual | Failure surfacing | confirm global migration failure reports an error and blocks startup, while local migration failure aborts runtime launch from the CLI |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| CLI launcher and packaged runtime use different namespace values | Product state splits across two hidden dirs | Resolve namespace once in build/launch flow and pass it to both from the same source |
| Packaged runtime local state stays on `./.diligent` while global state moves to `~/.overdare` | Product still collides at repo boundary and behavior becomes confusing | Treat packaged runtime helpers as first-class scope; require `./.<namespace>` and `~/.<namespace>` together |
| Launcher and runtime disagree on what local root means | Files land under the wrong hidden dir and migration targets the wrong location | Define local packaged storage relative to the launcher-passed startup cwd and thread that contract through `--cwd` |
| Target namespace directory is created before migration check | Migration never triggers and legacy data is orphaned | Run launcher-owned migration before any mkdir/create_dir_all/ensure path calls for the target namespace |
| Both legacy and target directories exist | Unsafe merge could destroy or interleave user data | Never merge; prefer target and leave legacy untouched |
| Cache fingerprint ignores namespace | Wrong reused packaged binary after package switch | Include `storageNamespace` in build fingerprint |
| `storageNamespace` metadata accepts invalid filesystem-ish values | Broken package outputs or hidden path bugs | Normalize and validate to a simple slug before any build step starts |
| Migration failure falls through to partial startup | Product appears launched but storage is split or blocked in non-obvious ways | Fail hard on invalid `storageNamespace` values, surface global migration failure clearly, and fail local migration in the launcher before runtime launch |
| README/packaging-doc drift from implementation names | Future packaging variants become inconsistent | Update docs in the same change and keep one canonical `storageNamespace` field name |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D033 | Config hierarchy stays explicit and layered | Used to justify keeping packaged namespace selection as an explicit packaging input rather than implicit runtime guessing |
| D042 | Immediate persistence / disk as source of truth | Used to justify requiring one unambiguous namespace per packaged build after a single conditional migration pass |
