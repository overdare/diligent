// @summary Runtime utility deriving ToolRenderPayload from tool name/input/output for unified Web/TUI rendering

import type { DiffFile, ToolRenderPayload } from "@diligent/protocol";

export interface DeriveToolRenderPayloadOptions {
  cwd?: string;
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
  if (inputText?.trim()) {
    blocks.push({ type: "text", title: "Input", text: inputText });
  }
  if (outputText?.trim()) {
    blocks.push({ type: "text", title: "Output", text: outputText, isError });
  }
  if (!inputSummary && !outputSummary && blocks.length === 0) return undefined;
  return {
    version: 2,
    inputSummary,
    outputSummary,
    blocks,
  };
}

export function deriveToolRenderPayload(
  toolName: string,
  input: unknown,
  outputText: string,
  isError: boolean,
  options?: DeriveToolRenderPayloadOptions,
): ToolRenderPayload | undefined {
  const name = toolName.toLowerCase();
  const parsed = toRecord(input);
  debugRenderPayload("start", {
    toolName,
    normalizedName: name,
    inputKeys: parsed ? Object.keys(parsed).sort() : [],
    outputLines: outputText ? outputText.split("\n").length : 0,
    isError,
  });

  if (name === "bash" && parsed) {
    const command = typeof parsed.command === "string" ? parsed.command : undefined;
    if (command) {
      return {
        version: 2,
        inputSummary: summarizeRenderText(command, 120),
        outputSummary: summarizeRenderText(outputText, 120),
        blocks: [{ type: "command", command, output: outputText || undefined, isError }],
      };
    }
  }

  if (name === "read" && parsed) {
    const filePath = typeof parsed.file_path === "string" ? parsed.file_path : undefined;
    if (filePath) {
      const rawContent = outputText
        .split("\n")
        .map((line) => line.replace(/^\s*\d+\t/, ""))
        .join("\n");
      return {
        version: 2,
        inputSummary: summarizeRenderText(filePath),
        outputSummary: summarizeRenderText(outputText),
        blocks: [
          {
            type: "file",
            filePath,
            content: rawContent || undefined,
            offset: typeof parsed.offset === "number" ? parsed.offset : undefined,
            limit: typeof parsed.limit === "number" ? parsed.limit : undefined,
            isError,
          },
        ],
      };
    }
  }

  if (name === "write" && parsed) {
    const filePath = typeof parsed.file_path === "string" ? parsed.file_path : undefined;
    const content = typeof parsed.content === "string" ? parsed.content : undefined;
    if (filePath) {
      return {
        version: 2,
        inputSummary: summarizeRenderText(filePath),
        outputSummary: summarizeRenderText(outputText),
        blocks: [{ type: "file", filePath, content, isError }],
      };
    }
  }

  if (name === "edit" && parsed) {
    const filePath = typeof parsed.file_path === "string" ? parsed.file_path : undefined;
    const oldString = typeof parsed.old_string === "string" ? parsed.old_string : undefined;
    const newString = typeof parsed.new_string === "string" ? parsed.new_string : undefined;
    if (filePath) {
      const action = oldString === "" ? ("Add" as const) : undefined;
      return {
        version: 2,
        inputSummary: summarizeRenderText(filePath),
        outputSummary: summarizeRenderText(outputText),
        blocks: [
          {
            type: "diff",
            files: [{ filePath, action, hunks: [{ oldString: oldString || undefined, newString }] }],
            output: outputText.split("\n")[0] || undefined,
          },
        ],
      };
    }
  }

  if ((name === "multi_edit" || name === "multiedit") && parsed) {
    const filePath = typeof parsed.file_path === "string" ? parsed.file_path : undefined;
    const edits = Array.isArray(parsed.edits) ? parsed.edits : undefined;
    if (filePath && edits) {
      const hunks = edits
        .map((edit) => toRecord(edit))
        .filter((edit): edit is Record<string, unknown> => !!edit)
        .map((edit) => ({
          oldString: typeof edit.old_string === "string" ? edit.old_string : undefined,
          newString: typeof edit.new_string === "string" ? edit.new_string : undefined,
        }));
      return {
        version: 2,
        inputSummary: summarizeRenderText(filePath),
        outputSummary: summarizeRenderText(outputText),
        blocks: [
          {
            type: "diff",
            files: [{ filePath, hunks }],
            output: outputText.split("\n")[0] || undefined,
          },
        ],
      };
    }
  }

  if (name === "apply_patch" && parsed) {
    const patch = typeof parsed.patch === "string" ? parsed.patch : undefined;
    if (patch) {
      const files = parsePatchForRender(patch);
      if (files.length > 0) {
        return {
          version: 2,
          inputSummary: summarizeRenderText(patch, 120),
          outputSummary: summarizeRenderText(outputText),
          blocks: [{ type: "diff", files, output: outputText.split("\n")[0] || undefined }],
        };
      }
    }
  }

  if (name === "glob") {
    const basePath = readAbsolutePathFromInput(parsed, "path");
    const pattern = readStringFromInput(parsed, "pattern");
    const searchPath = readStringFromInput(parsed, "path");
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
    if (queryItems.length > 0) {
      blocks.push({ type: "key_value", title: "Query", items: queryItems });
    }
    return {
      version: 2,
      inputSummary: summarizeRenderText(buildSearchSummary(pattern, displaySearchPath)),
      outputSummary: summarizeRenderText(outputText),
      blocks,
    };
  }

  if (name === "ls") {
    const items = toOutputLines(outputText).filter((line) => !line.startsWith("..."));
    if (items.length > 0) {
      return {
        version: 2,
        outputSummary: summarizeRenderText(outputText),
        blocks: [{ type: "list", items }],
      };
    }
  }

  if (name === "grep") {
    const basePath = readAbsolutePathFromInput(parsed, "path");
    const pattern = readStringFromInput(parsed, "pattern");
    const searchPath = readStringFromInput(parsed, "path");
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
    if (queryItems.length > 0) {
      blocks.push({ type: "key_value", title: "Query", items: queryItems });
    }
    return {
      version: 2,
      inputSummary: summarizeRenderText(buildSearchSummary(pattern, displaySearchPath)),
      outputSummary: summarizeRenderText(outputText),
      blocks,
    };
  }

  if (name === "update_knowledge" && parsed) {
    const actionValue = typeof parsed.action === "string" ? parsed.action : "upsert";
    const action = actionValue === "delete" ? "delete" : "upsert";
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    const typeValue = typeof parsed.type === "string" ? parsed.type.trim() : "";
    const content = typeof parsed.content === "string" ? parsed.content : "";
    const confidenceValue =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? parsed.confidence.toFixed(2) : "";
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
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

    if (items.length > 0) {
      blocks.push({ type: "key_value", items });
    }

    if (tags.length > 0) {
      blocks.push({
        type: "status_badges",
        title: "Tags",
        items: tags.map((tag) => ({ label: tag })),
      });
    }

    if (outputSummary) {
      blocks.push({
        type: "summary",
        text: outputSummary,
        tone: isError ? "danger" : "success",
      });
    }

    if (blocks.length > 0) {
      return {
        version: 2,
        inputSummary: summarizeRenderText(action),
        outputSummary: summarizeRenderText(outputSummary),
        blocks,
      };
    }
  }

  if (["spawn_agent", "wait", "close_agent", "send_input"].includes(name)) {
    const firstLine = outputText.split("\n")[0]?.trim();
    if (firstLine) {
      return {
        version: 2,
        outputSummary: summarizeRenderText(firstLine),
        blocks: [{ type: "summary", text: firstLine, tone: "info" }],
      };
    }
  }

  return undefined;
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

function readStringFromInput(parsed: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = parsed?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toOutputLines(outputText: string): string[] {
  return outputText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readAbsolutePathFromInput(parsed: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = parsed?.[key];
  if (typeof value !== "string") return undefined;
  const normalized = normalizePath(value);
  return isAbsolutePath(normalized) ? normalized : undefined;
}

function relativizeGlobOutputLines(lines: string[], basePath?: string): string[] {
  if (!basePath) return lines;
  return lines.map((line) => {
    if (line.startsWith("...")) return line;
    return maybeRelativePath(line, basePath);
  });
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
  if (fromSearchPath !== absPath && fromSearchPath !== ".") {
    return fromSearchPath;
  }

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
  if (pathDrive && baseDrive && pathDrive.toLowerCase() !== baseDrive.toLowerCase()) {
    return value;
  }

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
  if (/^[a-zA-Z]:$/.test(path.slice(0, slash))) {
    return `${path.slice(0, slash)}/`;
  }
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
