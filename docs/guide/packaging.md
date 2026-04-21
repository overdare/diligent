# Packaging

This guide describes the current packaging model in Diligent.

## Verified contract

Diligent packaging spans three related product surfaces:

- CLI
- Web/server
- Desktop

The main packaging path today is the OVERDARE CLI runtime/sidecar packaging flow.

That flow owns:

- building the web client bundle used by the packaged runtime
- compiling the Bun sidecar server binary
- assembling default resources for packaged installs
- creating runtime update bundles under `dist/`
- generating update and release metadata

## Entry points

Current operator-facing entry points are:

- repo root: `bun run overdare-ai-agent:build-sidecar`
- sidecar-only helper: `scripts/build-overdare-sidecar.ts`

`scripts/build-overdare-sidecar.ts` is the current operator-facing build helper in this repo.

## Current pipeline shape

At a high level, packaging does the following:

1. build the web frontend used by the runtime
2. compile the sidecar server for the current native-build platform
3. assemble runtime defaults content from the OVERDARE CLI-owned asset roots
4. publish runtime bundles via the OVERDARE CLI release flow as needed

## Runtime packaging relationship

The sidecar serves the React client and hosts `DiligentAppServer` over WebSocket JSON-RPC. Packaging therefore needs to bundle both UI assets and runtime assets coherently for the OVERDARE CLI launcher.

## Platform model

The current sidecar helper targets the current host platform via `scripts/build-overdare-sidecar.ts`.

Known targets currently include:

- `darwin-arm64`
- `darwin-x64`
- `linux-x64`
- `linux-arm64`
- `windows-x64`

Each platform maps packaging-time concerns together:

- Bun compile target
- executable extension
- OS/architecture metadata

## Defaults resource assembly

OVERDARE-owned defaults now live under `apps/overdare-ai-agent/`:

- `apps/overdare-ai-agent/bootstrap/`
- `apps/overdare-ai-agent/plugins/`
- `apps/overdare-ai-agent/supabase/`

At bundle assembly time these assets are staged under `defaults/` for compatibility with existing updater expectations. The launcher prefers an updated `bootstrap/` directory if present at runtime and otherwise falls back to the legacy `defaults/` path.

## Sidecar build

The sidecar is compiled from `packages/web/src/server/index.ts` using `bun build --compile`.

The sidecar helper script can build a fresh current-platform runtime binary for OVERDARE CLI diagnostics and launcher flows.

## Outputs and artifact layout

The current packaging flow assembles release artifacts under `dist/`.

Common outputs include the compiled sidecar binary and runtime bundle contents used by OVERDARE CLI.

## Change checklist

1. Decide whether the change affects sidecar build, runtime bundle assembly, or both.
2. If the shipped runtime contents change, update bootstrap/plugin ownership and runtime bundle layout together.
3. Verify whether OVERDARE CLI launcher/update expectations also need changes.

## Key code paths

- `scripts/build-overdare-sidecar.ts`
- `apps/overdare-ai-agent/README.md`
- `apps/overdare-ai-agent/bootstrap/`
- `apps/overdare-ai-agent/plugins/`
- `apps/overdare-ai-agent/supabase/`
- `package.json`
