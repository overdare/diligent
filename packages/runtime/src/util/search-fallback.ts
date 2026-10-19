// @summary In-process grep/glob fallback used when no ripgrep binary can be resolved
import type { Dirent, Stats } from "node:fs";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";

/**
 * In-process replacement for the ripgrep invocations made by the `grep` and
 * `glob` tools. It is only used when `resolveRgBinary()` finds no `rg`
 * (no `DILIGENT_RG_PATH`, no bundled `assets/bin/rg`, nothing on `PATH`), e.g.
 * a dev sidecar started with `bun run` on a host without ripgrep.
 *
 * Output mirrors what the tools receive from ripgrep:
 * - glob: absolute file paths (`<searchPath>/<relative path>`), like `rg --files`.
 * - grep: `path:line:text` for matches, `path-line-text` for context lines,
 *   `--` between non-contiguous context groups (including groups in different
 *   files), and no path prefix when `searchPath` is a single file, like
 *   `rg -n [-C N]`.
 *
 * Known limits compared with ripgrep:
 * - Patterns use JavaScript `RegExp` syntax, not the Rust `regex` crate. Most
 *   common syntax is shared; leading inline flags `(?i)`, `(?m)`, `(?s)` are
 *   translated, other Rust-only syntax (e.g. `(?x)`, `\z`, Unicode classes
 *   without the `u` flag) may fail or behave differently. `\w`/`\b` are ASCII-only.
 * - `.gitignore` support is simplified: only `.gitignore` files inside a git
 *   work tree (from the repository root down to each visited directory) are
 *   read; `.ignore`, `.rgignore`, `.git/info/exclude` and global excludes are not.
 * - `.git` is always skipped. `node_modules` is always skipped by grep and by
 *   glob unless the glob pattern mentions `node_modules`.
 * - Symlinks are not followed. Files containing a NUL byte or larger than
 *   `maxFileBytes` are skipped by grep.
 * - Glob patterns containing `/` are anchored to the search root; ripgrep
 *   given an absolute search root only matches them when they start with `**`.
 * - Work is bounded by `SEARCH_FALLBACK_LIMITS`; when a bound is hit the
 *   result is marked `truncated` and the overflow counts reported by the tools
 *   become lower bounds.
 */
export const SEARCH_FALLBACK_LIMITS = {
  /** Directory entries (files and directories) visited before the walk stops. */
  maxVisitedEntries: 100_000,
  /** Files whose contents grep reads before it stops. */
  maxScannedFiles: 20_000,
  /** Files larger than this are skipped by grep. */
  maxFileBytes: 8 * 1024 * 1024,
  /** Output lines grep collects before it stops. */
  maxOutputLines: 5_000,
} as const;

export interface SearchFallbackResult {
  /** Text shaped like ripgrep stdout. Empty when nothing matched. */
  stdout: string;
  /** Set when a work bound stopped the search early. */
  truncated: boolean;
}

export interface GlobFallbackOptions {
  signal?: AbortSignal;
}

export interface GrepFallbackOptions {
  include?: string;
  ignoreCase?: boolean;
  context?: number;
  signal?: AbortSignal;
}

/** Equivalent of `rg --files --no-ignore --hidden --glob <pattern> <searchPath>`. */
export async function globFilesFallback(
  searchPath: string,
  pattern: string,
  options: GlobFallbackOptions = {},
): Promise<SearchFallbackResult> {
  const filter = compileOverrideGlob(pattern);
  const prunedDirNames = pattern.includes("node_modules") ? GIT_ONLY : GIT_AND_NODE_MODULES;
  const walk = createWalk(searchPath, {
    includeHidden: true,
    respectGitignore: false,
    prunedDirNames,
    dirFilter: filter,
    signal: options.signal,
  });
  const files: string[] = [];
  for await (const file of walk.files()) {
    if (file.explicit || filter.matchesFile(file.relPath)) files.push(file.absPath);
  }
  return { stdout: files.join("\n"), truncated: walk.truncated };
}

/** Equivalent of `rg -n [--ignore-case] [--glob <include>] [-C <context>] <pattern> <searchPath>`. */
export async function grepFallback(
  searchPath: string,
  pattern: string,
  options: GrepFallbackOptions = {},
): Promise<SearchFallbackResult> {
  const regex = compileSearchRegex(pattern, options.ignoreCase ?? false);
  const filter = options.include ? compileOverrideGlob(options.include) : undefined;
  const context = options.context ?? 0;
  const walk = createWalk(searchPath, {
    includeHidden: false,
    respectGitignore: true,
    prunedDirNames: GIT_AND_NODE_MODULES,
    dirFilter: filter,
    signal: options.signal,
  });

  const out: string[] = [];
  let scannedFiles = 0;
  let truncated = false;
  for await (const file of walk.files()) {
    if (!file.explicit && filter && !filter.matchesFile(file.relPath)) continue;
    if (scannedFiles >= SEARCH_FALLBACK_LIMITS.maxScannedFiles || out.length >= SEARCH_FALLBACK_LIMITS.maxOutputLines) {
      truncated = true;
      break;
    }
    scannedFiles++;
    const lines = await readTextLines(file.absPath);
    if (!lines) continue;
    appendFileMatches(out, lines, regex, context, file.explicit ? "" : file.absPath);
  }
  if (out.length > SEARCH_FALLBACK_LIMITS.maxOutputLines) {
    out.length = SEARCH_FALLBACK_LIMITS.maxOutputLines;
    truncated = true;
  }
  return { stdout: out.join("\n"), truncated: truncated || walk.truncated };
}

