// @summary Tool display name, icon, and category mapping for compact ToolCallRow rendering

export interface ToolInfo {
  displayName: string;
  icon: string;
  category: "context" | "action";
}

const TOOL_MAP: Record<string, ToolInfo> = {
  Read: { displayName: "Read", icon: "↗", category: "context" },
  Grep: { displayName: "Search", icon: "⌕", category: "context" },
  Glob: { displayName: "Find", icon: "⌕", category: "context" },
  LS: { displayName: "List", icon: "≡", category: "context" },
  Bash: { displayName: "Shell", icon: ">_", category: "action" },
  Write: { displayName: "Write", icon: "✎", category: "action" },
  Edit: { displayName: "Edit", icon: "✎", category: "action" },
  MultiEdit: { displayName: "Edit", icon: "✎", category: "action" },
  Agent: { displayName: "Agent", icon: "◈", category: "action" },
  WebFetch: { displayName: "Fetch", icon: "↓", category: "context" },
  WebSearch: { displayName: "Search", icon: "⌕", category: "context" },
  TodoWrite: { displayName: "Todo", icon: "☑", category: "action" },
  TodoRead: { displayName: "Todo", icon: "☑", category: "context" },
};

export function getToolInfo(toolName: string): ToolInfo {
  return TOOL_MAP[toolName] ?? { displayName: toolName, icon: "⚙", category: "action" };
}

export function isContextTool(toolName: string): boolean {
  return getToolInfo(toolName).category === "context";
}

/** Extract a short human-readable summary from tool input JSON */
export function summarizeInput(_toolName: string, inputText: string): string {
  try {
    const parsed = JSON.parse(inputText) as Record<string, unknown>;

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
    if (query) return `"${query}"`;

    const description = parsed.description as string | undefined;
    if (description) return description.length > 60 ? `${description.slice(0, 57)}…` : description;

    return "";
  } catch {
    return inputText.length > 60 ? `${inputText.slice(0, 57)}…` : inputText;
  }
}
