# 06 — Subagent worktree isolation

Status: proposal · Depends on: none · Integrates with: 05 (writable roots), 03 (MCP roots), 02 (process cleanup)

## Problem

Every collab child runs in the parent's working directory. Two children that edit the same files race. A child's
half-finished edits land straight in the user's tree. Nothing separates "work a child produced" from "work the parent
produced", so the parent cannot review or discard a child's changes as a unit.

## Current state

| Fact | Evidence |
|---|---|
| Child system prompt hard-codes the parent cwd | `packages/runtime/src/collab/registry.ts:332-335` |
| Child `SessionManager` and child tools are built with `this.deps.cwd`; Stop hooks report the same cwd | `registry.ts:375-376, 386, 421-423` |
| Agent definitions (AGENT.md frontmatter) carry `name`, `description`, `tools`, `model_class` — no isolation field | `packages/runtime/src/agents/discovery.ts:130-135` |
| `collab/spawn/end` carries thread/agent identity but no workspace information | `packages/protocol/src/server-notifications.ts:258-272` |
| `.diligent/.gitignore` is generated with `sessions/ knowledge/ images/ logs/` | `infrastructure/diligent-dir.ts:39-45` |

## Reference survey

- **jcode** `crates/jcode-sdk/src/worktrees.rs:1-63`: lists via `git worktree list --porcelain -z`; creates a new
  branch from the invoking worktree's HEAD; never copies staged/unstaged/untracked changes; never reuses existing
  paths or branches.
- **hermes-agent** `tools/subagent_worktree.py`: opt-in; `<repo>/.worktrees/subagent-<id>`, branch
  `hermes-subagent/<id>`; silently downgrades outside git; on finish, zero commits **and** clean → removed, otherwise
  archived to a ref and the branch kept for the parent to merge; failed probes keep the worktree and flag it. Runs git
  with a non-interactive, hook-neutralized environment because `worktree add` runs repository hooks and filters.

## Design

### Activation

```ts
spawn_agent { …, isolation?: "shared" | "worktree" }   // NEW, optional
```

Precedence: explicit `isolation` param → AGENT.md frontmatter `isolation:` → config `agents.isolation` → `"shared"`.
`"shared"` is today's behavior; nothing changes unless asked.

Preconditions for `"worktree"`: the cwd is inside a git work tree whose HEAD resolves to a commit. Failure handling
depends on who asked: an explicit param fails the spawn with the reason (the model asked for something it cannot
get); a frontmatter/config default downgrades to `"shared"` and states the downgrade in the spawn result.

### Baseline

```ts
spawn_agent { …, baseline?: "head" | "working-tree" }  // default "working-tree"
```

- `head`: branch from `HEAD` (jcode/hermes behavior).
- `working-tree` (default): `git stash create` produces a commit of the parent's tracked, uncommitted changes without
  touching the parent's index or working tree; the worktree is created from that commit (or from `HEAD` when it
  prints nothing). Untracked files are not included, and the child's context note says so.

`working-tree` is the default because a parent usually delegates in the middle of its own edits; a child that cannot
see them works against stale code.

### Layout and naming

- Path: `<repoRoot>/.diligent/worktrees/<nickname>-<8 hex>`. `worktrees/` is added to the generated
  `.diligent/.gitignore` template, so `rg`-based `grep`/`glob` in the parent skip it. The template is written only
  when the file is absent (`diligent-dir.ts:71-75`), so worktree creation also appends a `worktrees/` line to an
  existing `.diligent/.gitignore` that lacks it.
- Branch: `diligent/agent/<nickname>-<8 hex>`. Never reused; a collision is regenerated.
- All git invocations use `-c core.hooksPath=<empty temp dir>` and `GIT_TERMINAL_PROMPT=0`, so repository hooks do not
  run unattended during `worktree add`/`status`. Worktree operations are serialized per repository with an in-process
  mutex (concurrent `worktree add` contends on `.git` locks).

### Child runtime

- `cwd` for the child `SessionManager`, tools, system prompt `runtime_context`, Stop hooks, and the child's MCP roots =
  the worktree path. `paths` (sessions/knowledge) stay the parent's, so child sessions are stored where they are today.
- An `isolation` system section tells the child: its worktree path and branch; that the parent's untracked files are
  absent; to commit its work on its branch; not to `cd` to the parent checkout.
- Child session header gains `worktree?: { path, branch, baseCommit }` (a header field, not a storage layout change).
- With a sandbox active (doc 05), the child's writable root is its worktree, not the parent cwd.

### Finalization

Runs when the child reaches a final status (completed, errored, closed via `close_agent`):

1. Kill the child's background processes (doc 02).
2. If the worktree is dirty: `git add -A && git commit -m "diligent: uncommitted work from <nickname>"` on the child
   branch (hooks disabled as above). Nothing a child produced is lost or left dangling in a directory.
3. Count commits `baseCommit..HEAD`.
4. Remove the worktree directory (`git worktree remove --force`).
5. Zero commits → delete the branch. Otherwise keep it.
6. Any failed git probe → keep the directory, keep the branch, report `inspectionFailed` (hermes fail-safe rule).

The `wait` tool result and `collab/spawn/end`/`collab/close/end` notifications gain:

```ts
worktree?: { branch: string; baseCommit: string; commits: number; kept: boolean; inspectionFailed?: boolean }
```

Merging is the parent's job with ordinary git through `bash` (`git merge`, `git cherry-pick`, `git diff
<base>..<branch>`). Phase 1 deliberately adds no merge tool: conflict resolution needs the model's judgment, and the
parent already has the tools.

### Resume

Resuming a finalized child (`spawn_agent` with a resume ID) re-creates a worktree from the kept branch. A child with
zero commits (branch deleted) resumes from the original `baseCommit`.

### Crash recovery

On server start, `git worktree prune`, then list `.diligent/worktrees/*` that no live agent owns. They are reported
through a log warning and left in place: deleting a worktree the runtime did not finalize could destroy work.

## Risks

- **Disk and time cost** of a checkout per child on large repos. Mitigated by opt-in; `git worktree add` shares the
  object store, so cost is the checkout itself.
- **Build artifacts and dependencies** (`node_modules`) are absent in a fresh worktree; children that need to build
  must install. Documented; a later `setupCommand` in AGENT.md frontmatter can automate it.
- **Submodules** are not initialized by `worktree add`; same mitigation.

## Tests

- `packages/runtime/test/collab/worktree.test.ts` (temp git repo fixture): `working-tree` baseline contains the
  parent's uncommitted tracked change and not its untracked file; finalization commits dirty work and keeps the
  branch; zero-commit child removes branch and directory; repo hook that writes a marker file never runs.
- `packages/e2e/app-server/collab-worktree.test.ts`: spawn with isolation → `collab/spawn/end` and `wait` carry the
  worktree payload; parent cwd file untouched by the child's write.
