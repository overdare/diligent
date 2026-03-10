type RenderBlock = Record<string, unknown>;

type ToolRenderPayload = {
  version: 1;
  blocks: RenderBlock[];
};

export function buildValidateLuaRender(filePath: string, output: string): ToolRenderPayload {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (output.includes("No issues found. Code is valid.")) {
    return {
      version: 1,
      blocks: [
        { type: "key_value", title: "Luau validation", items: [{ key: "path", value: filePath }, { key: "issues", value: "0" }] },
        { type: "summary", text: "No issues found. Code is valid.", tone: "success" },
      ],
    };
  }

  const statusItems = lines.filter((line) => line.startsWith("[OK]") || /^\[\d+ issue\(s\)\]/.test(line)).slice(0, 20);
  return {
    version: 1,
    blocks: [
      { type: "key_value", title: "Luau validation", items: [{ key: "path", value: filePath }, { key: "lines", value: String(lines.length) }] },
      ...(statusItems.length > 0 ? [{ type: "list" as const, title: "Files", items: statusItems }] : []),
      { type: "file", filePath, content: output, isError: true },
    ],
  };
}
