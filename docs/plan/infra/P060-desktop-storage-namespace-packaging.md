---
id: P060
status: backlog
created: 2026-04-04
---

# P060: Desktop Storage Namespace Packaging

## Goal

Desktop packaged builds can choose their own hidden storage namespace at package time so Diligent-based products do not collide on user machine state. A branded package such as an OVERDARE desktop distribution can use `.overdare` instead of `.diligent` consistently for both packaged desktop global state and packaged sidecar project-local state.

The runtime changes in this plan should introduce reusable namespace-aware path abstractions, but P060 activates them only through the packaged desktop build flow. In other words, the abstraction may be reusable by future callers, while the required behavior change in this plan remains scoped to packaged desktop / packaged sidecar execution.

When a packaged product first switches to a non-default namespace, it should perform a one-time conditional migration only if the target namespace does not exist and the legacy `.diligent` namespace does exist.

## Prerequisites

- Packaging pipeline MVP (P044)
- Desktop runtime auto-update architecture and path ownership in `apps/desktop/src-tauri/src/update.rs`, `init.rs`, and `sidecar.rs`
- Existing branded packaging metadata resolution in `apps/desktop/scripts/lib/project-name.ts`

## Artifact

```text
$ bun run apps/desktop/scripts/package.ts --version 0.3.0 --package thirdparty/overdare

Packaged desktop app starts and stores its desktop runtime state under:
- ~/.overdare/config.jsonc
- ~/.overdare/plugins/
- ~/.overdare/logs/
- ~/.overdare/updates/runtime/
- <startup-cwd>/.overdare/config.jsonc
- <startup-cwd>/.overdare/sessions/
- <startup-cwd>/.overdare/knowledge/
- <startup-cwd>/.overdare/skills/

The same packaged binary does not read from or write to ~/.diligent/ or <startup-cwd>/.diligent/ after migration/selection settles on the branded namespace.
```

Here `<startup-cwd>` means the startup cwd value passed by the desktop shell into the packaged sidecar via `--cwd`, which runtime then uses as the base for project-local storage resolution.

Conditional first-run migration rule:

- if `~/.overdare` does not exist and `~/.diligent` does exist, move `~/.diligent` → `~/.overdare`
- if `<startup-cwd>/.overdare` does not exist and `<startup-cwd>/.diligent` does exist, move `<startup-cwd>/.diligent` → `<startup-cwd>/.overdare`
- if the target namespace already exists, do not merge or overwrite legacy data
- if both source and target exist, keep the target as source of truth and leave legacy data untouched
- if migration is skipped because the target already exists or no legacy directory exists, continue silently without user-facing notice or diagnostic logging

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `apps/desktop/scripts/lib/project-name.ts` | Extend package metadata resolution to include a packaged desktop storage namespace. |
| `apps/desktop/scripts/package.ts` | Pass namespace env into sidecar build and Tauri build, and include it in build fingerprints. |
| `apps/desktop/scripts/build-exe-only.ts` | Pass the same namespace env through the exe-only packaging flow. |
| `packages/runtime/src/infrastructure/diligent-dir.ts` | Introduce a reusable namespace-aware runtime path helper and use it for packaged sidecar project-local resolution. |
| `packages/runtime/src/config/loader.ts` | Make runtime config lookup namespace-aware so packaged sidecar startup can activate the selected namespace. |
| `packages/runtime/src/config/runtime.ts` | Thread the reusable namespace-aware config/auth/userId/skills loading through packaged sidecar startup. |
| `packages/runtime/src/auth/auth-store.ts` | Make auth storage path resolution namespace-aware for packaged sidecar activation. |
| `packages/runtime/src/config/user-id.ts` | Make persisted userId path resolution namespace-aware for packaged sidecar activation. |
| `packages/runtime/src/skills/discovery.ts` | Make global/project skill root resolution namespace-aware for packaged sidecar activation. |
| `packages/web/src/shared/image-routes.ts` and `packages/web/src/server/index.ts` | Keep packaged sidecar persisted image and route behavior aligned with the selected local namespace rooted at startup cwd. |
| `packages/runtime/src/migration/*` and startup entrypoints | Add conditional migration from legacy `.diligent` to the selected namespace when target is absent. |
| `apps/desktop/src-tauri/src/init.rs` | Replace hardcoded `~/.diligent` setup/deploy paths with a single namespace-aware global directory helper. |
| `apps/desktop/src-tauri/src/sidecar.rs` | Replace hardcoded desktop log/update/runtime paths with the shared namespace-aware helper. |
| `apps/desktop/src-tauri/src/update.rs` | Replace hardcoded desktop config/update paths with the shared namespace-aware helper. |
| `apps/desktop/src-tauri/src/lib.rs` | Use the same namespace-aware helper for startup/init log and setup surfaces. |
| `apps/desktop/test/scripts/project-name.test.ts` | Add metadata-resolution tests for packaged desktop storage namespace. |
| `apps/desktop/test/scripts/version.test.ts` or new packaging-script tests | Verify package scripts propagate namespace env for desktop packaging flows. |
| `packages/runtime/test/**` | Add focused namespace tests for sidecar-used runtime path helpers. |
| `README.md` / desktop packaging docs | Document the new package metadata field and clarify that P060 activates the namespace abstraction only for packaged desktop state. |

