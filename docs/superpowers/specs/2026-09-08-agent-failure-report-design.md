# Agent Failure Reporting — Design

**Date:** 2026-09-08
**Status:** Draft (design phase, rev 3)
**Related:** `docs/plan/uncategorized/2026-08-25-production-agent-principles-roadmap.md` §R2
(LLM-driven error analysis), `docs/guide/sentry-monitoring.md`, OVDR-11475 (gateway records),
gateway repo `~/Desktop/workhard/diligent-gateway` (`DESIGN.md`, `contract/`)

## Problem

When a real user drives the agent through a Studio session — building a game, running a
long loop — the agent sometimes fails repeatedly or spins without making progress. Today
nobody finds out:

- **Sentry** only sees failures that escalate to a failed turn (`run_failed`). An agent
  that burns 40 tool calls achieving nothing raises zero errors, so Sentry stays silent.
  Sentry is also structurally barred from carrying conversation content, so even when it
  fires it cannot say *what* the agent got wrong.
- **Gateway records** receive every session entry, but nothing reads them.

We want genuine agent failure — including the silent, non-erroring kind — to surface as a
readable Markdown report, stored in the gateway and pinged to Slack.

## Decisions (locked)

- **Judgment runs on the user's LLM, not in the gateway.** The gateway must not hold an
  LLM dependency or spend on inference. Only stretches the agent itself judges to be a real
  failure are transmitted — normal use sends nothing.
- **The gateway stores and notifies. Nothing else.** New route, new table, one Slack
  webhook. No analysis, no read API in v1.
- **No GitHub commit.** Unvalidated machine-written reports pushed to the repo are noise
  before they are signal. Revisit once report quality has been observed.
