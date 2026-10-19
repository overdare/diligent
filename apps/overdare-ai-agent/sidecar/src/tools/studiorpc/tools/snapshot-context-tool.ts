// @summary Inspects immutable snapshot maps with optional conversation context, without restoring Studio.

import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Tool, ToolResult } from "../types";
import { findSnapshotById, type SnapshotEntry, truncateLabel } from "./snapshot";
import { readSnapshotData, type SnapshotDataPage } from "./snapshot-data";

const params = z.object({
  snapshotId: z.string().describe("Snapshot id from studiorpc_snapshot_list."),
  view: z
    .enum(["tree", "instance", "script"])
    .default("tree")
    .describe("tree: saved hierarchy; instance: property JSON excluding Source; script: original Source text."),
  guid: z
    .string()
    .min(1)
    .optional()
    .describe("Required for instance/script. For tree, optionally restrict to this saved subtree."),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Zero-based node offset for tree, character offset for instance/script. Use nextOffset to continue."),
  limit: z
    .number()
    .int()
    .positive()
    .max(8000)
    .optional()
    .describe(
      "Page size: tree defaults to 50 nodes and caps larger requests at 200; instance/script default to 4000 characters (max 8000).",
    ),
  includeConversation: z
    .boolean()
    .default(false)
    .describe("Also read the linked user request and following conversation excerpt."),
});

const description =
  "Inspect a saved snapshot without rolling back or contacting Studio. Returns JSON with snapshot metadata, " +
  "the stored stateSummary, and paged map data. Start with tree to find saved GUIDs; use instance for properties " +
  "or script for exact Source text. Continue with data.nextOffset when present; the output byte budget may " +
  "return fewer items than limit. Concatenate instance content pages before parsing their property JSON. Read only the immutable " +
  "snapshot, so it works even if the current map changed or Studio is offline. With includeConversation=true, " +
  "also look up the exact userMessageId in its recorded transcript (text/time fallback for legacy snapshots). " +
  "Conversation after capture can describe later changes; it is separate from the saved map data.";

const FOLLOWING_ENTRIES = 4;
const ENTRY_CHAR_CAP = 500;
// Leave room below the runtime's 50 KB truncation threshold so paging JSON stays intact.
const OUTPUT_BYTE_CAP = 40_000;

interface TranscriptMessage {
  id?: string;
  role: string;
  text: string;
  timestamp: string;
}

/** Extract plain text from a session message's string-or-blocks content. */
function messageText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const texts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

/** Parse "message" entries out of a session JSONL transcript, tolerating bad lines. */
function readTranscriptMessages(transcriptPath: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  for (const line of readFileSync(transcriptPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const entry = parsed as {
      type?: unknown;
      id?: unknown;
      timestamp?: unknown;
      message?: { role?: unknown; content?: unknown };
    };
    if (entry.type !== "message" || !entry.message || typeof entry.message.role !== "string") continue;
    const text =
      messageText(entry.message.content) ?? (entry.message.role === "user" ? "(Message contains no text.)" : undefined);
    if (text === undefined) continue;
    messages.push({
      id: typeof entry.id === "string" ? entry.id : undefined,
      role: entry.message.role,
      text,
      timestamp: typeof entry.timestamp === "string" ? entry.timestamp : "",
    });
  }
  return messages;
}

function clip(text: string): string {
  return text.length > ENTRY_CHAR_CAP ? `${text.slice(0, ENTRY_CHAR_CAP)}…` : text;
}

/** Exact IDs are authoritative; only legacy snapshots use prompt text and time. */
function readConversation(snapshot: SnapshotEntry): string {
  if (!snapshot.transcriptPath) return `Snapshot ${snapshot.id} has no transcript reference.`;
  const label = snapshot.label;
  if (!snapshot.userMessageId && !label) return `Snapshot ${snapshot.id} has no label to locate in the transcript.`;
  let messages: TranscriptMessage[];
  try {
    messages = readTranscriptMessages(snapshot.transcriptPath);
  } catch {
    return `The transcript recorded for snapshot ${snapshot.id} could not be read (${snapshot.transcriptPath}).`;
  }
  const matches = messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        message.role === "user" &&
        (snapshot.userMessageId ? message.id === snapshot.userMessageId : message.text.startsWith(label!)),
    );
  if (matches.length === 0) {
    return `The request ${snapshot.userMessageId ?? ""} for snapshot ${snapshot.id} was not found in the transcript (it may have been compacted away).`;
  }
  const before = matches.filter(({ message }) => message.timestamp && message.timestamp <= snapshot.createdAt);
  const eligible = snapshot.userMessageId ? matches : before.length > 0 ? before : matches;
  const match = eligible[eligible.length - 1];
  const following = messages.slice(match.index + 1, match.index + 1 + FOLLOWING_ENTRIES);
  const nextRequest = following.findIndex((message) => message.role === "user");
  const window = [match.message, ...(nextRequest < 0 ? following : following.slice(0, nextRequest))];
  const rendered = window.map((message) => `[${message.role}] ${clip(message.text)}`).join("\n");
  return (
    `Conversation for ${label ? `"${truncateLabel(label)}"` : "the linked request"} ` +
    `(following messages may describe changes made AFTER capture):\n\n${rendered}`
  );
}

