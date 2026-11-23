// @summary The `lsp` tool: definitions, references, hover, symbols, diagnostics, and rename through language servers
import { readFile } from "node:fs/promises";
import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import type { ToolRenderPayload } from "@diligent/protocol";
import type {
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  SymbolInformation,
  WorkspaceEdit,
  WorkspaceSymbol,
} from "vscode-languageserver-protocol";
import { z } from "zod";
import { type RuntimeToolHost, requestToolApprovalOutcome, resolveRejectedApproval } from "../capabilities";
import { READ_ONLY_TOOL_VARIANT, type ReadOnlyVariantTool } from "../read-only-variant";
import { buildLspInputSummary, summarizeRenderText } from "../render-payload";
import { splitLines } from "./changed-lines";
import { type LspClient, LspRequestTimeoutError, pathToUri } from "./client";
import {
  diagnosticEntries,
  documentSymbolEntries,
  formatEntries,
  hoverText,
  locationEntries,
  type ResultEntry,
  SourceLines,
  workspaceSymbolEntries,
} from "./format";
import type { LspWorkspace } from "./workspace";
import { collectTextEdits, computeFileChange, type FileTextChange } from "./workspace-edit";

export const LSP_TOOL_NAME = "lsp";
export const DEFAULT_LSP_TIMEOUT_S = 20;
/** Longest wait for a just-opened file's first analysis before answering a query on it. */
const FIRST_OPEN_WAIT_MS = 5_000;

const LspParams = z.object({
  action: z
    .enum([
      "diagnostics",
      "definition",
      "references",
      "hover",
      "symbols",
      "type_definition",
      "implementation",
      "rename",
      "status",
    ])
    .describe("Operation to run"),
  file: z
    .string()
    .optional()
    .describe(
      "File path, absolute or relative to the working directory. Required except for workspace symbols and status",
    ),
  line: z.number().int().positive().optional().describe("1-based line number, as shown by read"),
  symbol: z
    .string()
    .min(1)
    .optional()
    .describe("Identifier on `line`; its first occurrence on that line is the position"),
  query: z.string().optional().describe("symbols: search the workspace for this name instead of listing the file"),
  new_name: z.string().min(1).optional().describe("rename: the new identifier"),
  apply: z.boolean().optional().describe("rename: false (default) previews the edits, true writes them"),
  timeout_s: z
    .number()
    .min(5)
    .max(120)
    .optional()
    .describe(`Seconds before the request is abandoned (default ${DEFAULT_LSP_TIMEOUT_S})`),
});

type LspArgs = z.infer<typeof LspParams>;

const DESCRIPTION = `Query language servers for code intelligence. Address a position with \`line\` (1-based, as read shows) and \`symbol\` (the identifier on that line), not columns.

Actions:
- definition, type_definition, implementation, references, hover: need file, line, symbol.
- symbols: with file, lists the file's symbols; with query, searches the workspace.
- diagnostics: errors and warnings for file.
- rename: needs file, line, symbol, new_name. Previews the edits unless apply is true.
- status: configured servers and their state.

Results are \`path:line\` lists with one line of context, at most 100 entries. Servers start on first use, so the first call for a project can take longer.`;

export interface LspToolOptions {
  workspace: LspWorkspace;
  host?: RuntimeToolHost;
  /** Plan mode and read-only agents: everything except applying a rename. */
  readOnly?: boolean;
}

export function createLspTool(options: LspToolOptions): Tool<typeof LspParams> {
  const tool: ReadOnlyVariantTool & Tool<typeof LspParams> = {
    name: LSP_TOOL_NAME,
    description: options.readOnly ? `${DESCRIPTION}\n\nThis agent is read-only: rename can only preview.` : DESCRIPTION,
    parameters: LspParams,
    supportParallel: true,
    concurrency: (args) => {
      const input = args as Partial<LspArgs> | undefined;
      return input?.action === "rename" && input.apply === true ? "exclusive" : "shared";
    },
    async execute(args, ctx) {
      const timeoutMs = (args.timeout_s ?? DEFAULT_LSP_TIMEOUT_S) * 1000;
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]);
      try {
        return await runAction(args, { ...options, ctx, signal, timeoutMs });
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        const timedOut = signal.aborted || error instanceof LspRequestTimeoutError;
        const message = timedOut
          ? `lsp ${args.action} timed out after ${timeoutMs / 1000}s`
          : `lsp ${args.action} failed: ${error instanceof Error ? error.message : String(error)}`;
        return errorResult(args, message);
      }
    },
  };
  if (!options.readOnly) tool[READ_ONLY_TOOL_VARIANT] = () => createLspTool({ ...options, readOnly: true });
  return tool;
}

