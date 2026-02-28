#!/usr/bin/env bash
# Tail the latest diligent session log from the most recent running Docker container.
set -euo pipefail

# Find the most recently started running container
CONTAINER=$(docker ps --latest --quiet)
if [[ -z "$CONTAINER" ]]; then
  echo "No running Docker containers found." >&2
  exit 1
fi

CONTAINER_NAME=$(docker inspect --format '{{.Name}}' "$CONTAINER" | sed 's|^/||')
echo "Container: $CONTAINER ($CONTAINER_NAME)"

# Find the working directory inside the container
WORKDIR=$(docker inspect --format '{{.Config.WorkingDir}}' "$CONTAINER")
WORKDIR="${WORKDIR:-/app}"

SESSION_DIR="$WORKDIR/.diligent/sessions"

# Find the most recently modified .jsonl file
SESSION_FILE=$(docker exec "$CONTAINER" sh -c "ls -t ${SESSION_DIR}/*.jsonl 2>/dev/null | head -1" || true)
if [[ -z "$SESSION_FILE" ]]; then
  echo "No session files found in $SESSION_DIR" >&2
  echo "Waiting for a session to start..."
  # Poll until a session file appears
  while [[ -z "$SESSION_FILE" ]]; do
    sleep 1
    SESSION_FILE=$(docker exec "$CONTAINER" sh -c "ls -t ${SESSION_DIR}/*.jsonl 2>/dev/null | head -1" || true)
  done
fi

echo "Session:   $SESSION_FILE"
echo "---"
docker exec "$CONTAINER" tail -f "$SESSION_FILE"
