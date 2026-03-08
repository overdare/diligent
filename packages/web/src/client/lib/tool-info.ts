// @summary Tool display name, icon, and category mapping for compact ToolCallRow rendering

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
  const parts = path.split("/").filter(Boolean);
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