interface ActionContext extends LspToolOptions {
  ctx: ToolContext;
  signal: AbortSignal;
  timeoutMs: number;
}

async function runAction(args: LspArgs, context: ActionContext): Promise<ToolResult> {
  const { workspace } = context;
  if (args.action === "status") return statusResult(args, workspace);
  if (args.action === "symbols" && args.query !== undefined) return workspaceSymbols(args, context);
  if (!args.file) return errorResult(args, `${args.action} needs \`file\``);

  const path = workspace.resolvePath(args.file);
  const spec = workspace.serverFor(path);
  if (!spec) {
    const known = workspace.catalog.servers.map((server) => `${server.name} (${server.fileTypes.join(", ")})`);
    return errorResult(
      args,
      `No language server handles ${workspace.displayPath(path)}. Available: ${known.join("; ") || "none (see status)"}.`,
    );
  }
  const text = await readFile(path, "utf-8").catch(() => undefined);
  if (text === undefined) return errorResult(args, `Cannot read ${workspace.displayPath(path)}`);

  const acquired = await workspace.acquire(path, { start: true, signal: context.signal });
  if (!acquired) return errorResult(args, `No language server handles ${workspace.displayPath(path)}`);
  const { client } = acquired;
  if (args.action === "rename" || args.action === "references") await workspace.syncOpenDocuments(client);
  const opened = !client.isOpen(path);
  const version = await client.sync(path, text);
  if (opened && args.action !== "diagnostics") {
    // Servers answer requests on a just-opened file before its project has loaded (TypeScript then resolves an
    // imported name to its import). The first diagnostics publish marks the end of that initial analysis.
    await client.waitForDiagnostics(path, version, {
      timeoutMs: Math.min(FIRST_OPEN_WAIT_MS, context.timeoutMs / 2),
      settleMs: 0,
      signal: context.signal,
    });
  }
  const request = <R>(method: string, params: unknown) =>
    client.request<R>(method, params, { timeoutMs: context.timeoutMs, signal: context.signal });
  const sources = new SourceLines(new Map([[path, text]]));
  const header = `${spec.name}: ${workspace.displayPath(path)}`;

  if (args.action === "diagnostics") {
    const diagnostics = await workspace.diagnostics(client, path, version, {
      timeoutMs: context.timeoutMs,
      signal: context.signal,
    });
    if (diagnostics === undefined) {
      return listResult(args, `${header}: the server published no diagnostics within ${context.timeoutMs / 1000}s`, []);
    }
    return entriesResult(args, workspace, sources, diagnosticEntries(path, diagnostics), {
      title: `${header}: ${countLabel(diagnostics.length, "diagnostic")}`,
      empty: `${header}: no diagnostics`,
    });
  }

  if (args.action === "symbols") {
    const symbols = await request<Array<DocumentSymbol | SymbolInformation> | null>("textDocument/documentSymbol", {
      textDocument: { uri: pathToUri(path) },
    });
    const entries = documentSymbolEntries(path, symbols);
    return entriesResult(args, workspace, sources, entries, {
      title: `${header}: ${countLabel(entries.length, "symbol")}`,
      empty: `${header}: no symbols`,
    });
  }

  const position = resolvePosition(text, args);
  if ("error" in position) return errorResult(args, position.error);
  const at = { textDocument: { uri: pathToUri(path) }, position };
  const where = `${workspace.displayPath(path)}:${args.line} \`${args.symbol}\``;

  switch (args.action) {
    case "hover": {
      const hover = hoverText(await request<Hover | null>("textDocument/hover", at));
      return listResult(
        args,
        hover ? `${spec.name}: hover for ${where}\n\n${hover}` : `No hover information for ${where}`,
        [],
        {
          hover,
        },
      );
    }
    case "definition":
    case "type_definition":
    case "implementation": {
      const method = {
        definition: "textDocument/definition",
        type_definition: "textDocument/typeDefinition",
        implementation: "textDocument/implementation",
      }[args.action];
      const label = args.action.replace("_", " ");
      const result = await request<Location | Location[] | LocationLink[] | null>(method, at);
      const entries = locationEntries(result);
      return entriesResult(args, workspace, sources, entries, {
        title: `${spec.name}: ${countLabel(entries.length, label)} for ${where}`,
        empty: `No ${label} found for ${where}`,
      });
    }
    case "references": {
      const result = await request<Location[] | null>("textDocument/references", {
        ...at,
        context: { includeDeclaration: true },
      });
      const entries = locationEntries(result);
      return entriesResult(args, workspace, sources, entries, {
        title: `${spec.name}: ${countLabel(entries.length, "reference")} to ${where}`,
        empty: `No references found for ${where}`,
      });
    }
    case "rename":
      return rename(args, context, client, request, at, where);
  }
}

