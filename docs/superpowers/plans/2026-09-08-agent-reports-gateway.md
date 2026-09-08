# Agent Failure Reports — Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /v1/agent-reports` to diligent-gateway: store agent-written failure reports in a new `agent_reports` table, erase them on consent withdrawal, and post the first occurrence of each fingerprint to Slack via an Incoming Webhook.

**Architecture:** Extend the existing `archive` module (it owns the repository, masker, consent lookup and purge path) with one route, one service, one table and one notifier. No LLM, no S3, no read API. The client is fire-and-forget, so every failure mode on this path degrades to "not stored / not notified", never to a broken ingest.

**Tech Stack:** Python 3.11, FastAPI, pydantic v2, psycopg3 (async pool), httpx (already a runtime dep), pytest + in-memory fakes (`tests/fakes.py`), ruff.

**Spec:** `docs/superpowers/specs/2026-09-08-agent-failure-report-design.md` (in the diligent repo) — Stage 2 "Gateway: store, dedup, notify".

**Working directory:** `~/Desktop/workhard/diligent-gateway` (separate repo, branch `main`, clean). Every command below runs there unless stated otherwise. Activate the venv first: `source .venv/bin/activate` (or prefix commands with `.venv/bin/`). If `pytest`/`ruff` are missing: `pip install -e '.[dev]'`.

## Global Constraints

- All repo content in English.
- ruff: `line-length = 100`, `target-version = "py311"`, rules `E, F, I, UP, B` (B008 ignored). Before every commit run `python -m ruff check --fix app tests && python -m ruff check app tests` (`--fix` settles import order, `I001`).
- **All `import` lines go in the top import block of a file** — appending imports after code trips `E402`. When a task says "append to `tests/test_agent_reports.py`", put the new imports at the top and the new functions at the bottom.
- `schema.sql` is **additive and idempotent only** — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Never alter or drop an existing table.
- `user_id` is always the authenticated principal (`AuthContext.user_id`), never a body field.
- Consent is enforced **server-side, default-deny** via `Repository.granted_user_ids`, same as `/v1/records`.
- Slack notification must never block or fail the request: background task, all exceptions logged and swallowed.
- Every new ingest route must be added to `INGEST_ALLOWED` in `tests/test_surface.py` or CI fails.
- Route name is `/v1/agent-reports` — **not** `/v1/reports` (that path is reserved by the sidecar feedback modal, see spec "Side finding").
- Commit message trailer (every commit):
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu
  ```

## File Structure

| File | Responsibility |
|---|---|
| `app/modules/archive/schema.sql` (modify, append) | `agent_reports` DDL + indexes |
| `app/modules/archive/repository.py` (modify) | `StoredAgentReport`, `AgentReportInsert` rows; `Repository.insert_agent_report`; `DeletionStats.reports_deleted` |
| `app/modules/archive/postgres.py` (modify) | Postgres impl of the above; purge extension |
| `tests/fakes.py` (modify) | in-memory impl + `FakeNotifier` |
| `app/core/config.py` (modify) | `slack_webhook_url`, `dashboard_base_url` settings |
| `app/modules/archive/notify.py` (create) | `Notifier` protocol, `SlackWebhookNotifier`, `NullNotifier`, `build_notifier` |
| `app/modules/archive/schemas.py` (modify) | `AgentReport` (wire in), `AgentReportResult` (wire out) |
| `app/modules/archive/reports.py` (create) | `AgentReportService`: consent → mask → size → fingerprint → insert → notify decision; Slack text |
| `app/modules/archive/deps.py` (modify) | `ArchiveContext.reports`, `get_report_service` |
| `app/modules/archive/__init__.py` (modify) | build the service |
| `app/modules/archive/routes_ingest.py` (modify) | the route |
| `app/modules/archive/worker.py` (modify) | `PurgeReport.reports_deleted` + log line |
| `tests/conftest.py`, `tests/test_consent.py`, `tests/test_surface.py` (modify) | fixtures + guardrails |
| `tests/test_agent_reports.py` (create) | route/service tests |
| `contract/CLIENT_INTEGRATION.md`, `contract/openapi.json`, `README.md`, `DEPLOYMENT.md` (modify) | contract + ops docs |

---

### Task 0: Branch

- [ ] **Step 1: Create the branch**

```bash
cd ~/Desktop/workhard/diligent-gateway
git checkout -b feat/agent-reports
```

---

### Task 1: Schema + repository boundary + fake

**Files:**
- Modify: `app/modules/archive/schema.sql` (append at end)
- Modify: `app/modules/archive/repository.py`
- Modify: `app/modules/archive/postgres.py`
- Modify: `tests/fakes.py`
- Test: `tests/test_agent_reports.py` (create)

**Interfaces:**
- Produces:
  - `StoredAgentReport` dataclass (fields below)
  - `AgentReportInsert(report_id: int | None, first_for_fingerprint: bool)`
  - `Repository.insert_agent_report(report: StoredAgentReport) -> AgentReportInsert`
  - `InMemoryRepository.agent_reports: list[StoredAgentReport]`

- [ ] **Step 1: Write the failing fake-repository test**

Create `tests/test_agent_reports.py`:

```python
"""Agent failure reports (spec: Stage 2 — store, dedup, notify)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from app.modules.archive.repository import StoredAgentReport
from tests.fakes import InMemoryRepository


def _stored(client_report_id: str = "c1", fingerprint: str = "repeated_error:instance_upsert:tool_bug",
            user_id: str = "tester") -> StoredAgentReport:
    return StoredAgentReport(
        client_report_id=client_report_id,
        user_id=user_id,
        project_id="proj-1",
        session_id="sess-1",
        seq=42,
        event_ts=datetime(2026, 9, 8, tzinfo=UTC),
        kind="repeated_error",
        tool="instance_upsert",
        cause="tool_bug",
        fingerprint=fingerprint,
        release="1.4.2",
        payload={"title": "t", "summary_md": "s", "evidence": {"count": 3}},
        content_hash="deadbeef",
    )


def test_fake_insert_is_idempotent_and_flags_first_fingerprint():
    repo = InMemoryRepository()
    first = asyncio.run(repo.insert_agent_report(_stored("c1")))
    assert first.report_id == 1
    assert first.first_for_fingerprint is True

    dup = asyncio.run(repo.insert_agent_report(_stored("c1")))
    assert dup.report_id is None          # same client_report_id → not inserted
    assert dup.first_for_fingerprint is False

    second = asyncio.run(repo.insert_agent_report(_stored("c2")))
    assert second.report_id == 2
    assert second.first_for_fingerprint is False  # fingerprint already seen

    other = asyncio.run(repo.insert_agent_report(_stored("c3", fingerprint="aborted:-:model_error")))
    assert other.first_for_fingerprint is True
    assert len(repo.agent_reports) == 3
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_agent_reports.py -q`
Expected: FAIL — `ImportError: cannot import name 'StoredAgentReport'`

- [ ] **Step 3: Append the DDL to `schema.sql`**

Append at the very end of `app/modules/archive/schema.sql`:

```sql

-- ---------------------------------------------------------------------------
-- agent_reports (authenticated, consent-gated). Agent-written failure reports filed by
-- the diligent sidecar's `agent_report_failure` tool. Separate table (same reasoning as
-- system_log_events) so session ingest/archive/retention are untouched. Rows are
-- conversation-derived content and are erased with the user's data on consent withdrawal
-- (see PostgresRepository.delete_user_data).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_reports (
  id               BIGSERIAL   PRIMARY KEY,
  client_report_id TEXT        NOT NULL UNIQUE,   -- idempotency key (client-generated uuid)
  user_id          TEXT        NOT NULL,          -- from the authenticated principal, never the body
  project_id       TEXT        NOT NULL,
  session_id       TEXT        NOT NULL,
  seq              BIGINT,
  event_ts         TIMESTAMPTZ NOT NULL,
  kind             TEXT        NOT NULL,
  tool             TEXT,
  cause            TEXT        NOT NULL,
  fingerprint      TEXT        NOT NULL,          -- server-computed kind:tool:cause
  release          TEXT,
  payload          JSONB       NOT NULL,          -- server 2nd-pass masking applied: title, summary_md, evidence
  content_hash     TEXT        NOT NULL,
  s3_key           TEXT,                          -- reserved for the worker S3 mirror (not in v1)
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_reports_fingerprint_ts
  ON agent_reports (fingerprint, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_reports_user
  ON agent_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_reports_event_ts
  ON agent_reports (event_ts DESC);
```

- [ ] **Step 4: Add the row models and Protocol method to `repository.py`**

Insert after the `StoredSystemLog` dataclass (around line 37):

```python
@dataclass
class StoredAgentReport:
    """An agent failure report ready to be persisted into ``agent_reports`` (post masking)."""

    client_report_id: str
    user_id: str
    project_id: str
    session_id: str
    seq: int | None
    event_ts: datetime
    kind: str
    tool: str | None
    cause: str
    fingerprint: str
    release: str | None
    payload: dict[str, Any]
    content_hash: str


@dataclass
class AgentReportInsert:
    """Outcome of an idempotent report insert.

    ``report_id`` is ``None`` when ``client_report_id`` already existed (nothing inserted).
    ``first_for_fingerprint`` is True only when this call inserted the first row ever seen
    for the report's fingerprint — the Slack "new issue" trigger."""

    report_id: int | None
    first_for_fingerprint: bool
