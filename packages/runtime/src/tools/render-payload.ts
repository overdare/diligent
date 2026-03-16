// @summary Runtime helpers for generic text payloads and tool-specific producer render block builders

import type { DiffFile, ToolRenderPayload } from "@diligent/protocol";

export interface SearchRenderPayloadOptions {
  cwd?: string;
}

export interface SearchRenderInput {
  pattern?: string;
  path?: string;
}

export interface UpdateKnowledgeRenderInput {
  action?: string;
  id?: string;
  type?: string;
  content?: string;
  confidence?: number;
  tags?: string[];
}

export function summarizeRenderText(text: string | undefined, maxLength = 80): string | undefined {
  if (!text) return undefined;
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return undefined;
  return clipInlineText(firstLine, maxLength);
}

export function createTextRenderPayload(
  inputText?: string,
  outputText?: string,
  isError = false,
): ToolRenderPayload | undefined {
  const inputSummary = summarizeRenderText(inputText);
  const outputSummary = summarizeRenderText(outputText);
  const blocks: ToolRenderPayload["blocks"] = [];
  if (inputText?.trim()) blocks.push({ type: "text", title: "Input", text: inputText });
  if (outputText?.trim()) blocks.push({ type: "text", title: "Output", text: outputText, isError });
  if (!inputSummary && !outputSummary && blocks.length === 0) return undefined;
  return { version: 2, inputSummary, outputSummary, blocks };
}

export function createCommandRenderPayload(command: string, outputText: string, isError: boolean): ToolRenderPayload {
  return {
    version: 2,
    inputSummary: summarizeRenderText(command, 120),
    outputSummary: summarizeRenderText(outputText, 120),
    blocks: [{ type: "command", command, output: outputText || undefined, isError }],
  };
}

export function createFileRenderPayload(args: {
  filePath: string;
  content?: string;
  offset?: number;
  limit?: number;
  isError?: boolean;
  outputText?: string;
}): ToolRenderPayload {
  return {
    version: 2,
    inputSummary: summarizeRenderText(args.filePath),
    outputSummary: summarizeRenderText(args.outputText),
    blocks: [
      {
        type: "file",
        filePath: args.filePath,
        content: args.content,
        offset: args.offset,
        limit: args.limit,
        isError: args.isError,
      },
    ],
  };
}

export function createEditDiffRenderPayload(args: {
  filePath: string;
  oldString?: string;
  newString?: string;
  outputText: string;
}): ToolRenderPayload {
  const action = args.oldString === "" ? ("Add" as const) : undefined;
  return {
    version: 2,
    inputSummary: summarizeRenderText(args.filePath),
    outputSummary: summarizeRenderText(args.outputText),
    blocks: [
      {
        type: "diff",
        files: [
          {
            filePath: args.filePath,
            action,
            hunks: [{ oldString: args.oldString || undefined, newString: args.newString }],
          },
        ],
        output: args.outputText.split("\n")[0] || undefined,
      },
    ],
  };
}

export function createMultiEditDiffRenderPayload(args: {
  filePath: string;
  edits: Array<{ old_string: string; new_string: string }>;
  outputText: string;
}): ToolRenderPayload {
  return {
    version: 2,
    inputSummary: summarizeRenderText(args.filePath),
    outputSummary: summarizeRenderText(args.outputText),
    blocks: [
      {
        type: "diff",
        files: [
          {
            filePath: args.filePath,
            hunks: args.edits.map((edit) => ({ oldString: edit.old_string || undefined, newString: edit.new_string })),
          },
        ],
        output: args.outputText.split("\n")[0] || undefined,
      },
    ],
  };
}

export function createPatchDiffRenderPayload(patch: string, outputText: string): ToolRenderPayload | undefined {
  const files = parsePatchForRender(patch);
  if (files.length === 0) return undefined;
  return {
    version: 2,
    inputSummary: summarizeRenderText(patch, 120),
    outputSummary: summarizeRenderText(outputText),
    blocks: [{ type: "diff", files, output: outputText.split("\n")[0] || undefined }],
  };
}

