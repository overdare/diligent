---
id: P059
status: backlog
created: 2026-03-30
---

# P059: Desktop Runtime Auto-Update

## Goal

The desktop app silently checks for runtime updates on launch, downloads them in the background, and applies them on the next restart -- enabling rapid sidecar/web/plugin iteration without reinstalling the Tauri shell.

## Prerequisites

- Packaging pipeline (P044) fully operational
- Hosting location for runtime bundles and manifests (GitHub Releases, S3, or similar)

## Artifact

```
User launches app (v0.2.2 bundled, v0.3.0 published)
  → App starts with v0.2.2 (bundled), background downloads v0.3.0
  → User restarts app
  → App starts with v0.3.0 (from ~/.diligent/updates/runtime/)
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `apps/desktop/src-tauri/src/update.rs` | New update engine: manifest fetch, download, verify, stage |
| `apps/desktop/src-tauri/src/sidecar.rs` | Prefer updated sidecar over bundled; `ManagedChild` enum for dual spawn paths |
| `apps/desktop/src-tauri/src/init.rs` | Prefer updated defaults/plugins over bundled |
| `apps/desktop/src-tauri/src/lib.rs` | Wire update apply + background check into setup |
| `apps/desktop/src-tauri/Cargo.toml` | Add `sha2` dependency |
| `apps/desktop/scripts/package.ts` | Produce runtime bundle zip per platform |
| `apps/desktop/scripts/lib/manifest.ts` | Update manifest generation |
| `.github/workflows/overdare-release.yml` | Upload runtime bundle + manifest |

### What does NOT change

- Tauri shell binary itself (no self-update of the Rust executable)
- User config at `~/.diligent/config.jsonc` (never overwritten)
- Existing packaging artifacts (platform zips continue to be produced)
- Code signing or notarization (future follow-up)
- Rollback UI or version picker (future follow-up)

## Architecture

### Runtime Bundle

A single zip per platform containing everything except the Tauri shell:

```
runtime-bundle-{version}-{platform}.zip
├── diligent-web-server{ext}   # sidecar binary
├── rg{ext}                    # ripgrep binary
├── dist/client/               # React SPA
├── plugins/                   # bundled plugins
└── defaults/                  # config templates
```

### Remote Manifest

Served at a configurable URL:

```json
{
  "version": "0.3.0",
  "releaseDate": "2026-03-30T00:00:00Z",
  "platforms": {
    "darwin-arm64": {
      "url": "https://releases.example.com/v0.3.0/runtime-bundle-0.3.0-darwin-arm64.zip",
      "sha256": "abc123...",
      "size": 45000000
    }
  }
}
```

### Local Storage

```
~/.diligent/updates/
├── manifest.json          # last fetched remote manifest
├── pending/               # downloaded, not yet applied
│   └── runtime-bundle-{ver}-{platform}.zip
└── runtime/               # extracted, verified, active
    ├── version.json       # { version, appliedAt, sha256 }
    ├── diligent-web-server{ext}
    ├── rg{ext}
    ├── dist/client/
    ├── plugins/
    └── defaults/
```

### Update Lifecycle

```
App launch
  │
  ├─ [sync] apply_pending_update()
  │   └─ pending zip exists? → verify SHA256 → extract to staging → rename to runtime/
  │
  ├─ [sync] init::run()
  │   └─ prefer updates/runtime/defaults/ over bundled defaults/
  │
  ├─ [async] spawn_update_check()
  │   └─ fetch manifest → compare version → download zip to pending/ (for NEXT launch)
  │
  └─ [async] launch_server()
      └─ prefer updates/runtime/sidecar over bundled sidecar