```

Then in the `Repository` Protocol, after `insert_system_log`:

```python
    async def insert_agent_report(self, report: StoredAgentReport) -> AgentReportInsert:
        """Idempotent insert keyed on ``client_report_id``; reports whether the fingerprint
        was previously unseen. Never raises on duplicates."""
        ...
```

- [ ] **Step 5: Implement it in `postgres.py`**

Add `AgentReportInsert, StoredAgentReport` to the `from app.modules.archive.repository import (...)` block (keep the list alphabetical for ruff `I`). Then add after `insert_system_log`:

```python
    async def insert_agent_report(self, report: StoredAgentReport) -> AgentReportInsert:
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                # Check-then-insert. ponytail: two concurrent first reports for one fingerprint
                # can both read "unseen" and both notify — a duplicate Slack line, not data
                # loss. Make it a serialized upsert if that ever matters.
                await cur.execute(
                    "SELECT EXISTS(SELECT 1 FROM agent_reports WHERE fingerprint = %s)",
                    (report.fingerprint,),
                )
                seen = bool((await cur.fetchone())[0])
                await cur.execute(
                    """
                    INSERT INTO agent_reports
                        (client_report_id, user_id, project_id, session_id, seq, event_ts,
                         kind, tool, cause, fingerprint, release, payload, content_hash)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (client_report_id) DO NOTHING
                    RETURNING id
                    """,
                    (
                        report.client_report_id,
                        report.user_id,
                        report.project_id,
                        report.session_id,
                        report.seq,
                        report.event_ts,
                        report.kind,
                        report.tool,
                        report.cause,
                        report.fingerprint,
                        report.release,
                        Jsonb(report.payload),
                        report.content_hash,
                    ),
                )
                row = await cur.fetchone()
                report_id = int(row[0]) if row else None
                return AgentReportInsert(
                    report_id=report_id,
                    first_for_fingerprint=report_id is not None and not seen,
                )
```

- [ ] **Step 6: Implement the fake in `tests/fakes.py`**

Add `AgentReportInsert, StoredAgentReport` to the import block. In `InMemoryRepository.__init__` add:

```python
        self.agent_reports: list[StoredAgentReport] = []
```

After `insert_system_log` add:

```python
    async def insert_agent_report(self, report: StoredAgentReport) -> AgentReportInsert:
        if any(r.client_report_id == report.client_report_id for r in self.agent_reports):
            return AgentReportInsert(report_id=None, first_for_fingerprint=False)
        seen = any(r.fingerprint == report.fingerprint for r in self.agent_reports)
        self.agent_reports.append(report)
        return AgentReportInsert(report_id=len(self.agent_reports), first_for_fingerprint=not seen)
