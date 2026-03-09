// @summary Tool display name, icon, and category mapping for compact ToolCallRow rendering
import type { ToolRenderPayload } from "@diligent/protocol";

export interface ToolInfo {
  displayName: string;
  icon: string;
  category: "context" | "action";
}

// Keys are lowercase for case-insensitive matching
const TOOL_MAP: Record<string, ToolInfo> = {
  read: { displayName: "Read", icon: "↗", category: "context" },
  grep: { displayName: "Grep", icon: "⌕", category: "context" },
  glob: { displayName: "Glob", icon: "⌕", category: "context" },
  ls: { displayName: "List", icon: "≡", category: "context" },
  bash: { displayName: "Shell", icon: ">_", category: "action" },
  write: { displayName: "Write", icon: "✎", category: "action" },
  apply_patch: { displayName: "Patch", icon: "✎", category: "action" },
  multiedit: { displayName: "Edit", icon: "✎", category: "action" },
  agent: { displayName: "Agent", icon: "◈", category: "action" },
  webfetch: { displayName: "Fetch", icon: "↓", category: "context" },
  websearch: { displayName: "Search", icon: "⌕", category: "context" },
  todowrite: { displayName: "Todo", icon: "☑", category: "action" },
  todoread: { displayName: "Todo", icon: "☑", category: "context" },
  request_user_input: { displayName: "Input", icon: "?", category: "context" },
  notebookedit: { displayName: "Notebook", icon: "✎", category: "action" },
  notebookread: { displayName: "Notebook", icon: "↗", category: "context" },
  plan: { displayName: "Plan", icon: "◇", category: "action" },
  spawn_agent: { displayName: "Spawn", icon: "◈", category: "action" },
  wait: { displayName: "Wait", icon: "⏳", category: "action" },
  close_agent: { displayName: "Close", icon: "✕", category: "action" },
  send_input: { displayName: "Send", icon: "→", category: "action" },
  add_knowledge: { displayName: "Knowledge", icon: "✦", category: "action" },
  taskwrite: { displayName: "Task", icon: "☑", category: "action" },
  taskcreate: { displayName: "Task", icon: "☑", category: "action" },
  taskupdate: { displayName: "Task", icon: "☑", category: "action" },
  taskget: { displayName: "Task", icon: "☑", category: "context" },
  tasklist: { displayName: "Tasks", icon: "≡", category: "context" },
};

export function getToolInfo(toolName: string): ToolInfo {
  return TOOL_MAP[toolName.toLowerCase()] ?? { displayName: toolName, icon: "⚙", category: "action" };
}

export function formatToolDurationMs(durationMs?: number): string | null {
  if (durationMs === undefined || Number.isNaN(durationMs) || durationMs < 0) return null;
  return `${Math.round(durationMs)}ms`;
}

