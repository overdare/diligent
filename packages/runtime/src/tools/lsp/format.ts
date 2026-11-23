// @summary Text rendering of LSP results as capped `path:line` lists with one line of context
import { readFile } from "node:fs/promises";
import type {
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  MarkedString,
  MarkupContent,
  SymbolInformation,
  WorkspaceSymbol,
} from "vscode-languageserver-protocol";
import { splitLines } from "./changed-lines";
import { uriToPath } from "./client";

export const MAX_RESULT_ENTRIES = 100;
const MAX_CONTEXT_CHARS = 200;

export interface ResultEntry {
  path: string;
  /** 1-based. */
  line: number;
  /** Text after the `path:line` prefix; defaults to the source line. */
  label?: string;
}

/** Reads source lines once per file for context. Paths that cannot be read yield no context. */
export class SourceLines {
  private readonly cache = new Map<string, Promise<string[] | undefined>>();

  constructor(private readonly overrides: ReadonlyMap<string, string> = new Map()) {}

  async line(path: string, line: number): Promise<string | undefined> {
    let lines = this.cache.get(path);
    if (!lines) {
      const override = this.overrides.get(path);
      lines =
        override !== undefined
          ? Promise.resolve(splitLines(override))
          : readFile(path, "utf-8").then(splitLines, () => undefined);
      this.cache.set(path, lines);
    }
    return (await lines)?.[line - 1];
  }
}

export function clipContext(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_CONTEXT_CHARS ? `${trimmed.slice(0, MAX_CONTEXT_CHARS - 1)}…` : trimmed;
}

/** `path:line  context` lines, de-duplicated by path and line and capped at MAX_RESULT_ENTRIES. */
export async function formatEntries(
  entries: ResultEntry[],
  displayPath: (path: string) => string,
  sources: SourceLines,
): Promise<{ lines: string[]; total: number }> {
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    const key = `${entry.path}\0${entry.line}\0${entry.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const lines = await Promise.all(
    unique.slice(0, MAX_RESULT_ENTRIES).map(async (entry) => {
      const context = entry.label ?? clipContext((await sources.line(entry.path, entry.line)) ?? "");
      return `${displayPath(entry.path)}:${entry.line}${context ? `  ${context}` : ""}`;
    }),
  );
  if (unique.length > MAX_RESULT_ENTRIES) lines.push(`… ${unique.length - MAX_RESULT_ENTRIES} more not shown`);
  return { lines, total: unique.length };
}

export function locationEntries(result: Location | Location[] | LocationLink[] | null | undefined): ResultEntry[] {
  if (!result) return [];
  return (Array.isArray(result) ? result : [result]).map((item) => {
    const uri = "targetUri" in item ? item.targetUri : item.uri;
    const range = "targetUri" in item ? (item.targetSelectionRange ?? item.targetRange) : item.range;
    return { path: uriToPath(uri), line: range.start.line + 1 };
  });
}

export function hoverText(hover: Hover | null | undefined): string {
  if (!hover) return "";
  const parts = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  return parts
    .map((part: MarkedString | MarkupContent) =>
      typeof part === "string"
        ? part
        : "language" in part
          ? `\`\`\`${part.language}\n${part.value}\n\`\`\``
          : part.value,
    )
    .filter((text) => text.trim().length > 0)
    .join("\n\n")
    .trim();
}

const SYMBOL_KINDS = [
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enum member",
  "struct",
  "event",
  "operator",
  "type parameter",
];

export function symbolKindName(kind: number): string {
  return SYMBOL_KINDS[kind - 1] ?? "symbol";
}

/** Document symbols in source order, nested symbols indented under their parent. */
export function documentSymbolEntries(
  path: string,
  symbols: Array<DocumentSymbol | SymbolInformation> | null | undefined,
): ResultEntry[] {
  const entries: ResultEntry[] = [];
  const visit = (symbol: DocumentSymbol, depth: number) => {
    entries.push({
      path,
      line: symbol.selectionRange.start.line + 1,
      label: `${"  ".repeat(depth)}${symbolKindName(symbol.kind)} ${symbol.name}`,
    });
    for (const child of symbol.children ?? []) visit(child, depth + 1);
  };
  for (const symbol of symbols ?? []) {
    if ("location" in symbol) {
      entries.push({
        path: uriToPath(symbol.location.uri),
        line: symbol.location.range.start.line + 1,
        label: `${symbolKindName(symbol.kind)} ${symbol.name}${symbol.containerName ? ` (in ${symbol.containerName})` : ""}`,
      });
    } else {
      visit(symbol, 0);
    }
  }
  return entries;
}

export function workspaceSymbolEntries(
  symbols: Array<SymbolInformation | WorkspaceSymbol> | null | undefined,
): ResultEntry[] {
  return (symbols ?? []).map((symbol) => {
    const line = "range" in symbol.location ? symbol.location.range.start.line + 1 : 1;
    return {
      path: uriToPath(symbol.location.uri),
      line,
      label: `${symbolKindName(symbol.kind)} ${symbol.name}${symbol.containerName ? ` (in ${symbol.containerName})` : ""}`,
    };
  });
}

const SEVERITY_NAMES = ["error", "warning", "info", "hint"];

export function diagnosticEntries(path: string, diagnostics: Diagnostic[]): ResultEntry[] {
  return [...diagnostics]
    .sort(
      (left, right) => (left.severity ?? 1) - (right.severity ?? 1) || left.range.start.line - right.range.start.line,
    )
    .map((diagnostic) => {
      const severity = SEVERITY_NAMES[(diagnostic.severity ?? 1) - 1] ?? "error";
      const origin = [diagnostic.source, diagnostic.code].filter((part) => part !== undefined && part !== "").join(" ");
      return {
        path,
        line: diagnostic.range.start.line + 1,
        label: `${severity}: ${diagnosticSummary(diagnostic)}${origin ? ` (${origin})` : ""}`,
      };
    });
}

/** First line of a diagnostic message, which LSP 3.18 also allows as markup. */
export function diagnosticSummary(diagnostic: Diagnostic): string {
  const message = typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value;
  return message.split("\n")[0] ?? "";
}
