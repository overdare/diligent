#!/bin/sh
# @summary Patches lefthook-generated git hooks for Git Bash compatibility on Windows.
# Injects LEFTHOOK_BIN using a POSIX path so Git Bash can find lefthook.exe
# without relying on the hardcoded Windows absolute path bun generates.

PATCH_MARKER="# git-bash-compat-patch"

patch_hook() {
  hook="$1"
  [ -f "$hook" ] || return

  # Skip if already patched
  grep -q "$PATCH_MARKER" "$hook" && return

  # Build the patch block to inject after the shebang line
  PATCH=$(cat <<'PATCH_BLOCK'
# git-bash-compat-patch: set LEFTHOOK_BIN to a POSIX path so Git Bash can execute it
if [ -z "$LEFTHOOK_BIN" ]; then
  _root="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$_root" ] && [ -f "$_root/node_modules/.bin/lefthook.exe" ]; then
    export LEFTHOOK_BIN="$_root/node_modules/.bin/lefthook.exe"
  fi
  unset _root
fi
PATCH_BLOCK
)

  # Insert patch after the shebang line (line 1)
  # Use a temp file approach compatible with MSYS/Git Bash
  tmpfile="${hook}.tmp"
  {
    head -1 "$hook"
    printf '%s\n' "$PATCH"
    tail -n +2 "$hook"
  } > "$tmpfile" && mv "$tmpfile" "$hook"

  echo "Patched: $hook"
}

patch_hook ".git/hooks/pre-commit"
patch_hook ".git/hooks/pre-push"
