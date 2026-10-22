// @summary TUI file previews consume the same server contract as the Web preview
import { expect, test } from "bun:test";
import type { FileReadResponse } from "@diligent/protocol";
import { fileCommand } from "../../../../src/tui/commands/builtin/file";
import { registerBuiltinCommands } from "../../../../src/tui/commands/builtin/index";
import { CommandRegistry } from "../../../../src/tui/commands/registry";
import type { CommandContext } from "../../../../src/tui/commands/types";

function context(read: (method: string, params: unknown) => Promise<FileReadResponse>) {
  const lines: string[] = [];
  const errors: string[] = [];
  const ctx = {
    app: { getRpcClient: () => ({ request: read }) },
    threadId: "thread-1",
    displayLines: (output: string[]) => lines.push(...output),
    displayError: (message: string) => errors.push(message),
  } as unknown as CommandContext;
  return { ctx, lines, errors };
}

test("registered file command requests the selected path and retains history navigation", async () => {
  const requests: unknown[] = [];
  const view = context(async (method, params) => {
    requests.push({ method, params });
    return { kind: "markdown", path: "/repo/docs/README.md", name: "README.md", content: "# Actual preview" };
  });
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry, []);
  const command = registry.get("file");
  expect(command).toBeDefined();
  expect(registry.get("older")).toBeDefined();
  await command?.handler("docs/README.md", view.ctx);
  expect(requests).toEqual([{ method: "file/read", params: { path: "docs/README.md", threadId: "thread-1" } }]);
  expect(view.lines.join("\n")).toContain("Actual preview");
  expect(view.errors).toEqual([]);
});

test("normalizes quoted Windows links before sending them to the server", async () => {
  let sent: unknown;
  const view = context(async (_method, params) => {
    sent = params;
    return { kind: "text", path: "C:/repo/a space.txt", name: "a space.txt", content: "actual text" };
  });
  await fileCommand.handler('"C://repo/a space.txt"', view.ctx);
  expect(sent).toEqual({ path: "C:/repo/a space.txt", threadId: "thread-1" });
  expect(view.lines.join("\n")).toContain("actual text");
});

test("lists server-returned directory entries", async () => {
  const view = context(async () => ({
    kind: "directory",
    path: "/repo/docs",
    name: "docs",
    entries: [
      { name: "nested", path: "/repo/docs/nested", isDirectory: true },
      { name: "a.md", path: "/repo/docs/a.md", isDirectory: false },
    ],
  }));
  await fileCommand.handler("docs", view.ctx);
  expect(view.lines.join("\n")).toContain("nested/");
  expect(view.lines.join("\n")).toContain("a.md");
});

test("surfaces server errors and rejects missing paths and non-file URLs", async () => {
  let calls = 0;
  const view = context(async () => {
    calls++;
    throw new Error("Cannot preview files outside the project.");
  });
  await fileCommand.handler("../secret.md", view.ctx);
  expect(view.errors).toContain("Cannot preview files outside the project.");
  await fileCommand.handler(undefined, view.ctx);
  await fileCommand.handler("https://example.com", view.ctx);
  expect(calls).toBe(1);
  expect(view.errors.join("\n")).toContain("/file <path>");
});