export function createGlobRenderPayload(
  input: SearchRenderInput,
  outputText: string,
  options?: SearchRenderPayloadOptions,
): ToolRenderPayload {
  const basePath = readAbsolutePath(input.path);
  const pattern = readTrimmedString(input.pattern);
  const searchPath = readTrimmedString(input.path);
  const displaySearchPath = relativizePathAgainstCwd(searchPath, options?.cwd);
  const rawItems = toOutputLines(outputText);
  const items = relativizeGlobOutputLines(rawItems, basePath);
  const queryItems = buildQueryItems({ pattern, path: displaySearchPath });
  debugRenderPayload("glob_paths", {
    basePath: basePath ?? null,
    itemCount: items.length,
    changedCount: countChangedItems(rawItems, items),
    sampleBefore: rawItems.slice(0, 3),
    sampleAfter: items.slice(0, 3),
  });

  const blocks: ToolRenderPayload["blocks"] = [
    { type: "summary", text: buildSearchSummary(pattern, displaySearchPath), tone: "info" },
    { type: "list", title: buildFoundTitle(items.length, "file"), items },
  ];
  if (queryItems.length > 0) blocks.push({ type: "key_value", title: "Query", items: queryItems });
  return {
    version: 2,
    inputSummary: summarizeRenderText(buildSearchSummary(pattern, displaySearchPath)),
    outputSummary: summarizeRenderText(outputText),
    blocks,
  };
}

export function createGrepRenderPayload(
  input: SearchRenderInput,
  outputText: string,
  options?: SearchRenderPayloadOptions,
): ToolRenderPayload {
  const basePath = readAbsolutePath(input.path);
  const pattern = readTrimmedString(input.pattern);
  const searchPath = readTrimmedString(input.path);
  const displaySearchPath = relativizePathAgainstCwd(searchPath, options?.cwd);
  const rawItems = toOutputLines(outputText);
  const relativizedItems = relativizeGrepOutputLines(rawItems, basePath);
  const items = relativizedItems.filter((line) => !line.startsWith("..."));
  const queryItems = buildQueryItems({ pattern, path: displaySearchPath });
  debugRenderPayload("grep_paths", {
    basePath: basePath ?? null,
    rawCount: rawItems.length,
    itemCount: items.length,
    changedCount: countChangedItems(rawItems, relativizedItems),
    sampleBefore: rawItems.slice(0, 3),
    sampleAfter: relativizedItems.slice(0, 3),
  });

  const blocks: ToolRenderPayload["blocks"] = [
    { type: "summary", text: buildSearchSummary(pattern, displaySearchPath), tone: "info" },
    { type: "list", title: buildFoundTitle(items.length, "match"), items },
  ];
  if (queryItems.length > 0) blocks.push({ type: "key_value", title: "Query", items: queryItems });
  return {
    version: 2,
    inputSummary: summarizeRenderText(buildSearchSummary(pattern, displaySearchPath)),
    outputSummary: summarizeRenderText(outputText),
    blocks,
  };
}

export function createListRenderPayload(outputText: string): ToolRenderPayload | undefined {
  const items = toOutputLines(outputText).filter((line) => !line.startsWith("..."));
  if (items.length === 0) return undefined;
  return { version: 2, outputSummary: summarizeRenderText(outputText), blocks: [{ type: "list", items }] };
}

