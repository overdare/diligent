---
id: P044
status: backlog
created: 2026-03-09
---

# P044: Packaging Pipeline MVP

## Goal

A single script orchestrates CLI, Web server, and Desktop builds for all target platforms, producing organized per-platform artifact directories with version-stamped filenames and a checksum manifest. No branding changes — everything stays `diligent`.

## Prerequisites

- Existing per-target CLI build scripts in root `package.json` (`build:darwin-arm64`, etc.)
- Existing Web frontend build via `packages/web` Vite pipeline
- Existing Desktop build via `apps/desktop` Tauri pipeline with sidecar compilation
- `DILIGENT_VERSION` constant in `packages/protocol/src/methods.ts`

## Artifact

After running the packaging script:

```
$ bun run scripts/package.ts --version 0.1.0 --platforms darwin-arm64,linux-x64

dist/
├── darwin-arm64/
│   ├── diligent-0.1.0-darwin-arm64           # CLI binary
│   ├── diligent-server-0.1.0-darwin-arm64    # Web server binary
│   ├── Diligent-0.1.0.app/                   # Desktop app bundle (macOS only)
│   └── diligent-desktop-0.1.0-darwin-arm64   # Desktop raw binary
├── linux-x64/
│   ├── diligent-0.1.0-linux-x64
│   ├── diligent-server-0.1.0-linux-x64
│   ├── diligent-desktop-0.1.0-linux-x64
│   ├── diligent-desktop-0.1.0-linux-x64.AppImage
│   └── diligent-desktop-0.1.0-linux-x64.deb
├── checksums.sha256
└── release-meta.json
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `scripts/package.ts` | CREATE — main packaging orchestrator |
| `scripts/lib/platforms.ts` | CREATE — platform target definitions |
| `scripts/lib/version.ts` | CREATE — version injection helpers |
| `scripts/lib/checksum.ts` | CREATE — SHA256 checksum generation |
| root `package.json` | Add `package` script entry |
| `packages/protocol/src/methods.ts` | Version patched at package-time (restored after) |
| `apps/desktop/src-tauri/tauri.conf.json` | Version patched at package-time (restored after) |

### What does NOT change

- No branding or product identity changes — all names stay `diligent` / `Diligent`
- No storage path changes (`.diligent`, `~/.config/diligent`)
- No distribution spec or branded manifest (that's P041 scope)
- No CI/GitHub Actions workflow (future follow-up)
- No code signing or notarization (future follow-up)
- No changes to existing individual build scripts — the packaging script calls them as-is

## File Manifest

### scripts/

| File | Action | Description |
|------|--------|------------|
| `package.ts` | CREATE | Main packaging orchestrator — parses args, runs builds, assembles output |
| `lib/platforms.ts` | CREATE | Platform target definitions and filtering |
| `lib/version.ts` | CREATE | Version injection into protocol and Tauri config |
| `lib/checksum.ts` | CREATE | SHA256 checksum generation for all artifacts |

### Root

| File | Action | Description |
|------|--------|------------|
| `package.json` | MODIFY | Add `"package"` script entry |

## Implementation Tasks

### Task 1: Platform target definitions

**Files:** `scripts/lib/platforms.ts`

Define the canonical platform target list used across CLI, Web server, and Desktop builds.

```typescript
// @summary Platform target definitions for packaging pipeline

export interface PlatformTarget {
  id: string;                // e.g. "darwin-arm64"
  bunTarget: string;         // e.g. "bun-darwin-arm64"
  tauriTriple: string;       // e.g. "aarch64-apple-darwin"
  ext: string;               // ".exe" for windows, "" otherwise
  os: "darwin" | "linux" | "windows";
  arch: "arm64" | "x64";
  desktopBundleTypes: string[];  // ["app"] for macOS, ["AppImage", "deb"] for linux, ["msi"] for windows
}

export const ALL_PLATFORMS: PlatformTarget[] = [
  {
    id: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    tauriTriple: "aarch64-apple-darwin",
    ext: "",
    os: "darwin",
    arch: "arm64",
    desktopBundleTypes: ["app"],
  },
  {
    id: "darwin-x64",
    bunTarget: "bun-darwin-x64",
    tauriTriple: "x86_64-apple-darwin",
    ext: "",
    os: "darwin",
    arch: "x64",
    desktopBundleTypes: ["app"],
  },
  {
    id: "linux-x64",
    bunTarget: "bun-linux-x64",
    tauriTriple: "x86_64-unknown-linux-gnu",
    ext: "",
    os: "linux",
    arch: "x64",
    desktopBundleTypes: ["AppImage", "deb"],
  },
  {
    id: "windows-x64",
    bunTarget: "bun-windows-x64",
    tauriTriple: "x86_64-pc-windows-msvc",
    ext: ".exe",
    os: "windows",
    arch: "x64",
    desktopBundleTypes: ["msi"],
  },
];