/**
 * Translate a ripgrep (Rust regex) pattern into a per-line JavaScript RegExp.
 * Throws a SyntaxError for patterns JavaScript cannot parse.
 */
export function compileSearchRegex(pattern: string, ignoreCase: boolean): RegExp {
  let source = pattern;
  let flags = ignoreCase ? "i" : "";
  const inline = /^\(\?([ims]+)\)/.exec(source);
  if (inline) {
    source = source.slice(inline[0].length);
    // `m` and `s` only change behavior across line breaks; matching is per line.
    if (inline[1].includes("i") && !flags.includes("i")) flags += "i";
  }
  return new RegExp(source, flags);
}

function appendFileMatches(out: string[], lines: string[], regex: RegExp, context: number, path: string): void {
  const matchLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) matchLines.push(i);
  }
  if (matchLines.length === 0) return;

  const format = (index: number, separator: ":" | "-") =>
    path ? `${path}${separator}${index + 1}${separator}${lines[index]}` : `${index + 1}${separator}${lines[index]}`;

  if (context === 0) {
    for (const index of matchLines) out.push(format(index, ":"));
    return;
  }

  const isMatch = new Set(matchLines);
  let lastEmitted = -1;
  for (const index of matchLines) {
    const start = Math.max(0, index - context, lastEmitted + 1);
    const end = Math.min(lines.length - 1, index + context);
    // With context, rg also separates the first group of a file from the previous file's output.
    const separated = lastEmitted >= 0 ? start > lastEmitted + 1 : out.length > 0;
    if (separated) out.push("--");
    for (let i = start; i <= end; i++) out.push(format(i, isMatch.has(i) ? ":" : "-"));
    lastEmitted = Math.max(lastEmitted, end);
  }
}

async function readTextLines(absPath: string): Promise<string[] | undefined> {
  let buffer: Buffer;
  try {
    const info = await lstat(absPath);
    if (!info.isFile() || info.size > SEARCH_FALLBACK_LIMITS.maxFileBytes) return undefined;
    buffer = await readFile(absPath);
  } catch {
    return undefined;
  }
  if (buffer.indexOf(0) !== -1) return undefined;
  const lines = buffer.toString("utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

// ---------------------------------------------------------------------------
// Glob filters (ripgrep `--glob` semantics)
// ---------------------------------------------------------------------------

interface PathFilter {
  matchesFile(relPath: string): boolean;
  prunesDir(relPath: string): boolean;
}

/**
 * Compile a ripgrep `--glob` override. Like gitignore globs, a pattern without
 * `/` matches the basename at any depth; a pattern with `/` is anchored to the
 * search root. A leading `!` excludes matches instead of selecting them.
 */
function compileOverrideGlob(pattern: string): PathFilter {
  const negate = pattern.startsWith("!");
  const glob = new Bun.Glob(toRootRelativeGlob(negate ? pattern.slice(1) : pattern));
  if (negate) {
    return {
      matchesFile: (relPath) => !glob.match(relPath),
      prunesDir: (relPath) => glob.match(relPath),
    };
  }
  return { matchesFile: (relPath) => glob.match(relPath), prunesDir: () => false };
}

function toRootRelativeGlob(pattern: string): string {
  const trimmed = pattern.replace(/\/+$/, "");
  if (!trimmed.includes("/")) return `**/${trimmed}`;
  return trimmed.replace(/^\/+/, "");
}

// ---------------------------------------------------------------------------
// Gitignore rules
// ---------------------------------------------------------------------------

interface IgnoreRule {
  baseDir: string;
  glob: Bun.Glob;
  negate: boolean;
  dirOnly: boolean;
}

function parseGitignore(content: string, baseDir: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith("\\!") || line.startsWith("\\#")) {
      line = line.slice(1);
    }
    const dirOnly = line.endsWith("/");
    line = line.replace(/\/+$/, "");
    if (!line) continue;
    rules.push({ baseDir, glob: new Bun.Glob(toRootRelativeGlob(line)), negate, dirOnly });
  }
  return rules;
}

