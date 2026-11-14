.PHONY: help test test-e2e lint lint-fix typecheck build build-all dev clean \
       release-local \
	       setup check-env config \
	       debug-dev debug-build \
	       check

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Development:"
	@echo "  dev             Run the diligent CLI (interactive terminal coding agent,"
	@echo "                  uses .diligent)"
	@echo "  debug-dev       Run debug-viewer dev server"
	@echo ""
	@echo "Test / Lint:"
	@echo "  test            Run all tests"
	@echo "  test-e2e        Run end-to-end tests only"
	@echo "  lint            Lint (Biome)"
	@echo "  lint-fix        Lint + auto-fix"
	@echo "  typecheck       TypeScript type check"
	@echo "  check           Typecheck + test all packages (workspace coherence)"
	@echo ""
	@echo "Build:"
	@echo "  build           Build native binary (current platform)"
	@echo "  build-all       Build for all platforms (linux/darwin/windows)"
	@echo "  release-local   Build and install diligent into a user bin directory"
	@echo "  debug-build     Build debug-viewer (Vite)"
	@echo "  clean           Remove dist/"
	@echo ""
	@echo "Setup:"
	@echo "  setup           Create .env from .env.example (won't overwrite)"
	@echo "  check-env       Verify API keys are configured"
	@echo "  config          Show current provider configuration"

# Storage namespace resolution: shell env > .env.local > diligent (runtime default).
STORAGE_NS := $(shell ns="$${DILIGENT_STORAGE_NAMESPACE}"; \
	if [ -z "$$ns" ] && [ -f .env.local ]; then \
		ns=$$(grep -E '^[[:space:]]*DILIGENT_STORAGE_NAMESPACE=' .env.local | tail -1 | cut -d= -f2- | tr -d ' "'); \
	fi; \
	echo "$${ns:-diligent}")

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

check: node_modules
	bun run verify

dev: node_modules
	bun run packages/cli/src/index.ts

# --- Debug Viewer ---

debug-dev: node_modules
	bun run --cwd packages/debug-viewer dev

debug-build: node_modules
	bun run --cwd packages/debug-viewer build

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
	if [ "$(shell uname -s)" = "Darwin" ]; then codesign --force --sign - "$$bin_dir/diligent"; fi; \
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
	model=$$(grep -hoE '"model"[[:space:]]*:[[:space:]]*"[^"]*"' "$$HOME/.$(STORAGE_NS)/config.jsonc" ".$(STORAGE_NS)/config.jsonc" 2>/dev/null | tail -1 | sed -E 's/.*"([^"]*)"$$/\1/'); \
	if [ -n "$$model" ]; then \
		echo "  Model:     $$model (from config.jsonc)"; \
	else \
		echo "  Model:     (set 'model' in config.jsonc to override default)"; \
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
	@model=$$(grep -hoE '"model"[[:space:]]*:[[:space:]]*"[^"]*"' "$$HOME/.$(STORAGE_NS)/config.jsonc" ".$(STORAGE_NS)/config.jsonc" 2>/dev/null | tail -1 | sed -E 's/.*"([^"]*)"$$/\1/'); \
	if [ -n "$$model" ]; then echo "  model (config.jsonc): $$model"; else echo "  model (config.jsonc): (not set)"; fi
	@echo ""
	@echo "=== Config Files (namespace: $(STORAGE_NS)) ==="
	@if [ -f .env ]; then echo "  .env: exists"; else echo "  .env: missing (run: make setup)"; fi
	@if [ -f ".$(STORAGE_NS)/config.jsonc" ]; then echo "  .$(STORAGE_NS)/config.jsonc (project): exists"; else echo "  .$(STORAGE_NS)/config.jsonc (project): none"; fi
	@if [ -f "$$HOME/.$(STORAGE_NS)/config.jsonc" ]; then echo "  ~/.$(STORAGE_NS)/config.jsonc (global): exists"; else echo "  ~/.$(STORAGE_NS)/config.jsonc (global): none"; fi