### What does NOT change

- No change to un-packaged CLI/TUI/Web development behavior.
- No change to runtime project-local storage under `./.diligent/` for ordinary non-packaged source checkout workflows.
- No change to non-packaged callers unless they explicitly opt into the new runtime namespace abstraction in a future follow-up.
- No rename of internal package names, Rust module names, TypeScript symbols, or binary protocol names.
- No attempt to make end-user runtime namespace configurable after packaging; this plan is package/build-time selection only.
- No bidirectional sync, partial merge, or ongoing dual-write between `.diligent` and the branded namespace.
- No overwrite of an existing target namespace directory during migration.

## File Manifest

### apps/desktop/scripts/lib/

| File | Action | Description |
|------|--------|------------|
| `project-name.ts` | MODIFY | Resolve optional storage namespace metadata from package config and expose a normalized helper. |

### apps/desktop/scripts/

| File | Action | Description |
|------|--------|------------|
| `package.ts` | MODIFY | Thread packaged storage namespace into Bun sidecar and Tauri build env. |
| `build-exe-only.ts` | MODIFY | Thread packaged storage namespace into exe-only build env. |

### packages/runtime/src/infrastructure/

| File | Action | Description |
|------|--------|------------|
| `diligent-dir.ts` | MODIFY | Resolve project-local paths from a reusable namespace-aware helper instead of a hardcoded `.diligent`, while P060 activates it only for packaged sidecar flows. |

### packages/runtime/src/config/

| File | Action | Description |
|------|--------|------------|
| `loader.ts` | MODIFY | Use namespace-aware global/project config paths. |
| `runtime.ts` | MODIFY | Pass namespace-aware helpers into sidecar runtime startup flow. |
| `user-id.ts` | MODIFY | Use namespace-aware persisted userId path. |

### packages/runtime/src/migration/

| File | Action | Description |
|------|--------|------------|
| `storage-namespace.ts` | CREATE | Conditional migration helpers for legacy `.diligent` → target namespace when target is absent. |

### packages/web/src/

| File | Action | Description |
|------|--------|------------|
| `server/index.ts` | MODIFY | Ensure packaged sidecar startup performs conditional local migration and activates local namespace-aware paths consistently from desktop-passed startup cwd. |

### packages/web/src/shared/

| File | Action | Description |
|------|--------|------------|
| `image-routes.ts` | MODIFY | Preserve persisted image route expectations under the selected local namespace rooted at startup cwd. |

### packages/runtime/src/auth/

| File | Action | Description |
|------|--------|------------|
| `auth-store.ts` | MODIFY | Use namespace-aware auth.jsonc path for packaged sidecar auth loading. |

### packages/runtime/src/skills/

| File | Action | Description |
|------|--------|------------|
| `discovery.ts` | MODIFY | Use namespace-aware global/project skill discovery roots. |

### apps/desktop/src-tauri/src/

| File | Action | Description |
|------|--------|------------|
| `lib.rs` | MODIFY | Centralize desktop global-dir resolution and consume namespace-aware helper. |
| `init.rs` | MODIFY | Route default deployment, plugin deployment, and init logs through namespace-aware global dir. |
| `sidecar.rs` | MODIFY | Route updated runtime lookup and web logs through namespace-aware global dir. |
| `update.rs` | MODIFY | Route update manifest/config/runtime paths through namespace-aware global dir. |

### apps/desktop/test/scripts/

