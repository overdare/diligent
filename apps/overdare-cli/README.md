# apps/overdare-cli

Rust CLI for OVERDARE runtime bootstrap, plugin/bootstrap ownership, and webserver launch.

It currently provides two commands:

- `init` — show current/latest version and ensure the runtime is downloaded; updates unless `--skip-update` is used
- `webserver` — run the updated runtime binary `~/.overdare/updates/runtime/diligent-web-server` as a subprocess

## Commands

```bash
# Build the Rust CLI
cargo build --manifest-path apps/overdare-cli/Cargo.toml --release

# Or via repo root shortcut
bun run overdare-cli:build

# Initialize runtime, print current/latest version, and apply update if needed
cargo run --manifest-path apps/overdare-cli/Cargo.toml -- init

# Skip update only if runtime was already downloaded before
cargo run --manifest-path apps/overdare-cli/Cargo.toml -- init --skip-update

# Start the updated local web server runtime
cargo run --manifest-path apps/overdare-cli/Cargo.toml -- webserver --cwd=/path/to/project

# Run Rust tests
bun run overdare-cli:test

# Initialize from a custom manifest URL
DILIGENT_UPDATE_URL=https://example.com/update-manifest.json cargo run --manifest-path apps/overdare-cli/Cargo.toml -- init
```

## Notes

- `webserver` does not execute repo TypeScript directly; it launches the updated runtime subprocess
- `init` downloads the runtime bundle shape used by OVERDARE CLI: sidecar binary, `dist/client`, optional `rg`, and runtime defaults (`bootstrap/` preferred, legacy `defaults/` fallback)
- on first run, `init --skip-update` is rejected until the runtime exists locally at least once
- if `~/.overdare/config.jsonc` sets `"updateMode": "disabled"`, runtime update behavior follows that config
- `init --skip-update` intentionally exits with code `1` when no runtime has been downloaded yet
- repo root shortcuts:
  - `bun run overdare-cli:build`
  - `bun run overdare-cli:test`
  - `bun run overdare-cli:init`
  - `bun run overdare-cli:webserver -- --cwd=/path/to/project`

Additional OVERDARE-owned assets now live here as well:

- `apps/overdare-cli/bootstrap/`
- `apps/overdare-cli/plugins/`
- `apps/overdare-cli/supabase/`
- `apps/overdare-cli/scripts/deploy.ts`
- `apps/overdare-cli/scripts/tool-cli.ts`
