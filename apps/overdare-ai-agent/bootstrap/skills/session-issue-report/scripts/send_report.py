#!/usr/bin/env python3
"""Post one issue report to the internal Slack webhook, with redacted session context.

Deterministic plumbing only — the judgment about *whether* to report lives in SKILL.md.
This script exists so every invocation does the same three things the same way:
redact secrets, attach a session tail, and refuse to spam the channel twice.

    printf '%s' "$BODY" | send_report.py --kind product --title "..." [--tail 40] [--dry-run]

Exits 0 on "sent", "skipped (duplicate)" and "skipped (no webhook)" alike: a reporting
tool that fails an agent's turn is worse than one that stays quiet. Only a malformed
invocation exits non-zero.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

WEBHOOK_ENV = "DILIGENT_ISSUE_WEBHOOK"
# Fallback for an installed agent. A built binary launched by Studio inherits the launcher's
# environment, and a GUI launch has no shell environment to inherit — so `.env.local` and
# `export` only cover local `bun run` development. Baking the URL into the build is not an
# option either: the repo is public and dev releases are prereleases on it, so a baked
# secret would ship to anyone. A file the developer drops next to their own session data is
# the one place that is per-machine, survives reinstalls, and is never distributed.
WEBHOOK_FILE = "issue-report-webhook"
# Kept in parity with the sidecar's 1st-pass ruleset (masking.ts, version `secrets-2`).
# This path never reaches the gateway, so there is no server-side second pass behind us:
# whatever these patterns miss, leaves the machine.
MASK_VERSION = "secrets-2"
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("aws-access-key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[0-9A-Za-z]{36,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{10,}\b")),
    ("anthropic-key", re.compile(r"\bsk-ant-[0-9A-Za-z_-]{20,}\b")),
    ("openai-key", re.compile(r"\bsk-(?!ant-)[0-9A-Za-z_-]{20,}\b")),
    (
        "jwt",
        re.compile(r"\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\b"),
    ),
    (
        "private-key-block",
        re.compile(
            r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----"
        ),
    ),
    ("bearer", re.compile(r"\bBearer\s+[0-9A-Za-z._~+/=-]{12,}")),
]

ENTRY_PREVIEW_CHARS = 400
BODY_MAX_CHARS = 6000
DEFAULT_TAIL = 30


def redact(text: str) -> str:
    for name, pattern in PATTERNS:
        text = pattern.sub(f"[REDACTED:{name}]", text)
    return text


def mrkdwn(text: str) -> str:
    """Escape Slack's three control characters so a report cannot ping the channel.

    A body containing `<!channel>` would otherwise notify everyone, and `<http://x|y>`
    renders as a disguised link. Slack's documented rule is exactly these three.
    """
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def session_dirs() -> list[Path]:
    """Every plausible session directory, project-local first.

    The storage namespace differs by host: the OVERDARE sidecar forces `overdare`, the
    diligent CLI defaults to `diligent`, and either can be project-local or user-global.
    Rather than guess, look in all of them and let mtime decide.
    """
    namespaces = {os.environ.get("DILIGENT_STORAGE_NAMESPACE", "").strip() or "diligent", "overdare", "diligent"}
    roots = [Path.cwd(), Path.home()]
    return [root / f".{ns}" / "sessions" for root in roots for ns in namespaces]


def resolve_webhook() -> tuple[str, str] | tuple[None, None]:
    """The webhook URL and where it came from, or (None, None).

    Environment first so a shell or `.env.local` can override per run; then the per-machine
    file, which is what an installed agent actually has.
    """
    from_env = os.environ.get(WEBHOOK_ENV, "").strip()
    if from_env:
        return from_env, f"${WEBHOOK_ENV}"
    seen: set[Path] = set()
    # session_dirs() is ordered project-local first; keep that precedence rather than
    # letting a set's iteration order pick between a project and a home-level file.
    for directory in (d.parent for d in session_dirs()):
        if directory in seen:
            continue
        seen.add(directory)
        candidate = directory / WEBHOOK_FILE
        if not candidate.is_file():
            continue
        for line in candidate.read_text(errors="replace").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                return line, str(candidate)
    return None, None


def newest_session() -> Path | None:
    candidates = [p for d in session_dirs() if d.is_dir() for p in d.glob("*.jsonl")]
    return max(candidates, key=lambda p: p.stat().st_mtime, default=None)


def clip(text: str, limit: int = ENTRY_PREVIEW_CHARS) -> str:
    flat = " ".join(str(text).split())
    return flat if len(flat) <= limit else flat[:limit] + "…"


def render_message(message: dict) -> str | None:
    """One line per entry, shaped by role — see the three real shapes in the session log.

    `tool_result` carries no `content` at all (it has `output`/`toolName`/`isError`), and
    assistant `content` is a block array. Rendering them generically produced `null` and
    raw JSON, which buried the two things a defect report actually needs: which tool ran
    and whether it errored.
    """
    role = str(message.get("role", "?"))

    if role == "tool_result":
        status = "ERROR" if message.get("isError") else "ok"
        name = message.get("toolName") or "?"
        return f"[tool {name} {status}] {clip(message.get('output') or '')}"

    content = message.get("content")
    if isinstance(content, str):
        text = clip(content)
    elif isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            kind = block.get("type")
            if kind == "text":
                parts.append(clip(block.get("text") or "", 300))
            elif kind == "thinking":
                parts.append(f"(thinking) {clip(block.get('thinking') or '', 150)}")
            elif kind == "tool_call":
                parts.append(f"→ {block.get('name')}({clip(json.dumps(block.get('input') or {}, ensure_ascii=False), 150)})")
        text = clip(" ".join(p for p in parts if p))
    else:
        text = ""

    stop = message.get("stopReason")
    suffix = f" «stopReason={stop}»" if stop and stop not in ("end_turn", "tool_use") else ""
    if not text and not suffix:
        return None
    return f"[{role}] {text}{suffix}"


def read_tail(path: Path, limit: int) -> tuple[str, list[str]]:
    """Return (session_id, rendered tail lines) for the last `limit` interesting entries.

    `error` entries are kept alongside messages: for a defect report they are usually the
    single most useful line in the file, and they are cheap to carry.
    """
    session_id = path.stem
    kept: list[str] = []
    for raw in path.read_text(errors="replace").splitlines():
        raw = raw.strip()
        if not raw.startswith("{"):
            continue
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue
        kind = entry.get("type")
        if kind == "session":
            session_id = str(entry.get("id") or session_id)
        elif kind == "message":
            line = render_message(entry.get("message") or {})
            if line:
                kept.append(line)
        elif kind == "error":
            err = entry.get("error")
            if not isinstance(err, str):
                err = json.dumps(err, ensure_ascii=False)
            fatal = " fatal" if entry.get("fatal") else ""
            kept.append(f"[error{fatal}] {clip(err)}")
    return session_id, kept[-limit:]


def ledger_path(session_file: Path) -> Path:
    return session_file.parent.parent / "issue-reports.jsonl"


def already_sent(ledger: Path, session_id: str, key: str) -> bool:
    """One report per (session, fingerprint).

    Without this, an agent that notices the same missing capability on three consecutive
    turns posts three identical messages and the channel stops being read.
    """
    if not ledger.exists():
        return False
    for raw in ledger.read_text(errors="replace").splitlines():
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if row.get("session_id") == session_id and row.get("key") == key:
            return True
    return False


def record(ledger: Path, session_id: str, key: str, title: str) -> None:
    ledger.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "session_id": session_id,
        "key": key,
        "title": title,
        "sent_at": datetime.now(UTC).isoformat(),
    }
    with ledger.open("a") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_text(kind: str, title: str, body: str, session_id: str, tail: list[str], cwd: str) -> str:
    heading = {
        "product": ":wrench: *Studio / agent defect*",
        "self": ":repeat: *Agent self-critique*",
    }[kind]
    parts = [
        f"{heading} — {mrkdwn(title)}",
        f"session: `{mrkdwn(session_id)}` · cwd: `{mrkdwn(cwd)}` · {datetime.now(UTC):%Y-%m-%d %H:%M} UTC",
        "",
        mrkdwn(body.strip()),
    ]
    if tail:
        rendered = "\n".join(tail)
        parts += ["", "*Session tail*", "```", mrkdwn(rendered), "```"]
    return "\n".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", required=True, choices=["product", "self"])
    parser.add_argument("--title", required=True, help="One line, <=160 chars.")
    parser.add_argument("--session", help="Session .jsonl path. Default: newest found.")
    parser.add_argument("--tail", type=int, default=DEFAULT_TAIL, help=f"Entries to attach (default {DEFAULT_TAIL}).")
    parser.add_argument("--dry-run", action="store_true", help="Print the payload instead of posting.")
    args = parser.parse_args()

    body = sys.stdin.read()
    if not body.strip():
        print("send_report: nothing on stdin — pipe the report body in. Not sent.")
        return 0

    webhook, webhook_source = resolve_webhook()
    if not webhook and not args.dry_run:
        print(
            f"send_report: no webhook configured, so nothing was sent. Set {WEBHOOK_ENV}, or "
            f"put the URL in a `{WEBHOOK_FILE}` file beside your session data "
            f"(e.g. ~/.overdare/{WEBHOOK_FILE}). This skill is internal-only; ask the team for "
            "the channel webhook. Report the finding in your reply instead."
        )
        return 0

    session_file = Path(args.session) if args.session else newest_session()
    if session_file is None or not session_file.is_file():
        session_id, tail = "unknown", []
        ledger = Path.home() / ".diligent" / "issue-reports.jsonl"
    else:
        session_id, tail = read_tail(session_file, max(0, args.tail))
        ledger = ledger_path(session_file)

    title = redact(" ".join(args.title.split()))[:160]
    body = redact(body)[:BODY_MAX_CHARS]
    tail = [redact(line) for line in tail]

    key = hashlib.sha256(f"{args.kind}|{title}".encode()).hexdigest()[:12]
    if already_sent(ledger, session_id, key):
        print(f"send_report: already reported in this session ({key}); not sent again.")
        return 0

    text = build_text(args.kind, title, body, session_id, tail, str(Path.cwd()))
    payload = json.dumps({"text": text}, ensure_ascii=False).encode()

    if args.dry_run:
        print(text)
        return 0

    if webhook is None:
        # Unreachable: a missing webhook already returned above unless --dry-run, which
        # returned too. Stated explicitly so the POST below has a plain `str`.
        print("send_report: no webhook resolved; nothing sent.")
        return 0

    request = urllib.request.Request(
        webhook, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status = response.status
    except urllib.error.HTTPError as exc:
        print(f"send_report: webhook returned {exc.code}; not recorded. Tell the user it did not send.")
        return 0
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"send_report: could not reach the webhook ({exc}); not recorded.")
        return 0

    record(ledger, session_id, key, title)
    print(
        f"send_report: sent ({status}) via {webhook_source}, fingerprint {key}, "
        f"session {session_id}, mask {MASK_VERSION}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