function isIgnored(rules: readonly IgnoreRule[], absPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    const relPath = relativeTo(rule.baseDir, absPath);
    if (relPath !== undefined && rule.glob.match(relPath)) ignored = !rule.negate;
  }
  return ignored;
}

async function loadGitignore(dir: string): Promise<IgnoreRule[]> {
  try {
    return parseGitignore(await readFile(joinPath(dir, ".gitignore"), "utf8"), dir);
  } catch {
    return [];
  }
}

/** Rules from `.gitignore` files above `root` inside the same git work tree; `undefined` outside git. */
async function loadAncestorGitignoreRules(root: string): Promise<IgnoreRule[] | undefined> {
  const ancestors: string[] = [];
  let dir = root;
  while (true) {
    if (existsSync(joinPath(dir, ".git"))) break;
    const parent = parentDir(dir);
    if (parent === undefined) return undefined;
    dir = parent;
    ancestors.unshift(dir);
  }
  const rules: IgnoreRule[] = [];
  for (const ancestor of ancestors) rules.push(...(await loadGitignore(ancestor)));
  return rules;
}

// ---------------------------------------------------------------------------
// Directory walk
// ---------------------------------------------------------------------------

const GIT_ONLY: Readonly<Record<string, true>> = { ".git": true };
const GIT_AND_NODE_MODULES: Readonly<Record<string, true>> = { ".git": true, node_modules: true };

interface WalkOptions {
  includeHidden: boolean;
  respectGitignore: boolean;
  prunedDirNames: Readonly<Record<string, true>>;
  dirFilter?: PathFilter;
  signal?: AbortSignal;
}

interface WalkedFile {
  absPath: string;
  /** Path relative to the search root, `/`-separated. */
  relPath: string;
  /** The search root itself is this file (ripgrep searches explicit files unconditionally). */
  explicit: boolean;
}

interface Walk {
  files(): AsyncGenerator<WalkedFile>;
  readonly truncated: boolean;
}

function createWalk(searchPath: string, options: WalkOptions): Walk {
  const root = stripTrailingSlashes(searchPath);
  let truncated = false;

  async function* files(): AsyncGenerator<WalkedFile> {
    let rootInfo: Stats;
    try {
      rootInfo = await lstat(root);
    } catch {
      return;
    }
    if (rootInfo.isFile()) {
      yield { absPath: root, relPath: root.slice(root.lastIndexOf("/") + 1), explicit: true };
      return;
    }
    if (!rootInfo.isDirectory()) return;

    const baseRules = options.respectGitignore ? await loadAncestorGitignoreRules(root) : undefined;
    const stack: Array<{ dir: string; rules: readonly IgnoreRule[] | undefined }> = [{ dir: root, rules: baseRules }];
    let visited = 0;

    while (stack.length > 0) {
      if (options.signal?.aborted) throw new Error("Search aborted");
      const { dir, rules: inheritedRules } = stack.pop() as { dir: string; rules: readonly IgnoreRule[] | undefined };
      const rules = inheritedRules ? [...inheritedRules, ...(await loadGitignore(dir))] : undefined;

      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

      const subdirs: string[] = [];
      for (const entry of entries) {
        if (++visited > SEARCH_FALLBACK_LIMITS.maxVisitedEntries) {
          truncated = true;
          return;
        }
        if (!options.includeHidden && entry.name.startsWith(".")) continue;
        const absPath = joinPath(dir, entry.name);
        const relPath = absPath.slice(root.length + 1);
        if (entry.isDirectory()) {
          if (Object.hasOwn(options.prunedDirNames, entry.name)) continue;
          if (rules && isIgnored(rules, absPath, true)) continue;
          if (options.dirFilter?.prunesDir(relPath)) continue;
          subdirs.push(absPath);
        } else if (entry.isFile()) {
          if (rules && isIgnored(rules, absPath, false)) continue;
          yield { absPath, relPath, explicit: false };
        }
      }
      // Push in reverse so directories are visited in sorted order.
      for (let i = subdirs.length - 1; i >= 0; i--) stack.push({ dir: subdirs[i], rules });
    }
  }

  return {
    files,
    get truncated() {
      return truncated;
    },
  };
}

// ---------------------------------------------------------------------------
// Path helpers (search paths are already normalized to `/` separators)
// ---------------------------------------------------------------------------

function stripTrailingSlashes(path: string): string {
  const stripped = path.replace(/\/+$/, "");
  if (!stripped) return "/";
  return /^[a-zA-Z]:$/.test(stripped) ? `${stripped}/` : stripped;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function parentDir(path: string): string | undefined {
  const index = path.lastIndexOf("/");
  if (index < 0) return undefined;
  const parent = index === 0 ? "/" : path.slice(0, index);
  if (parent === path) return undefined;
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}/` : parent;
}

function relativeTo(baseDir: string, absPath: string): string | undefined {
  const prefix = baseDir.endsWith("/") ? baseDir : `${baseDir}/`;
  return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : undefined;
}
