# apps/overdare-cli

Rust CLI replacement for `apps/overdare-agent` when a GUI shell is not needed.

It currently provides two commands:

- `init` — show current/latest version and ensure the runtime is downloaded; updates unless `--skip-update` is used
- `webserver` — run the updated runtime binary `~/.diligent/updates/runtime/diligent-web-server` as a subprocess

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
- `init` downloads the same runtime bundle shape used by the desktop app: sidecar binary, `dist/client`, optional `rg`, and bootstrap defaults
- on first run, `init --skip-update` is rejected until the runtime exists locally at least once
- if `~/.diligent/config.jsonc` sets `"updateMode": "disabled"`, runtime update behavior follows that config
- `init --skip-update` intentionally exits with code `1` when no runtime has been downloaded yet
- repo root shortcuts:
  - `bun run overdare-cli:build`
  - `bun run overdare-cli:test`
  - `bun run overdare-cli:init`
  - `bun run overdare-cli:webserver -- --cwd=/path/to/project`
