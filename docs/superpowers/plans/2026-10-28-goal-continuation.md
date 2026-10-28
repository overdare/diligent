# Goal Continuation Repair Implementation Plan

**Goal:** Keep long-running goals active while useful work remains, without implicit run limits or accidental pauses.

**Architecture:** Keep lifecycle and accounting in the shared runtime. Make run limits optional in the protocol and render them consistently in Web and TUI. Preserve explicit user stops, permission boundaries, persisted budgets, and restart safety.

**Scope:** The user authorized the diagnosed fixes and related goal reliability repairs, followed by committing, pushing, and opening a PR. Keep commit and PR wording at the product level: goal functionality improvements.

## Tasks

- [x] Add regression tests before changes: uncapped goals, explicit limits, meaningful tool-free activity, empty-run protection, premature blocked reports, reconnect, user follow-ups, approval/input cancellation.
- [x] Make maxTurns optional, retain explicit/configured limits, and permit clearing an existing run limit with --turns unlimited. Preserve old ledgers rather than guessing whether their limits were intentional.
- [x] Count real assistant/reasoning/tool/compaction activity; keep the three-empty-run breaker. Strengthen completion and repeated-blocker instructions and prevent first-run blocked reports.
- [x] Preserve active goals across client disconnect/reconnect and user follow-ups. Defer new automatic work while disconnected. Keep unanswered goal approvals/questions durable and never infer approval from a missing client.
- [x] Render unlimited runs and visible stop reasons in Web and TUI; update the usage guide.
- [x] Run focused tests, type checks, lint, broader suites, and one independent review; fix substantive findings.

## Review Focus

- Explicit pause/Stop must never be undone by a reconnect or late completion.
- An interrupted old run must not settle or report against its replacement.
- Goal-owned descendants and pending interactions must remain cancellable.
- Existing numeric budgets must replay unchanged; users can explicitly remove a run cap.
- Activity must come from completed runtime events, not discarded stream attempts.

## Verification

### Follow-up lifecycle audit

- Reproduce automatic continuation lost while manual compaction owns the thread.
- Cover successful, skipped, failed, and explicitly paused compaction outcomes before changing the handler.
- Restore scheduling only after compaction releases the thread, retaining user pause and retry backoff semantics.
- Provide bounded, session-owned child IDs in unknown-target errors so a mistyped ID is recoverable without guessing or silently selecting another child.
- Run a live coding repair through transient setup failure, failing tests, user input, child review, and final verification.

Follow-up results:

- Reproduced lost compaction wake on successful, skipped, and failed compaction before the fix. All three now continue; explicit pause remains paused.
- Reproduced busy/idle notification failures stranding thread ownership or scheduling. Both now release ownership and re-wake safely.
- A real ChatGPT 6 Luna run mistyped a child ID and unnecessarily requested user intervention. The repaired build recovered an intentionally invalid ID from its diagnostic, retrieved the original child, and completed with one child and zero user-input requests.
- Live repair task recovered from a transient setup failure and ten failing tests, passed all twelve fixture tests without changing the test file, consumed a child review, and generated a verified JSON report.
- Follow-up full suite: 2,822 passed, 0 failed. Typecheck, lint, and focused retry-backoff verification passed. Independent review found no remaining actionable issues.

- `bun test`: 2,814 passed, 0 failed, including app-server end-to-end coverage.
- `bun run overdare-ai-agent:web:test`: 608 passed, 0 failed.
- `bun run typecheck`: passed.
- `bun run lint`: passed; eight informational diagnostics outside the changed files.
- `git diff --check`: passed.
- Independent review findings addressed: hidden reasoning activity, undelivered approval responses, and model-change rejection cancelling existing work.
- Explicit natural-language pause reporting is supported through the goal tool with user-request-only instructions; the runtime transition is covered end to end.
- Implementation was verified before publication; commit and PR text summarize the product improvement without internal thresholds.