- **No per-request budget selector.** Task cost is dominated by task size ("build the
  whole level" vs "change the button colour"); no threshold separates inefficiency from
  scope. Rejected, not deferred.

## The credential constraint (why the gateway is in the path)

The agent cannot post to Slack or GitHub itself. A Slack Incoming Webhook URL and a GitHub
token are secrets; baking either into the shipped binary hands them to every user
(extractable, abusable, rotatable only by redistributing the binary). A Sentry DSN can be
baked because it is a public write-only identifier by design; these are not.

A server relay is the only safe form, and the OVERDARE gateway already is one: per-user
Hub-token auth, prod/dev split, consent gate, masking, and every session entry already
flowing through it. This design adds one route to that system.

## Architecture

```
LOCAL (sidecar)                                GATEWAY                     SLACK
──────────────                                 ───────                     ─────
loop hook: cheap selectors (A/B/C)             POST /v1/agent-reports
   │ trips → arm                                  │ auth (Hub JWT)
   ▼                                              │ consent (default-deny)
beforeTurn: inject "assess yourself"              │ mask + size cap
   │                                              │ INSERT agent_reports
   ▼                                              │ fingerprint first-seen? ──► webhook
model judges: real failure?                       ▼
   │ yes → calls agent_report_failure tool     (daily worker mirrors .md to S3 — follow-up)
   │ no  → continues, nothing sent
   ▼
tool composes .md, POSTs
```

## Stage 1 — Local: selectors arm, the model judges

One `BundledToolProvider` (`@overdare/agent-report`, in
`apps/overdare-ai-agent/sidecar/src/tools/gateway/`), registered from
`createStudioBundledToolProviders` (`sidecar/src/tools/index.ts:18`) beside the existing
gateway transmitter. It exposes three things the runtime already knows how to wire:

| Hook | Role |
|---|---|
| `createAgentLoopHooks` → one `AgentLoopHook` | selectors + injection |
| `createTools` → `agent_report_failure` | the model's only way to file a report |
| `onEntryAppended` (`PluginHookFn`) | captures `session_id` / `seq` / `user_id` — `ToolContext` (`packages/core/src/tool/types.ts:27`) carries no session identity, `HookInput` (`packages/runtime/src/hooks/runner.ts:10`) does |

### Selectors (deterministic, no LLM)

| | Trigger | Where |
|---|---|---|
| **A** | `studiorpc_rollback` called · `studiorpc_human_edits` reports out-of-band edits · `AssistantMessage.stopReason === "aborted"` | `onToolResult`, `afterTurn` |
| **B** | same `(toolName, hash(args))` issued N times in one session | `onToolResult` |
| **C** | same `toolName` returning `isError` N times in a row (streak resets on success) | `onToolResult` |

N = 3, config value. Each selector arms at most **once per fingerprint per session**.

A fires whether or not the agent was at fault — a user who changed their mind also rolls
back. That is intended: selectors are candidates, not verdicts.

### Judgment (the user's LLM, inside the normal loop)

When a selector is armed, the next `beforeTurn` returns one `AgentContextInjection`
(`packages/core/src/agent/loop-hooks.ts:6`) — the same mechanism `plan-reminder-hook.ts`
uses — carrying a `<system-reminder>`:

> A failure signal fired (`kind`, `tool`, `count`). Before continuing, assess whether the
> preceding work was a genuine agent failure — you were going in circles, misusing a tool,
> or the user discarded your work because it was wrong. If and only if it was, call
> `agent_report_failure` once with an honest cause. If it was not (the user changed their
> mind, the retries were reasonable), do nothing and continue.

This costs no separate LLM call and no extra context: the model already holds the
transcript, and the injection is a few hundred tokens once per armed signal. The judgment
is a tool call, so its output is structured by construction.

Timing: for A-rollback / A-human_edits / B / C the injection lands on the very next
provider round of the same prompt. For A-aborted there is no next round until the user
speaks again, so the assessment happens at the start of the following prompt ("your last
turn was aborted by the user — before continuing, assess…").

Known limitation: this is self-assessment, and a model will under-report its own failure.
Accepted for v1 — the alternative is a second LLM somewhere, which is exactly what this
design keeps out.

### `agent_report_failure` tool

```ts
parameters: {
  cause:   "model_error" | "missing_tool" | "missing_context" | "ambiguous_prompt" | "tool_bug" | "user_error",
  title:   string (≤ 200),   // one line, what went wrong
  summary: string (≤ 4000),  // what was attempted, why it failed, what would have helped
}
```

`kind`, `tool`, `count`, `session_id`, `seq`, `release` come from the hook closure, not the
model. The tool composes the Markdown deterministically:

```markdown
## <title>
kind: repeated_error · tool: instance_upsert · count: 4 · cause: ambiguous_prompt
session: 20260908…-65f996 · seq: 168 · release: 1.4.2

<summary>
```

It then POSTs to the gateway (below) and returns a one-line confirmation. Gated on
`canTransmitRecords()` — withdrawn consent means the tool returns "reporting disabled" and
sends nothing. Failures to reach the gateway are logged, never surfaced as tool errors.

The tool description and the injection both instruct: describe the agent's behaviour, do
not quote the user's messages.

### Rollout switch

Add `agent-report` to `OVERDARE_EXPERIMENTS` (`sidecar/src/experiments.ts`) with
`toolNames: ["agent_report_failure"]`, `defaultEnabled: false`. The hook checks
`AgentLoopHookFactoryContext.tools` for the tool and stays inert when it is absent, so the
experiment flag switches the whole feature without a release.

## Stage 2 — Gateway: store, dedup, notify

Extend the existing `archive` module rather than adding a new one: the route needs its
`Repository`, `MaskingEngine`, consent lookup and purge path, all of which live there. The
`system_log_events` precedent (separate table, same infrastructure) is the shape to copy.

### Route — `POST /v1/agent-reports` (ingest role)

Mounted from `routes_ingest.py`. Pipeline, in order:

1. `authenticate` — Hub JWT, same as `/v1/records`. **`user_id` comes from the principal,
   never from the body** (the rule `ConsentUpdate` already follows).
2. `enforce_rate_limit(1, …)`.
3. **Consent, server-side, default-deny**: `repo.granted_user_ids({user_id})` must contain
   the caller. The client gate is not trusted alone. Not granted → `200 {stored: false}`
   (mirrors how records are silently skipped).
4. `masker.mask_record({"title": …, "summary_md": …, "evidence": …})` — the report body is
   model-written free text and gets the same second-pass scrub as every record.
5. Size cap: serialized masked payload ≤ `max_record_bytes` → else `413`.
6. `fingerprint = f"{kind}:{tool or '-'}:{cause}"`, **computed server-side**.
7. `INSERT` (idempotent on `client_report_id`, `ON CONFLICT DO NOTHING`).
8. If the row was inserted **and** no prior row with that fingerprint existed → schedule
   the Slack notify as a FastAPI `BackgroundTask`. The response never waits on Slack.

Response: `200 {report_id, reported_at, stored, notified}` — `report_id` is `null` when
`stored` is false (pydantic `int | None`; FastAPI serializes the null, it is not omitted).

Wire body (pydantic, mirrors `SystemLogEvent` style):

```jsonc
{
  "client_report_id": "uuid",
  "session_id": "…", "project_id": "…", "seq": 168,
  "event_ts": "2026-09-08T…Z",
  "kind": "rollback" | "human_edits" | "aborted" | "repeated_call" | "repeated_error",
  "tool": "instance_upsert",           // optional
  "cause": "ambiguous_prompt",
  "title": "…",                        // ≤ 200
  "summary_md": "…",                   // ≤ 8000
  "evidence": { "count": 4 },          // scalars only
  "release": "1.4.2"                   // optional
}
```

### Schema — `agent_reports` (additive only)

```sql
CREATE TABLE IF NOT EXISTS agent_reports (
  id               BIGSERIAL   PRIMARY KEY,
  client_report_id TEXT        NOT NULL UNIQUE,   -- idempotency key
  user_id          TEXT        NOT NULL,          -- from the authenticated principal
  project_id       TEXT        NOT NULL,
  session_id       TEXT        NOT NULL,
  seq              BIGINT,
  event_ts         TIMESTAMPTZ NOT NULL,
  kind             TEXT        NOT NULL,
  tool             TEXT,
  cause            TEXT        NOT NULL,
  fingerprint      TEXT        NOT NULL,          -- server-computed kind:tool:cause
  release          TEXT,
  payload          JSONB       NOT NULL,          -- masked: title, summary_md, evidence
  content_hash     TEXT        NOT NULL,
  s3_key           TEXT,                          -- set by the worker mirror (follow-up)
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_reports_fingerprint_ts ON agent_reports (fingerprint, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_reports_user           ON agent_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_reports_event_ts       ON agent_reports (event_ts DESC);
```

Appended to `app/modules/archive/schema.sql`. **No existing table or index is touched.**
The file is idempotent by convention (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) and this
addition keeps it so.

### Consent withdrawal must erase reports

`worker.purge_withdrawn` → `repo.delete_user_data(user_id)` today deletes
`session_records` and `session_index` (`postgres.py:324`). Reports are conversation-derived
content under the same consent, so the same transaction gains:

```sql
DELETE FROM agent_reports WHERE user_id = %s
```

`DeletionStats` gains `reports_deleted`; `InMemoryRepository` (`tests/fakes.py`) mirrors
it. **This lands in the same PR as the table** — a table that survives withdrawal is a
compliance gap, not a follow-up.

### Slack notifier

- Setting `GATEWAY_SLACK_WEBHOOK_URL` (`config.py`). Empty → notifier logs and does nothing,
  so dev/test never posts.
- `httpx.AsyncClient.post(url, json={"text": …}, timeout=5)` — `httpx` is already a runtime
  dependency. No Slack SDK, no bot token: the webhook is write-only to one channel.
- Runs as a `BackgroundTask`; any exception is logged and swallowed. Slack being down must
  never fail an ingest request.
- Fires on **first appearance of a fingerprint only** (step 8). Recurrence is stored
  silently. Escalation alerts are a follow-up once volumes are known.
- Message: title · `kind / tool / cause` · first ~6 lines of the summary · session id ·
  link to the admin dashboard session view (`/v1/sessions/{session_id}` on the query host).

Behind a small `Notifier` protocol so tests inject a fake, matching how `S3Store` is faked.

### Secrets ledger

| Secret | Holder | Delivery |
|---|---|---|
| Slack Incoming Webhook URL | gateway ingest pods | ESO/Vault, same path as `GATEWAY_JWT_KEY_BASE64` (`DEPLOYMENT.md` §"비밀 env") |

Nothing is added to the shipped agent binary.

### Deployment hazard — schema Job ordering

`schema.sql` is applied by a Helm Job on a **post-install/upgrade** hook
(`DEPLOYMENT.md:219`); the app's lifespan does not apply it (`main.py`). New pods can
therefore serve before `agent_reports` exists. Two required mitigations:

1. The route catches `psycopg.errors.UndefinedTable`, logs a warning, and returns `503`.
   The client is fire-and-forget, so nothing user-facing breaks; the window closes when the
   Job completes. Ingest of records is unaffected.
2. Before merge, confirm the hook weight/ordering in `sbx/ovdr-chart`
   (`charts/application/diligent-gateway`, branch `feat/diligent-gateway-chart` — not in
   this repo). If it can be made pre-upgrade, mitigation 1 becomes belt-and-braces.

### Contract

`python scripts/dump_contract.py` regenerates `contract/openapi.json`; add §12 to
`contract/CLIENT_INTEGRATION.md` describing the route (auth, consent, idempotency, limits).

### S3 mirror (follow-up PR, designed here so it is not lost)

The ingest path never touches S3 today; only the daily worker does. Keeping that boundary:
the worker selects `agent_reports WHERE s3_key IS NULL`, writes each as
`<prefix>/agent-reports/<YYYY-MM-DD>/<id>.md`, and sets `s3_key`. `s3_keys_for_user` gains
those keys so withdrawal purge deletes them. Recommended to land **after** DB + Slack are
observed working — it is the largest slice of gateway code for the least immediate value.

## Privacy

- Transmission is gated twice: locally on `canTransmitRecords()`, and server-side by the
  default-deny consent lookup. The client gate is never trusted alone.
- `user_id` is taken from the authenticated token, never from the body.
- Report bodies are masked server-side like every record.
- The injection and the tool description instruct the model to describe its own behaviour
  and not quote the user.
- Withdrawal erases reports in the same purge as records.
- Sentry is untouched; this path never widens what Sentry sends.

## Testing

**Sidecar** (`apps/overdare-ai-agent/sidecar/test/`, pure functions + fetch stub as in
`gateway.test.ts`):
- each selector trips at N and not at N−1; C's streak resets on success
- once per fingerprint per session; state resets on `restore`
- `beforeTurn` injects exactly once per armed signal, nothing when unarmed
- hook is inert when `agent_report_failure` is not in `context.tools`
- tool: withdrawn consent → no request; gateway failure → logged, not a tool error
- tool composes the expected Markdown from args + closure values

**Gateway** (`tests/test_agent_reports.py`, `TestClient` + `InMemoryRepository` per
`conftest.py`):
- 401 without token; `user_id` taken from principal even if body carries one
- consent default-deny → `stored: false`, no row, no notify
- masking applied to `summary_md`; oversized → 413
- same `client_report_id` twice → one row
- notify fires on first fingerprint only; notifier exception does not fail the request
- withdrawal purge deletes the user's reports (extend `test_consent.py`)
- `UndefinedTable` → 503

## Side finding (out of scope, needs a ticket)

The sidecar's feedback modal (`web/client/App.tsx`, `FeedbackReportModal.tsx`) submits via
`postUserFeedback` to `POST /v1/reports` (`sidecar/src/tools/gateway/feedback.ts:24`).
**No such route exists in the gateway** — `contract/openapi.json` lists none. That button
404s against prod today. Not changed here; the new route is deliberately named
`/v1/agent-reports` to avoid colliding with whatever `/v1/reports` becomes.

## Resolved (2026-09-08)

- **Slack channel** — reuse `#alert-studio-agent` (Sentry's). Split out later only if the
  volume warrants it.
- **S3 mirror** — deferred until DB + Slack are observed working in prod. S3 writes today
  happen only in `worker.py` (daily rollup at `:77`, on-demand session archive at `:130`);
  the ingest path never writes S3, and v1 keeps it that way.

## Open questions

1. **N** — starts at 3; revisit once the first week of reports is in.
2. **Dashboard view** — a `GET /v1/agent-reports` on the query role is cheap once rows
   exist; intentionally excluded from v1 per the store-and-notify decision.
