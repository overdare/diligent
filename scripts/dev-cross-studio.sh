#!/usr/bin/env bash
#
# dev-cross-studio.sh — dev launcher for a local Mac agent <-> Windows PC Studio.
#
# Performs the steps from docs/guide/mac-agent-windows-studio.md in one go:
#   0. Decide the sidecar cwd (world mount path present -> editing possible)
#   1. Copy bundle skills/agents into the global ~/.overdare
#   2. Ensure a yolo permission config in global ~/.overdare/config.jsonc (only if missing)
#   3. Free leftover processes on 7433/5174
#   4. Run the sidecar backend (7433) + Vite frontend (5174) together
#   5. Ctrl+C once tears down both
#
# Value precedence (for all): CLI arg > existing env var > .env.local > default
#   $1 / STUDIO_HOST          Windows IP (required)
#   $2 / STUDIO_PORT          Studio RPC port (default 13377)
#   $3 / STUDIO_PROJECT_DIR   (optional) Path to the Studio project folder
#                             mounted on the Mac. When set, the sidecar --cwd
#                             becomes this path so edit tools (instance_upsert,
#                             etc.) read/write the "live world file" directly.
#                             When unset, cwd=repo (browse only).
#
# Usage:
#   scripts/dev-cross-studio.sh                              # use .env.local values
#   scripts/dev-cross-studio.sh <windows-ip> [port] [world-dir]
#
# Examples:
#   scripts/dev-cross-studio.sh                              # browse only (no editing)
#   scripts/dev-cross-studio.sh 192.168.0.42 13377 /Volumes/StudioProject
#   # or set STUDIO_PROJECT_DIR=/Volumes/StudioProject in .env.local

set -euo pipefail

# --- Paths / args ----------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Capture explicit values (arg / existing env) first — they win over .env.local.
EXPLICIT_HOST="${1:-${STUDIO_HOST:-}}"
EXPLICIT_PORT="${2:-${STUDIO_PORT:-}}"
EXPLICIT_WORLD="${3:-${STUDIO_PROJECT_DIR:-}}"
EXPLICIT_STUDIO_LOCAL_FILE_ROOT="${STUDIO_LOCAL_FILE_ROOT:-}"
EXPLICIT_STUDIO_REMOTE_FILE_ROOT="${STUDIO_REMOTE_FILE_ROOT:-}"

# Load .env.local (if present). `set -a` exports so child processes (bun) get them too.
ENV_FILE="${REPO_ROOT}/.env.local"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  echo "> .env.local loaded"
fi

# Explicit values override .env.local.
STUDIO_HOST="${EXPLICIT_HOST:-${STUDIO_HOST:-}}"
STUDIO_PORT="${EXPLICIT_PORT:-${STUDIO_PORT:-13377}}"
WORLD_DIR="${EXPLICIT_WORLD:-${STUDIO_PROJECT_DIR:-}}"
STUDIO_LOCAL_FILE_ROOT="${EXPLICIT_STUDIO_LOCAL_FILE_ROOT:-${STUDIO_LOCAL_FILE_ROOT:-}}"
STUDIO_REMOTE_FILE_ROOT="${EXPLICIT_STUDIO_REMOTE_FILE_ROOT:-${STUDIO_REMOTE_FILE_ROOT:-}}"
export STUDIO_LOCAL_FILE_ROOT STUDIO_REMOTE_FILE_ROOT

BACKEND_PORT=7433
FRONTEND_PORT=5174
GLOBAL_DIR="${HOME}/.overdare"
BOOTSTRAP="${REPO_ROOT}/apps/overdare-ai-agent/bootstrap"
SIDECAR="${REPO_ROOT}/apps/overdare-ai-agent/sidecar/src/server.ts"

STUDIO_DISABLED="${STUDIO_DISABLED:-}"

if [ -n "$STUDIO_LOCAL_FILE_ROOT" ] || [ -n "$STUDIO_REMOTE_FILE_ROOT" ]; then
  echo "> Studio file roots: ${STUDIO_LOCAL_FILE_ROOT:-<unset>} -> ${STUDIO_REMOTE_FILE_ROOT:-<unset>}"
fi

if [ -n "$STUDIO_DISABLED" ]; then
  echo "> Studio: DISABLED (no RPC connection to 13377; edit/rollback tools unavailable)"