```

### Fallback Chain

| Resource | Priority 1 (updated) | Priority 2 (bundled) |
|----------|----------------------|----------------------|
| Sidecar | `~/.diligent/updates/runtime/diligent-web-server{ext}` | `app.shell().sidecar()` |
| dist/client | `~/.diligent/updates/runtime/dist/client/` | `resource_dir()/dist/client` |
| rg | `~/.diligent/updates/runtime/rg{ext}` | exe directory `rg{ext}` |
| defaults | `~/.diligent/updates/runtime/defaults/` | `resource_dir()/defaults` |

## File Manifest

### apps/desktop/src-tauri/src/

| File | Action | Description |
|------|--------|------------|
| `update.rs` | CREATE | Update engine: check, download, verify, stage |
| `sidecar.rs` | MODIFY | Add updated sidecar path resolution + `ManagedChild` enum |
| `init.rs` | MODIFY | Add updated defaults path resolution |
| `lib.rs` | MODIFY | Wire update into setup hook |

### apps/desktop/src-tauri/

| File | Action | Description |
|------|--------|------------|
| `Cargo.toml` | MODIFY | Add `sha2` dependency |

### apps/desktop/scripts/

| File | Action | Description |
|------|--------|------------|
| `lib/manifest.ts` | CREATE | Update manifest generation |
| `package.ts` | MODIFY | Produce runtime bundle zip |

### .github/workflows/

| File | Action | Description |
|------|--------|------------|
| `overdare-release.yml` | MODIFY | Upload runtime bundle + manifest |

## Implementation Tasks

### Task 1: Add `sha2` dependency

**Files:** `apps/desktop/src-tauri/Cargo.toml`

```toml
sha2 = { version = "0.10", default-features = false }
```

Small, pure-Rust crate. Avoids relying on transitive deps through `reqwest/rustls-tls`.

**Verify:** `cargo check` passes in `apps/desktop/src-tauri/`.

### Task 2: Create `update.rs` -- update engine

**Files:** `apps/desktop/src-tauri/src/update.rs`

Core module with four public functions:

```rust
// @summary Runtime auto-update: check, download, verify, stage

use std::fs;
use std::path::{Path, PathBuf};
use sha2::{Sha256, Digest};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    platforms: std::collections::HashMap<String, PlatformBundle>,
}

