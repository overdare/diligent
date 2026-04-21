# apps/overdare-ai-agent

Rust CLI for OVERDARE runtime bootstrap, plugin/bootstrap ownership, and webserver launch.

It currently provides two commands:

- `init` — show current/latest version and ensure the runtime is downloaded; updates unless `--skip-update` is used
- `webserver` — run the updated runtime binary `~/.overdare/updates/runtime/diligent-web-server` as a subprocess

## Commands

```bash
# Build the Rust CLI
cargo build --manifest-path apps/overdare-ai-agent/Cargo.toml --release

# Or via repo root shortcut
bun run overdare-ai-agent:build

# Initialize runtime, print current/latest version, and apply update if needed
cargo run --manifest-path apps/overdare-ai-agent/Cargo.toml -- init

# Skip update only if runtime was already downloaded before
cargo run --manifest-path apps/overdare-ai-agent/Cargo.toml -- init --skip-update

# Start the updated local web server runtime
cargo run --manifest-path apps/overdare-ai-agent/Cargo.toml -- webserver --cwd=/path/to/project

# Run Rust tests
bun run overdare-ai-agent:test

# Initialize from a custom manifest URL
DILIGENT_UPDATE_URL=https://example.com/update-manifest.json cargo run --manifest-path apps/overdare-ai-agent/Cargo.toml -- init
```

## Notes

- `webserver` does not execute repo TypeScript directly; it launches the updated runtime subprocess
- `init` downloads the runtime bundle shape used by OVERDARE CLI: sidecar binary, `dist/client`, optional `rg`, and runtime defaults (`bootstrap/` preferred, legacy `defaults/` fallback)
- on first run, `init --skip-update` is rejected until the runtime exists locally at least once
- if `~/.overdare/config.jsonc` sets `"updateMode": "disabled"`, runtime update behavior follows that config
- `init --skip-update` intentionally exits with code `1` when no runtime has been downloaded yet
- repo root shortcuts:
  - `bun run overdare-ai-agent:build`
  - `bun run overdare-ai-agent:test`
  - `bun run overdare-ai-agent:init`
  - `bun run overdare-ai-agent:webserver -- --cwd=/path/to/project`

Additional OVERDARE-owned assets now live here as well:

- `apps/overdare-ai-agent/bootstrap/`
- `apps/overdare-ai-agent/plugins/`
- `apps/overdare-ai-agent/supabase/`
- `apps/overdare-ai-agent/scripts/deploy.ts`
- `apps/overdare-ai-agent/scripts/tool-cli.ts`