| File | Action | Description |
|------|--------|------------|
| `project-name.test.ts` | MODIFY | Add tests for `storageNamespace` metadata resolution and normalization. |
| `version.test.ts` or `package.test.ts` | MODIFY / CREATE | Verify package scripts emit `DILIGENT_STORAGE_NAMESPACE` when package metadata is present. |

### packages/runtime/test/

| File | Action | Description |
|------|--------|------------|
| `infrastructure/diligent-dir.test.ts` | MODIFY | Verify namespace-aware path resolution keeps default `.diligent` and supports packaged overrides. |
| `config/loader.test.ts` | MODIFY | Verify global/project config loading uses the selected namespace. |
| `auth/auth-store.test.ts` | MODIFY | Verify auth path resolution uses the selected namespace. |
| `skills/discovery.test.ts` | MODIFY | Verify global/project skill roots use the selected namespace. |
| `config/runtime.test.ts` | MODIFY | Verify packaged sidecar runtime startup keeps global and local namespace resolution aligned. |
| `migration/storage-namespace.test.ts` | CREATE | Verify move-only-when-target-missing migration semantics for global and local directories. |

### Root / docs

| File | Action | Description |
|------|--------|------------|
| `README.md` | MODIFY | Document packaged desktop storage namespace metadata and usage. |
| `docs/plan/feature/P041-branded-distribution-packaging.md` | MODIFY | Cross-reference this plan as the desktop storage-namespace follow-up. |

## Implementation Tasks

### Task 1: Define packaged desktop namespace metadata

**Files:** `apps/desktop/scripts/lib/project-name.ts`, `apps/desktop/test/scripts/project-name.test.ts`
**Decisions:** D033, D042

Extend the existing package metadata reader so packaged distributions can declare a desktop storage namespace without coupling it to visible product naming.

```typescript
interface DiligentPackageConfig {
  projectName?: string;
  desktopIcons?: string[];
  desktopStorageNamespace?: string;
}

export interface DesktopPackageBranding {
  projectName: string;
  projectArtifactName: string;
  desktopIcons?: string[];
  storageNamespace: string;
}

export function resolveDesktopStorageNamespace(packageDir?: string): string {
  const configured = packageDir
    ? readPackageJson(join(packageDir, "package.json"))?.diligent?.desktopStorageNamespace
    : undefined;
  return normalizeStorageNamespace(configured) ?? "diligent";
}
```

Normalization rules should be explicit and deterministic:

- accept a bare namespace such as `overdare`
- trim whitespace
- lowercase it
- reject path separators and dots in the stored value
- derive actual on-disk hidden directory names later as `.${namespace}`

This keeps package metadata stable and avoids leaking filesystem formatting concerns into every caller.

Invalid configured values should fail the packaging build immediately. Do not silently fall back to `diligent` when package metadata is present but invalid.

**Verify:** `bun test apps/desktop/test/scripts/project-name.test.ts`

### Task 2: Thread namespace through desktop package scripts

**Files:** `apps/desktop/scripts/package.ts`, `apps/desktop/scripts/build-exe-only.ts`
**Decisions:** D042

Teach the desktop packaging entrypoints to resolve one storage namespace per package build and pass it into every desktop binary compilation step.

```typescript
const storageNamespace = resolveDesktopStorageNamespace(extraPackageDir);

run(`bun build --compile --target=${plat.bunTarget} ${serverEntry} --outfile ${outPath}`, ROOT, {
  DILIGENT_STORAGE_NAMESPACE: storageNamespace,
});

run(`bunx tauri build --no-bundle --config "${tauriConfigPath}"`, DESKTOP, {
  TAURI_TARGET_TRIPLE: plat.tauriTriple,
  DILIGENT_APP_PROJECT_NAME: projectName,
  DILIGENT_RUNTIME_VERSION: version,
  DILIGENT_STORAGE_NAMESPACE: storageNamespace,
});
```

Update the Rust build fingerprint so packaging cache invalidation notices namespace changes:

```typescript
const buildFingerprint = [
  `runtimeVersion=${version}`,
  `updateUrl=${updateUrlEnv}`,
  `storageNamespace=${storageNamespace}`,
].join(";");
```

This task should keep namespace handling package-selected. Do not change ordinary workspace runtime startup or developer `bun run dev` flows unless the packaged env variable is present. The package script is the only required activator in this plan, even though the downstream runtime abstraction may be reusable by future callers.

**Verify:** targeted packaging-script tests for resolved env values; manual dry run with and without `--package thirdparty/overdare`.

### Task 3: Add conditional namespace migration helpers