#[derive(Debug, Deserialize)]
struct PlatformBundle {
    url: String,
    sha256: String,
    size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InstalledVersion {
    pub version: String,
    pub applied_at: String,
    pub sha256: String,
}

/// Read installed updated version from updates/runtime/version.json
pub fn installed_version() -> Option<InstalledVersion> { ... }

/// Apply pending update: extract zip to runtime/, write version.json.
/// Synchronous. Called at startup BEFORE sidecar spawn.
pub fn apply_pending_update() -> Result<bool, String> {
    // 1. Read manifest.json from updates/
    // 2. Find pending zip for current platform
    // 3. Verify SHA256
    // 4. Extract to updates/runtime_staging/
    // 5. Set executable permissions (unix)
    // 6. Write version.json into staging
    // 7. Atomic swap: remove old runtime/, rename staging to runtime/
    // 8. Clean up pending zip
}

/// Non-blocking background update check + download.
pub fn spawn_update_check() {
    tauri::async_runtime::spawn(async { ... });
}

// Internal:
// - check_and_download() — fetch manifest, compare version, download zip
// - verify_sha256(path, expected) — compute and compare
// - extract_zip(zip_path, dest) — unzip on unix, Expand-Archive on windows
// - current_platform() — cfg! to platform ID string
// - resolve_manifest_url() — config.jsonc "updateUrl" > DILIGENT_UPDATE_URL env > disabled
```

**Key decisions:**
- Version comparison is string inequality (not semver ordering). Manifest declares "latest"; if different, download. Handles rollbacks.
- Zip extraction via system commands: `unzip` (unix) / PowerShell `Expand-Archive` (windows). No zip crate.
- Manifest URL from `config.jsonc` `"updateUrl"` > `DILIGENT_UPDATE_URL` compile-time env > empty (disabled).

**Verify:** Unit tests for `verify_sha256`, `InstalledVersion` serde round-trip, `current_platform()`.

### Task 3: Modify `sidecar.rs` -- prefer updated sidecar

**Files:** `apps/desktop/src-tauri/src/sidecar.rs`

**3a.** Replace `SidecarState` with dual-type child:

```rust
pub enum ManagedChild {
    TauriChild(tauri_plugin_shell::process::CommandChild),
    TokioChild(tokio::process::Child),
}

impl ManagedChild {
    pub fn kill(self) {
        match self {
            ManagedChild::TauriChild(c) => { let _ = c.kill(); }
            ManagedChild::TokioChild(mut c) => { let _ = c.kill(); }
        }
    }
}

pub struct SidecarState(pub Mutex<Option<ManagedChild>>);
```

**3b.** Add resolution functions:

```rust
fn resolve_updated_sidecar_path() -> Option<PathBuf> {
    let bin = if cfg!(windows) { "diligent-web-server.exe" } else { "diligent-web-server" };
    let path = global_dir()?.join("updates/runtime").join(bin);
    if path.exists() { Some(path) } else { None }
}

fn resolve_updated_dist_dir() -> Option<PathBuf> {
    let candidate = global_dir()?.join("updates/runtime/dist/client");
    if candidate.exists() { Some(candidate) } else { None }
}

fn resolve_updated_rg_bin() -> Option<PathBuf> {
    let bin = if cfg!(windows) { "rg.exe" } else { "rg" };
    let path = global_dir()?.join("updates/runtime").join(bin);
    if path.exists() { Some(path) } else { None }
}
```

**3c.** Branch in `start_sidecar()`:

```rust
pub async fn start_sidecar(app: &AppHandle, cwd: &str) -> Result<u16, String> {
    let dist_dir = resolve_updated_dist_dir()
        .unwrap_or(resolve_dist_dir(app)?);
    let rg_path = resolve_updated_rg_bin().or_else(resolve_rg_bin);
    // ... build args ...

    if let Some(updated) = resolve_updated_sidecar_path() {
        spawn_updated_sidecar(app, &updated, &args, rg_path.as_deref()).await
    } else {
        spawn_bundled_sidecar(app, &args, rg_path.as_deref()).await
    }
}
```

Updated sidecar uses `tokio::process::Command` (reads `DILIGENT_PORT=` from stdout). Bundled path uses existing `app.shell().sidecar()` logic (extracted to `spawn_bundled_sidecar`).

**Verify:** Build compiles. With no `updates/runtime/`, bundled sidecar is used (existing behavior). With mock binary in `updates/runtime/`, updated path is selected.

### Task 4: Modify `init.rs` -- prefer updated defaults

**Files:** `apps/desktop/src-tauri/src/init.rs`

Minimal change -- add one resolution step:

```rust
fn resolve_updated_defaults_dir(log: &mut String) -> Option<PathBuf> {
    let candidate = global_dir()?.join("updates/runtime/defaults");
    if candidate.exists() {
        let _ = writeln!(log, "[init] Using updated defaults: {}", candidate.display());
        Some(candidate)
    } else {
        None
    }
}

// In run():
let defaults_dir = resolve_updated_defaults_dir(&mut log)
    .or_else(|| resolve_defaults_dir(app, &mut log));
```

**Verify:** Existing init behavior unchanged when `updates/runtime/` doesn't exist.

### Task 5: Wire update flow in `lib.rs`

**Files:** `apps/desktop/src-tauri/src/lib.rs`

```rust
mod update;

// In setup():
.setup(|app| {
    // 1. Apply pending update (sync, before init)
    match update::apply_pending_update() {
        Ok(true) => eprintln!("[update] Applied pending update"),
        Ok(false) => {}
        Err(e) => eprintln!("[update] Failed to apply: {e}"),
    }

    // 2. Deploy defaults (uses updated paths if available)
    init::run(app);

    // 3. Background check for next launch
    update::spawn_update_check();

    Ok(())
})
```

Order: apply → init → background check.

**Verify:** App launches normally. `~/.diligent/init.log` shows correct resolution path.

### Task 6: Version injection for Rust shell

**Files:** `apps/desktop/scripts/package.ts`, `apps/desktop/src-tauri/src/update.rs`

During packaging, pass `DILIGENT_RUNTIME_VERSION` env var to Tauri build:

```typescript
// In buildDesktop():
env: { DILIGENT_RUNTIME_VERSION: version }
```

In `update.rs`, read at compile time:

```rust
const BUNDLED_VERSION: &str = match option_env!("DILIGENT_RUNTIME_VERSION") {
    Some(v) => v,
    None => "0.0.0-dev",
};
```

Effective version for comparison: `installed_version().version` if exists, else `BUNDLED_VERSION`.

**Verify:** Built binary prints correct version. Dev build uses `"0.0.0-dev"`.

### Task 7: Create `manifest.ts` and modify `package.ts`

**Files:** `apps/desktop/scripts/lib/manifest.ts` (CREATE), `apps/desktop/scripts/package.ts` (MODIFY)

After desktop build, assemble runtime bundle zip per platform:

```typescript
function assembleRuntimeBundle(plat: PlatformTarget): string | undefined {
    // Copy sidecar, rg, dist/client, plugins, defaults into temp dir
    // Zip it as {projectArtifactName}-runtime-{version}-{platform}.zip
    // Return zip filename
}
```

Generate update manifest with SHA256 of each runtime bundle:

```typescript
export function generateUpdateManifest(opts: {
    version: string;
    distDir: string;
    platforms: PlatformTarget[];
    baseUrl: string;
    projectArtifactName: string;
}): void { ... }
```

**Verify:** `bun run package --version 0.3.0 --platforms darwin-arm64` produces both `overdare-0.3.0-darwin-arm64.zip` (existing) and `overdare-runtime-0.3.0-darwin-arm64.zip` (new) plus `update-manifest.json`.

### Task 8: Update CI workflow

**Files:** `.github/workflows/overdare-release.yml`

Add artifact upload for runtime bundle and update manifest.

**Verify:** CI run produces runtime bundle artifact alongside existing artifacts.

## Acceptance Criteria

1. App launches normally when no updates exist (bundled runtime)
2. Background update check runs without blocking startup
3. Downloaded zip is verified against manifest SHA256
4. Pending update is extracted and staged atomically on next launch
5. Sidecar spawns from `updates/runtime/` when staged
6. Init deploys from `updates/runtime/defaults/` when available
7. Bundled versions used as fallback when `updates/runtime/` absent
8. `package.ts` produces `runtime-bundle-{ver}-{platform}.zip`
9. `update-manifest.json` generated with correct checksums
10. Works on all 5 target platforms

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | `verify_sha256` correctness | Known file with precomputed hash |
| Unit | `InstalledVersion` serde | Round-trip serialize/deserialize |
| Unit | `current_platform()` | Assert valid platform ID |
| Unit | `manifest.ts` generation | Known inputs, verify JSON |
| Integration | Full apply cycle | Place test zip in `pending/`, call `apply_pending_update()`, check `runtime/` |
| Integration | Sidecar path override | Mock binary in `updates/runtime/`, verify selection |
| Integration | Bundled fallback | No `updates/runtime/`, verify bundled used |
| Integration | Runtime bundle packaging | Run `package.ts`, verify zip contents |
| Manual | End-to-end update | Build v1, publish v2 manifest, launch, restart, verify v2 |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `unzip`/PowerShell unavailable | Extraction fails | System utilities on all targets; log clear error |
| Corrupt update blocks app | Unusable | SHA256 verify before staging; bundled fallback |
| Disk full during extract | Partial state | Extract to staging dir; rename only after success |
| Updated sidecar crashes | Startup fails | Future: catch spawn failure, retry with bundled |
| Manifest URL unreachable | No updates | Background check fails silently; app continues |

## Runtime Bundle Contract

This section documents the implicit cross-language contract between the TypeScript packaging scripts and the Rust update/sidecar/init modules. Any change to the runtime bundle layout must be reflected in all production and consumption points listed here.

### Directory Layout

The applied runtime lives at `~/.diligent/updates/runtime/`. Both `sidecar.rs` and `init.rs` resolve paths relative to this root. The staging directory (`~/.diligent/updates/runtime_staging/`) is an intermediate location that is renamed atomically to `runtime/` on successful extraction.

| Path (relative to `runtime/`) | Produced by | Consumed by | Role |
|-------------------------------|-------------|-------------|------|
| `diligent-web-server` (or `.exe` on Windows) | `package.ts` `assembleRuntimeBundle` | `sidecar.rs` `resolve_updated_sidecar_path` | Sidecar binary — the compiled TypeScript web server |
| `rg` (or `rg.exe` on Windows) | `package.ts` `assembleRuntimeBundle` | `sidecar.rs` `resolve_updated_rg_bin` | Ripgrep binary passed to sidecar via `--rg-path` arg |
| `dist/client/` | `package.ts` `assembleRuntimeBundle` | `sidecar.rs` `resolve_updated_dist_dir` | React SPA passed to sidecar via `--dist-dir` arg |
| `plugins/` | `package.ts` `assembleRuntimeBundle` | `init.rs` plugin copy logic | Bundled plugins deployed to global config on first run |
| `defaults/` | `package.ts` `assembleRuntimeBundle` | `init.rs` `resolve_updated_defaults_dir` | Config templates deployed to global config on first run |
| `version.json` | `update.rs` `apply_pending_update` | `update.rs` `installed_version` | Installed-version metadata; see schema below |

### Platform Identifier Mapping

Platform identifier strings must match exactly between the TypeScript manifest generator and the Rust manifest consumer. The single source of truth for TypeScript is `apps/desktop/scripts/lib/platforms.ts` (`PlatformTarget.id`). The Rust equivalent is `current_platform()` in `update.rs`.

| Platform | TypeScript `PlatformTarget.id` | Rust `current_platform()` return value | Rust `cfg!` predicate |
|----------|-------------------------------|----------------------------------------|----------------------|
| macOS Apple Silicon | `darwin-arm64` | `"darwin-arm64"` | `target_os="macos"` + `target_arch="aarch64"` |
| macOS Intel | `darwin-x64` | `"darwin-x64"` | `target_os="macos"` + `target_arch="x86_64"` |
| Linux x64 | `linux-x64` | `"linux-x64"` | `target_os="linux"` + `target_arch="x86_64"` |
| Linux ARM64 | `linux-arm64` | `"linux-arm64"` | `target_os="linux"` + `target_arch="aarch64"` |
| Windows x64 | `windows-x64` | `"windows-x64"` | `target_os="windows"` + `target_arch="x86_64"` |

If a new platform is added to `ALL_PLATFORMS` in `platforms.ts`, a matching `#[cfg(...)]` arm must be added to `current_platform()` in `update.rs`.

### `update-manifest.json` Schema

Generated by `apps/desktop/scripts/lib/manifest.ts` `generateUpdateManifest`. Consumed by `apps/desktop/src-tauri/src/update.rs` `UpdateManifest` / `PlatformBundle` structs (via `serde_json`).

```jsonc
{
  "version": "0.3.0",           // string — runtime bundle version (compared against installed version)
  "releaseDate": "2026-03-30T00:00:00.000Z", // string ISO-8601 — informational only, not read by Rust
  "platforms": {
    "<platform-id>": {          // key matches PlatformTarget.id / current_platform()
      "url": "https://...",     // string — download URL for the runtime bundle zip
      "sha256": "abc123...",    // string — hex-encoded SHA-256 of the zip file
      "size": 45000000          // number — byte length of the zip file (informational)
    }
  }
}
```

The Rust `UpdateManifest` struct uses `#[serde(default)]` on `platforms`, so a manifest with no platforms for the current platform is accepted and silently skips the update. `releaseDate` is not parsed by Rust and can evolve freely.

### `version.json` Schema

Written by `update.rs` `apply_pending_update` to `~/.diligent/updates/runtime/version.json` after successful staging. Read by `update.rs` `installed_version` to determine the currently active runtime version.

```jsonc
{
  "version": "0.3.0",           // string — version string matching the manifest "version" field
  "applied_at": "2026-03-30T00:00:00.000Z", // string ISO-8601 — timestamp of when the update was staged
  "sha256": "abc123..."         // string — hex-encoded SHA-256 of the zip that was applied
}
```

This file is written by Rust only. If a TypeScript component (e.g., the sidecar) ever reads `version.json` to report its version, the schema above is the authoritative contract.

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D096 | Protocol version fixed at 1 | Version comparison uses runtime version, not protocol version |
