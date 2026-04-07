# Packaging

This guide describes the current packaging model in Diligent.

## Verified contract

Diligent packaging spans three related product surfaces:

- CLI
- Web/server
- Desktop

Desktop packaging is the most involved path because it combines a Tauri shell, a bundled web frontend, and a compiled Bun sidecar.

Today, the documented packaging pipeline is primarily the desktop packaging pipeline under `apps/overdare-agent/scripts/`.

That pipeline owns:

- building the branded web client bundle
- compiling the Bun sidecar server binary
- assembling default resources for packaged installs
- optionally building the thin desktop shell binary
- creating runtime update bundles under `dist/`
- generating update and release metadata

## Entry points

Current operator-facing entry points are:

- repo root: `bun run package`
- desktop package script: `bun run apps/overdare-agent/scripts/package.ts --version <semver> ...`
- desktop build shortcut: `bun run desktop:build`
- Windows thin-shell helper: `bun run desktop:build:exe-only`
- sidecar-only helper: `apps/overdare-agent/scripts/build-sidecar.ts`

`apps/overdare-agent/scripts/package.ts` is the main release-oriented path.

## Current pipeline shape

At a high level, packaging does the following:

1. resolve version, platform set, branding inputs, and packaging mode
2. inject temporary version/branding data into packaging-time files
3. build the web frontend with the selected project name
4. assemble `src-tauri/resources/bootstrap`
5. compile the sidecar server for each requested native-build platform
6. optionally build the Tauri desktop shell binary
7. collect desktop executable artifacts into `dist/`
8. assemble runtime bundles into zip files
9. generate `update-manifest.json`, `release-meta.json`, and `checksums.sha256`
10. restore modified packaging files

## Desktop/runtime relationship

The desktop app is a Tauri shell around the web frontend and Bun sidecar.

The sidecar serves the React client and hosts `DiligentAppServer` over WebSocket JSON-RPC. Packaging therefore needs to bundle both UI assets and runtime assets coherently.

In the current release flow, the desktop executable is intentionally a thin shell. Runtime-updatable assets live in the separate runtime bundle.

## Operator-facing controls

Current packaging supports controls such as:

- version selection
- platform selection
- `--runtime-only` for runtime bundle assembly without full desktop shell packaging

Packaging also considers update-related inputs that affect build outputs and fingerprints.

Current script behavior worth noting:

- `--version` is required
- `--platforms` accepts a comma-separated list of known platform IDs
- Tauri desktop binaries can only be built for the current host OS, so requested non-native targets are skipped for the desktop-shell build step
- runtime bundles are assembled only for native-build platforms that were actually processed in the current run

## Platform model

The current platform table is defined in `apps/overdare-agent/scripts/lib/platforms.ts`.

Known targets currently include:

- `darwin-arm64`
- `darwin-x64`
- `linux-x64`
- `linux-arm64`
- `windows-x64`

Each platform maps packaging-time concerns together:

- Bun compile target
- Tauri target triple
- executable extension
- OS/architecture metadata

## Defaults resource assembly

Packaging prepares `apps/overdare-agent/src-tauri/resources/bootstrap/` before the desktop build and runtime-bundle assembly steps.

Current bootstrap assembly includes:

- base `config.jsonc` template from `apps/overdare-agent/bootstrap/`
- app-root files copied from `apps/overdare-agent/` into packaged bootstrap
- bundled plugins found under `apps/overdare-agent/plugins`
- deployable subdirectories currently limited to `agents/` and `skills/`

The app-root copy intentionally skips code-oriented files such as `package.json`, TypeScript/JavaScript sources, and lockfiles.

Bundled app plugins are built into the packaged bootstrap so branded products can ship plugin code without requiring the target project to install npm packages separately.

## Branding and app-owned builds

App-owned metadata defines visible branding inputs such as project name and desktop icons.

Current branding inputs come from `apps/overdare-agent/package.json` under the `diligent` key:

- `projectName`
- `desktopIcons`
- `desktopStorageNamespace`