export function filterPlatforms(ids: string[]): PlatformTarget[] {
  return ALL_PLATFORMS.filter((p) => ids.includes(p.id));
}
```

**Verify:** Import and call `filterPlatforms(["darwin-arm64"])` — returns single entry.

### Task 2: Version injection helpers

**Files:** `scripts/lib/version.ts`

Temporarily patch version into the two source-of-truth locations before builds, and restore after.

```typescript
// @summary Version injection for packaging — patches protocol and Tauri config

import { readFileSync, writeFileSync } from "node:fs";

const PROTOCOL_PATH = "packages/protocol/src/methods.ts";
const TAURI_CONF_PATH = "apps/desktop/src-tauri/tauri.conf.json";

interface VersionBackup {
  protocolOriginal: string;
  tauriOriginal: string;
}

export function injectVersion(version: string): VersionBackup {
  const protocolOriginal = readFileSync(PROTOCOL_PATH, "utf-8");
  const tauriOriginal = readFileSync(TAURI_CONF_PATH, "utf-8");

  // Patch protocol version
  const patchedProtocol = protocolOriginal.replace(
    /export const DILIGENT_VERSION = "[^"]+"/,
    `export const DILIGENT_VERSION = "${version}"`
  );
  writeFileSync(PROTOCOL_PATH, patchedProtocol);

  // Patch Tauri version
  const tauriConf = JSON.parse(tauriOriginal);
  tauriConf.version = version;
  writeFileSync(TAURI_CONF_PATH, JSON.stringify(tauriConf, null, 2) + "\n");

  return { protocolOriginal, tauriOriginal };
}

export function restoreVersion(backup: VersionBackup): void {
  writeFileSync(PROTOCOL_PATH, backup.protocolOriginal);
  writeFileSync(TAURI_CONF_PATH, backup.tauriOriginal);
}
```

**Verify:** Run inject → read files → confirm version replaced → run restore → confirm originals restored.

### Task 3: Checksum generation

**Files:** `scripts/lib/checksum.ts`

Generate SHA256 checksums for all files in the output directory.

```typescript
// @summary SHA256 checksum generation for release artifacts

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export function generateChecksums(distDir: string): void {
  const files = collectFiles(distDir).filter(
    (f) => !f.endsWith("checksums.sha256") && !f.endsWith("release-meta.json")
  );
  const lines: string[] = [];
  for (const file of files.sort()) {
    const hash = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
    lines.push(`${hash}  ${relative(distDir, file)}`);
  }
  writeFileSync(join(distDir, "checksums.sha256"), lines.join("\n") + "\n");
}
```

**Verify:** Create a temp dir with test files, run `generateChecksums`, verify output format matches `sha256sum` output.

### Task 4: Main packaging orchestrator

**Files:** `scripts/package.ts`, root `package.json`

The main script that ties everything together. It:

1. Parses CLI args (`--version`, `--platforms`, `--skip-desktop`)
2. Injects version
3. Builds Web frontend (shared by server sidecar and desktop)
4. Builds CLI binaries per platform
5. Builds Web server binaries per platform
6. Optionally builds Desktop per platform (only if current OS matches target and `--skip-desktop` not set)
7. Copies artifacts into `dist/{platform}/` with versioned filenames
8. Generates `checksums.sha256` and `release-meta.json`
9. Restores version files

```typescript
// @summary Main packaging orchestrator — builds all targets and assembles dist/

import { parseArgs } from "node:util";
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { ALL_PLATFORMS, filterPlatforms, type PlatformTarget } from "./lib/platforms";
import { injectVersion, restoreVersion } from "./lib/version";
import { generateChecksums } from "./lib/checksum";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    version: { type: "string" },
    platforms: { type: "string", default: ALL_PLATFORMS.map((p) => p.id).join(",") },
    "skip-desktop": { type: "boolean", default: false },
  },
});

if (!values.version) {
  console.error("Usage: bun run scripts/package.ts --version <semver> [--platforms p1,p2] [--skip-desktop]");
  process.exit(1);
}

