// @summary Fake stdio language server for LSP tests: answers navigation and rename from open documents, publishes diagnostics
//
// Behavior comes from `initializationOptions`:
// - logFile: append one line per received message method; one `initialize` line per process
// - silent: never publish diagnostics
// - crashOn: exit(1) when this request method arrives
// - failInitialize: exit(3) instead of answering initialize
//
// Diagnostics: every line containing ERROR is an error, every line containing WARN a warning; the message is the
// trimmed line text. Definitions are lines `function <name>` in open documents; references, rename and workspace
// symbols use whole-word matches across open documents.
import { appendFileSync } from "node:fs";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";

interface Options {
  logFile?: string;
  silent?: boolean;
  crashOn?: string;
  failInitialize?: boolean;
}

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const documents = new Map<string, { text: string; version: number }>();
let options: Options = {};

function log(entry: string): void {
  if (options.logFile) appendFileSync(options.logFile, `${entry}\n`);
}

function lines(uri: string): string[] {
  return (documents.get(uri)?.text ?? "").split("\n");
}

function wordAt(uri: string, position: { line: number; character: number }): string {
  const line = lines(uri)[position.line] ?? "";
  const before = line.slice(0, position.character).match(/[A-Za-z0-9_]*$/)?.[0] ?? "";
  const after = line.slice(position.character).match(/^[A-Za-z0-9_]*/)?.[0] ?? "";
  return before + after;
}

function occurrences(word: string) {
  const found: Array<{
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  }> = [];
  const pattern = new RegExp(`\\b${word}\\b`, "g");
  for (const uri of documents.keys()) {
    lines(uri).forEach((text, line) => {
      for (const match of text.matchAll(pattern)) {
        found.push({
          uri,
          range: { start: { line, character: match.index }, end: { line, character: match.index + word.length } },
        });
      }
    });
  }
  return found;
}

function publish(uri: string): void {
  if (options.silent) return;
  const document = documents.get(uri);
  if (!document) return;
  const diagnostics = lines(uri).flatMap((text, line) => {
    const severity = text.includes("ERROR") ? 1 : text.includes("WARN") ? 2 : undefined;
    if (!severity) return [];
    return [
      {
        range: { start: { line, character: 0 }, end: { line, character: text.length } },
        severity,
        source: "fake",
        message: text.trim(),
      },
    ];
  });
  void connection.sendNotification("textDocument/publishDiagnostics", { uri, version: document.version, diagnostics });
}

connection.onRequest((method, params) => {
  log(method);
  if (method === options.crashOn) process.exit(1);
  const p = params as {
    textDocument: { uri: string };
    position: { line: number; character: number };
    newName: string;
    query: string;
  };
  switch (method) {
    case "textDocument/definition": {
      const word = wordAt(p.textDocument.uri, p.position);
      return occurrences(word).filter((item) => lines(item.uri)[item.range.start.line]?.includes(`function ${word}`));
    }
    case "textDocument/references":
      return occurrences(wordAt(p.textDocument.uri, p.position));
    case "textDocument/hover":
      return { contents: { kind: "markdown", value: `**${wordAt(p.textDocument.uri, p.position)}**` } };
    case "textDocument/rename": {
      const changes: Record<string, Array<{ range: unknown; newText: string }>> = {};
      for (const item of occurrences(wordAt(p.textDocument.uri, p.position))) {
        (changes[item.uri] ??= []).push({ range: item.range, newText: p.newName });
      }
      return { changes };
    }
    case "textDocument/documentSymbol":
      return lines(p.textDocument.uri).flatMap((text, line) => {
        const name = text.match(/function (\w+)/)?.[1];
        if (!name) return [];
        const range = { start: { line, character: 0 }, end: { line, character: text.length } };
        return [{ name, kind: 12, range, selectionRange: range }];
      });
    case "workspace/symbol":
      return [...documents.keys()].flatMap((uri) =>
        lines(uri).flatMap((text, line) => {
          const name = text.match(/function (\w+)/)?.[1];
          if (!name || !name.includes(p.query)) return [];
          return [
            {
              name,
              kind: 12,
              location: { uri, range: { start: { line, character: 0 }, end: { line, character: 0 } } },
            },
          ];
        }),
      );
    case "shutdown":
      return null;
    default:
      return null;
  }
});

connection.onRequest("initialize", (params: { initializationOptions?: Options }) => {
  options = params.initializationOptions ?? {};
  log("initialize");
  if (options.failInitialize) process.exit(3);
  return {
    capabilities: {
      textDocumentSync: 1,
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      renameProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
    },
  };
});

connection.onNotification((method, params) => {
  log(method);
  const p = params as {
    textDocument: { uri: string; text?: string; version?: number };
    contentChanges?: Array<{ text: string }>;
  };
  if (method === "textDocument/didOpen") {
    documents.set(p.textDocument.uri, { text: p.textDocument.text ?? "", version: p.textDocument.version ?? 0 });
    publish(p.textDocument.uri);
  } else if (method === "textDocument/didChange") {
    const text = p.contentChanges?.at(-1)?.text ?? "";
    documents.set(p.textDocument.uri, { text, version: p.textDocument.version ?? 0 });
    publish(p.textDocument.uri);
  } else if (method === "textDocument/didClose") {
    documents.delete(p.textDocument.uri);
  } else if (method === "exit") {
    process.exit(0);
  }
});

connection.listen();