export function createSnapshotContextTool(cwd: string): Tool {
  return {
    name: "studiorpc_snapshot_context",
    description,
    parameters: params,
    async execute(rawArgs, ctx): Promise<ToolResult> {
      const args = params.parse(rawArgs ?? {});
      ctx.signal.throwIfAborted();
      let snapshot: SnapshotEntry;
      try {
        snapshot = findSnapshotById(cwd, args.snapshotId);
      } catch (error) {
        return { output: (error as Error).message, metadata: { error: true, method: "snapshot.context" } };
      }
      let data: SnapshotDataPage | undefined;
      let dataError: string | undefined;
      try {
        data = await readSnapshotData(snapshot.path, {
          view: args.view,
          guid: args.guid,
          offset: args.offset,
          limit: args.view === "tree" ? Math.min(args.limit ?? 50, 200) : (args.limit ?? 4000),
        });
      } catch (error) {
        dataError = error instanceof Error ? error.message : String(error);
      }
      ctx.signal.throwIfAborted();
      const { path: _path, transcriptPath: _transcriptPath, ...metadata } = snapshot;
      const conversation = args.includeConversation ? readConversation(snapshot) : undefined;
      const render = () =>
        JSON.stringify(
          {
            snapshot: { ...metadata, summaryStatus: snapshot.summaryStatus ?? "unavailable" },
            ...(data ? { data } : { dataError }),
            ...(conversation !== undefined ? { conversation } : {}),
          },
          null,
          2,
        );
      let output = render();
      while (data && Buffer.byteLength(output) > OUTPUT_BYTE_CAP) {
        const length = data.view === "tree" ? data.nodes.length : data.content.length;
        if (length <= 1) {
          dataError = "Snapshot metadata or instance identity exceeds the context output limit.";
          data = undefined;
        } else {
          const keep = Math.floor(length / 2);
          if (data.view === "tree") data.nodes = data.nodes.slice(0, keep);
          else data.content = data.content.slice(0, keep);
          data.nextOffset = data.offset + keep;
        }
        output = render();
      }
      if (Buffer.byteLength(output) > OUTPUT_BYTE_CAP) {
        dataError = "Snapshot metadata exceeds the context output limit.";
        output = JSON.stringify({ snapshot: { id: snapshot.id }, dataError });
      }
      return {
        output,
        metadata: {
          method: "snapshot.context",
          snapshotId: snapshot.id,
          userMessageId: snapshot.userMessageId,
          ...(dataError !== undefined ? { error: true } : {}),
        },
      };
    },
  };
}