```

- [ ] **Step 7: Run the test and lint**

Run: `python -m pytest tests/test_agent_reports.py -q && python -m ruff check app tests`
Expected: `1 passed`, ruff clean.

- [ ] **Step 8: Commit**

```bash
git add app/modules/archive/schema.sql app/modules/archive/repository.py app/modules/archive/postgres.py tests/fakes.py tests/test_agent_reports.py
git commit -m "feat(archive): agent_reports table and repository boundary

Additive DDL only. Idempotent insert keyed on client_report_id; reports whether
the fingerprint was previously unseen so the caller can decide to notify.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 2: Consent withdrawal erases reports

**Files:**
- Modify: `app/modules/archive/repository.py` (`DeletionStats`)
- Modify: `app/modules/archive/postgres.py` (`delete_user_data`)
- Modify: `tests/fakes.py` (`delete_user_data`)
- Modify: `app/modules/archive/worker.py` (`PurgeReport`, `purge_withdrawn`)
- Test: `tests/test_consent.py`

**Interfaces:**
- Consumes: `StoredAgentReport`, `InMemoryRepository.agent_reports` (Task 1)
- Produces: `DeletionStats.reports_deleted: int`, `PurgeReport.reports_deleted: int`

- [ ] **Step 1: Extend the existing purge test**

In `tests/test_consent.py`, add the import at the top (keep alphabetical inside the block):

```python
from app.modules.archive.repository import StoredAgentReport
```

Then in `test_withdraw_defers_erasure_until_worker_purge`, right after the `for seq in range(3): ...` loop, insert:

```python
    # a filed agent report is conversation-derived content: it must go with the user's data
    repo.agent_reports.append(
        StoredAgentReport(
            client_report_id="c1", user_id="tester", project_id="proj-1", session_id="sess-1",
            seq=1, event_ts=datetime(2026, 6, 22, tzinfo=UTC), kind="rollback", tool=None,
            cause="model_error", fingerprint="rollback:-:model_error", release=None,
            payload={"title": "t", "summary_md": "s", "evidence": {}}, content_hash="x",
        )
    )
```

(`datetime`/`UTC` — add `from datetime import UTC, datetime` to the imports if not already present.)

After `assert report.s3_objects_deleted == 1` add:

```python
    assert report.reports_deleted == 1
    assert repo.agent_reports == []
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_consent.py::test_withdraw_defers_erasure_until_worker_purge -q`
Expected: FAIL — `AttributeError: 'PurgeReport' object has no attribute 'reports_deleted'` (or the reports list still has 1 entry).

- [ ] **Step 3: Extend `DeletionStats`**

In `repository.py`:

```python
@dataclass
class DeletionStats:
    """Outcome of a user-scoped erasure (consent withdrawal)."""

    records_deleted: int
    sessions_deleted: int
    s3_keys: list[str] = field(default_factory=list)
    reports_deleted: int = 0
```

Update the Protocol docstring of `delete_user_data` to: `"""Erase a user: collect their S3 keys, then delete hot rows + index rows + agent reports.`

- [ ] **Step 4: Extend `PostgresRepository.delete_user_data`**

After the `session_index` DELETE (same cursor, same transaction), add:

```python
                await cur.execute("DELETE FROM agent_reports WHERE user_id = %s", (user_id,))
                reports_deleted = cur.rowcount
                return DeletionStats(
                    records_deleted=records_deleted,
                    sessions_deleted=sessions_deleted,
                    s3_keys=s3_keys,
                    reports_deleted=reports_deleted,
                )
```

(Replace the existing `return DeletionStats(...)`.)

- [ ] **Step 5: Extend the fake**

In `InMemoryRepository.delete_user_data`, before the `return`:

```python
        before = len(self.agent_reports)
        self.agent_reports = [r for r in self.agent_reports if r.user_id != user_id]
        return DeletionStats(
            records_deleted=len(rec_keys),
            sessions_deleted=len(sid_keys),
            s3_keys=s3_keys,
            reports_deleted=before - len(self.agent_reports),
        )
```

- [ ] **Step 6: Extend the worker report**

In `worker.py` `PurgeReport` add `reports_deleted: int = 0`. In `purge_withdrawn`, after `report.s3_objects_deleted += len(keys)` add `report.reports_deleted += stats.reports_deleted`, and extend the log line:

```python
        logger.info(
            "purged user=%s records=%d sessions=%d s3_objects=%d reports=%d",
            uid,
            stats.records_deleted,
            stats.sessions_deleted,
            len(keys),
            stats.reports_deleted,
        )
```

- [ ] **Step 7: Run tests + lint**

Run: `python -m pytest tests/test_consent.py -q && python -m ruff check app tests`
Expected: all pass, ruff clean.

- [ ] **Step 8: Commit**