async function workspaceSymbols(args: LspArgs, context: ActionContext): Promise<ToolResult> {
  const { workspace } = context;
  const query = args.query ?? "";
  let clients: LspClient[];
  if (args.file) {
    const acquired = await workspace.acquire(workspace.resolvePath(args.file), { start: true, signal: context.signal });
    if (!acquired) return errorResult(args, `No language server handles ${args.file}`);
    clients = [acquired.client];
  } else {
    clients = workspace.manager.runningClients();
    if (clients.length === 0) {
      return errorResult(
        args,
        "No language server is running yet; pass `file` to start the server for that file type.",
      );
    }
  }
  const results = await Promise.all(
    clients.map((client) =>
      client
        .request<Array<SymbolInformation | WorkspaceSymbol> | null>(
          "workspace/symbol",
          { query },
          { timeoutMs: context.timeoutMs, signal: context.signal },
        )
        .then(workspaceSymbolEntries),
    ),
  );
  const entries = results.flat();
  return entriesResult(args, workspace, new SourceLines(), entries, {
    title: `${countLabel(entries.length, "workspace symbol")} matching "${query}"`,
    empty: `No workspace symbols match "${query}"`,
  });
}

type RequestFn = <R>(method: string, params: unknown) => Promise<R>;

async function rename(
  args: LspArgs,
  context: ActionContext,
  client: LspClient,
  request: RequestFn,
  at: { textDocument: { uri: string }; position: { line: number; character: number } },
  where: string,
): Promise<ToolResult> {
  const { workspace } = context;
  if (!args.new_name) return errorResult(args, "rename needs `new_name`");
  if (args.apply && context.readOnly) {
    return errorResult(
      args,
      "Applying a rename is not available in plan mode or read-only agents; omit `apply` to preview it.",
    );
  }
  const edit = await request<WorkspaceEdit | null>("textDocument/rename", { ...at, newName: args.new_name });
  const changes: FileTextChange[] = [];
  for (const [path, edits] of collectTextEdits(edit)) {
    const before = await readFile(path, "utf-8");
    changes.push(computeFileChange(path, before, edits));
  }
  if (changes.length === 0) return errorResult(args, `The server proposed no edits to rename ${where}`);

  const editCount = changes.reduce((sum, change) => sum + change.editCount, 0);
  const scope = `${countLabel(editCount, "edit")} in ${countLabel(changes.length, "file")}`;
  const lineEntries: ResultEntry[] = changes.flatMap((change) =>
    change.lines.map((line) => ({
      path: change.path,
      line: line.line,
      label: `${line.before.trim()}  →  ${line.after.trim()}`,
    })),
  );
  const { lines } = await formatEntries(lineEntries, (path) => workspace.displayPath(path), new SourceLines());
  const diff = renameDiffPayload(args, workspace, changes);

  if (!args.apply) {
    const output = [
      `Rename ${where} to \`${args.new_name}\`: ${scope} (preview; call again with apply: true to write)`,
      ...lines,
    ].join("\n");
    return {
      output,
      render: { ...diff, outputSummary: `Preview: ${scope}`, blocks: [...diff.blocks, textBlock(output)] },
    };
  }

  const approval = await requestToolApprovalOutcome(
    context.host,
    {
      permission: "write",
      toolName: LSP_TOOL_NAME,
      description: `Rename ${args.symbol} to ${args.new_name}: ${scope}`,
      details: { file_path: changes[0]!.path, paths: changes.map((change) => change.path) },
    },
    { signal: context.ctx.signal },
  );
  if (approval.decision === "reject") {
    const rejection = resolveRejectedApproval(approval, context.ctx);
    return { output: rejection.output, render: errorRender(args, rejection.output), metadata: rejection.metadata };
  }

  // Approval can take minutes: write nothing when any file changed since the edits were computed.
  for (const change of changes) {
    const current = await readFile(change.path, "utf-8").catch(() => undefined);
    if (current !== change.before) {
      return errorResult(
        args,
        `${workspace.displayPath(change.path)} changed while waiting for approval; the rename was not applied. Run it again.`,
      );
    }
  }
  for (const change of changes) {
    await Bun.write(change.path, change.after);
    if (client.isOpen(change.path)) await client.sync(change.path, change.after);
  }
  const output = [`Renamed ${where} to \`${args.new_name}\`: ${scope}`, ...lines].join("\n");
  return {
    output,
    render: { ...diff, outputSummary: `Renamed: ${scope}`, blocks: [...diff.blocks, textBlock(output)] },
  };
}

