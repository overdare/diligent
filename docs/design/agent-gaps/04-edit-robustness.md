# 04 — Edit robustness: tolerant matching, stale-write guard, read tracking, anchored edits

Status: proposal · Depends on: none · Integrates with: 09 (post-edit diagnostics), 07 (concurrency)

## Problem

`edit`/`multi_edit` fail on any whitespace, line-ending, or typographic-punctuation difference, and they can silently
overwrite changes made to the file while an approval prompt was open. Nothing stops the model from editing a file it
never read, or editing from a stale view.

## Current state

| Fact | Evidence |
|---|---|
| `edit` matches `old_string` with `indexOf` only; 0 matches → `old_string not found`; >1 → not unique | `packages/runtime/src/tools/edit.ts:62-103` |
| Description states the tool "does not track prior read calls" | `edit.ts:115` |
| Content is read (`:182`), then approval is awaited (`:201-214`), then the precomputed result is written (`:217`) — an external change during the approval wait is overwritten | `edit.ts:180-217` |
| `apply_patch` already has codex-style tolerant matching: exact → trimEnd → trim → Unicode-punctuation-normalized, with a retry from file start | `tools/apply-patch.ts:477-490, 529-575` |
| No CRLF handling in `edit`: an LF `old_string` never matches a CRLF file | `edit.ts:78-103` (no newline normalization) |
| The runtime has an experiment mechanism that can gate tool names | `packages/runtime/src/experiments/index.ts:3-40` |

So the gap is narrower than "exact match or patch only": `apply_patch` is already tolerant; `edit` is not, and
neither tool guards against stale writes.

## Reference survey

- **codex** `apply-patch/src/seek_sequence.rs:12-76`: four matching passes (exact, `trim_end`, `trim`, normalized
  punctuation); first match wins.
- **oh-my-pi** hashline mode is the default edit mode (`edit/settings.ts:21,47`): `read` output carries a 4-hex
  snapshot tag per file, edits address original line numbers under that tag, a mismatched tag is refused, and only
  lines visible in the latest read may be edited (`edit/hashline-compact.md:1-24`). After an edit it warns when the
  file no longer parses (`edit/index.ts:614`).

## Design

Four layers, independently shippable, in order of risk.

### L1 — Tolerant matching for `edit`/`multi_edit`

Extract `seekSequence`/`tryMatch`/`normalizeUnicode` from `apply-patch.ts` into `tools/text-match.ts` and use it in
both tools (one implementation, no second convention).

`applyEdit` algorithm:

1. Detect the file's dominant EOL; normalize `content`, `old_string`, `new_string` to LF.
2. Exact `indexOf` (current behavior, current error messages).
3. On 0 exact matches, split into lines and run the line passes (trimEnd → trim → normalized). Accept only if the
   chosen pass finds **exactly one** location; multiple fuzzy hits are an error listing their line numbers.
4. Replace the matched line range with `new_string` lines. When the match came from the `trim` pass and every
   `new_string` line shares the same indentation delta as `old_string` vs. the file, re-indent `new_string` by that
   delta; otherwise insert verbatim.
5. Restore the original EOL style; preserve a trailing newline if the file had one.
6. Output states the pass used: `Edited … (matched ignoring trailing whitespace)` so the model learns.

`replace_all` stays exact-only (fuzzy global replacement is too risky).

### L2 — Stale-write guard (all writing tools)

After approval resolves and immediately before writing, re-read the file:

- unchanged → write the precomputed result;
- changed → recompute the edit on the fresh content; if it still applies uniquely, write that and say so; otherwise
  fail with `file changed while waiting for approval; re-read it`.

The same check applies to `write` (existing file) and `apply_patch` update hunks. Writes use write-to-temp + rename
on the same directory to avoid torn files on crash; Windows uses the same rename with retry on `EPERM`
(antivirus/indexer locks).

### L3 — Read tracking

A per-agent `FileViewTracker` (owned with `CodeModeSession`, survives the per-turn agent rebuild):

```ts
interface FileView { mtimeMs: number; size: number; sha1: string; ranges: Array<[start: number, end: number]> }
// key: realpath
```

- `read` records the returned line range and the content hash; `grep` with line numbers records matched lines.
- `edit`/`multi_edit`/`write`/`apply_patch` on an **existing** file check the tracker:
  - never read → `enforce`: error `read <path> before editing it`; `warn`: proceed and append a warning;
  - read but the file's `mtime`/`size` changed since → error `<path> changed since you last read it`.
- A successful write by the agent updates the view (the agent "knows" what it wrote).
- Config: `tools.edit.requireRead: "off" | "warn" | "enforce"`, default `warn` for one release, then `enforce` after
  measuring the failure rate in evals.
- Children have their own tracker; a parent's read does not license a child's edit.
- After resume or compaction the tracker is empty, so the first edit of a file requires a fresh read. This is
  intended: the model's view is no longer guaranteed to be in context.

### L4 — Anchored ("hashline") edits, experimental

Behind an experiment (`edit-anchored`), registered through the existing experiment definitions so it can be enabled
per user and evaluated before any default change.

- `read` output, when enabled, starts with `[<abs path>#<TAG>]` where `TAG` = first 4 hex chars of SHA-1 of the file
  content. Line numbers keep the current format.
- New tool `anchored_edit`, structured JSON (validated by zod and renderable), not a text DSL:

```ts
anchored_edit {
  file_path: string;
  tag: string;                               // must equal the current file's tag
  ops: Array<
    | { op: "replace"; start: number; end: number; lines: string[] }
    | { op: "insert_after"; line: number; lines: string[] }  // 0 = top of file
    | { op: "delete"; start: number; end: number }
  >;                                         // line numbers refer to the tagged snapshot; non-overlapping
}
```

- Refusals: tag mismatch (stale view); any op touching a line outside the ranges recorded by L3 for that tag ("unseen
  line"); overlapping ops. Each refusal names the exact reason and the lines involved.
- Ops are applied bottom-up so original numbering stays valid; the result reports the new tag.

## Risks

- **Fuzzy false positives** (L1): limited to unique matches and reported explicitly; `replace_all` excluded.
- **Friction** (L3): `enforce` can cost an extra `read` per file; mitigated by `grep` ranges counting as views and a
  `warn` rollout.
- **Model unfamiliarity** (L4): experiment-only until evals (`packages/evals`) show equal or better success rates on
  the edit suite.

## Tests

- `packages/runtime/test/tools/text-match.test.ts`: pass ordering; uniqueness across passes; CRLF round-trip.
- `packages/runtime/test/tools/edit.test.ts`: approval spy that modifies the file before resolving → recompute or
  fail as specified; CRLF file edited with LF `old_string` keeps CRLF.
- `packages/runtime/test/tools/file-view-tracker.test.ts`: never-read / changed-since-read / own-write cases.
- `packages/evals`: edit-success suite run with L4 on and off.