elif [ -z "$STUDIO_HOST" ]; then
  echo "x Could not find STUDIO_HOST (Windows IP)." >&2
  echo "  Set STUDIO_HOST=<windows-ip> in .env.local, or" >&2
  echo "  pass it as an argument: scripts/dev-cross-studio.sh <windows-ip> [studio-port]" >&2
  echo "  (Or run 'make dev-agent-nostudio' to launch without Studio.)" >&2
  exit 1
else
  echo "> Studio target: ${STUDIO_HOST}:${STUDIO_PORT}"
fi

# --- 0. Decide sidecar cwd (world-file location = editing possible) ---------
# WORLD_DIR set:  cwd=mount path -> edit tools modify the live .ovdrjm directly.
# WORLD_DIR unset: cwd=repo -> only RPC reads (level.browse, etc.), no editing.
if [ -n "$WORLD_DIR" ]; then
  if [ ! -d "$WORLD_DIR" ]; then
    echo "x World directory not found: ${WORLD_DIR}" >&2
    echo "  Make sure the Windows Studio project folder is mounted on the Mac." >&2
    exit 1
  fi
  CWD="$WORLD_DIR"
  umap_count="$(find "$WORLD_DIR" -maxdepth 1 -iname '*.umap' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$umap_count" = "1" ]; then
    echo "> World directory: ${WORLD_DIR} (1 .umap found)"
  elif [ "$umap_count" = "0" ]; then
    echo "! ${WORLD_DIR} has no .umap — edit tools cannot find the world file."
  else
    echo "! ${WORLD_DIR} has ${umap_count} .umap files — edit tools require exactly one."
  fi
  # Write-permission check — required for editing (.ovdrjm writes) and session saving.
  if touch "${WORLD_DIR}/.__diligent_write_test" 2>/dev/null; then
    rm -f "${WORLD_DIR}/.__diligent_write_test"
    echo "  + mount is writable — editing OK"
  else
    echo "  ! mount is read-only / no permission — editing and session saving will fail."
    echo "    Grant this account 'write/change' permission in the Windows share settings."
  fi
else
  CWD="$REPO_ROOT"
  echo "> No world directory -> cwd=repo (browse only, no editing)."
  echo "  To edit, pass a mount path as the 3rd argument or via STUDIO_PROJECT_DIR."
fi

