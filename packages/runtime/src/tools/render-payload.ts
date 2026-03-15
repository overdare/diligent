// @summary Runtime utility deriving ToolRenderPayload from tool name/input/output for unified Web/TUI rendering

import type { DiffFile, ToolRenderPayload } from "@diligent/protocol";

export function deriveToolRenderPayload(
  toolName: string,
  input: unknown,
  outputText: string,
  isError: boolean,
): ToolRenderPayload | undefined {
  const name = toolName.toLowerCase();
  const parsed = toRecord(input);

  if (name === "bash" && parsed) {
    const command = typeof parsed.command === "string" ? parsed.command : undefined;
    if (command) {
      return {
        version: 1,
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
        version: 1,
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
      return { version: 1, blocks: [{ type: "file", filePath, content, isError }] };
    }
  }

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

  if (name === "glob") {
    const items = toOutputLines(outputText);
    if (items.length > 0) {
      return { version: 1, blocks: [{ type: "list", title: "Files", items }] };
    }
  }

  if (name === "ls") {
    const items = toOutputLines(outputText).filter((line) => !line.startsWith("..."));
    if (items.length > 0) {
      return { version: 1, blocks: [{ type: "list", items }] };
    }
  }

  if (name === "grep") {
    const items = toOutputLines(outputText).filter((line) => !line.startsWith("..."));
    if (items.length > 0) {
      return { version: 1, blocks: [{ type: "list", items }] };
    }
  }

  if (name === "update_knowledge" && parsed) {
    const action = typeof parsed.action === "string" ? parsed.action : "upsert";
    const id = typeof parsed.id === "string" ? parsed.id : "";
    const typeValue = typeof parsed.type === "string" ? parsed.type : "";
    const content = typeof parsed.content === "string" ? parsed.content : "";
    const confidence = typeof parsed.confidence === "number" ? String(parsed.confidence) : "";
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map((v) => String(v)).join(", ") : "";
    const items = [
      { key: "action", value: action },
      ...(id ? [{ key: "id", value: id }] : []),
      ...(typeValue ? [{ key: "type", value: typeValue }] : []),
      ...(content ? [{ key: "content", value: content }] : []),
      ...(confidence ? [{ key: "confidence", value: confidence }] : []),
      ...(tags ? [{ key: "tags", value: tags }] : []),
    ].filter((item) => item.value);
    if (items.length > 0) {
      return { version: 1, blocks: [{ type: "key_value", items }] };
    }
  }

  if (["spawn_agent", "wait", "close_agent", "send_input"].includes(name)) {
    const firstLine = outputText.split("\n")[0]?.trim();
    if (firstLine) {
      return { version: 1, blocks: [{ type: "summary", text: firstLine, tone: "info" }] };
    }
  }

  return undefined;
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
