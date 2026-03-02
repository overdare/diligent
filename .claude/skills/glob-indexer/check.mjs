#!/usr/bin/env node

// @summary Detect README.md gaps and @summary coverage

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

// ── .gitignore parsing ───────────────────────────────────────────────────

function parseGitignore(rootPath) {
  const dirPatterns = new Set(); // e.g. "node_modules", "dist"
  const filePatterns = new Set(); // e.g. ".DS_Store", ".env"
  const extPatterns = new Set(); // e.g. ".swp", ".tsbuildinfo"
  const pathPatterns = []; // e.g. ".claude/worktrees"

  try {
    const content = readFileSync(join(rootPath, ".gitignore"), "utf-8");
    for (let line of content.split("\n")) {
      line = line.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;

      // Strip trailing slash
      const isDir = line.endsWith("/");
      if (isDir) line = line.slice(0, -1);

      // Glob like *.swp → extension pattern
      if (line.startsWith("*.")) {
        extPatterns.add(line.slice(1)); // ".swp"
        continue;
      }

      // Path pattern (contains /) → treat as path prefix
      if (line.includes("/")) {
        pathPatterns.push(line);
        continue;
      }

      // Simple name — classify as dir or file
      if (isDir) {
        dirPatterns.add(line);
      } else {
        filePatterns.add(line);
      }
    }
  } catch {
    // no .gitignore
  }

  return { dirPatterns, filePatterns, extPatterns, pathPatterns };
}

// ── Constants ──────────────────────────────────────────────────────────────

const HARDCODED_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
]);

const IGNORE_PATHS = ["docs/references"];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".wasm",
  ".zip",
  ".gz",
  ".tar",
  ".bz2",
  ".7z",
  ".rar",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
  ".flac",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  ".class",
  ".pyc",
  ".pyo",
]);

const NON_SUMMARY_FILES = new Set([
  "index.ts",
  "index.js",
  "index.mjs",
  "types.ts",
  "types.js",
  "index.html",
  "__init__.py",
  "package.json",
  "tsconfig.json",
  ".gitignore",
  "README.md",
  "CLAUDE.md",
  "LICENSE",
]);

// ── Helpers ────────────────────────────────────────────────────────────────

/** @type {{ dirPatterns: Set<string>, filePatterns: Set<string>, extPatterns: Set<string>, pathPatterns: string[] }} */
let gitignore = { dirPatterns: new Set(), filePatterns: new Set(), extPatterns: new Set(), pathPatterns: [] };

function isIgnoredDir(name) {
  return HARDCODED_IGNORE_DIRS.has(name) || gitignore.dirPatterns.has(name) || name.startsWith(".");
}

function isIgnoredPath(relPath) {
  for (const ip of IGNORE_PATHS) {
    if (relPath.startsWith(ip)) return true;
  }
  for (const pp of gitignore.pathPatterns) {
    if (relPath === pp || relPath.startsWith(pp + "/")) return true;
  }
  return false;
}

function isIgnoredFile(fileName) {
  if (gitignore.filePatterns.has(fileName)) return true;
  const ext = extname(fileName).toLowerCase();
  if (gitignore.extPatterns.has(ext)) return true;
  return false;
}

