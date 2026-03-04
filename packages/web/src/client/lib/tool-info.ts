// @summary Tool display name, icon, and category mapping for compact ToolCallRow rendering

export interface ToolInfo {
  displayName: string;
  icon: string;
  category: "context" | "action";
}

// Keys are lowercase for case-insensitive matching
const TOOL_MAP: Record<string, ToolInfo> = {
  read: { displayName: "Read", icon: "↗", category: "context" },
  grep: { displayName: "Search", icon: "⌕", category: "context" },
  glob: { displayName: "Find", icon: "⌕", category: "context" },
  ls: { displayName: "List", icon: "≡", category: "context" },
  bash: { displayName: "Shell", icon: ">_", category: "action" },
  write: { displayName: "Write", icon: "✎", category: "action" },
  edit: { displayName: "Edit", icon: "✎", category: "action" },
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
  task: { displayName: "Task", icon: "◈", category: "action" },
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
  void inputText;
  return displayName;
}

export function isContextTool(toolName: string): boolean {
  return getToolInfo(toolName).category === "context";
}

export function isBashTool(toolName: string): boolean {
  return toolName.toLowerCase() === "bash";
}

/** Extract a short human-readable summary from tool input JSON */
export function summarizeInput(_toolName: string, inputText: string): string {
  try {
    const parsed = JSON.parse(inputText) as Record<string, unknown>;

    if (_toolName.toLowerCase() === "request_user_input") {
      const title = parseRequestUserInputTitle(parsed);
      return title ? clip(title, 60) : "";
    }

    const intent = readStringField(parsed, [
      "description",
      "prompt",
      "message",
      "query",
      "reason",
      "title",
      "summary",
      "goal",
      "objective",
    ]);
    if (intent) return clip(intent);

    const path =
      (parsed.file_path as string | undefined) ??
      (parsed.path as string | undefined) ??
      (parsed.notebook_path as string | undefined);

    if (path) {
      const segments = path.split("/");
      return segments.slice(-2).join("/");
    }

    const pattern = parsed.pattern as string | undefined;
    if (pattern) return `"${pattern}"`;

    const command = parsed.command as string | undefined;
    if (command) return command.length > 60 ? `${command.slice(0, 57)}…` : command;

    const query = parsed.query as string | undefined;
    if (query) return `"${clip(query)}"`;

    const description = parsed.description as string | undefined;
    if (description) return clip(description);

    return "";
  } catch {
    return clip(inputText);
  }
}
