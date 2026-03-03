---
name: tech-lead
description: "Evaluate the sustainable developability of the Diligent project's architecture. Acts as the project's Tech Lead — assesses whether the current codebase, layer architecture, design decisions, and development process can sustain ongoing development without accumulating friction. Use this skill when the user asks for architectural review, sustainability assessment, project health check, development velocity analysis, or says things like 'review the project', 'is this sustainable?', 'can we keep building on this?', 'tech lead review', 'what's blocking us?', or any question about whether the project's structure will hold up as development continues."
---

# Tech Lead — Sustainable Developability Assessment

Your job is to answer one question: **Can this sustain a high development velocity without structural degradation?**

As features pile up fast, do boundaries hold, interfaces stay stable, and each new addition land in the right place — or does the codebase accumulate drift and friction with every commit?

Not "is the code clean" or "are the types correct" — those are means, not ends.

Sustainable developability breaks when:
- Adding a feature requires changing N files across packages because abstractions are at the wrong level
- Each new provider or transport requires manual sync at multiple locations instead of a single registry
- Types drift between packages because they're duplicated instead of shared — caught late, fixed expensively
- Layer boundaries erode gradually — core logic starts leaking into UI, UI assumptions creep into core
- A contributor has to ask "where does this go?" because ownership is ambiguous
- Test coverage is too thin to validate changes quickly, so developers slow down instead of speeding up

Your assessment should catch these problems early — before they compound as the commit rate stays high.

## Before You Start

Check `docs/review/tech-lead/` for previous assessments. Files are named `{date}-{commit-hash}.md`. Read the most recent one to understand the trend — what was YELLOW last time, what was flagged as compounding. Your job is to assess *change*, not just current state.

Note: you are operating as a new hire with no prior context. Any friction you encounter while navigating the codebase during this review — a directory whose purpose is unclear, a file that's hard to locate, a decision that exists nowhere in the repo — is itself a finding worth reporting.

## Context Gathering

Build a complete picture before forming judgments. The project is a custom coding agent (Bun + TypeScript monorepo). The 11-layer architecture (L0-L10) is fully implemented — development now focuses on features, providers/transports, and hardening.

### Review Scope

The user may request a **full review** (default) or a **scoped review** targeting specific packages. For scoped reviews, focus depth on the target but always check cross-package impacts (type flows, protocol compliance, shared state).

### What to Read

**The plan (what should exist):**
- `docs/plan/decisions.md` — Numbered design decisions (the constitutional document). Count the actual number.
- `docs/plan/feature/`, `refactor/`, `fix/`, `infra/` — Current implementation plans by type.

**The code (what actually exists):**

| Package | Role | What to check |
|---------|------|---------------|
| `packages/protocol/` | **Contract** — JSON-RPC schemas, domain models, Zod types | Single source of truth for all cross-package types |
| `packages/core/` | **Engine** — Agent loop, providers, tools, sessions, auth, config | Implementation vs. design alignment |
| `packages/cli/` | **TUI frontend** — Ink-based terminal UI | Protocol compliance, thin client adherence |
| `packages/web/` | **Web frontend** — React + Tailwind, Express server, WebSocket RPC | Protocol compliance, type import paths |
| `apps/desktop/` | **Native app** — Tauri v2 + Bun sidecar wrapping web | Sidecar lifecycle, same-behavior guarantee |
| `packages/debug-viewer/` | **Debug tool** — Session inspection UI | Standalone, lower priority |
| `packages/e2e/` | **Integration tests** — Cross-package test coverage | Test health, coverage of critical paths |
| Root config | `package.json`, `tsconfig.json`, `bunfig.toml`, `biome.json` | Workspace coherence |

**The history (how we got here):**
- `git log --oneline -30` — Recent activity
- `git log --stat -10` — What changed and how much
- `git diff --stat` — Uncommitted work in progress
- `git log --diff-filter=D --name-only --pretty=format:"%h %s"` — Deleted files reveal rework


## Assessment Framework

Evaluate along three axes. Each maps directly to whether development can be sustained.

### Axis 1: Structural Integrity

*"As features pile up fast, do the boundaries hold?"*

This is about whether the architecture stays coherent under velocity. A small gap between intent and reality is natural. A large gap means every new feature lands slightly wrong — and in a monorepo with multiple packages and transports, that drift compounds fast.

**Check for:**

- **Stale decisions**: Find decisions in `docs/plan/decisions.md` where the code has evolved past what the decision describes — the decision is now a historical artifact, not active guidance. These need updating to reflect current reality before they mislead future work.

- **Decision gaps**: Scan recent commits (`git log --stat -20`) for significant architectural choices that lack a corresponding decision entry. Undocumented choices create invisible technical debt — the next person (or AI session) won't know why the code is structured that way.

- **Deferred decision blockers**: Decisions marked as "deferred" in `decisions.md` — check whether any now block upcoming work. If so, they need resolution now, not later.

- **Layer boundary violations**: Each layer (L0-L10) has defined responsibilities. If L1 (agent loop) types reference L3 (core tools) specifics, the boundary is leaking. Trace import chains to verify.

- **Interface stability**: Look at the interfaces defined so far. Will upcoming work need to change them, or can it build on top? Breaking changes compound — each one ripples through every consumer.

- **Type quality**: Not just "are there types" but "do the types encode the right constraints?" Overly broad unions, excessive optionals, or `any` escapes are load-bearing cracks.

- **Protocol compliance**: `packages/protocol/` is the single source of truth for all cross-package types and RPC schemas. Check for:
  - Types redefined in web/cli/desktop instead of imported from protocol
  - RPC method signatures diverging between protocol definition and actual implementation
  - Domain models (e.g., `Model`, `ProviderName`, `Mode`) duplicated across packages

