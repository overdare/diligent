#!/usr/bin/env bash
set -euo pipefail

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${HOME}/tui-captures/${TS}"
mkdir -p "$OUT_DIR"

RAW_LOG="$OUT_DIR/terminal.raw.log"
CLEAN_LOG="$OUT_DIR/terminal.clean.log"

echo "Capture dir: $OUT_DIR"
echo "Starting Claude Code in script(1)..."

# Capture raw TTY output including ANSI escapes.
script -q "$RAW_LOG" claude

# Produce a more readable log: remove ANSI and backspace-overwrites.
perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g; s/.\x08//g' "$RAW_LOG" > "$CLEAN_LOG"

echo "Saved:"
echo "  RAW   : $RAW_LOG"
echo "  CLEAN : $CLEAN_LOG"
