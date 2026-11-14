// @summary TUI project file previews using the shared file/read protocol
import { parseFileLink } from "@diligent/runtime/client";
import { renderMarkdown } from "../../markdown";
import type { Command } from "../types";

export const fileCommand: Command = {
  name: "file",
  description: "Preview a project file or folder: /file <path>",
  supportsArgs: true,
  availableDuringTask: true,
  handler: async (args, ctx) => {
    const input = args?.trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
    const file = parseFileLink(input);
    if (!file) {
      ctx.displayError("Usage: /file <path> (a local project file or folder)");
      return;
    }
    const rpc = ctx.app.getRpcClient?.();
    if (!rpc) {
      ctx.displayError("App server is not initialized.");
      return;
    }
    try {
      const result = await rpc.request("file/read", { path: file.path, threadId: ctx.threadId ?? undefined });
      const lines = ["", result.path, ""];
      switch (result.kind) {
        case "markdown":
          lines.push(...renderMarkdown(result.content, process.stdout.columns || 80).split("\n"));
          break;
        case "text":
          lines.push(...result.content.split("\n"));
          break;
        case "directory":
          lines.push(...result.entries.map((entry) => `${entry.name}${entry.isDirectory ? "/" : ""}`));
          if (!result.entries.length) lines.push("This folder is empty.");
          break;
        case "image":
        case "binary":
          lines.push(
            `${result.name} (${result.mediaType})`,
            "Open this file in the Web client to view or download it.",
          );
          break;
      }
      ctx.displayLines([...lines, ""]);
    } catch (error) {
      ctx.displayError(error instanceof Error ? error.message : String(error));
    }
  },
};