```bash
git add app/modules/archive/repository.py app/modules/archive/postgres.py app/modules/archive/worker.py tests/fakes.py tests/test_consent.py
git commit -m "feat(archive): erase agent_reports on consent withdrawal

Reports are conversation-derived content under the same consent as records;
the purge transaction now deletes them and PurgeReport counts them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 3: Settings, notifier, wire schemas, service

**Files:**
- Modify: `app/core/config.py`
- Create: `app/modules/archive/notify.py`
- Modify: `app/modules/archive/schemas.py`
- Create: `app/modules/archive/reports.py`
- Modify: `tests/fakes.py` (`FakeNotifier`)
- Test: `tests/test_agent_reports.py`

**Interfaces:**
- Consumes: `Repository.insert_agent_report`, `Repository.granted_user_ids`, `MaskingEngine.mask_record`, `_canonical`/`_content_hash` from `ingest.py`
- Produces:
  - `Settings.slack_webhook_url: str`, `Settings.dashboard_base_url: str`
  - `Notifier` Protocol: `async def notify(self, text: str) -> None`
  - `build_notifier(webhook_url: str) -> Notifier`
  - `AgentReport` (pydantic, request body), `AgentReportResult` (response)
  - `build_fingerprint(kind: str, tool: str | None, cause: str) -> str`
  - `format_slack_message(report: StoredAgentReport, dashboard_base_url: str) -> str`
  - `AgentReportTooLargeError(size, limit)`
  - `AgentReportService.submit(user_id: str, report: AgentReport) -> tuple[AgentReportResult, str | None]` — second element is the Slack text to send, or `None`
  - `AgentReportService.notify_safely(text: str) -> None` — never raises

- [ ] **Step 1: Write the failing service tests**

Append to `tests/test_agent_reports.py`:

```python
from app.core.masking import build_engine
from app.modules.archive.reports import (
    AgentReportService,
    AgentReportTooLargeError,
    build_fingerprint,
    format_slack_message,
)
from app.modules.archive.schemas import AgentReport
from tests.fakes import FakeNotifier


def _report(**overrides) -> AgentReport:
    base = {
        "client_report_id": "11111111-1111-1111-1111-111111111111",
        "session_id": "sess-1",
        "project_id": "proj-1",
        "seq": 42,
        "event_ts": "2026-09-08T01:02:03Z",
        "kind": "repeated_error",
        "tool": "instance_upsert",
        "cause": "ambiguous_prompt",
        "title": "UIStroke.Thickness passed as a string",
        "summary_md": "Tried \"2px\" four times; schema wants a number. key AKIAIOSFODNN7EXAMPLE",
        "evidence": {"count": 4},
        "release": "1.4.2",
    }
    base.update(overrides)
    return AgentReport(**base)


def _service(repo, notifier, consent_required=False, max_bytes=10_000) -> AgentReportService:
    return AgentReportService(
        repo, build_engine(pii_enabled=False), notifier, max_bytes,
        consent_required=consent_required, dashboard_base_url="https://admin.example",
    )


def test_fingerprint_is_kind_tool_cause():
    assert build_fingerprint("repeated_error", "instance_upsert", "tool_bug") == (
        "repeated_error:instance_upsert:tool_bug"
    )
    assert build_fingerprint("aborted", None, "model_error") == "aborted:-:model_error"


def test_submit_masks_stores_and_returns_slack_text_on_first_fingerprint():
    repo, notifier = InMemoryRepository(), FakeNotifier()
    result, text = asyncio.run(_service(repo, notifier).submit("tester", _report()))

    assert result.stored is True and result.notified is True and result.report_id == 1
    stored = repo.agent_reports[0]
    assert stored.user_id == "tester"                       # principal, not body
    assert stored.fingerprint == "repeated_error:instance_upsert:ambiguous_prompt"
    assert "AKIAIOSFODNN7EXAMPLE" not in stored.payload["summary_md"]
    assert "REDACTED" in stored.payload["summary_md"]
    assert text is not None and "UIStroke.Thickness" in text
    assert "https://admin.example/v1/sessions/sess-1" in text
    assert "AKIAIOSFODNN7EXAMPLE" not in text                # slack text is built from the masked row


def test_submit_second_occurrence_is_stored_but_not_notified():
    repo, notifier = InMemoryRepository(), FakeNotifier()
    svc = _service(repo, notifier)
    asyncio.run(svc.submit("tester", _report()))
    result, text = asyncio.run(
        svc.submit("tester", _report(client_report_id="22222222-2222-2222-2222-222222222222"))
    )
    assert result.stored is True and result.notified is False and text is None
    assert len(repo.agent_reports) == 2


def test_submit_duplicate_client_report_id_is_a_noop():
    repo, notifier = InMemoryRepository(), FakeNotifier()
    svc = _service(repo, notifier)
    asyncio.run(svc.submit("tester", _report()))
    result, text = asyncio.run(svc.submit("tester", _report()))
    assert result.stored is False and result.notified is False and text is None
    assert len(repo.agent_reports) == 1


def test_submit_default_denies_without_consent():
    repo, notifier = InMemoryRepository(), FakeNotifier()
    result, text = asyncio.run(_service(repo, notifier, consent_required=True).submit("tester", _report()))
    assert result.stored is False and result.notified is False and text is None
    assert repo.agent_reports == []


def test_submit_rejects_oversized_report():
    repo, notifier = InMemoryRepository(), FakeNotifier()
    svc = _service(repo, notifier, max_bytes=64)
    try:
        asyncio.run(svc.submit("tester", _report()))
    except AgentReportTooLargeError as exc:
        assert exc.limit == 64
    else:
        raise AssertionError("expected AgentReportTooLargeError")


def test_notify_safely_swallows_notifier_errors():
    repo, notifier = InMemoryRepository(), FakeNotifier(fail=True)
    asyncio.run(_service(repo, notifier).notify_safely("hello"))  # must not raise
    assert notifier.sent == []


def test_format_slack_message_without_dashboard_url_has_no_link():
    text = format_slack_message(_stored(), "")
    assert "/v1/sessions/" not in text
    assert "repeated_error" in text and "instance_upsert" in text
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_agent_reports.py -q`
Expected: FAIL — `ImportError` on `app.modules.archive.reports` / `FakeNotifier`.

- [ ] **Step 3: Add settings**

In `app/core/config.py`, after the `retention_days` line add:

```python
    # Agent failure reports (POST /v1/agent-reports). Slack Incoming Webhook URL for the
    # first-seen-fingerprint alert. Empty (the default) disables posting entirely, so local
    # dev and tests never reach Slack. Secret: deliver via ESO/Vault like the JWT key.
    slack_webhook_url: str = ""
    # Public base URL of the query (admin) dashboard, used to link a report to its session.
    # Empty → no link in the Slack message.
    dashboard_base_url: str = ""
