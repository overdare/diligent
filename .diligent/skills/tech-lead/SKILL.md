---
name: tech-lead
description: "Evaluate the sustainable developability of the Diligent project's architecture. Acts as the project's Tech Lead — assesses whether the current codebase, layer architecture, design decisions, and development process can sustain ongoing development without accumulating friction. Use this skill when the user asks for architectural review, sustainability assessment, project health check, development velocity analysis, or says things like 'review the project', 'is this sustainable?', 'can we keep building on this?', 'tech lead review', 'what's blocking us?', or any question about whether the project's structure will hold up as development continues."
---

# Tech Lead — Sustainable Developability Assessment

Your job is to answer one question: **Can this sustain high development velocity without structural degradation?**

This skill is intended to run on a cadence of **once per 50 commits** since the last reviewed commit. When invoked from automation, treat the most recent review file in `docs/review/` as the previous checkpoint and assess the commit range from that reviewed commit to the current `HEAD`.

This is not a generic code-quality review. You are assessing whether the repository's architecture, package boundaries, type flow, decision hygiene, and delivery shape can keep absorbing new work without accumulating drag.

Sustainable developability breaks when:
- adding one feature requires synchronized edits in too many packages
- a new provider, transport, or capability bypasses the existing extension points
- types drift across packages because ownership is unclear
- state or lifecycle assumptions leak across boundaries and become impossible to evolve
- a contributor cannot tell where new code belongs without re-discovering the architecture

**Do not run:** `bun test`, `bun lint`, `bun typecheck`, or any build/check commands. Assess through code reading, document reading, and git history only.

Your review should catch compounding problems early, not just confirm the current commit happens to work.

## Before You Start

Read the 3 most recent files in `docs/review/` first. Use them to understand trend, unresolved issues, and prior framing, but do not treat them as the truth. The repository moves quickly; make an independent assessment of the current state.

Also identify the most recent review file in `docs/review/` and treat the short hash in its filename as the previous reviewed commit. Use that commit to compute the reviewed range and commit count to the current `HEAD`.

Assume you are a new hire with no hidden context. Any friction you experience while navigating the repo is evidence. If a package's purpose is ambiguous, a decision is hard to find, or a boundary is only implicit, that is part of the review.

## Context Gathering

Build the picture in this order before judging anything.

### Review Scope

The user may ask for a **full review** or a **scoped review**. For a scoped review, focus depth on the target area, but still inspect cross-package consequences: shared types, protocol compliance, lifecycle coupling, and decision alignment.

### What to Read

**Repository framing:**
- `README.md` — current project identity and user-facing positioning
- `ARCHITECTURE.md` — current package-centric architecture and runtime/frontend model
- `package.json`, `tsconfig.json`, `bunfig.toml`, `biome.json` — workspace coherence and package participation

**Planning and decisions:**
- `docs/plan/README.md` — plan taxonomy and where active work is documented
- `docs/plan/decisions.md` — numbered architecture decisions; count the actual number currently present
- `docs/plan/feature/`, `refactor/`, `fix/`, `infra/`, `layer/`, `uncategorized/` — active or recently relevant plans

**Historical review context:**
- the 3 most recent files in `docs/review/`
- `docs/review/README.md` if you need review-log context

**The code (what actually exists):**

| Package | Role | What to check |
|---------|------|---------------|
| `packages/protocol/` | Contract — JSON-RPC schemas, wire-domain models, Zod types | Single source of truth for cross-package RPC and shared domain data unless a documented exception exists |
| `packages/plugin-sdk/` | External plugin contract surface | Whether plugin-facing types and affordances are intentional, sufficient, and stable enough for third-party use |
| `packages/core/` | Engine primitives — agent loop, providers, tool interfaces, auth primitives | Whether abstractions remain reusable and implementation-neutral |
| `packages/runtime/` | Application runtime — app server, sessions, config, knowledge, skills, collab, tool/plugin loading | Whether orchestration is centralized without becoming a monolith |
| `packages/cli/` | CLI host — launcher, non-interactive entry, TUI client | Whether CLI behavior stays aligned with protocol semantics and does not grow its own backend logic |
| `packages/web/` | Bun server + React client | Whether server/client responsibilities stay clear and frontend protocol behavior remains coherent |
| `apps/desktop/` | Tauri host around bundled web + Bun sidecar | Whether desktop remains a wrapper over shared behavior rather than a parallel backend path |
| `packages/debug-viewer/` | Standalone session/debug inspection tool | Lower priority, but inspect intentional independence and any costs of duplicated contracts |
| `packages/e2e/` | Integration tests over the agent stack and protocol flows | What critical behaviors are covered, and what transport-specific behavior is not covered |