# --- 1. Install durable copies of bundle skills/agents ----------------------
install_bundle() {
  local kind="$1" # skills | agents
  local src="${BOOTSTRAP}/${kind}"
  local dst="${GLOBAL_DIR}/${kind}"
  [ -d "$src" ] || return 0

  mkdir -p "$GLOBAL_DIR" "$dst"
  local stage
  stage="$(mktemp -d "${GLOBAL_DIR}/.dev-cross-studio-${kind}.stage.XXXXXX")" || {
    echo "x Could not create staging directory for ${kind}" >&2
    return 1
  }
  mkdir -p "${stage}/new" "${stage}/backup"

  local copied=0
  local entry name
  for entry in "$src"/* "$src"/.[!.]* "$src"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name="$(basename "$entry")"
    if ! cp -R -L "$entry" "${stage}/new/${name}"; then
      echo "x Could not stage ${kind} entry: ${name}; keeping existing global entry" >&2
      rm -rf "$stage"
      return 1
    fi
    copied=$((copied + 1))
  done

  # All current bundle entries are staged before replacing any global entries. This
  # leaves unrelated global names alone and lets each same-name directory be swapped
  # as a complete copy, removing files retired from that bundle entry.
  local -a replaced_names=()
  local idx rollback_name rollback_failed install_failed
  install_failed=0
  for entry in "${stage}/new"/* "${stage}/new"/.[!.]* "${stage}/new"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name="$(basename "$entry")"
    if [ -e "${dst}/${name}" ] || [ -L "${dst}/${name}" ]; then
      if ! mv "${dst}/${name}" "${stage}/backup/${name}"; then
        echo "x Could not prepare existing ${kind} entry for replacement: ${name}" >&2
        install_failed=1
        break
      fi
    fi

    replaced_names+=("$name")
    if ! mv "$entry" "${dst}/${name}"; then
      echo "x Could not install staged ${kind} entry: ${name}" >&2
      install_failed=1
      break
    fi
  done

  if [ "$install_failed" -ne 0 ]; then
    # Roll back every entry moved during this install, including any earlier entry
    # whose replacement succeeded, so backups are never discarded after a later mv
    # failure. A failed restore leaves the staging directory as a recoverable backup.
    rollback_failed=0
    for ((idx = ${#replaced_names[@]} - 1; idx >= 0; idx--)); do
      rollback_name="${replaced_names[$idx]}"
      if [ -e "${dst}/${rollback_name}" ] || [ -L "${dst}/${rollback_name}" ]; then
        if ! rm -rf "${dst}/${rollback_name}"; then
          echo "x Could not remove partially installed ${kind} entry: ${rollback_name}" >&2
          rollback_failed=1
          continue
        fi
      fi
      if [ -e "${stage}/backup/${rollback_name}" ] || [ -L "${stage}/backup/${rollback_name}" ]; then
        if ! mv "${stage}/backup/${rollback_name}" "${dst}/${rollback_name}"; then
          echo "x Could not restore previous ${kind} entry: ${rollback_name}" >&2
          rollback_failed=1
        fi
      fi
    done
    if [ "$rollback_failed" -ne 0 ]; then
      echo "! Previous ${kind} entries remain recoverable in: ${stage}" >&2
      return 1
    fi
    rm -rf "$stage"
    return 1
  fi

  rm -rf "$stage"
  echo "  + ${kind}: ${copied} bundled copy/copies -> ${dst}"
}
echo "> Copying bundle skills/agents to global storage"
install_bundle skills
install_bundle agents

# --- 2. Ensure yolo permission config (global, only if missing) -------------
# Place it in global ~/.overdare/config.jsonc. Why:
#   - Loaded regardless of cwd (even a read-only mount) — the loader merges global + project.
#   - Does not attempt to write to the mount, so it is safe on a read-only share.
GLOBAL_CONFIG="${GLOBAL_DIR}/config.jsonc"
if [ ! -f "$GLOBAL_CONFIG" ]; then
  mkdir -p "$GLOBAL_DIR"
  printf '{\n  // disable dev permission prompts (same as exe bootstrap/config.jsonc)\n  "yolo": true\n}\n' >"$GLOBAL_CONFIG"
  echo "> Created permission config: ${GLOBAL_CONFIG} (yolo:true)"
else
  echo "> Permission config: keeping existing global config (unchanged)"
fi

# --- 3. Free leftover ports -------------------------------------------------
free_port() {
  local port="$1"
  local pids
  # Avoid blocking on remote mounts, and target only TCP listeners.
  pids="$(lsof -b -w -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "  + killing process(es) holding port ${port}: ${pids}"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -b -w -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    # shellcheck disable=SC2086
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  fi
}
echo "> Freeing ports (${BACKEND_PORT}, ${FRONTEND_PORT})"
free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"

# --- 4. Reachability check (continues on failure, warning only) -------------
if [ -z "$STUDIO_DISABLED" ] && command -v nc >/dev/null 2>&1; then
  if nc -z -w 2 "$STUDIO_HOST" "$STUDIO_PORT" 2>/dev/null; then
    echo "> Studio reachability: OK (${STUDIO_HOST}:${STUDIO_PORT})"
  else
    echo "! Cannot reach Studio (${STUDIO_HOST}:${STUDIO_PORT}) — Studio may be bound to 127.0.0.1 only, or the firewall is blocking. See docs/guide/mac-agent-windows-studio.md. Continuing anyway."
  fi
fi

# --- 5. Run processes + teardown trap ---------------------------------------
BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  echo ""
  echo "> Cleaning up..."
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "  + done"
}
trap cleanup EXIT INT TERM

echo "> Starting sidecar backend (:${BACKEND_PORT}, cwd=${CWD})"
if [ -n "$STUDIO_DISABLED" ]; then
  STUDIO_DISABLED=1 \
    bun run "$SIDECAR" --dev --port="$BACKEND_PORT" --cwd="$CWD" &
else
  STUDIO_HOST="$STUDIO_HOST" STUDIO_PORT="$STUDIO_PORT" \
    bun run "$SIDECAR" --dev --port="$BACKEND_PORT" --cwd="$CWD" &
fi
BACKEND_PID=$!

echo "> Starting Vite frontend (:${FRONTEND_PORT})"
bun run --cwd apps/overdare-ai-agent/sidecar web:dev &
FRONTEND_PID=$!

echo ""
echo "  Browser: http://localhost:${FRONTEND_PORT}"
echo "  Quit: Ctrl+C"
echo ""

# When either process dies, break the loop; the EXIT trap cleans up the rest.
# (macOS default bash 3.2 has no `wait -n`, so poll instead.)
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