```

- [ ] **Step 4: Create `app/modules/archive/notify.py`**

```python
"""Outbound notifications for agent failure reports — a Slack Incoming Webhook.

A webhook URL is write-only to one channel (no read scope, no bot token, no SDK), which is
the narrowest credential that can post to Slack. Callers must treat ``notify`` as
best-effort: wrap it so a Slack outage can never fail an ingest request.
"""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)


class Notifier(Protocol):
    async def notify(self, text: str) -> None: ...


class NullNotifier:
    """Used when no webhook is configured: logs the first line and drops the message."""

    async def notify(self, text: str) -> None:
        first = text.splitlines()[0] if text else ""
        logger.info("slack notify skipped (GATEWAY_SLACK_WEBHOOK_URL unset): %s", first)


class SlackWebhookNotifier:
    def __init__(self, webhook_url: str, timeout_seconds: float = 5.0):
        self._url = webhook_url
        self._timeout = timeout_seconds

    async def notify(self, text: str) -> None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(self._url, json={"text": text})
            resp.raise_for_status()


def build_notifier(webhook_url: str) -> Notifier:
    url = webhook_url.strip()
    return SlackWebhookNotifier(url) if url else NullNotifier()
```

- [ ] **Step 5: Add wire models to `schemas.py`**

Change the typing import to `from typing import Any, Literal`. After `SystemLogEvent` add:

```python
# --- Agent failure reports (spec: docs/superpowers/specs/2026-09-08-agent-failure-report-design.md) ---

AgentReportKind = Literal["rollback", "human_edits", "aborted", "repeated_call", "repeated_error"]
AgentReportCause = Literal[
    "model_error", "missing_tool", "missing_context", "ambiguous_prompt", "tool_bug", "user_error"
]


class AgentReport(BaseModel):
    """A failure report filed by the agent's ``agent_report_failure`` tool.

    The user is the authenticated principal — there is deliberately no ``user_id`` field.
    """

    client_report_id: str = Field(min_length=1, max_length=64)  # idempotency key
    session_id: str = Field(min_length=1, max_length=256)
    project_id: str = Field(min_length=1, max_length=256)
    seq: int | None = Field(default=None, ge=0)
    event_ts: datetime
    kind: AgentReportKind
    tool: str | None = Field(default=None, max_length=128)
    cause: AgentReportCause
    title: str = Field(min_length=1, max_length=200)
    summary_md: str = Field(min_length=1, max_length=8000)
    evidence: dict[str, Any] = Field(default_factory=dict)
    release: str | None = Field(default=None, max_length=64)

    @field_validator("project_id", "session_id")
    @classmethod
    def _no_path_separators(cls, v: str) -> str:
        # Same rule as RecordEnvelope: these may become S3 keys later.
        if "/" in v or "\\" in v or ".." in v:
            raise ValueError("must not contain path separators")
        return v


class AgentReportResult(BaseModel):
    report_id: int | None = None  # null when not stored (no consent / duplicate)
    reported_at: datetime
    stored: bool
    notified: bool