**The history (how the system is moving):**
- `git log --oneline -30` — recent activity shape
- `git log --stat -10` — churn by file and subsystem
- `git diff --stat` — uncommitted drift or in-flight architectural work
- `git log --diff-filter=D --name-only --pretty=format:"%h %s"` — deleted files as signals of cleanup, churn, or throwaway work

## Repo-Specific Ground Rules

Use these rules so your review matches this repository's actual architecture instead of a generic monorepo checklist.

### 1. Use the current architecture language

Anchor your review in `ARCHITECTURE.md` as it exists now. Do not rely on older "fully implemented layer stack" framing if the repo currently documents its architecture through package boundaries and runtime/frontend roles.

### 2. Distinguish intentional exceptions from accidental duplication

The default expectation is shared ownership through `protocol → core → runtime → cli/web/desktop`. However, not every duplicated type is automatically a bug.

Examples to evaluate carefully:
- `packages/plugin-sdk/` may intentionally expose plugin-facing shapes that are not identical to internal runtime/core types
- `packages/debug-viewer/` may intentionally duplicate selected contracts to remain standalone

Your task is to determine whether a duplication is:
- an intentional, documented boundary decision
- an acceptable local adapter
- or a dangerous sync point with no clear owner

### 3. Treat package-specific caveats as package-specific

Some risks are not global review axes; they are package-local rules. Examples:
- web client/server separation is a `packages/web/` concern
- desktop sidecar lifecycle is an `apps/desktop/` concern
- e2e transport limitations are a `packages/e2e/` interpretation concern

Do not over-promote these into universal architectural laws unless the repository does.

### 4. Respect the real contract surfaces

This repo has more than one important contract surface:
- internal shared protocol and runtime contracts
- external plugin-facing contract in `packages/plugin-sdk/`
- documented intentional exceptions in decisions and package-local conventions

If you find tension between these surfaces, report it explicitly.

## Assessment Framework

Evaluate along four axes. Each axis maps directly to whether sustained development gets easier or harder over time.

### Axis 1: Structural Integrity

*"Are new changes still landing in the right place?"*

Assess whether the architecture described in docs still matches the actual package boundaries, ownership, and extension points in code.

**Check for:**
- **Stale decisions**: decisions whose guidance no longer matches the code
- **Decision gaps**: major architectural changes in recent history with no corresponding decision or plan update
- **Deferred decision blockers**: previously deferred decisions that now block active work
- **Boundary erosion**: code that forces UI, runtime, protocol, or plugin concerns to know too much about each other
- **Interface instability**: extension points that look reusable today but will obviously need breaking changes soon
- **Type quality**: overly broad unions, excessive optionals, local enum/schema forks, unsafe casts, or ownership ambiguity
- **Growth attractors**: large orchestrator files or reducers/stores that are absorbing too much unrelated behavior

### Axis 2: Development Velocity Trajectory

*"Is the delivery loop getting healthier or more expensive?"*

You are not measuring speed. You are measuring whether the shape of recent work predicts smoother future delivery or mounting friction.

**Analyze git history using explicit definitions:**
- **Rework ratio**: classify commits as feature, fix, refactor/rework, docs/chore, or test. Rework means primarily renaming, moving, extracting, consolidating, or reshaping existing code without being mainly about a new capability.
- **Commit granularity**: do not use line count alone. Large commits are acceptable if they stay within one coherent purpose. Flag commits that mix multiple unrelated concerns or span too many subsystems at once.
- **Throwaway work**: distinguish between healthy cleanup, feature replacement, and true waste. File deletion is not automatically bad.
- **Planning-to-implementation ratio**: treat this as a directional heuristic, not a KPI. Compare planning/review/doc churn against code delivery, especially if the repo seems stuck discussing rather than landing.

### Axis 3: Cross-Package Coherence

*"Do the packages still compose as one system?"*

