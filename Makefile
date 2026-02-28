.PHONY: help test test-e2e lint lint-fix typecheck build build-all dev clean \
       setup check-env config

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Development:"
	@echo "  dev           Run CLI in dev mode"
	@echo "  test          Run all tests"
	@echo "  test-e2e      Run end-to-end tests only"
	@echo "  lint          Lint (Biome)"
	@echo "  lint-fix      Lint + auto-fix"
	@echo "  typecheck     TypeScript type check"
	@echo ""
	@echo "Build:"
	@echo "  build         Build native binary (current platform)"
	@echo "  build-all     Build for all platforms (linux/darwin x64/arm64)"
	@echo "  clean         Remove dist/"
	@echo ""
	@echo "Setup:"
	@echo "  setup         Create .env from .env.example (won't overwrite)"
	@echo "  check-env     Verify API keys are configured"
	@echo "  config        Show current provider configuration"

# --- Development ---

test:
	bun test

test-e2e:
	bun test packages/e2e/

lint:
	bun run lint

lint-fix:
	bun run lint:fix

typecheck:
	bun run typecheck

dev:
	bun run packages/cli/src/index.ts

# --- Build ---

build:
	bun run build

build-all:
	bun run build:all

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
	@if [ -f diligent.jsonc ]; then echo "  diligent.jsonc (project): exists"; else echo "  diligent.jsonc (project): none"; fi
	@if [ -f "$$HOME/.config/diligent/diligent.jsonc" ]; then echo "  ~/.config/diligent/diligent.jsonc (global): exists"; else echo "  ~/.config/diligent/diligent.jsonc (global): none"; fi
