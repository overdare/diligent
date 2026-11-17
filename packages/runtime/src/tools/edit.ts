// @summary Edit file contents via string replacement with tolerant line matching and a stale-write guard
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { isAbsolute, stripExtendedLengthPrefix } from "../util/path";
import { type RuntimeToolHost, requestToolApproval } from "./capabilities";
import {
  createEditDiffRenderPayload,
  createMultiEditDiffRenderPayload,
  createTextRenderPayload,
} from "./render-payload";
import { findTolerantLineMatch } from "./text-match";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const EditParams = z.object({
  file_path: z.string().describe("The absolute path to the file to edit"),
  old_string: z.string().describe("The exact text to find and replace"),
  new_string: z.string().describe("The replacement text"),
  replace_all: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, replace every occurrence of old_string instead of requiring uniqueness"),
});

const MultiEditParams = z.object({
  file_path: z.string().describe("The absolute path to the file to edit"),
  edits: z
    .array(
      z.object({
        old_string: z.string().describe("The exact text to find and replace"),
        new_string: z.string().describe("The replacement text"),
        replace_all: z.boolean().optional().default(false),
      }),
    )
    .min(1)
    .describe("Ordered list of edits to apply sequentially"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SingleEdit {
  old_string: string;
  new_string: string;
  replace_all: boolean;
}

interface AppliedEdits {
  result: string;
  count: number;
  /** Labels of tolerant passes used, one per edit that did not match exactly. */
  tolerantMatches: string[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** 1-based line numbers of every non-overlapping occurrence of `needle` in `haystack`. */
function occurrenceLines(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const lines: number[] = [];
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    lines.push(haystack.slice(0, pos).split("\n").length);
    pos += needle.length;
  }
  return lines;
}

function leadingWhitespace(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}

/**
 * Line-level fallback after an exact substring miss. Accepts only a unique match; when the match ignored
 * indentation, shifts the replacement by the indentation difference of the first matched line.
 */
function applyTolerantEdit(content: string, oldString: string, newString: string): { result: string; label: string } {
  const endsWithNewline = content.endsWith("\n");
  const lines = (endsWithNewline ? content.slice(0, -1) : content).split("\n");
  const trailingNewline = oldString.endsWith("\n");
  const pattern = (trailingNewline ? oldString.slice(0, -1) : oldString).split("\n");
  const replacementText = trailingNewline && newString.endsWith("\n") ? newString.slice(0, -1) : newString;

  const match = findTolerantLineMatch(lines, pattern);
  if (match.kind === "none") throw new Error("old_string not found in file");
  if (match.kind === "ambiguous") {
    const at = match.indexes.map((index) => index + 1).join(", ");
    throw new Error(`old_string matches ${match.pass.label} at lines ${at}; provide more context`);
  }

  let replacement = replacementText === "" ? [] : replacementText.split("\n");
  const fileIndent = leadingWhitespace(lines[match.index]);
  const oldIndent = leadingWhitespace(pattern[0]);
  if (match.pass.label.startsWith("ignoring indentation") && fileIndent !== oldIndent) {
    replacement = replacement.map((line) =>
      line !== "" && line.startsWith(oldIndent) ? fileIndent + line.slice(oldIndent.length) : line,
    );
  }

  const next = [...lines.slice(0, match.index), ...replacement, ...lines.slice(match.index + pattern.length)];
  return { result: next.join("\n") + (endsWithNewline ? "\n" : ""), label: match.pass.label };
}

/** A failed edit within a sequence; `index` is 0-based. */
class EditFailure extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Validate and apply edits in order to `content`, throwing EditFailure for the first edit that does not apply.
 * A consistently CRLF file is matched as LF-normalized text and written back with CRLF.
 */
function applyEdits(content: string, edits: SingleEdit[]): AppliedEdits {
  const crlf = content.includes("\r\n") && !/(^|[^\r])\n/.test(content);
  const toLf = (value: string) => (crlf ? value.replace(/\r\n/g, "\n") : value);
  let current = toLf(content);
  let count = 0;
  const tolerantMatches: string[] = [];

  edits.forEach((edit, index) => {
    try {
      const oldString = toLf(edit.old_string);
      const newString = toLf(edit.new_string);
      if (oldString === newString) throw new Error("old_string and new_string must differ");

      const exact = occurrenceLines(current, oldString);
      if (edit.replace_all) {
        if (exact.length === 0) throw new Error("old_string not found in file");
        current = current.replaceAll(oldString, () => newString);
        count += exact.length;
        return;
      }
      if (exact.length > 1) {
        throw new Error(
          `old_string is not unique (found at lines ${exact.join(", ")}), provide more context or use replace_all`,
        );
      }
      if (exact.length === 1) {
        current = current.replace(oldString, () => newString);
      } else {
        const tolerant = applyTolerantEdit(current, oldString, newString);
        current = tolerant.result;
        tolerantMatches.push(tolerant.label);
      }
      count += 1;
    } catch (err) {
      throw new EditFailure(index, err instanceof Error ? err.message : String(err));
    }
  });

  return { result: crlf ? current.replace(/\n/g, "\r\n") : current, count, tolerantMatches };
}

/**
 * Approval can take minutes. Re-read the file before writing: if it changed, re-apply the edits to the current
 * content so a concurrent change is never overwritten, or fail when the edits no longer apply.
 */
async function revalidateAfterApproval(
  filePath: string,
  approvedFrom: string,
  applied: AppliedEdits,
  edits: SingleEdit[],
): Promise<{ applied: AppliedEdits; note: string } | { error: string }> {
  const current = await Bun.file(filePath).text();
  if (current === approvedFrom) return { applied, note: "" };
  try {
    return {
      applied: applyEdits(current, edits),
      note: " The file changed while waiting for approval; the edit was re-applied to its current content.",
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      error: `Error: ${filePath} changed while waiting for approval and the edit no longer applies (${reason}). Re-read the file before editing.`,
    };
  }
}

function describeTolerantMatches(applied: AppliedEdits): string {
  return applied.tolerantMatches.length > 0 ? ` (matched ${[...new Set(applied.tolerantMatches)].join("; ")})` : "";
}

// ---------------------------------------------------------------------------
// edit tool
// ---------------------------------------------------------------------------

export function createEditTool(host?: RuntimeToolHost): Tool<typeof EditParams> {
  return {
    name: "edit",
    description: `Performs string replacements in files.

Usage:
- Inspect the file before editing unless the exact current text and sufficient context are already available from this conversation or tool output. The tool matches current contents; it does not track prior read calls.
- To create a new file when explicitly required, set old_string to an empty string and new_string to the complete file content. This create mode fails if the file already exists.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- Prefer a focused edit to an existing file. Create a new file when the requested implementation needs it.
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.
- When old_string has no exact match, whole lines are matched again ignoring trailing whitespace, then indentation, then typographic punctuation. The result says which tolerance was used. replace_all always requires an exact match.
- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
    parameters: EditParams,

    async execute(args, ctx): Promise<ToolResult> {
      const file_path = stripExtendedLengthPrefix(args.file_path);
      const { old_string, new_string, replace_all } = args;

      if (!isAbsolute(file_path)) {
        return { output: `Error: file_path must be absolute: ${file_path}`, metadata: { error: true } };
      }

      // --- Create-new-file mode ---
      if (old_string === "") {
        const exists = await fileExists(file_path);
        if (exists) {
          return {
            output:
              "Error: old_string is empty but file already exists. Use a non-empty old_string to edit an existing file.",
            metadata: { error: true },
          };
        }

        const approval = await requestToolApproval(
          host,
          {
            permission: "write",
            toolName: "edit",
            description: `Create ${file_path}`,
            details: { file_path },
          },
          { signal: ctx.signal },
        );
        if (approval === "reject") {
          ctx.abort();
          return { output: "[Rejected by user]", metadata: { error: true } };
        }

        try {
          await mkdir(dirname(file_path), { recursive: true });
          await Bun.write(file_path, new_string);
          const output = `Created ${file_path}`;
          return {
            output,
            render: createEditDiffRenderPayload({
              filePath: file_path,
              oldString: old_string,
              newString: new_string,
              outputText: output,
              actionSummary: "1 file created",
            }),
          };
        } catch (err) {
          return {
            output: `Error creating file: ${err instanceof Error ? err.message : String(err)}`,
            metadata: { error: true },
          };
        }
      }

      // --- Edit existing file ---
      let content: string;
      try {
        content = await Bun.file(file_path).text();
      } catch (err) {
        return {
          output: `Error reading file: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }

      const edits = [{ old_string, new_string, replace_all }];
      let applied: AppliedEdits;
      try {
        applied = applyEdits(content, edits);
      } catch (err) {
        return {
          output: `Error: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }

      const approval = await requestToolApproval(
        host,
        {
          permission: "write",
          toolName: "edit",
          description: `Edit ${file_path}`,
          details: { file_path },
        },
        { signal: ctx.signal },
      );
      if (approval === "reject") {
        ctx.abort();
        return { output: "[Rejected by user]", metadata: { error: true } };
      }

      try {
        const checked = await revalidateAfterApproval(file_path, content, applied, edits);
        if ("error" in checked) return { output: checked.error, metadata: { error: true } };
        const { count } = checked.applied;
        await Bun.write(file_path, checked.applied.result);
        const output = `Edited ${file_path}: replaced ${count} occurrence(s)${describeTolerantMatches(checked.applied)}.${checked.note}`;
        return {
          output,
          render: createEditDiffRenderPayload({
            filePath: file_path,
            oldString: old_string,
            newString: new_string,
            outputText: output,
            actionSummary: `${count} edit${count === 1 ? "" : "s"} applied`,
          }),
        };
      } catch (err) {
        return {
          output: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// multi_edit tool
// ---------------------------------------------------------------------------

export function createMultiEditTool(host?: RuntimeToolHost): Tool<typeof MultiEditParams> {
  return {
    name: "multi_edit",
    description: `This is a tool for making multiple edits to a single file in one operation. It is built on top of the Edit tool and allows you to perform multiple find-and-replace operations efficiently. Prefer this tool over the Edit tool when you need to make multiple edits to the same file.

Before using this tool:
- Use the Read tool to understand the file's contents and context
- Verify the directory path is correct

IMPORTANT:
- All edits are applied in sequence, in the order they are provided
- Each edit operates on the result of the previous edit
- All edits must be valid for the operation to succeed - if any edit fails, none will be applied
- The edits are atomic - either all succeed or none are applied
- Plan your edits carefully to avoid conflicts between sequential operations

WARNING:
- old_string should match the file contents exactly; when it does not, whole lines are matched again ignoring trailing whitespace, then indentation, then typographic punctuation
- The tool will fail if edits.old_string and edits.new_string are the same
- Since edits are applied in sequence, ensure that earlier edits don't affect the text that later edits are trying to find

When making edits:
- Ensure all edits result in idiomatic, correct code
- Do not leave the code in a broken state
- Always use absolute file paths, including drive-qualified paths on Windows.
- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.
`,
    parameters: MultiEditParams,

    async execute(args, ctx): Promise<ToolResult> {
      const file_path = stripExtendedLengthPrefix(args.file_path);
      const { edits } = args;

      if (!isAbsolute(file_path)) {
        return { output: `Error: file_path must be absolute: ${file_path}`, metadata: { error: true } };
      }

      let content: string;
      try {
        content = await Bun.file(file_path).text();
      } catch (err) {
        return {
          output: `Error reading file: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }

      // Validate and apply all edits on an in-memory copy (atomic: fail before writing)
      let applied: AppliedEdits;
      try {
        applied = applyEdits(content, edits);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const output =
          err instanceof EditFailure ? `Error in edit ${err.index + 1}/${edits.length}: ${message}` : message;
        return { output, render: createTextRenderPayload(undefined, output, true), metadata: { error: true } };
      }

      const approval = await requestToolApproval(
        host,
        {
          permission: "write",
          toolName: "multi_edit",
          description: `Multi-edit ${file_path} (${edits.length} edits)`,
          details: { file_path, editCount: edits.length },
        },
        { signal: ctx.signal },
      );
      if (approval === "reject") {
        ctx.abort();
        return { output: "[Rejected by user]", metadata: { error: true } };
      }

      try {
        const checked = await revalidateAfterApproval(file_path, content, applied, edits);
        if ("error" in checked) {
          return {
            output: checked.error,
            render: createTextRenderPayload(undefined, checked.error, true),
            metadata: { error: true },
          };
        }
        const totalCount = checked.applied.count;
        await Bun.write(file_path, checked.applied.result);
        const output = `Edited ${file_path}: applied ${edits.length} edit(s), replaced ${totalCount} occurrence(s) total${describeTolerantMatches(checked.applied)}.${checked.note}`;
        return {
          output,
          render: createMultiEditDiffRenderPayload({
            filePath: file_path,
            edits,
            outputText: output,
            actionSummary: `${edits.length} edit${edits.length === 1 ? "" : "s"} applied`,
          }),
        };
      } catch (err) {
        return {
          output: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }
    },
  };
}
