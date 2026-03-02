// @summary Session management commands - create new session and list sessions
import { t } from "../../theme";
import type { Command } from "../types";

export const newCommand: Command = {
  name: "new",
  description: "Start a new session",
  handler: async (_args, ctx) => {
    const threadId = await ctx.startNewThread();
    ctx.displayLines([`  ${t.dim}New thread started: ${threadId}${t.reset}`]);
  },
};

export const resumeCommand: Command = {
  name: "resume",
  description: "Resume thread or show picker",
  supportsArgs: true,
  handler: async (args, ctx) => {
    if (args) {
      const resumedId = await ctx.resumeThread(args);
      if (resumedId) {
        ctx.displayLines([`  ${t.dim}Resumed thread: ${resumedId}${t.reset}`]);
      } else {
        ctx.displayError(`Thread not found: ${args}`);
      }
      return;
    }

    // Show thread picker
    const threads = await ctx.listThreads();
    if (threads.length === 0) {
      ctx.displayLines([`  ${t.dim}No threads found.${t.reset}`]);
      return;
    }

    const { ListPicker } = await import("../../components/list-picker");
    const items = threads.map((thread) => ({
      label: thread.id,
      description: thread.modified,
      value: thread.id,
    }));

    return new Promise<void>((resolve) => {
      const picker = new ListPicker({ title: "Threads", items }, async (value) => {
        handle.hide();
        ctx.requestRender();
        if (value) {
          const resumedId = await ctx.resumeThread(value);
          if (resumedId) {
            ctx.displayLines([`  ${t.dim}Resumed thread: ${resumedId}${t.reset}`]);
          }
        }
        resolve();
      });
      const handle = ctx.showOverlay(picker, { anchor: "center" });
      ctx.requestRender();
    });
  },
};

export const statusCommand: Command = {
  name: "status",
  description: "Show thread info and model",
  availableDuringTask: true,
  handler: async (_args, ctx) => {
    const lines: string[] = [""];
    lines.push(`  ${t.bold}Model:${t.reset}    ${ctx.config.model.id} (${ctx.config.model.provider})`);

    if (ctx.threadId) {
      lines.push(`  ${t.bold}Thread:${t.reset}   ${ctx.threadId}`);
      const thread = await ctx.readThread();
      if (thread) {
        lines.push(`  ${t.bold}Entries:${t.reset}  ${thread.entryCount}`);
      }
    } else {
      lines.push(`  ${t.bold}Thread:${t.reset}   (none)`);
    }

    if (ctx.config.sources.length > 0) {
      lines.push(`  ${t.bold}Config:${t.reset}   ${ctx.config.sources.join(", ")}`);
    }

    if (ctx.skills.length > 0) {
      lines.push(`  ${t.bold}Skills:${t.reset}   ${ctx.skills.length} loaded`);
    }

    lines.push("");
    ctx.displayLines(lines);
  },
};