Current behavior:

- the resolved project name is injected into web and desktop packaging inputs
- the artifact name is derived from the normalized project name
- custom desktop icons are copied into a temporary Tauri icon directory for the build
- those temporary icon overrides are cleaned up after packaging

## Version injection and restoration

The packaging script temporarily injects release version information into packaging-time files before the build and restores the original files afterward.

This keeps release artifacts versioned correctly without leaving the working tree permanently rewritten after a packaging run.

## Sidecar build

The sidecar is compiled from `packages/web/src/server/index.ts` using `bun build --compile`.

Current packaging behavior names the compiled sidecar by Tauri target triple during assembly and then renames it inside runtime bundles to a stable shipped name such as `diligent-web-server` or `diligent-web-server.exe`.

The sidecar-only helper script can also:

- prepare bootstrap resources
- build missing web assets if needed
- compile sidecars for one or more targets
- copy `dist/client` into the Tauri resource tree

## Runtime-only mode

`--runtime-only` skips the Tauri desktop shell build but still performs the shared runtime bundle work.

This mode is for producing runtime-update artifacts without rebuilding the full desktop shell.

## Outputs and artifact layout

The current packaging flow assembles release artifacts under `dist/`.

Common outputs include:

- desktop executable artifacts copied to `dist/`
- runtime zip bundles named like `<artifact>-runtime-<version>-<platform>.zip`
- `release-meta.json`
- `update-manifest.json`
- `checksums.sha256`

During bundle assembly, the temporary runtime directory contains:

- compiled sidecar binary
- bundled `rg` binary when present
- web client assets under `dist/client`
- packaged bootstrap under `bootstrap/`

## Update metadata

Packaging currently emits two different release-description files:

- `release-meta.json` for build metadata such as version, build date, git commit, requested platforms, and collected artifact names
- `update-manifest.json` for runtime-update delivery, keyed by platform with URL, SHA-256, and bundle size

The current update manifest uses:

- `DILIGENT_UPDATE_BASE_URL` when provided
- otherwise a GitHub Releases URL rooted at `https://github.com/overdare/diligent/releases/download/v<version>`

The desktop-shell build fingerprint also considers `DILIGENT_UPDATE_URL` so cached Rust build decisions track update-channel-sensitive inputs.

## Build caching and native constraints

The Tauri portion uses a Rust-source fingerprint check to avoid unnecessary rebuilds.

Current practical constraints:

- desktop-shell binaries require native builds on the current OS
- runtime bundles are assembled from the native-built sidecar/resources output available in the current run
- `dist/` is cleaned at the start of packaging, with locked files on Windows skipped rather than aborting the whole run

## Thin-shell exe-only path

There is also a Windows-focused `build-exe-only.ts` path.

That script builds only the thin desktop executable and related metadata, without assembling runtime bundles.

## Change checklist

1. Decide whether the change affects desktop shell packaging, runtime bundle assembly, or both.
2. If the shipped runtime contents change, update bootstrap/resource assembly and runtime bundle layout together.
3. If branding or versioned metadata changes, update the inject/restore path and artifact naming consistently.
4. If a new platform is introduced, update platform definitions before changing packaging orchestration.
5. Verify whether update-manifest generation and checksum output also need changes.

## Key code paths

- `apps/overdare-agent/scripts/package.ts`
- `apps/overdare-agent/scripts/build-exe-only.ts`
- `apps/overdare-agent/scripts/build-sidecar.ts`
- `apps/overdare-agent/scripts/lib/bootstrap.ts`
- `apps/overdare-agent/scripts/lib/manifest.ts`
- `apps/overdare-agent/scripts/lib/platforms.ts`
- `apps/overdare-agent/scripts/lib/project-name.ts`
- `apps/overdare-agent/scripts/lib/package-mode.ts`
- `apps/overdare-agent/scripts/lib/version.ts`
- `apps/overdare-agent/scripts/lib/rust-cache.ts`
- `apps/overdare-agent/README.md`
- `package.json`