/** Position of the first occurrence of `symbol` on `line`, preferring a whole-identifier match. */
export function resolvePosition(
  text: string,
  args: Pick<LspArgs, "action" | "line" | "symbol">,
): { line: number; character: number } | { error: string } {
  if (args.line === undefined || args.symbol === undefined) {
    return { error: `${args.action} needs \`line\` and \`symbol\`` };
  }
  const lines = splitLines(text);
  const source = lines[args.line - 1];
  if (source === undefined) return { error: `line ${args.line} is past the end of the file (${lines.length} lines)` };
  const escaped = args.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(?<![\\p{L}\\p{N}_$])${escaped}(?![\\p{L}\\p{N}_$])`, "u").exec(source);
  const character = word?.index ?? source.indexOf(args.symbol);
  if (character < 0) return { error: `\`${args.symbol}\` does not occur on line ${args.line}: ${source.trim()}` };
  return { line: args.line - 1, character };
}

async function entriesResult(
  args: LspArgs,
  workspace: LspWorkspace,
  sources: SourceLines,
  entries: ResultEntry[],
  labels: { title: string; empty: string },
): Promise<ToolResult> {
  if (entries.length === 0) return listResult(args, labels.empty, []);
  const { lines } = await formatEntries(entries, (path) => workspace.displayPath(path), sources);
  return listResult(args, [labels.title, ...lines].join("\n"), lines, { title: labels.title });
}

function listResult(
  args: LspArgs,
  output: string,
  items: string[],
  extra: { title?: string; hover?: string } = {},
): ToolResult {
  const firstLine = output.split("\n", 1)[0];
  const blocks: ToolRenderPayload["blocks"] = [];
  if (items.length > 0) blocks.push({ type: "list", title: extra.title, items });
  else if (extra.hover) blocks.push({ type: "text", title: "Hover", text: extra.hover });
  else blocks.push({ type: "summary", text: firstLine ?? output, tone: "muted" });
  return {
    output,
    render: { inputSummary: buildLspInputSummary(args), outputSummary: summarizeRenderText(firstLine, 120), blocks },
  };
}

function statusResult(args: LspArgs, workspace: LspWorkspace): ToolResult {
  const { servers, unavailable } = workspace.catalog;
  const states = workspace.manager.status();
  const lines = [`Post-edit diagnostics: ${workspace.postEditDiagnostics}`, "Configured servers:"];
  for (const server of servers) {
    const running = states.filter((state) => state.name === server.name);
    const detail = running.length
      ? running
          .map((state) => {
            const crashes = state.crashes ? `, ${state.crashes} crash(es)` : "";
            const error = state.error ? `: ${state.error.split("\n")[0]}` : "";
            return `${state.state} at ${workspace.displayPath(state.root) || "."} (${state.openDocuments} open${crashes})${error}`;
          })
          .join("; ")
      : "not started";
    lines.push(`- ${server.name} [${server.fileTypes.join(" ")}] ${server.command}: ${detail}`);
  }
  if (servers.length === 0) lines.push("- none");
  if (unavailable.length > 0) {
    lines.push("Unavailable:");
    for (const server of unavailable) lines.push(`- ${server.name}: ${server.reason}`);
  }
  const output = lines.join("\n");
  return {
    output,
    render: {
      inputSummary: buildLspInputSummary(args),
      outputSummary: `${countLabel(servers.length, "server")} available`,
      blocks: [{ type: "text", title: "Language servers", text: output }],
    },
  };
}

function renameDiffPayload(args: LspArgs, workspace: LspWorkspace, changes: FileTextChange[]): ToolRenderPayload {
  return {
    inputSummary: buildLspInputSummary(args),
    blocks: [
      {
        type: "diff",
        files: changes.map((change) => ({
          filePath: workspace.displayPath(change.path),
          action: "Update" as const,
          hunks: change.lines.map((line) => ({ oldString: line.before, newString: line.after })),
        })),
      },
    ],
  };
}

function textBlock(text: string): ToolRenderPayload["blocks"][number] {
  return { type: "text", title: "Output", text };
}

function errorRender(args: LspArgs, output: string): ToolRenderPayload {
  return {
    inputSummary: buildLspInputSummary(args),
    outputSummary: summarizeRenderText(output.split("\n", 1)[0], 120),
    blocks: [{ type: "text", title: "Error", text: output, isError: true }],
  };
}

function errorResult(args: LspArgs, output: string): ToolResult {
  return { output, render: errorRender(args, output), metadata: { error: true } };
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