const version = values.version;
const platformIds = values.platforms!.split(",").map((s) => s.trim());
const platforms = filterPlatforms(platformIds);
const skipDesktop = values["skip-desktop"];

// ... orchestration logic:
// 1. Clean dist/
// 2. Inject version
// 3. Build web frontend
// 4. For each platform: build CLI, build web server, copy to dist/{platform}/
// 5. If !skipDesktop: build desktop per platform (cross-compile limited by Tauri)
// 6. Generate release-meta.json
// 7. Generate checksums
// 8. Restore version files
```

Key design decisions in the orchestrator:

- **Desktop cross-compilation is limited.** Tauri can only build native bundles for the current OS. The script detects the current OS and only builds desktop for matching platforms. CLI and Web server (pure Bun) can cross-compile freely.
- **Web frontend builds once.** The Vite build is platform-independent and shared.
- **Version restore happens in a `finally` block** to prevent leaving patched files on failure.
- **`release-meta.json`** records version, build date, git commit, and platform list for traceability.

```typescript
interface ReleaseMeta {
  version: string;
  buildDate: string;       // ISO 8601
  gitCommit: string;       // short SHA
  platforms: string[];
  artifacts: Record<string, string[]>;  // platform → filenames
}
```

Root `package.json` addition:

```json
{
  "scripts": {
    "package": "bun run scripts/package.ts"
  }
}
```

**Verify:** Run `bun run package --version 0.0.1-test --platforms darwin-arm64 --skip-desktop` — produces `dist/darwin-arm64/` with CLI and server binaries, plus `checksums.sha256` and `release-meta.json`.

### Task 5: Artifact naming and copy logic

**Files:** `scripts/package.ts` (continued from Task 4)

Define the exact artifact naming conventions and copy sources:

```typescript
function artifactName(base: string, version: string, platform: PlatformTarget): string {
  return `${base}-${version}-${platform.id}${platform.ext}`;
}

// CLI binary
// Source: bun build --compile --target={bunTarget} packages/cli/src/index.ts --outfile <temp>
// Dest:   dist/{platform.id}/diligent-{version}-{platform.id}{ext}

// Web server binary
// Source: bun build --compile --target={bunTarget} packages/web/src/server/index.ts --outfile <temp>
// Dest:   dist/{platform.id}/diligent-server-{version}-{platform.id}{ext}

// Desktop binary (raw)
// Source: apps/desktop/src-tauri/target/release/diligent-desktop{ext}
// Dest:   dist/{platform.id}/diligent-desktop-{version}-{platform.id}{ext}

// Desktop bundle (macOS .app)
// Source: apps/desktop/src-tauri/target/release/bundle/macos/Diligent.app
// Dest:   dist/{platform.id}/Diligent-{version}.app  (directory copy)

// Desktop bundle (Linux AppImage)
// Source: apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage
// Dest:   dist/{platform.id}/diligent-desktop-{version}-{platform.id}.AppImage

// Desktop bundle (Linux deb)
// Source: apps/desktop/src-tauri/target/release/bundle/deb/*.deb
// Dest:   dist/{platform.id}/diligent-desktop-{version}-{platform.id}.deb

// Desktop bundle (Windows MSI)
// Source: apps/desktop/src-tauri/target/release/bundle/msi/*.msi
// Dest:   dist/{platform.id}/diligent-desktop-{version}-{platform.id}.msi
```

Build commands used (wrapping existing scripts):

```typescript
// CLI: direct bun build --compile per platform
function buildCli(platform: PlatformTarget, outfile: string): void {
  execSync(
    `bun build --compile --target=${platform.bunTarget} packages/cli/src/index.ts --outfile ${outfile}`,
    { cwd: ROOT, stdio: "inherit" }
  );
}

// Web server: direct bun build --compile per platform
function buildWebServer(platform: PlatformTarget, outfile: string): void {
  execSync(
    `bun build --compile --target=${platform.bunTarget} packages/web/src/server/index.ts --outfile ${outfile}`,
    { cwd: ROOT, stdio: "inherit" }
  );
}

// Web frontend: build once
function buildWebFrontend(): void {
  execSync("bun run build", { cwd: join(ROOT, "packages/web"), stdio: "inherit" });
}