The main risk in a fast-moving monorepo is not local mess. It is packages drifting into incompatible interpretations of the same domain.

**Check for:**
- **Type flow**: whether shared types still have a clear owner and downstream consumers import rather than redefine them
- **Protocol parity**: whether the same RPC methods, notification semantics, session lifecycle rules, and auth/config flows mean the same thing across clients
- **Transport interpretation**: whether CLI, web, and desktop preserve protocol semantics even if their UX and bootstrap paths differ
- **Registry discipline**: whether new providers, tools, or plugins enter through bounded registries rather than manual sync across many files
- **Shared vs duplicated logic**: config parsing, model/provider resolution, event adaptation, approval flows, persistence translation, render payload assembly
- **Workspace dependency chain**: whether package relationships in root config still match the actual intended layering

### Axis 4: Forward Compatibility

*"What will break first when the next capability arrives?"*

Look for today's hidden assumptions that become tomorrow's migration tax.

**Evaluate:**
- **Decided-but-unimplemented features**: decisions already made but not yet encoded in protocol/session/runtime shape
- **Extension point sufficiency**: whether plugin/tool/provider/session interfaces can absorb the next likely capability without breaking changes
- **State scope assumptions**: in-memory, single-process, single-session, single-thread assumptions that future features will violate
- **Hardcoded values**: magic strings, static method lists, fixed version assumptions, env-driven coupling
- **Test foundation**: whether the tests support refactoring or discourage it by overfitting implementation details

## Package-Specific Review Notes

Use these when you inspect the corresponding package. They are local heuristics, not global laws.

### `packages/plugin-sdk/`
- Check whether plugin-facing types are stable enough for external authors
- Check whether gaps in approval, rendering, or lifecycle affordances force each plugin to invent its own conventions

### `packages/runtime/`
- Watch for app-server/session-manager growth turning orchestration files into bottlenecks
- Prefer findings that identify missing extraction boundaries or mislocated responsibilities, not raw file size alone

### `packages/cli/`
- Review both launcher behavior and TUI behavior
- Check whether non-interactive flow, stdio protocol handling, and TUI state management still align with shared backend semantics

### `packages/web/`
- Evaluate server/client responsibility split and frontend protocol behavior
- Review initialize/bootstrap/draft/hydration/notification routing semantics, not just component cleanliness

### `apps/desktop/`
- Check sidecar startup, shutdown, packaging, and connection contracts
- Flag any sign that desktop is growing a separate backend path instead of wrapping shared runtime behavior

### `packages/debug-viewer/`
- Treat as standalone tooling, not as a first-class protocol client that must mirror CLI/web exactly
- Evaluate whether its independence is still worth the maintenance cost of any duplicated data shapes

### `packages/e2e/`
- Use it to reason about protocol/runtime coverage
- Do not assume it fully proves stdio/WebSocket/Tauri adapter correctness unless the tests explicitly cover those paths

## Output

**Write the assessment to a file.** Determine the current HEAD commit hash (`git rev-parse --short HEAD`) and write the review to:

```
docs/review/{YYYY-MM-DD}-{short-hash}.md
```

If a file with today's date already exists, overwrite it. Do not only print the assessment to stdout. The review must exist on disk.

After writing the review, **register the actionable findings as GitHub Issues** using the `gh` CLI. GitHub Issues are the execution queue for follow-up work; the review document is the analysis artifact.

## GitHub Issue Registration

Create or update GitHub Issues for actionable items so follow-up work can be executed independently from the review document.

### Source of truth for issues

- Use `## Priority Actions` as the primary source for issue creation.
- If a critical unresolved structural risk is not represented in `## Priority Actions`, add a corresponding action first and then create the issue from that action.
- Do not create issues for resolved items, purely informational observations, or bookkeeping-only work.

### De-duplication before creation

Before creating an issue, search existing open issues with `gh issue list` and `gh issue view` as needed.

- Reuse an existing open issue when it already covers the same structural problem and intended action.
- Create a new issue only when no equivalent open issue exists.
- If a previous issue exists but is closed and the problem is still current, open a new issue and reference the closed issue for context.

### Issue shape

Create one GitHub Issue per independently executable action. Prefer focused issues over umbrella issues.

Each issue should include:
- a concise action-oriented title
- the review file path
- the reviewed commit range
- why this matters for sustainable development velocity
- concrete target files, packages, or decisions when known

