// @summary Applies codex-style Begin/End patch envelopes with strict verification
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../tool/types";

const ApplyPatchParams = z.object({
  patch: z.string().describe("The full patch text to apply, including *** Begin Patch and *** End Patch markers"),
});

type PatchHunk =
  | { type: "add"; path: string; lines: string[] }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: UpdateChunk[] };

interface UpdateChunk {
  oldLines: string[];
  newLines: string[];
  context?: string;
  isEndOfFile?: boolean;
}

interface FileChange {
  type: "add" | "update" | "delete" | "move";
  sourcePath: string;
  targetPath: string;
  before: string;
  after: string;
}

const BEGIN_MARKER = "*** Begin Patch";
const END_MARKER = "*** End Patch";

export function createApplyPatchTool(cwd: string): Tool<typeof ApplyPatchParams> {
  return {
    name: "apply_patch",
    description:
      "Apply a codex-style patch block to files. Supports Add/Delete/Update, Move to, and @@ hunks with strict verification.",
    parameters: ApplyPatchParams,
    async execute(args, ctx): Promise<ToolResult> {
      let hunks: PatchHunk[];
      try {
        hunks = parsePatch(args.patch);
      } catch (error) {
        return {
          output: `apply_patch verification failed: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { error: true },
        };
      }

      if (hunks.length === 0) {
        return {
          output: "patch rejected: empty patch",
          metadata: { error: true },
        };
      }

      let changes: FileChange[];
      try {
        changes = await verifyAndPlanChanges(hunks, cwd);
      } catch (error) {
        return {
          output: `apply_patch verification failed: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { error: true },
        };
      }

      const previewPath = changes[0]?.targetPath ?? changes[0]?.sourcePath ?? "(none)";
      const approval = await ctx.approve({
        permission: "write",
        toolName: "apply_patch",
        description: `Apply patch touching ${changes.length} file(s)`,
        details: {
          file_path: previewPath,
          paths: changes.map((change) => change.targetPath),
        },
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true }, abortRequested: true };
      }

      try {
        await applyChanges(changes);
      } catch (error) {
        return {
          output: `Error applying patch: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { error: true },
        };
      }

      const summaryLines = changes.map((change) => {
        const relSource = normalizeRelPath(relative(cwd, change.sourcePath));
        const relTarget = normalizeRelPath(relative(cwd, change.targetPath));
        if (change.type === "add") return `A ${relTarget}`;
        if (change.type === "delete") return `D ${relSource}`;
        if (change.type === "move") return `M ${relSource} -> ${relTarget}`;
        return `M ${relTarget}`;
      });

      return {
        output: `Success. Updated the following files:\n${summaryLines.join("\n")}`,
      };
    },
  };
}

function normalizeRelPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripHeredoc(value: string): string {
  const match = value.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
  return match ? match[2] : value;
}

function parsePatch(rawPatch: string): PatchHunk[] {
  if (!rawPatch.trim()) throw new Error("patch is empty");

  const normalized = stripHeredoc(normalizeNewlines(rawPatch).trim());
  const lines = normalized.split("\n");
  const begin = lines.findIndex((line) => line.trim() === BEGIN_MARKER);
  const end = lines.findIndex((line) => line.trim() === END_MARKER);

  if (begin === -1 || end === -1 || begin >= end) {
    throw new Error("Invalid patch format: missing Begin/End markers");
  }

  for (let i = 0; i < begin; i++) {
    if (lines[i].trim().length > 0) throw new Error("Unexpected content before *** Begin Patch");
  }
  for (let i = end + 1; i < lines.length; i++) {
    if (lines[i].trim().length > 0) throw new Error("Unexpected content after *** End Patch");
  }

  const hunks: PatchHunk[] = [];
  let i = begin + 1;

  while (i < end) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.startsWith("*** Add File:")) {
      const path = line.slice("*** Add File:".length).trim();
      if (!path) throw new Error("Missing path in Add File header");
      const addLines: string[] = [];
      i++;
      while (i < end && !lines[i].startsWith("*** ")) {
        if (!lines[i].startsWith("+")) throw new Error(`Invalid Add File line: ${lines[i]}`);
        addLines.push(lines[i].slice(1));
        i++;
      }
      hunks.push({ type: "add", path, lines: addLines });
      continue;
    }

    if (line.startsWith("*** Delete File:")) {
      const path = line.slice("*** Delete File:".length).trim();
      if (!path) throw new Error("Missing path in Delete File header");
      hunks.push({ type: "delete", path });
      i++;
      continue;
    }

    if (line.startsWith("*** Update File:")) {
      const path = line.slice("*** Update File:".length).trim();
      if (!path) throw new Error("Missing path in Update File header");
      i++;

      let movePath: string | undefined;
      if (i < end && lines[i].startsWith("*** Move to:")) {
        movePath = lines[i].slice("*** Move to:".length).trim();
        if (!movePath) throw new Error("Missing path in Move to header");
        i++;
      }

      const chunks: UpdateChunk[] = [];
      while (i < end && !lines[i].startsWith("*** ")) {
        if (lines[i].trim().length === 0) {
          i++;
          continue;
        }
        if (!lines[i].startsWith("@@")) {
          throw new Error(`Expected @@ hunk header, got: ${lines[i]}`);
        }

        const context = lines[i].slice(2).trim() || undefined;
        i++;
        const oldLines: string[] = [];
        const newLines: string[] = [];
        let isEndOfFile = false;

        while (i < end && !lines[i].startsWith("@@") && !lines[i].startsWith("*** ")) {
          const row = lines[i];
          if (row === "*** End of File") {
            isEndOfFile = true;
            i++;
            break;
          }
          if (row.startsWith(" ")) {
            const value = row.slice(1);
            oldLines.push(value);
            newLines.push(value);
          } else if (row.startsWith("-")) {
            oldLines.push(row.slice(1));
          } else if (row.startsWith("+")) {
            newLines.push(row.slice(1));
          } else {
            throw new Error(`Invalid hunk line: ${row}`);
          }
          i++;
        }

        chunks.push({ oldLines, newLines, context, isEndOfFile: isEndOfFile || undefined });
      }

      hunks.push({ type: "update", path, movePath, chunks });
      continue;
    }

    throw new Error(`Unknown patch header: ${line}`);
  }

  return hunks;
}

function resolvePatchPath(cwd: string, patchPath: string): string {
  if (isAbsolute(patchPath)) {
    throw new Error(`Patch paths must be relative, got absolute path: ${patchPath}`);
  }
  return resolve(cwd, patchPath);
}

async function verifyAndPlanChanges(hunks: PatchHunk[], cwd: string): Promise<FileChange[]> {
  const changes: FileChange[] = [];

  for (const hunk of hunks) {
    if (hunk.type === "add") {
      const targetPath = resolvePatchPath(cwd, hunk.path);
      const after = hunk.lines.length === 0 ? "" : `${hunk.lines.join("\n")}\n`;
      changes.push({
        type: "add",
        sourcePath: targetPath,
        targetPath,
        before: "",
        after,
      });
      continue;
    }

    if (hunk.type === "delete") {
      const sourcePath = resolvePatchPath(cwd, hunk.path);
      const info = await stat(sourcePath).catch(() => null);
      if (!info || !info.isFile()) {
        throw new Error(`Failed to read file to delete: ${sourcePath}`);
      }
      const before = await readFile(sourcePath, "utf-8");
      changes.push({
        type: "delete",
        sourcePath,
        targetPath: sourcePath,
        before,
        after: "",
      });
      continue;
    }

    const sourcePath = resolvePatchPath(cwd, hunk.path);
    const info = await stat(sourcePath).catch(() => null);
    if (!info || !info.isFile()) {
      throw new Error(`Failed to read file to update: ${sourcePath}`);
    }
    const before = await readFile(sourcePath, "utf-8");
    const after = deriveNewContent(sourcePath, before, hunk.chunks);
    const targetPath = hunk.movePath ? resolvePatchPath(cwd, hunk.movePath) : sourcePath;

    changes.push({
      type: hunk.movePath ? "move" : "update",
      sourcePath,
      targetPath,
      before,
      after,
    });
  }

  return changes;
}

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function deriveNewContent(filePath: string, content: string, chunks: UpdateChunk[]): string {
  const original = splitLines(content);
  const replacements: Array<[number, number, string[]]> = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.context) {
      const contextIndex = seekSequence(original, [chunk.context], lineIndex);
      if (contextIndex === -1) {
        throw new Error(`Failed to find context '${chunk.context}' in ${filePath}`);
      }
      lineIndex = contextIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex = original.length;
      replacements.push([insertionIndex, 0, chunk.newLines]);
      continue;
    }

    let pattern = chunk.oldLines;
    let replacement = chunk.newLines;
    let found = seekSequence(original, pattern, lineIndex, chunk.isEndOfFile);

    if (found === -1 && pattern.length > 0 && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (replacement.length > 0 && replacement[replacement.length - 1] === "") {
        replacement = replacement.slice(0, -1);
      }
      found = seekSequence(original, pattern, lineIndex, chunk.isEndOfFile);
    }

    if (found === -1) {
      throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`);
    }

    replacements.push([found, pattern.length, replacement]);
    lineIndex = found + pattern.length;
  }

  const next = [...original];
  for (let i = replacements.length - 1; i >= 0; i--) {
    const [start, oldLen, newLines] = replacements[i];
    next.splice(start, oldLen, ...newLines);
  }

  if (next.length === 0) return "";
  return `${next.join("\n")}\n`;
}

