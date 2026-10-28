# Goal Improvements Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Selectively incorporate PR #500 improvements without regressing this branch's goal continuity and recovery.

**Architecture:** Core exposes a generic successful end-of-turn signal. Runtime owns reload recovery, evidence checks, blocker audits, and accounting; the protocol and shared client helpers carry controls and elapsed time to Web and TUI.

**Tech Stack:** Bun, TypeScript, Zod, React.

**Spec:** The user's request to incorporate useful #500 changes and fix shared weaknesses, preserving generic commit and PR wording.

## Global Constraints

- Preserve notification isolation, durable recovery, disconnect continuation, goal-owned user input, and actual-activity detection.
- Preserve explicit budgets; do not import soft-budget overruns or tool-count completion gates.
- Keep `--turns`; accept `--runs` as an alias and allow limit-only edits.
- Keep commits and PR prose at the level of goal functionality improvements.

## Review Focus

- Reload must not revive a user-paused, replaced, disabled, or failed-reload goal.
- A successful tool handoff must persist all results without classifying the turn as interrupted.
- Repeated blocker claims in one run or after gaps must not satisfy the consecutive-run audit.
- Completion references must identify observed successful results, not failed, fabricated, stale, or control-tool calls. Text deliverables remain valid evidence; semantic completeness still requires the model's requirement-by-requirement audit.
- Elapsed time must not double-charge after pause, stale settlement, restart, or replacement.

### Task 1: Successful handoff and configuration recovery

- [x] Add failing core endTurn and runtime reload ownership tests.
- [x] Add ToolResult.endTurn propagation and make create_goal end its requesting turn.
- [x] Capture reload pause ownership using goal identity/revision; resume only after successful reload and valid execution configuration.
- [x] Run core and runtime goal/config tests.

### Task 2: Goal audit contracts

- [x] Add failing tests for first blocker on a late run, duplicate claims, changed blockers, gaps, and resume reset.
- [x] Track a stable blocker key across distinct consecutive runs; expose the audit to the model, return a nonterminal audit result until the threshold is reached.
- [x] Add requirement/evidence/source completion checks and runtime observation tracking. Only successful non-control tool results or actual assistant answer text may be cited. Require a verbatim excerpt from the source and expose bounded source previews through get_goal. Reset evidence on resume or objective replacement.
- [x] Test failed/fabricated sources, valid text deliverables, successful results, and app-server event wiring. Strengthen continuation guidance without claiming semantic truth can be proven automatically.

### Task 3: Limit editing and elapsed time

- [x] Add parser/protocol/controller tests for limit-only edits and clearing token/run limits while preserving usage and objective.
- [x] Add shared elapsed-time formatting and runtime timestamp accounting tests.
- [x] Update Web and TUI summaries and command help; retain visible stopped reasons and Resume controls.
- [x] Test both client surfaces, including uncapped progress display.

### Task 4: Verification and delivery

- [x] Run targeted suites, full package tests, Web tests, typecheck, lint, and diff checks.
- [x] Exercise the local app with a real goal and verify visible state plus its output.
- [x] Reuse the existing reviewer for the final diff; address actionable findings.
- Delivery: commit, push, and update PR #502 with generic goal improvement wording after the checks below.

## Implementation rulings and verification

- Model creation accepts only the objective. A real smoke test exposed an unsolicited model-supplied run limit; the strict tool schema now rejects limit fields. User RPC commands and configured defaults retain limit support. Existing goals are not migrated because model- and user-specified limits cannot be distinguished retrospectively.
- A successful endTurn handoff preserves every companion tool result, including errors, for recovery in the goal-owned run. A failed handoff tool never ends the turn. Queued steering still takes priority.
- Reload auto-resume is limited to successful in-process reloads. The existing TUI process-restart reload remains an explicit-resume boundary.
- Bash and MCP errors now populate the executor's shared error metadata so failed results cannot enter the completion source catalog.
- Completion enforces observation provenance and quoted excerpts, not independent semantic correctness. Requirement completeness and external-blocker equivalence remain model assessments.
- The existing reviewer checked reload ownership, evidence handling, stale settlement, the core handoff, and shared clients. All actionable findings were addressed.

Final checks: 2,860 package tests passed; 614 Web tests passed; typecheck passed; lint passed with eight pre-existing unrelated informational diagnostics; diff whitespace check passed.

Live ChatGPT 6 Luna validation: thread `20261028082913167000-07e60a` created an uncapped goal, wrote `goal-final-check.txt`, verified exact `GOAL_OK` contents and seven bytes, and completed with observed source citations. The file was independently read from disk. Screenshot: `/tmp/diligent-goal-selective-verified.png`. An earlier probe's invented evidence ID was rejected, and the model recovered by reading the actual source catalog.