export function createUpdateKnowledgeRenderPayload(
  input: UpdateKnowledgeRenderInput,
  outputText: string,
  isError: boolean,
): ToolRenderPayload | undefined {
  const actionValue = typeof input.action === "string" ? input.action : "upsert";
  const action = actionValue === "delete" ? "delete" : "upsert";
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const typeValue = typeof input.type === "string" ? input.type.trim() : "";
  const content = typeof input.content === "string" ? input.content : "";
  const confidenceValue =
    typeof input.confidence === "number" && Number.isFinite(input.confidence) ? input.confidence.toFixed(2) : "";
  const tags = Array.isArray(input.tags)
    ? input.tags
        .map((value) => String(value).trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  const contentPreview = content ? clipInlineText(content.replace(/\s+/g, " ").trim(), 140) : "";
  const items = [
    { key: "action", value: action },
    ...(id ? [{ key: "id", value: id }] : []),
    ...(typeValue ? [{ key: "type", value: typeValue }] : []),
    ...(confidenceValue ? [{ key: "confidence", value: confidenceValue }] : []),
    ...(contentPreview ? [{ key: "content", value: contentPreview }] : []),
    ...(tags.length > 0 ? [{ key: "tags", value: tags.join(", ") }] : []),
  ];

  const outputSummary = outputText
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const blocks: ToolRenderPayload["blocks"] = [];
  if (items.length > 0) blocks.push({ type: "key_value", items });
  if (tags.length > 0) {
    blocks.push({ type: "status_badges", title: "Tags", items: tags.map((tag) => ({ label: tag })) });
  }
  if (outputSummary) blocks.push({ type: "summary", text: outputSummary, tone: isError ? "danger" : "success" });
  if (blocks.length === 0) return undefined;

  return {
    version: 2,
    inputSummary: summarizeRenderText(action),
    outputSummary: summarizeRenderText(outputSummary),
    blocks,
  };
}

function clipInlineText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function countChangedItems(before: string[], after: string[]): number {
  const limit = Math.min(before.length, after.length);
  let changedCount = 0;
  for (let index = 0; index < limit; index += 1) {
    if (before[index] !== after[index]) changedCount += 1;
  }
  changedCount += Math.abs(before.length - after.length);
  return changedCount;
}

function isRenderPayloadDebugEnabled(): boolean {
  const value = readProcessEnv("DILIGENT_DEBUG_RENDER_PAYLOAD");
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function debugRenderPayload(event: string, data: Record<string, unknown>): void {
  if (!isRenderPayloadDebugEnabled()) return;
  console.debug("[render-payload]", event, data);
}

function buildSearchSummary(pattern?: string, path?: string): string {
  const parts: string[] = [];
  if (pattern) parts.push(`pattern: ${JSON.stringify(pattern)}`);
  if (path) parts.push(`path: ${JSON.stringify(path)}`);
  if (parts.length === 0) return "Search";
  return `Search(${parts.join(", ")})`;
}

function buildFoundTitle(count: number, singularNoun: string): string {
  const noun = pluralizeNoun(singularNoun, count);
  return `└ Found ${count} ${noun}`;
}

function pluralizeNoun(singularNoun: string, count: number): string {
  if (count === 1) return singularNoun;
  if (singularNoun === "match") return "matches";
  return `${singularNoun}s`;
}

function buildQueryItems(values: { pattern?: string; path?: string }): Array<{ key: string; value: string }> {
  const items: Array<{ key: string; value: string }> = [];
  if (values.pattern) items.push({ key: "pattern", value: values.pattern });
  if (values.path) items.push({ key: "path", value: values.path });
  return items;
}

function relativizePathAgainstCwd(pathValue: string | undefined, cwdOverride?: string): string | undefined {
  if (!pathValue) return undefined;
  const normalized = normalizePath(pathValue);
  if (!isAbsolutePath(normalized)) return pathValue;
  if (!cwdOverride) return normalized;
  return maybeRelativePath(normalized, cwdOverride);
}

function readProcessEnv(name: string): string | undefined {
  const proc = typeof process !== "undefined" ? process : undefined;
  const value = proc?.env?.[name];
  return typeof value === "string" ? value : undefined;
}

function readTrimmedString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toOutputLines(outputText: string): string[] {
  return outputText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readAbsolutePath(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizePath(value);
  return isAbsolutePath(normalized) ? normalized : undefined;
}

function relativizeGlobOutputLines(lines: string[], basePath?: string): string[] {
  if (!basePath) return lines;
  return lines.map((line) => (line.startsWith("...") ? line : maybeRelativePath(line, basePath)));
}

function relativizeGrepOutputLines(lines: string[], basePath?: string): string[] {
  if (!basePath) return lines;
  return lines.map((line) => {
    if (line.startsWith("...")) return line;
    const parsedLine = splitGrepOutputLine(line);
    if (!parsedLine) return line;
    const relativePath = maybeRelativePathAgainstSearchScope(parsedLine.path, basePath);
    return `${relativePath}${parsedLine.suffix}`;
  });
}

function splitGrepOutputLine(line: string): { path: string; suffix: string } | undefined {
  const markerRegex = /([:-])\d+([:-])/g;
  for (const match of line.matchAll(markerRegex)) {
    const markerStart = match.index;
    if (markerStart === undefined || markerStart <= 0) continue;
    const candidatePath = line.slice(0, markerStart);
    if (!isAbsolutePath(candidatePath)) continue;
    return { path: candidatePath, suffix: line.slice(markerStart) };
  }
  return undefined;
}

function maybeRelativePathAgainstSearchScope(absPath: string, searchPath: string): string {
  const fromSearchPath = maybeRelativePath(absPath, searchPath);
  if (fromSearchPath !== absPath && fromSearchPath !== ".") return fromSearchPath;

  const parent = dirname(searchPath);
  if (!parent) return absPath;
  const fromParent = maybeRelativePath(absPath, parent);
  return fromParent === "." ? absPath : fromParent;
}

function maybeRelativePath(value: string, basePath: string): string {
  const path = normalizePath(value);
  const base = normalizePath(basePath);
  if (!isAbsolutePath(path) || !isAbsolutePath(base)) return value;

  const pathDrive = getDrive(path);
  const baseDrive = getDrive(base);
  if (pathDrive && baseDrive && pathDrive.toLowerCase() !== baseDrive.toLowerCase()) return value;

  const normalizedBase = trimTrailingSlash(base);
  if (path === normalizedBase) return ".";

  const comparePath = pathDrive ? path.toLowerCase() : path;
  const compareBase = pathDrive ? normalizedBase.toLowerCase() : normalizedBase;
  const prefix = `${compareBase}/`;
  if (!comparePath.startsWith(prefix)) return value;

  return path.slice(normalizedBase.length + 1);
}

function dirname(pathValue: string): string | undefined {
  const path = trimTrailingSlash(normalizePath(pathValue));
  const slash = path.lastIndexOf("/");
  if (slash < 0) return undefined;
  if (slash === 0) return "/";
  if (/^[a-zA-Z]:$/.test(path.slice(0, slash))) return `${path.slice(0, slash)}/`;
  return path.slice(0, slash);
}

function trimTrailingSlash(pathValue: string): string {
  if (pathValue === "/") return pathValue;
  if (/^[a-zA-Z]:\/$/.test(pathValue)) return pathValue;
  return pathValue.endsWith("/") ? pathValue.slice(0, -1) : pathValue;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function getDrive(pathValue: string): string | undefined {
  const match = pathValue.match(/^([a-zA-Z]:)\//);
  return match?.[1];
}

function isAbsolutePath(pathValue: string): boolean {
  if (pathValue.startsWith("/")) return true;
  return /^[a-zA-Z]:\//.test(pathValue);
}

function parsePatchForRender(patch: string): DiffFile[] {
  const lines = patch.split("\n");
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldLines: string[] = [];
  let newLines: string[] = [];

  const flushHunk = () => {
    if (!current) return;
    if (oldLines.length > 0 || newLines.length > 0) {
      current.hunks.push({ oldString: oldLines.join("\n") || undefined, newString: newLines.join("\n") });
      oldLines = [];
      newLines = [];
    }
  };

  const flushFile = () => {
    flushHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    const addMatch = line.match(/^\*\*\* Add File: (.+)$/);
    if (addMatch) {
      flushFile();
      current = { filePath: addMatch[1].trim(), action: "Add", hunks: [] };
      continue;
    }

    const deleteMatch = line.match(/^\*\*\* Delete File: (.+)$/);
    if (deleteMatch) {
      flushFile();
      current = { filePath: deleteMatch[1].trim(), action: "Delete", hunks: [] };
      continue;
    }

    const updateMatch = line.match(/^\*\*\* Update File: (.+)$/);
    if (updateMatch) {
      flushFile();
      current = { filePath: updateMatch[1].trim(), action: "Update", hunks: [] };
      continue;
    }

    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveMatch && current) {
      current.movedTo = moveMatch[1].trim();
      current.action = "Move";
      continue;
    }

    if (!current) continue;
    if (line.startsWith("@@")) {
      flushHunk();
      continue;
    }
    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }

  flushFile();
  return files;
}