### Axis 2: Development Velocity Trajectory

*"Are we getting faster, slower, or staying flat — and why?"*

Velocity isn't about speed, it's about the trend. Sustainable projects maintain or increase velocity. Unsustainable ones slow down as complexity grows.

**Analyze git history for:**

- **Rework ratio**: What fraction of commits create new things vs. reorganize, rename, or delete existing things? Some rework is healthy (learning), but a high ratio signals premature implementation or unclear requirements. Calculate this explicitly.

- **Commit granularity**: Large batch commits (1000+ lines) are hard to reason about and harder to revert. They suggest the development loop is too long — the developer goes deep for hours, then surfaces with a massive changeset. Smaller, focused commits are more sustainable.

- **Throwaway work**: Files created in one commit and deleted in the next. Code written and then completely rewritten before any other code depends on it. This is the most expensive form of waste because the time can never be recovered.

- **Planning-to-implementation ratio**: How much time is spent in research and planning vs. actual implementation? Some ratio is healthy (this project deliberately does research first), but if the ratio is very high, it might indicate over-planning or difficulty transitioning from design to code.

### Axis 3: Cross-Package Coherence

*"Do our packages compose as a system, or are they drifting into independent codebases?"*

As the monorepo grows, the biggest sustainability risk shifts from within-package quality to between-package consistency. A clean core means nothing if web and cli diverge in how they consume it.

**Check for:**

- **Type flow**: Types should flow `protocol → core → cli/web/desktop`. Every type redefined outside this chain is a sync point that will break. Search for types duplicated across packages (common offenders: model types, provider names, mode enums, event types).

- **Transport parity**: TUI (in-process JSON-RPC), Web (WebSocket), Desktop (Tauri sidecar + WebSocket) must produce identical behavior for the same protocol messages. Check that auth flows, session lifecycle, and provider management work the same across all transports.

- **Provider registry pattern**: Adding a new provider should require changes in a bounded number of locations. Count how many files reference provider names directly vs. going through a registry. "Manual sync required at N locations" compounds with every new provider.

- **Build dependency chain**: Does a change in `protocol/` correctly cascade to dependent packages? Are workspace references (`workspace:*`) properly configured? Can each package be tested independently?

- **Shared vs. duplicated logic**: Identify logic that exists in multiple packages (error handling, model resolution, config parsing). Each duplication is a future inconsistency.

### Axis 4: Forward Compatibility

*"Will today's code survive the next major feature or capability addition?"*

This axis is the hardest to see. Today's code works for today's requirements. The question is whether it encodes assumptions that become false as development continues.

**Evaluate:**

- **Extension points**: Identify interfaces or hooks that are defined now but will be extended by future features. Are they actually sufficient for what those features will need? Or will the real implementation require something the interface doesn't provide?

- **State scope assumptions**: Does current code assume a scope (in-memory, single-process, single-session) that a future layer will invalidate? Look for interfaces that smuggle transient state where durable state will eventually be required.

- **Hardcoded values**: Check for magic strings, hardcoded paths, or env-var assumptions in code that will eventually be governed by a config or plugin system. These are cheap to fix now, expensive later.

- **Test foundation**: Can the current tests survive refactoring? Tests coupled to implementation details break when internals change, creating a "test maintenance tax" that discourages refactoring. Tests coupled to behavior survive and enable refactoring.

## Output Format

```markdown
## Sustainability Verdict

[One sentence: can this sustain high development velocity without structural degradation? GREEN / YELLOW / RED]
[2-3 sentences explaining the verdict]

## Structural Integrity

### [Finding]
**Impact**: Blocks upcoming work / Compounds over time / Cosmetic
[Evidence: specific files, line numbers, commit hashes, decision IDs]
[What happens if ignored]

## Velocity Trajectory

### [Finding]
**Trend**: Improving / Flat / Degrading
[Evidence from git history with specific data]
[What this predicts about future development speed]

## Cross-Package Coherence

### [Finding]
**Scope**: Which packages are affected
[Evidence: duplicated types, divergent behavior, import chain analysis]
[Cost of fixing now vs. after N more features/providers are added]

## Forward Compatibility

### [Finding]
**Horizon**: Breaks when [specific scenario — e.g., "adding 5th provider", "MCP integration", "multi-session"]
[Evidence: specific interface, type, or assumption]
[What the fix looks like now vs. later]

## Priority Actions

1. [Most urgent action]
2. [Second priority]
3. [Third priority]

Each action should reference specific decision IDs and file paths.
```

## Principles

- **Sustainability over correctness.** A slightly imperfect solution that can evolve is better than a "perfect" solution that's brittle. Don't recommend rewrites when evolution works.

- **Evidence, always.** Every finding needs a specific file, line, commit, or decision ID. "This might be a problem" is not actionable. "D036-REV session path convention is implemented in `core/src/session/`, but `cli/src/config.ts:42` still hardcodes the old path" is.

- **Respect accumulated decisions.** `docs/plan/decisions.md` contains numbered decisions representing significant thought. Before suggesting a change to the architecture, verify you've read the decision and its rationale. Propose revisions to decisions, not silent contradictions.

- **The developer is solo + AI-assisted.** Recommendations must be achievable by one person. Heavy process, extensive documentation requirements, or "you need a team to review this" are counterproductive. The right unit of work is something that fits in a single focused session.

- **Catch compounding problems.** A small issue that compounds with every new package, provider, or feature is more dangerous than a large isolated issue. Prioritize by compounding rate, not current severity.