Use labels when possible:
- `tech-lead`
- one priority/severity label if the repository already has a clear convention; otherwise create only `tech-lead`

At the end of the review, include a short `## GitHub Issues` section listing each mapped action with its corresponding issue number or noting that an existing issue was reused.

### Format

```markdown
# Tech Lead Review — YYYY-MM-DD (short-hash)

**Scope**: Full project review | Scoped review: [target]
**Commit range**: [previous reviewed commit] → [current short hash] ([N] commits since last review)
**Previous reviews**: [list the 3 most recent review filenames]

## Sustainability Verdict

[One sentence verdict: GREEN / YELLOW / RED]
[2-3 sentences explaining the verdict in terms of sustainable velocity, not generic quality]

## Previous Review Delta

For the major actions/findings in the most recent prior review, summarize what changed:
- **Resolved**
- **Partially addressed**
- **Same**
- **No longer relevant due to decomposition/simplification**

If a previous concern was structurally eliminated, say so explicitly and keep it out of Persistent Issues.

## Structural Integrity

### [Finding]
**Impact**: Blocks upcoming work / Compounds over time / Cosmetic / Positive
[Evidence: specific files, line numbers, commit hashes, decision IDs]
[Why this matters for sustained development]

## Velocity Trajectory

### [Finding]
**Trend**: Improving / Flat / Degrading
[Evidence from git history with concrete classification or churn data]
[What this predicts about future delivery cost]

## Cross-Package Coherence

### [Finding]
**Scope**: [packages affected]
[Evidence: duplicated types, diverging protocol semantics, registry spread, import chain analysis]
[Why this will or will not compound]

## Forward Compatibility

### [Finding]
**Horizon**: Breaks when [specific next capability or scale increase]
[Evidence: specific interface, assumption, decision, or hardcoded path]
[What the cheaper fix looks like now vs. later]

## Novel Perspective

Find at least one perspective that has not already been explicitly raised in previous reviews, decisions, backlog items, or code comments.

Repackaging an existing concern does not count. The perspective must stand on its own and reveal something structurally invisible so far.

### [Perspective name]
- **Why no one has seen this**: [structural reason this angle stayed invisible]
- **Evidence**: [specific files, lines, commits, patterns]
- **Implication**: [what the project should do differently if this is true]

---

## Persistent Issues

Use the 3 most recent previous assessments only as historical context. Include only issues that:
- appeared in 2 or more reviews
- remain unresolved now
- still represent an active risk

Do not keep resolved items here just to preserve bookkeeping continuity.

### [Issue name]
- **First raised**: [date and review file]
- **Appearances**: [review dates or filenames]
- **Status trajectory**: Getting worse / Same / Partially addressed
- **Current evidence**: [specific files, line numbers]
- **Why it persists**: [credible hypothesis]

## Priority Actions

Group actions by dependency. Actions inside one group should be parallelizable. Groups execute in order.

Priority Actions must be real implementation or decision-update work. Do not add bookkeeping-only tasks such as "close tracking" or "mark complete".

### Group 1 (parallel)
1. [Action A] — [specific file path, decision ref]
2. [Action B] — [specific file path, decision ref]

### Group 2 (parallel, after Group 1)
3. [Action C] — [specific file path, decision ref]
4. [Action D] — [specific file path, decision ref]
```

## Principles

- **Sustainability over correctness.** Favor recommendations that keep the system evolvable.
- **Evidence always.** Every finding needs concrete file paths, line numbers, commits, or decision IDs.
- **Respect decisions, but verify they still match reality.** Recommend updates to decisions rather than silently ignoring them.
- **Optimize for a solo developer + AI-assisted workflow.** Recommendations must fit focused sessions, not imaginary committee process.
- **Prioritize compounding risks.** Small sync points that repeat are more dangerous than one large isolated file.
- **Prefer architectural docs over inline comments for durable guidance.** When documentation is needed, explicitly consider updating `docs/*` or `ARCHITECTURE.md` first instead of adding code comments.
- **Call out resolved-by-decomposition outcomes.** If a prior risk was structurally removed, record that clearly instead of keeping it alive as a stale issue.
- **Earn the Novel Perspective section.** If every finding could have been predicted from the prior review, the review did not go deep enough.