function normalizeUnicode(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

function tryMatch(
  lines: string[],
  pattern: string[],
  start: number,
  compare: (a: string, b: string) => boolean,
  eof: boolean,
): number {
  if (eof) {
    const fromEnd = lines.length - pattern.length;
    if (fromEnd >= start) {
      let matched = true;
      for (let i = 0; i < pattern.length; i++) {
        if (!compare(lines[fromEnd + i], pattern[i])) {
          matched = false;
          break;
        }
      }
      if (matched) return fromEnd;
    }
  }

  for (let index = start; index <= lines.length - pattern.length; index++) {
    let matched = true;
    for (let i = 0; i < pattern.length; i++) {
      if (!compare(lines[index + i], pattern[i])) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }

  return -1;
}

function seekSequence(lines: string[], pattern: string[], start: number, eof = false): number {
  if (pattern.length === 0) return -1;

  const exact = tryMatch(lines, pattern, start, (a, b) => a === b, eof);
  if (exact !== -1) return exact;

  const rstrip = tryMatch(lines, pattern, start, (a, b) => a.trimEnd() === b.trimEnd(), eof);
  if (rstrip !== -1) return rstrip;

  const trim = tryMatch(lines, pattern, start, (a, b) => a.trim() === b.trim(), eof);
  if (trim !== -1) return trim;

  return tryMatch(lines, pattern, start, (a, b) => normalizeUnicode(a.trim()) === normalizeUnicode(b.trim()), eof);
}

async function applyChanges(changes: FileChange[]): Promise<void> {
  for (const change of changes) {
    if (change.type === "delete") {
      await rm(change.sourcePath);
      continue;
    }

    await mkdir(dirname(change.targetPath), { recursive: true });
    await writeFile(change.targetPath, change.after, "utf-8");

    if (change.type === "move" && change.sourcePath !== change.targetPath) {
      await rm(change.sourcePath, { force: true });
    }
  }
}
