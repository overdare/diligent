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

// ── README.md parsing ──────────────────────────────────────────────────────

function parseReadmeTree(readmePath) {
  /** @type {string[]} */
  const topLevel = [];
  /** @type {Map<string, string[]>} */
  const nested = new Map(); // parentDir -> childDirs[]

  try {
    const content = readFileSync(readmePath, "utf-8");
    const lines = content.split("\n");
    let inCodeBlock = false;
    let topIndent = -1;
    let currentParent = null;
    let nestedIndent = -1;

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        topIndent = -1;
        currentParent = null;
        nestedIndent = -1;
        continue;
      }
      if (!inCodeBlock) continue;

      const m = line.match(/^(\s*)([\w.\-@]+\/)/);
      if (!m) continue;

      const indent = m[1].length;
      const dirName = m[2].replace(/\/$/, "");

      if (topIndent === -1) topIndent = indent;

      if (indent === topIndent) {
        topLevel.push(dirName);
        currentParent = dirName;
        nestedIndent = -1;
      } else if (indent > topIndent && currentParent) {
        if (nestedIndent === -1) nestedIndent = indent;
        if (indent === nestedIndent) {
          if (!nested.has(currentParent)) nested.set(currentParent, []);
          nested.get(currentParent).push(dirName);
        }
      }
    }
  } catch {
    // no README.md
  }
  return { topLevel, nested };
}

// ── Analysis ───────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const rootPath = resolve(args[0] || ".");

  // Parse .gitignore and merge into ignore sets
  gitignore = parseGitignore(rootPath);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: check.mjs [path]

Detect README.md gaps and @summary coverage.

Arguments:
  path    Root directory to check (default: cwd)

Reports:
  - Missing README.md files
  - Stale README.md (listed dirs don't match actual dirs)
  - @summary coverage per directory`);
    process.exit(0);
  }

  const allDirs = getDirectories(rootPath);

  // ── Missing README.md ──
  const missing = [];
  for (const dir of allDirs) {
    const childDirs = getDirectChildDirs(dir, rootPath);
    // Need README if: 4+ subdirs, OR < 4 subdirs but any child has 4+ subdirs (2-depth)
    const needsReadme =
      childDirs.length >= 4 ||
      (childDirs.length > 0 &&
        childDirs.length < 4 &&
        childDirs.some(
          (child) =>
            getDirectChildDirs(join(dir, child), rootPath).length >= 4
        ));
    if (!needsReadme) continue;
    const readmePath = join(rootPath, dir, "README.md");
    if (!existsSync(readmePath)) {
      missing.push(dir);
    }
  }

  if (missing.length > 0) {
    console.log("Missing README.md:");
    for (const dir of missing) {
      console.log(`  ${dir}/`);
    }
    console.log();
  }

  // ── Stale README.md ──
  const stale = [];
  for (const dir of allDirs) {
    const readmePath = join(rootPath, dir, "README.md");
    if (!existsSync(readmePath)) continue;

    const { topLevel: listedDirs, nested } = parseReadmeTree(readmePath);
    const actualDirs = getDirectChildDirs(dir, rootPath);

    if (listedDirs.length === 0 && actualDirs.length === 0) continue;

    const issues = [];

    // Check top-level
    const listedSet = new Set(listedDirs);
    const actualSet = new Set(actualDirs);
    const unlisted = actualDirs.filter((d) => !listedSet.has(d));
    const removed = listedDirs.filter((d) => !actualSet.has(d));
    if (unlisted.length > 0) issues.push(`unlisted: ${unlisted.join(", ")}`);
    if (removed.length > 0) issues.push(`removed: ${removed.join(", ")}`);

    // Check nested (2-depth) entries
    for (const [parent, nestedListed] of nested) {
      const actualNested = getDirectChildDirs(join(dir, parent), rootPath);
      const nestedListedSet = new Set(nestedListed);
      const actualNestedSet = new Set(actualNested);
      const nestedUnlisted = actualNested.filter(
        (d) => !nestedListedSet.has(d)
      );
      const nestedRemoved = nestedListed.filter(
        (d) => !actualNestedSet.has(d)
      );
      if (nestedUnlisted.length > 0)
        issues.push(`${parent}/ unlisted: ${nestedUnlisted.join(", ")}`);
      if (nestedRemoved.length > 0)
        issues.push(`${parent}/ removed: ${nestedRemoved.join(", ")}`);
    }

    // Check if 2-depth expansion is needed but missing
    if (listedDirs.length > 0 && listedDirs.length < 4 && nested.size === 0) {
      const expandable = listedDirs.filter(
        (d) =>
          actualSet.has(d) &&
          getDirectChildDirs(join(dir, d), rootPath).length >= 4
      );
      if (expandable.length > 0) {
        issues.push(`shallow — expand 2-depth: ${expandable.join(", ")}`);
      }
    }

    if (issues.length > 0) {
      stale.push({ dir, detail: issues.join("; ") });
    }
  }

  if (stale.length > 0) {
    console.log("Stale README.md (directory contents changed):");
    for (const { dir, detail } of stale) {
      console.log(`  ${dir}/`.padEnd(40) + detail);
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