function isBinary(filePath) {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function hasSummary(filePath) {
  if (isBinary(filePath)) return false;
  try {
    const content = readFileSync(filePath, "utf-8");
    const nl = content.indexOf("\n");
    const firstLine = (nl === -1 ? content : content.slice(0, nl)).trim();
    return /^(?:\/\/|#|--|\/\*|<!--)\s*@summary\s+/.test(firstLine);
  } catch {
    return false;
  }
}

function isSummaryCandidate(fileName) {
  if (NON_SUMMARY_FILES.has(fileName)) return false;
  if (isBinary(fileName)) return false;
  // Only source files
  const ext = extname(fileName).toLowerCase();
  return [".ts", ".js", ".mjs", ".tsx", ".jsx", ".py", ".sh", ".sql"].includes(ext);
}

// ── Git file listing ───────────────────────────────────────────────────────

function getGitFiles(rootPath) {
  try {
    const output = execSync("git ls-files", {
      cwd: rootPath,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ── Directory analysis ─────────────────────────────────────────────────────

function getDirectories(rootPath) {
  /** @type {Set<string>} */
  const dirs = new Set();
  const gitFiles = getGitFiles(rootPath);

  for (const file of gitFiles) {
    const dir = dirname(file);
    if (dir === ".") continue;

    // Add all ancestor directories
    let current = dir;
    while (current !== ".") {
      dirs.add(current);
      current = dirname(current);
    }
  }

  return [...dirs]
    .filter((d) => {
      const parts = d.split("/");
      return !parts.some((p) => isIgnoredDir(p)) && !isIgnoredPath(d);
    })
    .sort();
}

function getDirectChildDirs(dirPath, rootPath) {
  const fullPath = join(rootPath, dirPath);
  try {
    const entries = readdirSync(fullPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !isIgnoredDir(e.name))
      .map((e) => e.name)
      .filter((name) => !isIgnoredPath(join(dirPath, name)))
      .sort();
  } catch {
    return [];
  }
}

function getDirectChildFiles(dirPath, rootPath) {
  const fullPath = join(rootPath, dirPath);
  try {
    const entries = readdirSync(fullPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith(".") && !isIgnoredFile(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// ── Expected tree builder ───────────────────────────────────────────────────

/**
 * @typedef {{ name: string, children: TreeNode[] }} TreeNode
 */

/**
 * Build expected directory tree using recursive expansion rules:
 * - 0 children → leaf (empty array)
 * - 4+ children → flat list (stop recursion)
 * - 1~3 children → recurse into each child
 * @param {string} dir - relative directory path
 * @param {string} rootPath - absolute root
 * @param {number} depth - recursion guard
 * @returns {TreeNode[]}
 */
function buildExpectedTree(dir, rootPath, depth = 0) {
  if (depth > 20) return [];
  const children = getDirectChildDirs(dir, rootPath);
  if (children.length === 0) return [];
  if (children.length >= 4) {
    return children.map((name) => ({ name, children: [] }));
  }
  // 1~3 children: recurse each
  return children.map((name) => ({
    name,
    children: buildExpectedTree(join(dir, name), rootPath, depth + 1),
  }));
}

/**
 * Count all nodes in a tree recursively.
 * @param {TreeNode[]} tree
 * @returns {number}
 */
function countTreeNodes(tree) {
  let count = 0;
  for (const node of tree) {
    count += 1 + countTreeNodes(node.children);
  }
  return count;
}

// ── README.md parsing ──────────────────────────────────────────────────────

/**
 * Parse README code block tree into TreeNode[] (arbitrary depth).
 * Uses indent-based stack parsing.
 * @param {string} readmePath
 * @returns {TreeNode[]}
 */
function parseReadmeTree(readmePath) {
  /** @type {{ indent: number, name: string }[]} */
  const entries = [];

  try {
    const content = readFileSync(readmePath, "utf-8");
    const lines = content.split("\n");
    let inCodeBlock = false;

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (!inCodeBlock) continue;

      const m = line.match(/^(\s*)([\w.\-@]+\/)/);
      if (!m) continue;

      entries.push({ indent: m[1].length, name: m[2].replace(/\/$/, "") });
    }
  } catch {
    // no README.md
  }

  if (entries.length === 0) return [];
  return buildTreeFromEntries(entries, 0, entries.length, entries[0].indent);
}

/**
 * Recursively build TreeNode[] from flat indent-based entries.
 * @param {{ indent: number, name: string }[]} entries
 * @param {number} start
 * @param {number} end
 * @param {number} level - expected indent for this depth
 * @returns {TreeNode[]}
 */
function buildTreeFromEntries(entries, start, end, level) {
  const result = [];
  let i = start;
  while (i < end) {
    if (entries[i].indent === level) {
      const node = { name: entries[i].name, children: [] };
      // Find range of children (entries with indent > level until next same-level)
      let childEnd = i + 1;
      while (childEnd < end && entries[childEnd].indent > level) {
        childEnd++;
      }
      if (i + 1 < childEnd) {
        node.children = buildTreeFromEntries(
          entries,
          i + 1,
          childEnd,
          entries[i + 1].indent
        );
      }
      result.push(node);
      i = childEnd;
    } else {
      i++;
    }
  }
  return result;
}

// ── Tree utilities ──────────────────────────────────────────────────────────

/**
 * Compute max depth of a tree (0 for empty, 1 for flat list, etc.)
 * @param {TreeNode[]} tree
 * @returns {number}
 */
function maxTreeDepth(tree) {
  if (tree.length === 0) return 0;
  return 1 + Math.max(...tree.map((n) => maxTreeDepth(n.children)));
}

/**
 * Render tree as indented string (same format as README code blocks).
 * @param {TreeNode[]} tree
 * @param {number} indent
 * @returns {string}
 */
function renderTree(tree, indent = 0) {
  const lines = [];
  for (const node of tree) {
    lines.push(`${" ".repeat(indent)}${node.name}/`);
    if (node.children.length > 0) {
      lines.push(renderTree(node.children, indent + 2));
    }
  }
  return lines.join("\n");
}

// ── Tree validation ─────────────────────────────────────────────────────────

/**
 * Compare parsed README tree vs expected tree.
 * Reports: unlisted, removed, shallow — should expand.
 * Entries listed in README but excluded by IGNORE_PATHS are tolerated if they exist on disk.
 * @param {TreeNode[]} readmeTree
 * @param {TreeNode[]} expectedTree
 * @param {string} dirPath - relative path of the directory being checked
 * @param {string} rootPath - absolute root
 * @param {string} parentPath - for error messages (display prefix)
 * @returns {string[]}
 */
function validateTree(readmeTree, expectedTree, dirPath, rootPath, parentPath = "") {
  const issues = [];
  const readmeNames = new Set(readmeTree.map((n) => n.name));
  const expectedNames = new Set(expectedTree.map((n) => n.name));

  const prefix = parentPath ? `${parentPath} ` : "";

  const unlisted = expectedTree
    .filter((n) => !readmeNames.has(n.name))
    .map((n) => n.name);
  // Only flag "removed" if the directory truly doesn't exist on disk
  const removed = readmeTree
    .filter((n) => !expectedNames.has(n.name))
    .filter((n) => {
      const fullPath = join(rootPath, dirPath, n.name);
      try { return !statSync(fullPath).isDirectory(); } catch { return true; }
    })
    .map((n) => n.name);

  if (unlisted.length > 0)
    issues.push(`${prefix}unlisted: ${unlisted.join(", ")}`);
  if (removed.length > 0)
    issues.push(`${prefix}removed: ${removed.join(", ")}`);

  // For each expected node with children, check README matches
  for (const expectedNode of expectedTree) {
    const readmeNode = readmeTree.find((n) => n.name === expectedNode.name);
    if (!readmeNode) continue;

    if (expectedNode.children.length > 0) {
      if (readmeNode.children.length === 0) {
        issues.push(
          `shallow — should expand: ${prefix}${expectedNode.name}`
        );
      } else {
        const childIssues = validateTree(
          readmeNode.children,
          expectedNode.children,
          join(dirPath, expectedNode.name),
          rootPath,
          `${prefix}${expectedNode.name}/`
        );
        issues.push(...childIssues);
      }
    }
  }

  return issues;
}

// ── Analysis ───────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--") && !a.startsWith("-"));
  const rootPath = resolve(positional[0] || ".");

  // Parse .gitignore and merge into ignore sets
  gitignore = parseGitignore(rootPath);

  const verbose = args.includes("--plan");

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: check.mjs [path] [--plan]

Detect README.md gaps and @summary coverage.

Arguments:
  path    Root directory to check (default: cwd)

Flags:
  --plan  Show full README blueprint with expected trees

Reports:
  - README.md blueprint (all locations, depth, nodes, status)
  - Missing README.md files
  - Stale README.md (listed dirs don't match actual dirs)
  - @summary coverage per directory`);
    process.exit(0);
  }

  const allDirs = getDirectories(rootPath);

  // ── Build blueprint for all dirs needing README ──
  /** @type {{ dir: string, tree: TreeNode[], nodes: number, depth: number, exists: boolean, issues: string[] }[]} */
  const blueprint = [];
  for (const dir of allDirs) {
    const tree = buildExpectedTree(dir, rootPath);
    const nodes = countTreeNodes(tree);
    if (nodes < 4) continue;
    const readmePath = join(rootPath, dir, "README.md");
    const exists = existsSync(readmePath);
    let issues = [];
    if (exists) {
      const readmeTree = parseReadmeTree(readmePath);
      issues = validateTree(readmeTree, tree, dir, rootPath);
    }
    blueprint.push({
      dir,
      tree,
      nodes,
      depth: maxTreeDepth(tree),
      exists,
      issues,
    });
  }

  // ── README.md blueprint ──
  console.log("README.md blueprint:");
  for (const { dir, nodes, depth, exists, issues, tree } of blueprint) {
    const status = !exists
      ? "MISSING"
      : issues.length > 0
        ? "STALE"
        : "OK";
    const label = `  ${dir}/`.padEnd(38);
    console.log(
      `${label}depth ${depth}, ${String(nodes).padStart(2)} nodes  [${status}]`
    );
    if (verbose) {
      for (const line of renderTree(tree, 4).split("\n")) {
        console.log(line);
      }
    }
  }
  console.log();

  // ── Missing README.md ──
  const missing = blueprint.filter((b) => !b.exists);
  if (missing.length > 0) {
    console.log("Missing README.md:");
    for (const { dir, tree } of missing) {
      console.log(`  ${dir}/`);
      if (verbose) {
        for (const line of renderTree(tree, 4).split("\n")) {
          console.log(line);
        }
      }
    }
    console.log();
  }

  // ── Stale README.md ──
  const stale = blueprint.filter((b) => b.exists && b.issues.length > 0);
  if (stale.length > 0) {
    console.log("Stale README.md (directory contents changed):");
    for (const { dir, issues, tree } of stale) {
      console.log(
        `  ${dir}/`.padEnd(40) + issues.join("; ")
      );
      if (verbose) {
        console.log("    Expected tree:");
        for (const line of renderTree(tree, 6).split("\n")) {
          console.log(line);
        }
      }
    }
    console.log();
  }

  // ── @summary coverage ──
  console.log("@summary coverage:");
  const coverageDirs = [];
  let totalFiles = 0;
  let totalWithSummary = 0;

  for (const dir of allDirs) {
    const files = getDirectChildFiles(dir, rootPath);
    const candidates = files.filter((f) => isSummaryCandidate(f));
    if (candidates.length === 0) continue;

    let withSummary = 0;
    for (const f of candidates) {
      if (hasSummary(join(rootPath, dir, f))) withSummary++;
    }

    totalFiles += candidates.length;
    totalWithSummary += withSummary;

    const pct = Math.round((withSummary / candidates.length) * 100);
    coverageDirs.push({ dir, withSummary, total: candidates.length, pct });
  }

  // Sort by coverage ascending (worst first)
  coverageDirs.sort((a, b) => a.pct - b.pct || b.total - a.total);

  for (const { dir, withSummary, total, pct } of coverageDirs) {
    const label = `  ${dir}/`.padEnd(45);
    console.log(`${label}${withSummary}/${total} files (${pct}%)`);
  }

  const totalPct = totalFiles > 0 ? Math.round((totalWithSummary / totalFiles) * 100) : 0;
  console.log(`  ${"Total:".padEnd(43)}${totalWithSummary}/${totalFiles} files (${totalPct}%)`);
}

main();