**Files:** `packages/runtime/src/migration/storage-namespace.ts`, `packages/runtime/test/migration/storage-namespace.test.ts`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/init.rs`, `packages/web/src/server/index.ts`
**Decisions:** D042

Add one migration rule only:

- if target namespace is absent and legacy `.diligent` exists, move legacy directory to target namespace
- otherwise do nothing

This should be implemented as an explicit helper that can be used by both the Rust shell (for home-global state) and the packaged sidecar startup path (for startup-cwd-local state). The helper is intentionally reusable, but P060 only requires packaged desktop entrypoints to invoke it.

Illustrative TypeScript shape for local migration:

```typescript
export interface StorageNamespaceMigrationPaths {
  legacyPath: string;
  targetPath: string;
}

export async function migrateStorageNamespaceIfNeeded(paths: StorageNamespaceMigrationPaths): Promise<
  | { status: "migrated"; from: string; to: string }
  | { status: "skipped-no-legacy" }
  | { status: "skipped-target-exists" }
> {
  const legacyExists = await Bun.file(paths.legacyPath).exists();
  const targetExists = await Bun.file(paths.targetPath).exists();
  if (targetExists) return { status: "skipped-target-exists" };
  if (!legacyExists) return { status: "skipped-no-legacy" };
  await rename(paths.legacyPath, paths.targetPath);
  return { status: "migrated", from: paths.legacyPath, to: paths.targetPath };
}
```

Illustrative Rust shape for global migration:

```rust
pub enum MigrationOutcome {
    Migrated { from: PathBuf, to: PathBuf },
    SkippedNoLegacy,
    SkippedTargetExists,
}