function clip(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max - 3)}…` : value;
}

function stringifySingleLineJson(value: unknown): string | undefined {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" && text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

function readStringField(parsed: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function summarizePathForUi(value: string): string {
  const path = value.trim();
  if (!path) return path;
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length === 1) return parts[0];
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function extractPatchTargetPath(patch: string): string | undefined {
  const lines = patch.split("\n");
  for (const line of lines) {
    const m = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

export function parseRequestUserInputTitle(parsed: Record<string, unknown>): string | undefined {
  const questions = parsed.questions;
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  const first = questions[0];
  if (!first || typeof first !== "object") return undefined;
  const firstQuestion = first as Record<string, unknown>;
  const question = firstQuestion.question;
  if (typeof question === "string" && question.trim().length > 0) return question.trim();
  const header = firstQuestion.header;
  if (typeof header === "string" && header.trim().length > 0) return header.trim();
  return undefined;
}

export function parseRequestUserInputTitleFromOutput(outputText: string): string | undefined {
  const firstLine = outputText.split("\n")[0]?.trim();
  if (!firstLine) return undefined;
  const lineMatch = firstLine.match(/^\[[^\]]+\]\s*(.+)$/);
  if (lineMatch?.[1]?.trim()) return lineMatch[1].trim();
  const headerMatch = firstLine.match(/^\[([^\]]+)\]/);
  return headerMatch?.[1]?.trim();
}

/**
 * Build the short header title shown in tool call rows.
 * Example: request_user_input -> "Ask - scope"
 */
export function getToolHeaderTitle(toolName: string, inputText: string, outputText = ""): string {
  const { displayName } = getToolInfo(toolName);
  const normalizedName = toolName.toLowerCase();
  if (normalizedName === "request_user_input") {
    try {
      const parsed = JSON.parse(inputText) as Record<string, unknown>;
      const title = parseRequestUserInputTitle(parsed);
      if (title) return `Question - ${clip(title, 72)}`;
    } catch {
      // Fall through to output parser
    }
    const outputTitle = parseRequestUserInputTitleFromOutput(outputText);
    return outputTitle ? `Question - ${clip(outputTitle, 72)}` : "Question";
  }
  if (normalizedName === "plan") {
    return parsePlanHeaderTitle(inputText);
  }
  if (
    normalizedName === "edit" ||
    normalizedName === "multiedit" ||
    normalizedName === "multi_edit" ||
    normalizedName === "write"
  ) {
    try {
      const parsed = JSON.parse(inputText) as Record<string, unknown>;
      const filePath = readStringField(parsed, ["file_path"]);
      if (filePath) return `${displayName} — ${clip(summarizePathForUi(filePath), 60)}`;
    } catch {
      // fall through
    }
  }
  void inputText;
  return displayName;
}

type PlanHeaderStep = { text: string; status?: "pending" | "in_progress" | "done" };

function parsePlanHeaderTitle(inputText: string): string {
  try {
    const parsed = JSON.parse(inputText) as Record<string, unknown>;
    if (parsed.close === true) return "Plan — Closed";
    const steps = parsed.steps as PlanHeaderStep[] | undefined;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    if (!steps || !Array.isArray(steps)) return title ? `Plan — ${clip(title, 50)}` : "Plan";
    const doneCount = steps.filter((step) => step.status === "done").length;
    const totalCount = steps.length;
    const progress = `${doneCount}/${totalCount}`;
    const label = doneCount === 0 ? "Created" : doneCount === totalCount ? "Done" : "Updated";
    const suffix = title ? ` — ${clip(title, 40)}` : "";
    return `Plan ${label} ${progress}${suffix}`;
  } catch {
    return "Plan";
  }
}

export function isContextTool(toolName: string): boolean {
  return getToolInfo(toolName).category === "context";
}

export function isBashTool(toolName: string): boolean {
  return toolName.toLowerCase() === "bash";
}

/** Extract a short human-readable summary from tool output text */
export function summarizeOutput(toolName: string, outputText: string): string {
  if (!outputText.trim()) return "";
  const name = toolName.toLowerCase();

  if (name === "request_user_input") {
    const title = parseRequestUserInputTitleFromOutput(outputText);
    return title ? clip(title, 80) : "";
  }

  const firstLine = outputText
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";

  return clip(firstLine, name === "bash" ? 120 : 80);
}

/** Extract a short human-readable summary from tool input text */
export function summarizeInput(toolName: string, inputText: string): string {
  if (!inputText.trim()) return "";
  const _toolName = toolName;
  const normalizedName = _toolName.toLowerCase();

  try {
    const parsed = JSON.parse(inputText) as Record<string, unknown>;

    if (normalizedName === "request_user_input") {
      const title = parseRequestUserInputTitle(parsed);
      if (title) return clip(title, 80);
    }

    // Plan: headerTitle already carries all useful info
    if (normalizedName === "plan") return "";

    if (normalizedName === "read") {
      const filePath = readStringField(parsed, ["file_path"]);
      return filePath ? `Read ${clip(summarizePathForUi(filePath), 72)}` : "";
    }

    if (normalizedName === "write") {
      const filePath = readStringField(parsed, ["file_path"]);
      return filePath ? `Write ${clip(summarizePathForUi(filePath), 72)}` : "";
    }

    if (normalizedName === "edit") {
      const filePath = readStringField(parsed, ["file_path"]);
      return filePath ? `Edit ${clip(summarizePathForUi(filePath), 72)}` : "";
    }

    if (normalizedName === "multiedit" || normalizedName === "multi_edit") {
      const filePath = readStringField(parsed, ["file_path"]);
      return filePath ? `Edit ${clip(summarizePathForUi(filePath), 72)}` : "";
    }

    if (normalizedName === "apply_patch") {
      const patchText = readStringField(parsed, ["patch"]);
      if (!patchText) return "";
      const target = extractPatchTargetPath(patchText);
      return target ? `Patch ${clip(summarizePathForUi(target), 72)}` : "";
    }

    const intent = readStringField(parsed, [
      "intent",
      "prompt",
      "description",
      "explanation",
      "query",
      "question",
      "message",
      "command",
      "path",
    ]);
    if (intent) return clip(intent, normalizedName === "bash" ? 120 : 80);

    const jsonPreview = stringifySingleLineJson(parsed);
    if (jsonPreview) return clip(jsonPreview, normalizedName === "bash" ? 120 : 80);
  } catch {
    // Ignore JSON parse errors and fall back to raw text
  }

  const firstLine = inputText
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";
  return clip(firstLine, normalizedName === "bash" ? 120 : 80);
}

/**
 * Derive a ToolRenderPayload from tool name + raw input/output text.
 * Used as fallback when item.render is absent (e.g. hydrated from session history).
 */
export function deriveRenderPayload(
  toolName: string,
  inputText: string,
  outputText: string,
): ToolRenderPayload | undefined {
  const name = toolName.toLowerCase();
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(inputText) as Record<string, unknown>;
  } catch {
    // not JSON — only bash fallback below will work
  }

  // bash → command block
  if (name === "bash" && parsed) {
    const command = typeof parsed.command === "string" ? parsed.command : undefined;
    if (command) {
      return {
        version: 1,
        blocks: [{ type: "command", command, output: outputText || undefined, isError: false }],
      };
    }
  }

  // read → file block (outputText has line numbers; strip them for display)
  if (name === "read" && parsed) {
    const filePath = typeof parsed.file_path === "string" ? parsed.file_path : undefined;
    if (filePath) {
      const rawContent = outputText
        .split("\n")
        .map((line) => line.replace(/^\s*\d+\t/, ""))
        .join("\n");
      return {
        version: 1,
        blocks: [
          {
            type: "file",
            filePath,
            content: rawContent || undefined,
            offset: typeof parsed.offset === "number" ? parsed.offset : undefined,
            limit: typeof parsed.limit === "number" ? parsed.limit : undefined,
          },
        ],
      };
    }
  }

  // write → file block
  if (name === "write" && parsed) {
    const filePath = typeof parsed.file_path === "string" ? parsed.file_path : undefined;
    const content = typeof parsed.content === "string" ? parsed.content : undefined;
    if (filePath) {
      return { version: 1, blocks: [{ type: "file", filePath, content }] };
    }
  }

  // edit → diff block
  if (name === "edit" && parsed) {
    const filePath = typeof parsed.file_path === "string" ? parsed.file_path : undefined;
    const oldString = typeof parsed.old_string === "string" ? parsed.old_string : undefined;
    const newString = typeof parsed.new_string === "string" ? parsed.new_string : undefined;
    if (filePath) {
      const action = oldString === "" ? ("Add" as const) : undefined;
      return {
        version: 1,
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

  // multi_edit → diff block
  if ((name === "multi_edit" || name === "multiedit") && parsed) {
    const filePath = typeof parsed.file_path === "string" ? parsed.file_path : undefined;
    const edits = Array.isArray(parsed.edits) ? parsed.edits : undefined;
    if (filePath && edits) {
      const hunks = edits.map((e: Record<string, unknown>) => ({
        oldString: typeof e.old_string === "string" ? e.old_string : undefined,
        newString: typeof e.new_string === "string" ? e.new_string : undefined,
      }));
      return {
        version: 1,
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

  // apply_patch → diff block (parse the patch text client-side)
  if (name === "apply_patch" && parsed) {
    const patch = typeof parsed.patch === "string" ? parsed.patch : undefined;
    if (patch) {
      const files = parsePatchForRender(patch);
      if (files.length > 0) {
        return {
          version: 1,
          blocks: [{ type: "diff", files, output: outputText.split("\n")[0] || undefined }],
        };
      }
    }
  }

  // glob → list (output: file paths one per line)
  if (name === "glob") {
    const lines = outputText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      return { version: 1, blocks: [{ type: "list", title: "Files", items: lines }] };
    }
  }

  // ls → list
  if (name === "ls") {
    const lines = outputText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith("...")); // exclude truncation notes
    if (lines.length > 0) {
      return { version: 1, blocks: [{ type: "list", items: lines }] };
    }
  }

  // grep → list (output: path:line:content format)
  if (name === "grep") {
    const lines = outputText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith("..."));
    if (lines.length > 0) {
      return { version: 1, blocks: [{ type: "list", items: lines }] };
    }
  }

  // add_knowledge → key_value
  if (name === "add_knowledge" && parsed) {
    const type_ = typeof parsed.type === "string" ? parsed.type : "";
    const content = typeof parsed.content === "string" ? parsed.content : "";
    const confidence = typeof parsed.confidence === "number" ? String(parsed.confidence) : "";
    const tags = Array.isArray(parsed.tags) ? (parsed.tags as string[]).join(", ") : "";
    const items = [
      { key: "type", value: type_ },
      { key: "content", value: content },
      ...(confidence ? [{ key: "confidence", value: confidence }] : []),
      ...(tags ? [{ key: "tags", value: tags }] : []),
    ].filter((i) => i.value);
    if (items.length > 0) {
      return { version: 1, blocks: [{ type: "key_value", items }] };
    }
  }

  // spawn_agent, wait, close_agent, send_input → summary
  if (["spawn_agent", "wait", "close_agent", "send_input"].includes(name)) {
    const firstLine = outputText.split("\n")[0]?.trim();
    if (firstLine) {
      return { version: 1, blocks: [{ type: "summary", text: firstLine, tone: "info" }] };
    }
  }

  return undefined;
}

function parsePatchForRender(patch: string): import("@diligent/protocol").DiffFile[] {
  const lines = patch.split("\n");
  const files: import("@diligent/protocol").DiffFile[] = [];
  let current: import("@diligent/protocol").DiffFile | null = null;
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
    const delMatch = line.match(/^\*\*\* Delete File: (.+)$/);
    if (delMatch) {
      flushFile();
      current = { filePath: delMatch[1].trim(), action: "Delete", hunks: [] };
      continue;
    }
    const updMatch = line.match(/^\*\*\* Update File: (.+)$/);
    if (updMatch) {
      flushFile();
      current = { filePath: updMatch[1].trim(), action: "Update", hunks: [] };
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
    if (line.startsWith("+")) newLines.push(line.slice(1));
    else if (line.startsWith("-")) oldLines.push(line.slice(1));
    // context lines ( ) contribute to both sides
    else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }
  flushFile();
  return files;
}