// Desktop: uses existing Tauri pipeline with TAURI_TARGET_TRIPLE env
function buildDesktop(platform: PlatformTarget): void {
  // Copy frontend dist to Tauri resources
  const clientDist = join(ROOT, "packages/web/dist/client");
  const resourceDist = join(ROOT, "apps/desktop/src-tauri/resources/dist/client");
  cpSync(clientDist, resourceDist, { recursive: true });

  // Build sidecar for this platform
  execSync(`bun run build:sidecar`, {
    cwd: join(ROOT, "apps/desktop"),
    stdio: "inherit",
    env: { ...process.env, TAURI_TARGET_TRIPLE: platform.tauriTriple },
  });

  // Build Tauri app
  execSync("bunx tauri build", {
    cwd: join(ROOT, "apps/desktop"),
    stdio: "inherit",
  });
}
```

**Verify:** Inspect `dist/{platform}/` contents — filenames include version and platform, no stale files from previous builds.

### Task 6: Release metadata and final assembly

**Files:** `scripts/package.ts` (finalization section)

After all builds complete, generate metadata:

```typescript
function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function writeReleaseMeta(
  distDir: string,
  version: string,
  platforms: PlatformTarget[],
  artifacts: Record<string, string[]>
): void {
  const meta: ReleaseMeta = {
    version,
    buildDate: new Date().toISOString(),
    gitCommit: getGitCommit(),
    platforms: platforms.map((p) => p.id),
    artifacts,
  };
  writeFileSync(
    join(distDir, "release-meta.json"),
    JSON.stringify(meta, null, 2) + "\n"
  );
}
```

The script prints a summary table at the end:

```
✓ Packaging complete: diligent v0.1.0

  darwin-arm64/
    diligent-0.1.0-darwin-arm64          12.3 MB
    diligent-server-0.1.0-darwin-arm64   14.1 MB
    Diligent-0.1.0.app                   28.5 MB

  linux-x64/
    diligent-0.1.0-linux-x64            11.8 MB
    diligent-server-0.1.0-linux-x64     13.6 MB

  checksums.sha256
  release-meta.json
```

**Verify:** `release-meta.json` contains correct version, date, commit, platform list, and artifact inventory. `checksums.sha256` matches `sha256sum -c` validation.

## Acceptance Criteria

1. `bun run package --version 0.1.0 --platforms darwin-arm64 --skip-desktop` completes successfully
2. CLI binary at `dist/darwin-arm64/diligent-0.1.0-darwin-arm64` runs and prints correct version
3. Web server binary at `dist/darwin-arm64/diligent-server-0.1.0-darwin-arm64` starts and serves
4. `checksums.sha256` validates with `cd dist && sha256sum -c checksums.sha256`
5. `release-meta.json` contains version, git commit, build date, and artifact list
6. After packaging completes, `packages/protocol/src/methods.ts` and `apps/desktop/src-tauri/tauri.conf.json` are restored to original content
7. `--platforms` flag correctly filters which platforms to build
8. Existing individual build scripts (`build:darwin-arm64`, `desktop:build`, etc.) still work unchanged
9. No branding changes — all artifact names use `diligent` / `Diligent`

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Platform filtering | Import `filterPlatforms`, assert correct filtering |
| Unit | Version injection/restore | Inject, read files, restore, compare originals |
| Unit | Checksum generation | Generate on known files, verify SHA256 values |
| Integration | Full CLI-only packaging | `--skip-desktop --platforms darwin-arm64`, verify output structure |
| Integration | Version propagation | Built CLI binary outputs injected version string |
| Manual | Full packaging run | Build all available platforms, inspect dist/ |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Desktop cross-compile limitation | Tauri can only build native bundles for current OS | Script detects OS, skips non-native desktop builds with clear message |
| Version restore failure on build error | Source files left with patched version | Use try/finally to always restore; git status check at end |
| Large artifact sizes | dist/ can grow to several GB for all platforms | `--platforms` flag for targeted builds; clean dist/ at start |
| Bun cross-compile flakiness | Some targets may fail | Each platform build is independent; failures don't block other platforms |

## Decisions Referenced

None — this is the first packaging infrastructure plan. No existing decisions in `decisions.md` cover build or release processes.

## Relationship to P041

This plan extracts **only the packaging pipeline** from P041 (Branded Distribution Packaging). P041's branding, product identity, distribution spec, storage policy, and bundled plugin concerns are intentionally excluded. When P041 proceeds later, it can layer branding on top of this pipeline by parameterizing the artifact names and injecting product metadata.
