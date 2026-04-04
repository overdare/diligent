.PHONY: help test test-e2e lint lint-fix typecheck build build-all dev clean \
       release-local \
       setup check-env config \
       web-dev web-build web-start \
       debug-dev debug-build \
       desktop-dev desktop-build check-desktop

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Development:"
	@echo "  dev             Install deps and run CLI"
	@echo "  web-dev         Run web frontend dev server (Vite)"
	@echo "  web-start       Run web backend server"
	@echo "  debug-dev       Run debug-viewer dev server"
	@echo "  desktop-dev     Run desktop app (Tauri dev mode)"
	@echo ""
	@echo "Test / Lint:"
	@echo "  test            Run all tests"
	@echo "  test-e2e        Run end-to-end tests only"
	@echo "  lint            Lint (Biome)"
	@echo "  lint-fix        Lint + auto-fix"
	@echo "  typecheck       TypeScript type check"
	@echo ""
	@echo "Build:"
	@echo "  build           Build native binary (current platform)"
	@echo "  build-all       Build for all platforms (linux/darwin/windows)"
	@echo "  release-local   Build and install diligent into a user bin directory"
	@echo "  web-build       Build web frontend (Vite)"
	@echo "  debug-build     Build debug-viewer (Vite)"
	@echo "  desktop-build   Build desktop app (Tauri)"
	@echo "  clean           Remove dist/"
	@echo ""
	@echo "Setup:"
	@echo "  setup           Create .env from .env.example (won't overwrite)"
	@echo "  check-env       Verify API keys are configured"
	@echo "  check-desktop   Verify Rust/Cargo are installed (required for desktop)"
	@echo "  config          Show current provider configuration"

# --- Development ---

node_modules: package.json bun.lock
	bun install
	@touch node_modules

test: node_modules
	bun test

test-e2e: node_modules
	bun test packages/e2e/

lint: node_modules
	bun run lint

lint-fix: node_modules
	bun run lint:fix

typecheck: node_modules
	bun run typecheck

dev: node_modules
	bun run packages/cli/src/index.ts

# --- Web ---

web-dev: node_modules
	bun run --cwd packages/web dev

web-build: node_modules
	bun run --cwd packages/web build

web-start: node_modules
	bun run --cwd packages/web start

# --- Debug Viewer ---

debug-dev: node_modules
	bun run --cwd packages/debug-viewer dev

debug-build: node_modules
	bun run --cwd packages/debug-viewer build

# --- Desktop ---

check-desktop:
	@echo "Checking desktop build prerequisites..."
	@if command -v rustc >/dev/null 2>&1; then \
		echo "  rustc:  OK ($(shell rustc --version 2>/dev/null))"; \
	else \
		echo "  rustc:  NOT FOUND — install via: curl https://sh.rustup.rs -sSf | sh"; \
		exit 1; \
	fi
	@if command -v cargo >/dev/null 2>&1; then \
		echo "  cargo:  OK ($(shell cargo --version 2>/dev/null))"; \
	else \
		echo "  cargo:  NOT FOUND — install via: curl https://sh.rustup.rs -sSf | sh"; \
		exit 1; \
	fi
	@echo "  @tauri-apps/cli: installed via bun install (node_modules)"
	@echo ""
	@echo "All desktop prerequisites met. Run: make desktop-dev"

desktop-dev: node_modules
	bun run --cwd apps/desktop dev

desktop-build: node_modules
	bun run --cwd apps/desktop build

# --- Build ---

build:
	bun run build

build-all:
	bun run build:all

release-local: build
	@bin_dir="$$BIN_DIR"; \
	if [ -z "$$bin_dir" ]; then \
	  for candidate in $$(printf '%s\n' "$$PATH" | tr ':' '\n'); do \
	    case "$$candidate" in \
	      "$$HOME"/*) \
	        case "$$candidate" in \
	          */node_modules/.bin) ;; \
	          *) bin_dir="$$candidate"; break ;; \
	        esac ;; \
	    esac; \
	  done; \
	fi; \
	if [ -z "$$bin_dir" ]; then bin_dir="$$HOME/.local/bin"; fi; \
	mkdir -p "$$bin_dir"; \
	cp -f dist/diligent "$$bin_dir/diligent"; \
	chmod +x "$$bin_dir/diligent"; \
	echo "Released diligent locally to $$bin_dir/diligent"; \
	case ":$$PATH:" in \
	  *:"$$bin_dir":*) ;; \
	  *) echo "Note: $$bin_dir is not currently on PATH. Add it to use 'diligent' directly." ;; \
	esac

clean:
	rm -rf dist/

# --- Setup ---

setup:
	@if [ -f .env ]; then \
		echo ".env already exists, skipping (edit manually or remove first)"; \
	else \
		cp .env.example .env; \
		echo "Created .env from .env.example"; \
		echo "Edit .env and add your API keys"; \
	fi

check-env:
	@echo "Checking provider credentials..."
	@has_any=0; \
	if [ -n "$$ANTHROPIC_API_KEY" ]; then \
		echo "  Anthropic: OK"; \
		has_any=1; \
	else \
		echo "  Anthropic: not set"; \
	fi; \
	if [ -n "$$OPENAI_API_KEY" ]; then \
		echo "  OpenAI:    OK"; \
		has_any=1; \
	else \
		echo "  OpenAI:    not set"; \
	fi; \
	if [ -n "$$DILIGENT_MODEL" ]; then \
		echo "  Model:     $$DILIGENT_MODEL"; \
	else \
		echo "  Model:     (default: claude-sonnet-4-20250514)"; \
	fi; \
	if [ $$has_any -eq 0 ]; then \
		echo ""; \
		echo "No API key found. Run: make setup"; \
		exit 1; \
	fi

config:
	@echo "=== Environment ==="
	@if [ -n "$$ANTHROPIC_API_KEY" ]; then echo "  ANTHROPIC_API_KEY: set"; else echo "  ANTHROPIC_API_KEY: (empty)"; fi
	@if [ -n "$$OPENAI_API_KEY" ]; then echo "  OPENAI_API_KEY: set"; else echo "  OPENAI_API_KEY: (empty)"; fi
	@if [ -n "$$DILIGENT_MODEL" ]; then echo "  DILIGENT_MODEL: $$DILIGENT_MODEL"; else echo "  DILIGENT_MODEL: (not set)"; fi
	@echo ""
	@echo "=== Config Files ==="
	@if [ -f .env ]; then echo "  .env: exists"; else echo "  .env: missing (run: make setup)"; fi
	@if [ -f .diligent/config.jsonc ]; then echo "  .diligent/config.jsonc (project): exists"; else echo "  .diligent/config.jsonc (project): none"; fi
	@if [ -f "$HOME/.diligent/config.jsonc" ]; then echo "  ~/.diligent/config.jsonc (global): exists"; else echo "  ~/.diligent/config.jsonc (global): none"; fi
