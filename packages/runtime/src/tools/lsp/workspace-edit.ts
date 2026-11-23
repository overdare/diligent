// @summary Turns an LSP WorkspaceEdit into per-file text changes with a line-level preview
import type { Position, TextEdit, WorkspaceEdit } from "vscode-languageserver-protocol";
import { splitLines } from "./changed-lines";
import { uriToPath } from "./client";

export interface FileTextChange {
  path: string;
  before: string;
  after: string;
  /** One entry per edited source line, 1-based, in file order. */
  lines: Array<{ line: number; before: string; after: string }>;
  editCount: number;
}

/** Text edits per file. File create/rename/delete operations are rejected: rename only edits text in phase 1. */
export function collectTextEdits(edit: WorkspaceEdit | null | undefined): Map<string, TextEdit[]> {
  const byPath = new Map<string, TextEdit[]>();
  const add = (uri: string, edits: TextEdit[]) => {
    const path = uriToPath(uri);
    byPath.set(path, [...(byPath.get(path) ?? []), ...edits]);
  };
  for (const change of edit?.documentChanges ?? []) {
    if (!("textDocument" in change)) {
      throw new Error(`the server proposed a file ${change.kind} operation, which the lsp tool does not apply`);
    }
    add(
      change.textDocument.uri,
      change.edits.map((item) => ({
        range: item.range,
        newText: "newText" in item ? item.newText : item.snippet.value,
      })),
    );
  }
  if (!edit?.documentChanges) {
    for (const [uri, edits] of Object.entries(edit?.changes ?? {})) add(uri, edits);
  }
  return byPath;
}

export function computeFileChange(path: string, before: string, edits: TextEdit[]): FileTextChange {
  const lineStarts = lineStartOffsets(before);
  const offsetOf = (position: Position) => {
    if (position.line >= lineStarts.length) return before.length;
    const next = lineStarts[position.line + 1] ?? before.length;
    return Math.min(lineStarts[position.line]! + position.character, next);
  };
  const resolved = edits
    .map((edit) => ({ edit, start: offsetOf(edit.range.start), end: offsetOf(edit.range.end) }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < resolved.length; index++) {
    if (resolved[index]!.start < resolved[index - 1]!.end) throw new Error(`overlapping edits in ${path}`);
  }
  let after = before;
  for (const { edit, start, end } of [...resolved].reverse()) {
    after = after.slice(0, start) + edit.newText + after.slice(end);
  }

  const beforeLines = splitLines(before);
  const lines: FileTextChange["lines"] = [];
  const byLine = new Map<number, TextEdit[]>();
  for (const { edit } of resolved) {
    byLine.set(edit.range.start.line, [...(byLine.get(edit.range.start.line) ?? []), edit]);
  }
  for (const [line, lineEdits] of byLine) {
    const original = beforeLines[line] ?? "";
    const singleLine = lineEdits.every((edit) => edit.range.end.line === line && !/[\r\n]/.test(edit.newText));
    let updated = original;
    if (singleLine) {
      for (const edit of [...lineEdits].sort(
        (left, right) => right.range.start.character - left.range.start.character,
      )) {
        updated = updated.slice(0, edit.range.start.character) + edit.newText + updated.slice(edit.range.end.character);
      }
    } else {
      updated = "(multi-line edit)";
    }
    lines.push({ line: line + 1, before: original, after: updated });
  }
  return { path, before, after, lines, editCount: edits.length };
}

function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\r" && text[index + 1] === "\n") index++;
    if (char === "\r" || char === "\n") starts.push(index + 1);
  }
  return starts;
}