pub fn migrate_global_namespace_if_needed() -> Result<MigrationOutcome, String> {
    let legacy = legacy_global_storage_dir();
    let target = global_storage_dir();
    // target exists -> skip
    // legacy missing -> skip
    // else rename legacy -> target
}
```

Migration should happen before any new namespace directories are created. That ordering is critical; otherwise the target would exist first and block migration forever.

Failure handling is intentionally strict:

- global migration failure should allow the desktop window to open but must surface an error and block further packaged runtime startup
- local migration failure should fail packaged sidecar launch rather than falling back to legacy or creating a fresh target namespace
- skipped migration outcomes (`skipped-no-legacy`, `skipped-target-exists`) should remain silent with no user-facing notice and no extra diagnostic logging

**Verify:** unit tests for all three outcomes; manual migration smoke test from a machine/repo that only has `.diligent`.

### Task 4: Make runtime helpers namespace-aware so packaged sidecar can activate them for both global and local state

**Files:** `packages/runtime/src/infrastructure/diligent-dir.ts`, `packages/runtime/src/config/loader.ts`, `packages/runtime/src/config/runtime.ts`, `packages/runtime/src/auth/auth-store.ts`, `packages/runtime/src/config/user-id.ts`, `packages/runtime/src/skills/discovery.ts`, `packages/runtime/test/infrastructure/diligent-dir.test.ts`, `packages/runtime/test/config/loader.test.ts`, `packages/runtime/test/auth/auth-store.test.ts`, `packages/runtime/test/skills/discovery.test.ts`
**Decisions:** D033, D042

The packaged sidecar launches `packages/web/src/server/index.ts`, which calls `ensureDiligentDir(cwd)` and `loadRuntimeConfig(cwd, paths)`. The desktop shell already passes startup cwd into the sidecar via `--cwd`, and runtime uses that value as the base for project-local storage. That means desktop packaging cannot stop at Rust-only path changes; the runtime helpers used inside the sidecar must also resolve the selected namespace for both global and startup-cwd-local storage.

The important boundary is activation vs. reusability:

- the runtime helper/Options shape introduced here should be reusable by future callers
- the only caller required to supply a non-default namespace in P060 is the packaged desktop flow
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

Then use it in the sidecar-relevant runtime helpers for this rollout:

- `diligent-dir.ts`: `resolvePaths(projectRoot, env?)`
- `config/loader.ts`: `~/.<namespace>/config.jsonc` and `./.<namespace>/config.jsonc`
- `auth/auth-store.ts`: `~/.<namespace>/auth.jsonc`
- `user-id.ts`: `~/.<namespace>/user-id`
- `skills/discovery.ts`: `./.<namespace>/skills` and `~/.<namespace>/skills`
- `runtime.ts`: pass through the updated helper calls without changing external behavior when env is absent
- `packages/web/src/server/index.ts`: continue using `ensureDiligentDir(cwd)` / `loadRuntimeConfig(cwd, paths)`, but now those helpers must create and consume `./.overdare` when the packaged env is set

Because the packaged sidecar is compiled with `DILIGENT_STORAGE_NAMESPACE`, these helper changes affect packaged desktop behavior while preserving existing `.diligent` defaults for ordinary dev/runtime flows. The helper itself is reusable, but P060 activates it only through the packaged desktop build/startup path. The required packaged result is symmetry: if global is `~/.overdare`, local must also be `./.overdare` relative to startup cwd. If only legacy `.diligent` data exists, Task 3 moves it first.

**Verify:** `bun test` for the focused runtime tests above, plus a packaged sidecar smoke test confirming it migrates legacy local `.diligent` only when `./.overdare` is absent.

### Task 5: Centralize desktop global-dir resolution in Rust

**Files:** `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/init.rs`, `apps/desktop/src-tauri/src/sidecar.rs`, `apps/desktop/src-tauri/src/update.rs`
**Decisions:** D042

Replace repeated `home.join(".diligent")` helpers with one compile-time namespace-aware helper used by every desktop path consumer.

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

Then update all desktop path usage sites to rely on the shared helper:

- `init.rs`: deployed defaults/plugins/config/logs
- `sidecar.rs`: `logs/`, `updates/runtime/`, updated `dist/client`, updated `rg`
- `update.rs`: `config.jsonc`, `updates/`, `runtime/`, `version.json`
- `lib.rs`: startup logging and any global-dir reporting

Do not add dual-read behavior. After conditional migration, the packaged build should use exactly one namespace.

**Verify:** `cargo test` or `cargo check` in `apps/desktop/src-tauri/`, plus focused unit tests for helper output and global migration ordering.

### Task 6: Keep sidecar/runtime behavior aligned with the selected namespace

**Files:** `apps/desktop/scripts/package.ts`, `apps/desktop/src-tauri/src/sidecar.rs`, `apps/desktop/src-tauri/src/update.rs`
**Decisions:** D042

Ensure the sidecar binary and the Tauri shell are compiled with the same namespace so update/runtime paths remain coherent.

The packaged desktop system effectively has three desktop-owned storage consumers:

1. Tauri shell init/setup
2. Tauri shell updater
3. Bun-compiled web sidecar launched by Tauri

This task must guarantee that all three resolve the same paths for desktop-only state.

Implementation direction:

```typescript
function buildSidecar(plat: PlatformTarget, storageNamespace: string): void {
  run(`bun build --compile --target=${plat.bunTarget} ${serverEntry} --outfile ${outPath}`, ROOT, {
    DILIGENT_STORAGE_NAMESPACE: storageNamespace,
  });
}
```

This task assumes Task 3 and Task 4 are implemented. The preferred outcome is coherence: packaged desktop should not split its state between `~/.overdare` and `~/.diligent`, or between `./.overdare` and `./.diligent`.

**Verify:** manual packaged smoke test — install/run packaged desktop, confirm logs, updates, deployed defaults, sessions, knowledge, skills, and project config land under the selected namespace only, with one-time migration when only legacy data exists.

### Task 7: Document packaged desktop namespace semantics

**Files:** `README.md`, `docs/plan/feature/P041-branded-distribution-packaging.md`

Document the new package metadata field and its deliberately narrow scope:

```json
{
  "diligent": {
    "projectName": "OVERDARE AI Agent",
    "desktopStorageNamespace": "overdare"
  }
}
```

The docs should state clearly:

- this is used by desktop packaging flows
- it changes packaged desktop state roots from `~/.diligent` to `~/.overdare`
- it changes packaged sidecar project-local roots from `./.diligent` to `./.overdare` relative to desktop-passed startup cwd
- it migrates legacy `.diligent` only when the branded target does not yet exist
- invalid namespace metadata fails packaging instead of falling back silently
- it does not change ordinary non-packaged source checkout defaults unless the packaged env is present
- the underlying runtime namespace abstraction may be reused later, but that wider adoption is not part of this rollout
- it is intended to avoid collisions between Diligent-based packaged products

Update P041 to point at this plan instead of leaving storage namespace as an implied future detail.

**Verify:** documentation examples match implemented metadata names and path behavior.

## Acceptance Criteria

1. A package with `diligent.desktopStorageNamespace = "overdare"` produces desktop binaries compiled with `DILIGENT_STORAGE_NAMESPACE=overdare`.
2. If `~/.overdare` is absent and `~/.diligent` exists, packaged desktop startup moves `~/.diligent` to `~/.overdare` before creating new global state.
3. If `<startup-cwd>/.overdare` is absent and `<startup-cwd>/.diligent` exists, packaged sidecar startup moves `<startup-cwd>/.diligent` to `<startup-cwd>/.overdare` before creating new local state.
4. If the target namespace already exists, no merge or overwrite occurs; packaged runtime uses the target namespace as-is.
5. Packaged desktop Tauri paths for config, logs, plugin deployment, and updates resolve under `~/.overdare/` instead of `~/.diligent/`.
6. Packaged sidecar runtime paths for config, sessions, knowledge, skills, and images resolve under `./.overdare/` instead of `./.diligent/`.
7. A package without explicit namespace metadata continues to use `.diligent` for both global and local state, and non-packaged callers remain unchanged in this plan.
8. No dual-write or directory-merge logic is added.
9. Invalid `desktopStorageNamespace` metadata causes packaging to fail rather than silently falling back to `.diligent`.
10. If global migration fails, packaged desktop opens the app window but surfaces an error and blocks packaged runtime startup.
11. If local migration fails, packaged sidecar launch fails rather than falling back to legacy paths or creating a fresh target namespace.
12. Skipped migration outcomes (`target exists`, `no legacy`) do not emit user-facing notices or extra diagnostic logging.
13. Packaging-script tests and desktop/runtime validation pass.
14. Documentation explains the conditional migration rule and the resulting single active namespace.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Namespace metadata parsing, normalization, and invalid-value failure | `bun test apps/desktop/test/scripts/project-name.test.ts` |
| Unit | Packaging env propagation | `bun test` for updated/new script tests around package/build-exe-only helpers |
| Unit | Conditional migration helper | `bun test packages/runtime/test/migration/storage-namespace.test.ts` |
| Unit | Runtime helper namespace resolution | `bun test` for runtime path helpers under default and overridden namespace |
| Unit | Rust global-dir helper | `cargo test` for helper behavior with default and overridden namespace |
| Integration | Desktop path coherence | package a branded desktop build and inspect generated runtime/config/log/update plus startup-cwd-local `.overdare/` locations |
| Manual | Conditional migration | test four cases: legacy-only, target-only, both-exist, neither-exists for both global and local directories, including the silent-skip policy |
| Manual | Failure surfacing | confirm global migration failure opens the desktop window with an error, while local migration failure aborts sidecar launch |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Tauri shell and Bun sidecar compile with different namespace values | Desktop state splits across two hidden dirs | Resolve namespace once in package script and pass it to both build steps from the same variable |
| Sidecar local state stays on `./.diligent` while global state moves to `~/.overdare` | Product still collides at repo boundary and behavior becomes confusing | Treat packaged sidecar runtime helpers as first-class scope; require `./.<namespace>` and `~/.<namespace>` together |
| Desktop and sidecar disagree on what local root means | Files land under the wrong hidden dir and migration targets the wrong location | Define local packaged storage relative to the desktop-passed startup cwd and thread that contract through `--cwd` |
| Target namespace directory is created before migration check | Migration never triggers and legacy data is orphaned | Run migration before any mkdir/create_dir_all/ensure path calls for the target namespace |
| Both legacy and target directories exist | Unsafe merge could destroy or interleave user data | Never merge; prefer target and leave legacy untouched |
| Cache fingerprint ignores namespace | Wrong reused shell binary after package switch | Include `storageNamespace` in Rust build fingerprint |
| Namespace metadata accepts invalid filesystem-ish values | Broken package outputs or hidden path bugs | Normalize and validate to a simple slug before any build step starts |
| Migration failure falls through to partial startup | Product appears launched but storage is split or blocked in non-obvious ways | Fail hard on invalid namespace values, surface global migration failure in-window, and fail local migration at sidecar launch |
| README/P041 drift from implementation names | Future packaging variants become inconsistent | Update docs in the same change and keep one canonical metadata field name |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D033 | Config hierarchy stays explicit and layered | Used to justify keeping desktop namespace selection as an explicit packaging input rather than implicit runtime guessing |
| D042 | Immediate persistence / disk as source of truth | Used to justify requiring one unambiguous namespace per packaged desktop build after a single conditional migration pass |