```

- [ ] **Step 6: Create `app/modules/archive/reports.py`**

```python
"""Agent failure report service (spec Stage 2): consent → mask → size → fingerprint →
insert → notify decision. The route runs the Slack post as a background task via
``notify_safely`` so Slack can never slow or fail an ingest request."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from app.core.masking.engine import MaskingEngine
from app.modules.archive.ingest import _canonical, _content_hash
from app.modules.archive.notify import Notifier
from app.modules.archive.repository import Repository, StoredAgentReport
from app.modules.archive.schemas import AgentReport, AgentReportResult

logger = logging.getLogger(__name__)

_SUMMARY_PREVIEW_LINES = 6


class AgentReportTooLargeError(Exception):
    def __init__(self, size: int, limit: int):
        super().__init__(f"agent report is {size} bytes (limit {limit})")
        self.size = size
        self.limit = limit


def build_fingerprint(kind: str, tool: str | None, cause: str) -> str:
    """Grouping key, computed server-side so a client cannot split or merge issues."""
    return f"{kind}:{tool or '-'}:{cause}"


def format_slack_message(report: StoredAgentReport, dashboard_base_url: str) -> str:
    """Plain-text (mrkdwn) alert for the first occurrence of a fingerprint. Built from the
    stored (masked) row, never from the raw request."""
    title = str(report.payload.get("title", ""))
    summary = str(report.payload.get("summary_md", ""))
    preview = "\n".join(summary.splitlines()[:_SUMMARY_PREVIEW_LINES])
    lines = [
        f":rotating_light: *Agent failure report* — first occurrence of `{report.fingerprint}`",
        f"*{title}*",
        f"kind: {report.kind} · tool: {report.tool or '-'} · cause: {report.cause} "
        f"· release: {report.release or '-'}",
        f"session: `{report.session_id}` · project: `{report.project_id}`",
        preview,
    ]
    base = dashboard_base_url.rstrip("/")
    if base:
        lines.append(f"{base}/v1/sessions/{report.session_id}")
    return "\n".join(lines)


class AgentReportService:
    def __init__(
        self,
        repo: Repository,
        masker: MaskingEngine,
        notifier: Notifier,
        max_record_bytes: int,
        consent_required: bool = True,
        dashboard_base_url: str = "",
    ):
        self._repo = repo
        self._masker = masker
        self._notifier = notifier
        self._max_record_bytes = max_record_bytes
        self._consent_required = consent_required
        self._dashboard_base_url = dashboard_base_url

    async def submit(
        self, user_id: str, report: AgentReport
    ) -> tuple[AgentReportResult, str | None]:
        """Store the report for ``user_id`` (the authenticated principal).

        Returns the wire result plus the Slack text to send — ``None`` unless this call
        inserted the first row for a previously unseen fingerprint."""
        now = datetime.now(UTC)
        if self._consent_required:
            granted = await self._repo.granted_user_ids({user_id})
            if user_id not in granted:
                logger.info("agent report dropped: no consent for user_id=%s", user_id)
                return AgentReportResult(reported_at=now, stored=False, notified=False), None

        raw = {"title": report.title, "summary_md": report.summary_md, "evidence": report.evidence}
        masked, mask_report = self._masker.mask_record(raw)
        if mask_report.any:
            logger.debug(
                "masked agent report secrets=%s pii=%s",
                mask_report.secret_hits,
                mask_report.pii_hits,
            )
        size = len(_canonical(masked).encode("utf-8"))
        if size > self._max_record_bytes:
            raise AgentReportTooLargeError(size, self._max_record_bytes)

        stored = StoredAgentReport(
            client_report_id=report.client_report_id,
            user_id=user_id,
            project_id=report.project_id,
            session_id=report.session_id,
            seq=report.seq,
            event_ts=report.event_ts,
            kind=report.kind,
            tool=report.tool,
            cause=report.cause,
            fingerprint=build_fingerprint(report.kind, report.tool, report.cause),
            release=report.release,
            payload=masked,
            content_hash=_content_hash(masked),
        )
        outcome = await self._repo.insert_agent_report(stored)
        if outcome.report_id is None:
            return AgentReportResult(reported_at=now, stored=False, notified=False), None

        text = (
            format_slack_message(stored, self._dashboard_base_url)
            if outcome.first_for_fingerprint
            else None
        )
        result = AgentReportResult(
            report_id=outcome.report_id,
            reported_at=now,
            stored=True,
            notified=text is not None,
        )
        return result, text

    async def notify_safely(self, text: str) -> None:
        """Background-task entry point: a Slack failure is logged, never raised."""
        try:
            await self._notifier.notify(text)
        except Exception:
            logger.exception("slack notify failed (report was stored)")
```

- [ ] **Step 7: Add `FakeNotifier` to `tests/fakes.py`**

Append at the end of the file:

```python
class FakeNotifier:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[str] = []
        self._fail = fail

    async def notify(self, text: str) -> None:
        if self._fail:
            raise RuntimeError("slack down")
        self.sent.append(text)
```

- [ ] **Step 8: Run tests + lint**

Run: `python -m pytest tests/test_agent_reports.py -q && python -m ruff check app tests`
Expected: `9 passed`, ruff clean. If ruff `I001` complains about import order in the test file, run `python -m ruff check --fix tests/test_agent_reports.py`.

- [ ] **Step 9: Commit**

```bash
git add app/core/config.py app/modules/archive/notify.py app/modules/archive/schemas.py app/modules/archive/reports.py tests/fakes.py tests/test_agent_reports.py
git commit -m "feat(archive): agent report service, wire models and Slack notifier

Consent (default-deny) → mask → size cap → server-computed fingerprint →
idempotent insert → Slack text only for a first-seen fingerprint.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 4: Route, wiring, surface guardrail

**Files:**
- Modify: `app/modules/archive/deps.py`
- Modify: `app/modules/archive/__init__.py`
- Modify: `app/modules/archive/routes_ingest.py`
- Modify: `tests/conftest.py`
- Modify: `tests/test_consent.py` (the `gated_client` fixture)
- Modify: `tests/test_surface.py`
- Test: `tests/test_agent_reports.py`

**Interfaces:**
- Consumes: `AgentReportService`, `build_notifier`, `AgentReport`, `AgentReportResult`, `AgentReportTooLargeError` (Task 3)
- Produces: `ArchiveContext.reports: AgentReportService`, `get_report_service`, `POST /v1/agent-reports`

- [ ] **Step 1: Write the failing route tests**

Append to `tests/test_agent_reports.py`:

```python
import psycopg.errors
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.modules.archive.consent import ConsentService
from app.modules.archive.dashboard import DashboardService
from app.modules.archive.deps import ArchiveContext
from app.modules.archive.ingest import IngestService

HEADERS = {"Authorization": "Bearer test-token"}  # → user_id "tester"


def _body(**overrides) -> dict:
    return _report(**overrides).model_dump(mode="json")


def test_route_requires_auth(client):
    assert client.post("/v1/agent-reports", json=_body()).status_code == 401


def test_route_stores_and_notifies_in_background(client, repo, notifier):
    r = client.post("/v1/agent-reports", json=_body(), headers=HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stored"] is True and body["notified"] is True and body["report_id"] == 1
    assert repo.agent_reports[0].user_id == "tester"
    assert len(notifier.sent) == 1                       # TestClient runs background tasks
    assert "UIStroke.Thickness" in notifier.sent[0]


def test_route_ignores_body_user_id(client, repo):
    payload = _body()
    payload["user_id"] = "mallory"                       # not in the schema; must not leak
    r = client.post("/v1/agent-reports", json=payload, headers=HEADERS)
    assert r.status_code == 200
    assert repo.agent_reports[0].user_id == "tester"


def test_route_notifies_only_first_fingerprint(client, notifier):
    client.post("/v1/agent-reports", json=_body(), headers=HEADERS)
    r = client.post(
        "/v1/agent-reports",
        json=_body(client_report_id="22222222-2222-2222-2222-222222222222"),
        headers=HEADERS,
    )
    assert r.json()["notified"] is False
    assert len(notifier.sent) == 1


def _client_with(core, repo, s3, settings, reports: AgentReportService) -> TestClient:
    """A TestClient whose archive context uses a custom report service (else use `client`)."""
    app = create_app()
    app.state.core = core
    app.state.archive = ArchiveContext(
        repo=repo,
        ingest=IngestService(repo, build_engine(pii_enabled=False), settings.max_record_bytes, False),
        dashboard=DashboardService(repo, s3, settings.presign_expiry_seconds),
        consent=ConsentService(repo),
        s3=s3,
        reports=reports,
    )
    return TestClient(app)


def test_route_survives_notifier_failure(core, repo, s3, settings):
    tc = _client_with(core, repo, s3, settings, _service(repo, FakeNotifier(fail=True)))
    r = tc.post("/v1/agent-reports", json=_body(), headers=HEADERS)
    assert r.status_code == 200 and r.json()["stored"] is True
    assert len(repo.agent_reports) == 1


def test_route_413_when_oversized(core, repo, s3, settings, notifier):
    tc = _client_with(core, repo, s3, settings, _service(repo, notifier, max_bytes=64))
    assert tc.post("/v1/agent-reports", json=_body(), headers=HEADERS).status_code == 413


def test_route_503_when_table_missing(core, repo, s3, settings, notifier, monkeypatch):
    async def missing_table(_report):
        raise psycopg.errors.UndefinedTable('relation "agent_reports" does not exist')

    monkeypatch.setattr(repo, "insert_agent_report", missing_table)
    tc = _client_with(core, repo, s3, settings, _service(repo, notifier))
    assert tc.post("/v1/agent-reports", json=_body(), headers=HEADERS).status_code == 503


def test_route_422_on_unknown_kind(client):
    r = client.post("/v1/agent-reports", json=_body(kind="budget"), headers=HEADERS)
    assert r.status_code == 422
```

Note `_body(kind="budget")` raises inside `_report(...)` at pydantic construction — change that last test to build the dict directly:

```python
def test_route_422_on_unknown_kind(client):
    payload = _body()
    payload["kind"] = "budget"
    r = client.post("/v1/agent-reports", json=payload, headers=HEADERS)
    assert r.status_code == 422
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_agent_reports.py -q`
Expected: FAIL — `fixture 'notifier' not found` and/or `TypeError: ArchiveContext.__init__() got an unexpected keyword argument 'reports'`.

- [ ] **Step 3: Extend `ArchiveContext` + provider in `deps.py`**

```python
from app.modules.archive.reports import AgentReportService
```

```python
@dataclass
class ArchiveContext:
    repo: Repository
    ingest: IngestService
    dashboard: DashboardService
    consent: ConsentService
    s3: S3Store
    reports: AgentReportService
```

```python
def get_report_service(ctx: ArchiveContext = Depends(get_archive)) -> AgentReportService:
    return ctx.reports
```

- [ ] **Step 4: Build the service in `__init__.py`**

Add imports:

```python
from app.modules.archive.notify import build_notifier
from app.modules.archive.reports import AgentReportService
```

In `build_context`, before `return ArchiveContext(`:

```python
    reports = AgentReportService(
        repo,
        masker,
        build_notifier(s.slack_webhook_url),
        s.max_record_bytes,
        consent_required=s.consent_required,
        dashboard_base_url=s.dashboard_base_url,
    )
```

and add `reports=reports,` to the `ArchiveContext(...)` call.

- [ ] **Step 5: Add the route to `routes_ingest.py`**

Imports:

```python
import logging

import psycopg.errors
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from app.modules.archive.deps import get_ingest_service, get_report_service
from app.modules.archive.reports import AgentReportService, AgentReportTooLargeError
from app.modules.archive.schemas import (
    AgentReport,
    AgentReportResult,
    BatchRecords,
    IngestResult,
    RecordEnvelope,
    SystemLogEvent,
)

logger = logging.getLogger(__name__)
```

Route (append at end of file):

```python
@router.post("/agent-reports", response_model=AgentReportResult)
async def post_agent_report(
    body: AgentReport,
    background: BackgroundTasks,
    core: CoreContainer = Depends(get_core),
    principal: AuthContext = Depends(authenticate),
    service: AgentReportService = Depends(get_report_service),
) -> AgentReportResult:
    """Agent-filed failure report. Consent-gated (default deny), masked, idempotent on
    ``client_report_id``. Slack fires in the background on a first-seen fingerprint."""
    enforce_rate_limit(1, core, principal)
    try:
        # user_id is the principal — never trust a body-supplied id.
        result, notify_text = await service.submit(principal.user_id, body)
    except AgentReportTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except psycopg.errors.UndefinedTable:
        # Deploy window: the Helm schema Job is a post-upgrade hook, so new pods can serve
        # before agent_reports exists. The client is fire-and-forget; 503 until the Job runs.
        logger.warning("agent_reports table missing — schema job not applied yet")
        raise HTTPException(status_code=503, detail="agent_reports not provisioned") from None
    if notify_text is not None:
        background.add_task(service.notify_safely, notify_text)
    return result
```

- [ ] **Step 6: Update fixtures**

`tests/conftest.py` — add imports `from app.modules.archive.reports import AgentReportService` and `from tests.fakes import FakeNotifier, FakeS3, InMemoryRepository`, then:

```python
@pytest.fixture
def notifier() -> FakeNotifier:
    return FakeNotifier()


@pytest.fixture
def archive_ctx(repo, s3, settings, notifier) -> ArchiveContext:
    masker = build_engine(pii_enabled=False)
    # Consent gate off here: these fixtures back the ingest/dashboard tests, which aren't
    # about opt-in. The gate (default on) is exercised end-to-end in test_consent.py.
    return ArchiveContext(
        repo=repo,
        ingest=IngestService(repo, masker, settings.max_record_bytes, consent_required=False),
        dashboard=DashboardService(repo, s3, settings.presign_expiry_seconds),
        consent=ConsentService(repo),
        s3=s3,
        reports=AgentReportService(
            repo, masker, notifier, settings.max_record_bytes, consent_required=False
        ),
    )
```

`tests/test_consent.py` `gated_client` fixture — add `from app.modules.archive.reports import AgentReportService` and `from tests.fakes import FakeNotifier` (if not present), and add to its `ArchiveContext(...)`:

```python
        reports=AgentReportService(
            repo, masker, FakeNotifier(), settings.max_record_bytes, consent_required=True
        ),
```

`tests/test_surface.py` — add to `INGEST_ALLOWED`:

```python
    ("POST", "/v1/agent-reports"),  # agent-filed failure reports (consent-gated)
```

- [ ] **Step 7: Run the whole suite + lint**

Run: `python -m pytest -q && python -m ruff check app tests`
Expected: all pass (previous count + new tests), ruff clean.

- [ ] **Step 8: Commit**

```bash
git add app/modules/archive/deps.py app/modules/archive/__init__.py app/modules/archive/routes_ingest.py tests/conftest.py tests/test_consent.py tests/test_surface.py tests/test_agent_reports.py
git commit -m "feat(ingest): POST /v1/agent-reports

Authenticated, consent-gated (default deny), masked, idempotent. Slack runs as
a background task; a missing table (pre-schema-job window) answers 503.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 5: Contract + docs

**Files:**
- Modify: `contract/openapi.json` (regenerated), `contract/CLIENT_INTEGRATION.md`, `README.md`, `DEPLOYMENT.md`

- [ ] **Step 1: Regenerate the machine-readable contract**

Run: `python scripts/dump_contract.py && git diff --stat contract/`
Expected: `contract/openapi.json` changed; it now contains `"/v1/agent-reports"`. Verify:

```bash
python -c "import json;d=json.load(open('contract/openapi.json'));assert '/v1/agent-reports' in d['paths'];print('ok')"
```

- [ ] **Step 2: Document the route in `contract/CLIENT_INTEGRATION.md`**

Append after §11:

```markdown
## 12. Agent failure reports (`POST /v1/agent-reports`)

Filed by the diligent sidecar's `agent_report_failure` tool when the agent itself judges
that a stretch of work was a genuine failure (design:
`docs/superpowers/specs/2026-09-08-agent-failure-report-design.md` in the diligent repo).
Stored in its own `agent_reports` table; the first occurrence of each fingerprint is posted
to Slack. **No LLM runs in the gateway** — the report body is already written.

How it differs from `/v1/records`:
1. **Authenticated** (Bearer studio JWT) and **consent-gated, default-deny** — the user is
   the principal; a report from a user without a `granted` consent row is dropped
   (`stored:false`), not stored.
2. **Idempotent on `client_report_id`** — resend freely; a duplicate answers `stored:false`.
3. **Erased on withdrawal** together with the user's records.

**Body** (`title`, `summary_md`, `kind`, `cause`, ids and `event_ts` required):

| field | type | req | notes |
|---|---|:--:|---|
| `client_report_id` | string(1–64) | ✅ | client-generated uuid; idempotency key |
| `session_id` | string(1–256) | ✅ | no path separators |
| `project_id` | string(1–256) | ✅ | same resolution as records |
| `seq` | int ≥ 0 | | latest record seq at filing time |
| `event_ts` | ISO-8601 datetime | ✅ | |
| `kind` | `rollback` \| `human_edits` \| `aborted` \| `repeated_call` \| `repeated_error` | ✅ | which local selector armed |
| `tool` | string(≤128) | | tool involved, if any |
| `cause` | `model_error` \| `missing_tool` \| `missing_context` \| `ambiguous_prompt` \| `tool_bug` \| `user_error` | ✅ | the model's own diagnosis |
| `title` | string(1–200) | ✅ | one line |
| `summary_md` | string(1–8000) | ✅ | Markdown body (server-masked) |
| `evidence` | object | | scalars only, e.g. `{"count": 4}` |
| `release` | string(≤64) | | agent bundle version |

There is no `user_id` field — it is taken from the token.

**Behavior**
- Server masks `title`/`summary_md`/`evidence`; fingerprint = `kind:tool:cause` computed
  server-side.
- Slack fires **only** for the first row of a fingerprint; later rows are stored silently.

**Response** `200`: `{"report_id": 12, "reported_at": "...", "stored": true, "notified": true}`
(`report_id` is `null` when `stored` is false).

| status | meaning | client action |
|---|---|---|
| 200 `stored:true` | stored (maybe notified) | done |
| 200 `stored:false` | no consent, or duplicate `client_report_id` | done — do not retry |
| 401 | bad/missing token | re-auth |
| 413 | payload > `max_record_bytes` after masking | trim `summary_md` |
| 422 | schema validation failed | fix payload (bug) |
| 429 | rate limited (per user) | back off |
| 503 | `agent_reports` table not provisioned yet (deploy window) | drop; best-effort |
```

- [ ] **Step 3: README + DEPLOYMENT**

`README.md` — in the `## API` list, after the `/v1/records:batch` line add:

```markdown
- `POST /v1/agent-reports` — agent-filed failure report (auth + consent required); first-seen fingerprint → Slack
```

`DEPLOYMENT.md` — in the secrets/env table (the one that says the JWT key is the only secret env, around line 132–161), add a row:

```markdown
| Slack webhook (agent failure alerts) | `GATEWAY_SLACK_WEBHOOK_URL` | ESO/Vault, same path as the JWT key. Empty = alerts off. Channel: `#alert-studio-agent` |
```

and in the non-secret values list mention `GATEWAY_DASHBOARD_BASE_URL` (the admin ingress URL, e.g. `https://diligent-gateway-prod-admin.ovdr.io`) → chart `values.yaml` `env:`.

- [ ] **Step 4: Lint + full suite one last time**

Run: `python -m ruff check app tests && python -m pytest -q`
Expected: clean, all pass.

- [ ] **Step 5: Commit**

```bash
git add contract/ README.md DEPLOYMENT.md
git commit -m "docs: agent-reports contract (§12), README API, deployment secrets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 6: Pre-merge checklist (manual, not code)

- [ ] Confirm the Helm schema Job hook ordering in `sbx/ovdr-chart` (`charts/application/diligent-gateway`, branch `feat/diligent-gateway-chart`). If it is `post-upgrade`, the 503 window is expected and harmless; if it can be moved to `pre-upgrade`, do so in a chart PR.
- [ ] Add `GATEWAY_SLACK_WEBHOOK_URL` to Vault for dev first; verify one alert lands in `#alert-studio-agent` from the dev gateway before enabling prod.
- [ ] Add `GATEWAY_DASHBOARD_BASE_URL` to chart values for dev/prod.
- [ ] Open the PR (assignee: marklee-kk) with the PR body trailer:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu
  ```
