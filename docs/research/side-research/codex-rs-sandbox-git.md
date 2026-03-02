# codex-rs Sandbox & Git Integration

Research from reverse-engineering the codex-rs reference codebase.

---

## 1. Sandbox Architecture

### Overview

Policy-based isolation with platform-specific implementations:

```
SandboxPolicy (what to allow)
    ↓
SandboxManager.select_initial()  — choose sandbox type
    ↓
SandboxManager.transform()       — wrap command with sandbox
    ↓
Platform-specific execution
```

### SandboxPolicy variants

```rust
DangerFullAccess              // no sandbox
ExternalSandbox               // delegate to external system
ReadOnly { network_access }   // read-only filesystem
WorkspaceWrite {
    writable_roots,           // explicit write-allowed paths
    read_only_access,
    network_access,
}
```

### Platform implementations

| Platform | Mechanism | Key detail |
|----------|-----------|------------|
| Linux | Bubblewrap (`bwrap`) | PID + network namespace, seccomp |
| macOS | Seatbelt (`sandbox-exec`) | SBPL deny-by-default policy |
| Windows | Restricted Token + ACL | deny write ACE |

**Linux bwrap command shape:**
```bash
bwrap --ro-bind / /                   # root read-only
      --bind <writable> <writable>    # explicit write roots
      --ro-bind .git .git             # re-protect .git
      --unshare-net                   # network isolation
      --unshare-pid                   # PID isolation
```

**macOS Seatbelt** uses SBPL (Scheme-like policy language):
```scheme
(deny default)         ; deny everything by default
(allow file-read* ...)
(allow file-write* (subpath "/tmp/workspace"))
```

Wrapped via `/usr/bin/sandbox-exec -p "<policy>" <command>` — absolute path hardcoded to prevent PATH injection.

### Key files

- `core/src/sandboxing/mod.rs` — orchestration
- `core/src/seatbelt.rs` — macOS implementation + tests
- `linux-sandbox/src/bwrap.rs` — bubblewrap command generation
- `protocol/src/protocol.rs` — `SandboxPolicy`, `WritableRoot`
- `windows-sandbox-rs/src/` — Windows ACL implementation

---

## 2. Git Protection via Sandbox

### Default protected subpaths

Even within `writable_roots`, these are always read-only:

- `.git/` (directory) or `.git` (file, worktree pointer)
- Resolved `gitdir:` path (from `git worktree add` pointer files)
- `.codex/`
- `.agents/`

### Why git is protected

Prevents agent from:
- Injecting git hooks (`.git/hooks/pre-commit`)
- Modifying `.git/config`
- Tampering with the object database

### Git worktree handling

`.git` can be a file containing `gitdir: /path/to/actual/.git` (created by `git worktree add`). codex-rs detects and parses this, protecting **both** the pointer file and the resolved target path.

---

## 3. Git Integration (Beyond Sandbox)

### No libgit2 — all system `git` binary

All git operations use `tokio::process::Command` with a **5-second timeout**.

### Context provided to the model

Three layers collected at session start:

```bash
git rev-parse HEAD               → commit hash
git rev-parse --abbrev-ref HEAD  → branch name
git remote get-url origin        → repo URL
git status --porcelain           → dirty state check
git diff <closest-remote-sha>    → full diff to remote
```

"Closest remote SHA" = walk branch ancestry to find nearest remote ref, then diff from there. Untracked files also included via `git diff --no-index /dev/null <file>`.

### apply_patch tool

Primary mechanism for agent to modify files — unified diff applied via:

```bash
git apply --3way <patch>
```

- Falls back to direct apply if 3-way fails
- 40+ regex patterns to parse all git apply output edge cases
- Dry-run support via `--check`

### Repo root detection

Lightweight: walks up directory tree looking for `.git` (file or directory). Does not require `git` binary. Handles worktrees transparently via `git rev-parse --git-common-dir`.

---

## 4. Ghost Commits

### Purpose: Undo checkpoints only

Ghost commits are **not** used for turn-to-turn diff tracking. They are exclusively for rollback.

### Mechanism

Uses a **temporary git index** to create an orphan commit with no branch ref:

```bash
# 1. Populate temp index from HEAD
GIT_INDEX_FILE=/tmp/codex-temp-index git read-tree HEAD

# 2. Stage working tree changes into temp index
GIT_INDEX_FILE=/tmp/codex-temp-index git add --all

# 3. Write temp index as tree object
GIT_INDEX_FILE=/tmp/codex-temp-index git write-tree
# → returns tree SHA

# 4. Create commit object with no branch
git commit-tree <tree> -p HEAD -m "codex snapshot"
# → returns orphan commit SHA
```

Result:
- Main `.git/index` untouched → `git status` shows nothing staged
- No branch points to commit → `git log` shows nothing
- Commit object exists in `.git/objects/` (reachable only by SHA)

```
main → A → B → C (HEAD)
                │
                └── ghost (orphan, invisible)
```

### Lifecycle

```
Turn start
  → background task: create_ghost_commit_with_report()
  → stored as ResponseItem::GhostSnapshot { ghost_commit } in history

User invokes Undo
  → find last GhostSnapshot in history (reverse scan)
  → git reset --hard <ghost SHA>
  → remove GhostSnapshot from history
```

### Exclusions

Large files/directories skipped by default:
- Files over 10 MiB
- Directories over 200 files
- Hardcoded: `node_modules`, `.venv`, `dist`, `build`, etc.

### Key files

- `utils/git/src/ghost_commits.rs` — implementation
- `core/src/tasks/ghost_snapshot.rs` — background task wrapper
- `core/src/tasks/undo.rs` — restoration logic

---

## 5. TurnDiffTracker

### Purpose: Show user what changed this turn

Completely independent from ghost commits. Shows a unified diff at the end of each turn.

### Mechanism

In-memory baseline, no git involvement:

```
Before each apply_patch call:
  → snapshot current file contents in memory (baseline)

After turn ends:
  → compare current disk state vs baseline (similar crate)
  → emit unified diff as EventMsg::TurnDiff
```

### Why not just diff against the last ghost commit?

Likely reasons:
1. **Timing**: ghost commit runs async in background — may not be ready when first patch is applied
2. **Feature flag**: `Feature::GhostCommit` can be disabled; TurnDiffTracker must work independently
3. **Granularity**: baseline is snapshotted per-patch, not just at turn start

Design tradeoff: two separate systems for what could conceptually be one operation.

### Key files

- `core/src/turn_diff_tracker.rs` — implementation
- `core/src/tools/events.rs` — calls `on_patch_begin()` before each patch
- `core/src/codex.rs` — emits `TurnDiffEvent` after turn completes

---

## 6. Git Internals Reference

Key concepts used throughout codex-rs:

| Concept | Location | Role |
|---------|----------|------|
| Working Tree | filesystem | actual files |
| Index (staging) | `.git/index` | binary file, next commit contents |
| Object Store | `.git/objects/` | blobs, trees, commits (immutable) |
| Refs | `.git/refs/` | branch/tag = text file containing commit SHA |
| Orphan commit | `.git/objects/` | commit object with no ref pointing to it |

`GIT_INDEX_FILE` env var redirects all index operations to a different file — main index is completely unaffected.
