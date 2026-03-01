#!/usr/bin/env node
// @summary Explore directory structure with @summary extraction

import { readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, basename, extname, resolve } from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage",
  ".next", ".turbo", ".cache", "__pycache__",
]);

const IGNORE_PATHS = ["docs/references"];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".wasm", ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a",
  ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flac",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  ".class", ".pyc", ".pyo",
]);

// ── Glob matcher ───────────────────────────────────────────────────────────

function globToRegex(pattern) {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      // ** matches anything including /
      if (pattern[i + 2] === "/") {
        re += "(?:.+/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (c === "*") {
      re += "[^/]*";
      i++;
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === ".") {
      re += "\\.";
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isIgnoredDir(name) {
  return IGNORE_DIRS.has(name) || name.startsWith(".");
}

function isIgnoredPath(relPath, rootDir) {
  for (const ip of IGNORE_PATHS) {
    const absIgnore = resolve(ip);
    const absPath = resolve(rootDir, relPath);
    if (absPath.startsWith(absIgnore)) return true;
  }
  return false;
}

function isBinary(filePath) {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase());
}

// ── Ripgrep integration ───────────────────────────────────────────────────

function runRipgrep(pattern, searchRoot, maxDepth) {
  const args = ["--files", "--glob", pattern];
  for (const ip of IGNORE_PATHS) args.push("--glob", `!${ip}/**`);
  for (const id of IGNORE_DIRS) args.push("--glob", `!${id}/**`);
  args.push("--glob", "!.*/**");
  if (maxDepth !== -1) args.push("--max-depth", String(maxDepth));
  args.push(".");

  try {
    const stdout = execFileSync("rg", args, {
      cwd: searchRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return stdout.trim().split("\n").filter(Boolean).map(p => p.replace(/^\.\//, ""));
  } catch (err) {
    // rg exit code 1 = no matches, exit code 2 = error
    if (err.status === 1) return [];
    throw err;
  }
}

function buildTreeFromPaths(filePaths, searchRoot) {
  // Build nested map from flat paths
  const root = new Map();
  for (const fp of filePaths) {
    const parts = fp.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.has(part)) {
        node.set(part, i < parts.length - 1 ? new Map() : null);
      }
      const child = node.get(part);
      if (i < parts.length - 1) {
        if (child === null) {
          // Was a file, now also a dir parent — promote to map
          const m = new Map();
          node.set(part, m);
          node = m;
        } else {
          node = child;
        }
      }
    }
  }

  // Convert nested map → Entry[]
  function mapToEntries(map, dirPath) {
    /** @type {Entry[]} */
    const entries = [];
    const parentDescs = parseParentReadmeDescriptions(dirPath);

    const dirNames = [];
    const fileNames = [];
    for (const [name, child] of map) {
      if (child instanceof Map) dirNames.push(name);
      else fileNames.push(name);
    }
    dirNames.sort((a, b) => a.localeCompare(b));
    fileNames.sort((a, b) => a.localeCompare(b));

    for (const name of dirNames) {
      const fullPath = join(dirPath, name);
      const desc = extractReadmeDescription(fullPath) || parentDescs[name + "/"] || parentDescs[name] || null;
      const children = mapToEntries(map.get(name), fullPath);
      entries.push({ name: name + "/", type: "dir", summary: desc, children });
    }

    for (const name of fileNames) {
      const fullPath = join(dirPath, name);
      const summary = extractSummary(fullPath) || parentDescs[name] || null;
      entries.push({ name, type: "file", summary, children: [] });
    }

    return entries;
  }

  return mapToEntries(root, searchRoot);
}

function hasRipgrep() {
  try {
    execFileSync("rg", ["--version"], { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function extractSummary(filePath) {
  if (isBinary(filePath)) return null;
  try {
    const fd = readFileSync(filePath, "utf-8");
    // Read first line only
    const nl = fd.indexOf("\n");
    const firstLine = (nl === -1 ? fd : fd.slice(0, nl)).trim();

    // Match // @summary, # @summary, -- @summary, <!-- @summary -->
    const m = firstLine.match(
      /^(?:\/\/|#|--|\/\*|<!--)\s*@summary\s+(.+?)(?:\s*(?:\*\/|-->))?$/
    );
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function extractReadmeDescription(dirPath) {
  try {
    const content = readFileSync(join(dirPath, "README.md"), "utf-8");
    // First non-empty line after # heading
    const lines = content.split("\n");
    let foundHeading = false;
    for (const line of lines) {
      if (!foundHeading) {
        if (line.startsWith("# ")) foundHeading = true;
        continue;
      }
      const trimmed = line.trim();
      if (trimmed.length > 0) return trimmed;
    }
    // Fallback: strip # from heading
    const heading = lines.find((l) => l.startsWith("# "));
    return heading ? heading.replace(/^#\s+/, "") : null;
  } catch {
    return null;
  }
}

/** Parse README.md code blocks to extract entry descriptions.
 *  Searches current dir first, then walks up ancestors to find descriptions
 *  for entries that may be listed under a nested path (e.g. "src/agent/"). */
function parseParentReadmeDescriptions(dirPath) {
  /** @type {Record<string, string>} */
  const descriptions = {};

  // Try README.md in the directory itself first
  _parseReadmeCodeBlocks(join(dirPath, "README.md"), "", descriptions);

  // Walk up ancestors looking for READMEs that list nested paths
  let current = dirPath;
  for (let i = 0; i < 5; i++) {
    const parent = resolve(current, "..");
    if (parent === current) break;
    const rel = relative(parent, dirPath);
    _parseReadmeCodeBlocks(join(parent, "README.md"), rel, descriptions);
    current = parent;
  }

  return descriptions;
}

function _parseReadmeCodeBlocks(readmePath, prefix, descriptions) {
  try {
    const content = readFileSync(readmePath, "utf-8");
    const lines = content.split("\n");
    let inCodeBlock = false;
    // Track indentation-based path context: [{indent, name}]
    const pathStack = [];

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        pathStack.length = 0;
        continue;
      }
      if (!inCodeBlock) continue;

      // Match: entry with optional description (indent + name + optional spaces + description)
      const m = line.match(/^(\s*)([\w.\-@]+\/?)\s{2,}(.+)/);
      const mNoDesc = !m && line.match(/^(\s*)([\w.\-@]+\/)\s*$/);

      const indent = (m || mNoDesc)?.[1]?.length ?? -1;
      const name = (m || mNoDesc)?.[2];
      const desc = m?.[3]?.trim() ?? null;

      if (indent < 0 || !name) continue;

      // Pop stack to find parent at lower indent
      while (pathStack.length > 0 && pathStack[pathStack.length - 1].indent >= indent) {
        pathStack.pop();
      }

      // Build full path from stack
      const fullPath = [...pathStack.map((s) => s.name), name].join("");

      // Push directories onto stack for nesting
      if (name.endsWith("/")) {
        pathStack.push({ indent, name });
      }

      // Check if this entry is a direct child of our target prefix
      if (prefix) {
        const prefixSlash = prefix.endsWith("/") ? prefix : prefix + "/";
        if (!fullPath.startsWith(prefixSlash)) continue;
        const remainder = fullPath.slice(prefixSlash.length);
        // Must be direct child (no further /)
        const stripped = remainder.replace(/\/$/, "");
        if (stripped.includes("/")) continue;
        if (desc && !descriptions[remainder]) {
          descriptions[remainder] = desc;
        }
      } else {
        // No prefix — only direct children (no /)
        const stripped = name.replace(/\/$/, "");
        if (fullPath.replace(/\/$/, "").includes("/")) continue;
        if (desc && !descriptions[name]) {
          descriptions[name] = desc;
        }
      }
    }
  } catch {
    // no README.md
  }
}

// ── Tree collection ────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, type: 'dir'|'file', summary: string|null, children: Entry[] }} Entry
 */

function collectTree(dirPath, rootDir, currentDepth, maxDepth) {
  /** @type {Entry[]} */
  const entries = [];

  let items;
  try {
    items = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return entries;
  }

  // Parse parent README.md for subdirectory/file descriptions
  const parentDescs = parseParentReadmeDescriptions(dirPath);

  // Sort: directories first, then files, alphabetical within each group
  const dirs = items.filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const files = items.filter((d) => d.isFile()).sort((a, b) => a.name.localeCompare(b.name));

  for (const d of dirs) {
    if (isIgnoredDir(d.name)) continue;
    const fullPath = join(dirPath, d.name);
    const rel = relative(rootDir, fullPath);
    if (isIgnoredPath(rel, rootDir)) continue;

    // Priority: own README.md description > parent README.md listing
    const desc = extractReadmeDescription(fullPath) || parentDescs[d.name + "/"] || parentDescs[d.name] || null;
    const children =
      maxDepth === -1 || currentDepth + 1 < maxDepth
        ? collectTree(fullPath, rootDir, currentDepth + 1, maxDepth)
        : [];

    entries.push({ name: d.name + "/", type: "dir", summary: desc, children });
  }

  for (const f of files) {
    if (f.name.startsWith(".")) continue;
    const fullPath = join(dirPath, f.name);
    // Priority: @summary > parent README.md listing
    const summary = extractSummary(fullPath) || parentDescs[f.name] || null;
    entries.push({ name: f.name, type: "file", summary, children: [] });
  }

  return entries;
}

// ── Pattern matching & filtering ───────────────────────────────────────────

function matchesPattern(entry, regex, isRecursive) {
  return regex.test(entry.name) || regex.test(entry.name.replace(/\/$/, ""));
}

function filterTree(entries, regex, isRecursive) {
  /** @type {Entry[]} */
  const result = [];
  for (const entry of entries) {
    if (matchesPattern(entry, regex, isRecursive)) {
      result.push(entry);
    } else if (isRecursive && entry.children.length > 0) {
      const filtered = filterTree(entry.children, regex, isRecursive);
      if (filtered.length > 0) {
        result.push({ ...entry, children: filtered });
      }
    }
  }
  return result;
}

// ── Output formatting ──────────────────────────────────────────────────────

function formatTree(entries, indent, nameColWidth) {
  const lines = [];
  for (const entry of entries) {
    const pad = entry.name.padEnd(nameColWidth);
    const desc = entry.summary ? `  ${entry.summary}` : entry.type === "file" ? "" : "";
    lines.push(`${indent}${pad}${desc}`);
    if (entry.children.length > 0) {
      const childNameWidth = Math.max(
        ...entry.children.map((e) => e.name.length),
        1
      );
      lines.push(...formatTree(entry.children, indent + "  ", childNameWidth));
    }
  }
  return lines;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let pattern = null;
  let searchPath = ".";
  let maxDepth = -1; // -1 = unlimited

  // Parse args
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--depth" && args[i + 1]) {
      maxDepth = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: explore.mjs <pattern> [path] [--depth N]

Explore directory structure with @summary extraction.

Arguments:
  pattern     Glob pattern (e.g. "*/" "*.ts" "**/" "src/**/*.ts")
  path        Search root directory (default: cwd)
  --depth N   Limit tree depth (default: unlimited)

Files are always shown with @summary when available.

Examples:
  explore.mjs "*/"  packages/core/src          # direct subdirectories
  explore.mjs "*.ts" packages/core/src/tools   # .ts files in directory
  explore.mjs "**/" packages/core/src --depth 2 # recursive with depth limit`);
      process.exit(0);
    } else if (!args[i].startsWith("-")) {
      positional.push(args[i]);
    }
  }

  pattern = positional[0] || "*/";
  searchPath = positional[1] || ".";

  // Handle brace expansion for paths like packages/*/src
  const searchPaths = expandBraces(searchPath);

  const isDirPattern = pattern.endsWith("/");
  const isRecursive = pattern.includes("**");
  const useRipgrep = !isDirPattern && hasRipgrep();

  if (!isDirPattern && !useRipgrep) {
    console.error("Warning: ripgrep (rg) not found — falling back to built-in matcher (brace expansion and path patterns may not work)");
  }

  for (const sp of searchPaths) {
    const resolved = resolve(sp);
    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      console.error(`Error: path not found: ${sp}`);
      continue;
    }
    if (!stat.isDirectory()) {
      console.error(`Error: not a directory: ${sp}`);
      continue;
    }

    let filtered;
    if (useRipgrep) {
      const filePaths = runRipgrep(pattern, resolved, maxDepth);
      filtered = buildTreeFromPaths(filePaths, resolved);
    } else {
      const regex = globToRegex(pattern);
      const tree = collectTree(resolved, resolved, 0, maxDepth);
      filtered = filterTree(tree, regex, isRecursive);
    }

    if (filtered.length === 0) {
      console.log(`${sp}/  (no matches)`);
      continue;
    }

    const nameColWidth = Math.max(...filtered.map((e) => e.name.length), 1);

    console.log(`${sp}/`);
    const lines = formatTree(filtered, "  ", nameColWidth);
    for (const line of lines) {
      console.log(line);
    }
    console.log();
  }
}

// ── Brace expansion (simple: packages/*/src) ──────────────────────────────

function expandBraces(pattern) {
  if (!pattern.includes("*")) return [pattern];

  const parts = pattern.split("/");
  let paths = [""];

  for (const part of parts) {
    if (part === "*") {
      const expanded = [];
      for (const p of paths) {
        const base = p || ".";
        try {
          const entries = readdirSync(base, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() && !isIgnoredDir(e.name)) {
              expanded.push(p ? join(p, e.name) : e.name);
            }
          }
        } catch {
          // skip
        }
      }
      paths = expanded;
    } else {
      paths = paths.map((p) => (p ? join(p, part) : part));
    }
  }

  return paths.length > 0 ? paths : [pattern];
}

main();
