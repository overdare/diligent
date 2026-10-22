// @summary Covers discovery batch ordering and split-tool history page merging

import { describe, expect, test } from "bun:test";
import type { SessionSummary, ThreadItem } from "@diligent/protocol";
import { mergeHistoryItems, mergeSessionSummaries } from "../../src/client/history-pages";

type ToolItem = Extract<ThreadItem, { type: "toolCall" }>;

const start: ToolItem = {
  type: "toolCall",
  itemId: "tool-1",
  toolCallId: "call-1",
  toolName: "read",
  input: { path: "file.ts" },
  timestamp: 10,
  startedAt: 10,
  parentToolCallId: "parent-1",
};
const result: ToolItem = {
  type: "toolCall",
  itemId: "tool-1",
  toolCallId: "call-1",
  toolName: "read",
  input: {},
  timestamp: 20,
  startedAt: 20,
  output: "contents",
  durationMs: 10,
  isError: false,
};
const context = (id: string): Extract<ThreadItem, { type: "knowledge" }> => ({
  type: "knowledge",
  itemId: id,
  knowledgeId: id,
  content: id,
});
const summary = (id: string, modified: string, messageCount?: number): SessionSummary => ({
  id,
  path: `/sessions/${id}.jsonl`,
  cwd: "/project",
  created: "2026-01-01T00:00:00.000Z",
  modified,
  ...(messageCount === undefined ? {} : { messageCount }),
});

describe("mergeHistoryItems", () => {
  test("prepends older history and enriches result-only tools without losing completion", () => {
    const recent = [result, context("after")];
    const older = [context("before"), start, context("during")];
    const merged = mergeHistoryItems(older, recent);
    expect(merged.map((item) => item.itemId)).toEqual(["before", "tool-1", "during", "after"]);
    expect(merged[1]).toMatchObject({
      input: { path: "file.ts" },
      output: "contents",
      timestamp: 20,
      startedAt: 10,
      durationMs: 10,
      isError: false,
      parentToolCallId: "parent-1",
    });
    expect(recent).toEqual([result, context("after")]);
    expect(older[1]).toBe(start);
    expect(start.output).toBeUndefined();
  });

  test("refresh retains older history and completed tools when a start-only item repeats", () => {
    const loaded = mergeHistoryItems([context("before"), start], [result]);
    const refreshed = mergeHistoryItems(loaded, [start, context("latest")]);
    expect(refreshed.map((item) => item.itemId)).toEqual(["before", "tool-1", "latest"]);
    expect(refreshed[1]).toMatchObject({ output: "contents", durationMs: 10, isError: false });
  });

  test("retains empty completion output and false errors", () => {
    const merged = mergeHistoryItems([{ ...start, output: "stale", isError: true }], [{ ...result, output: "" }]);
    expect(merged[0]).toMatchObject({ output: "", isError: false });
  });

  test("overlapping pages do not duplicate items and latest message data wins", () => {
    const merged = mergeHistoryItems(
      [context("a"), context("b")],
      [{ ...context("b"), content: "updated" }, context("c")],
    );
    expect(merged).toEqual([context("a"), { ...context("b"), content: "updated" }, context("c")]);
    expect(mergeHistoryItems(merged, [])).toEqual(merged);
    expect(mergeHistoryItems([], merged)).toEqual(merged);
  });
});

describe("mergeSessionSummaries", () => {
  test("sorts incoming discovery batches and keeps unknown counts", () => {
    const first = [summary("old", "2026-01-01T00:00:00.000Z"), summary("b", "2026-01-03T00:00:00.000Z", 0)];
    const merged = mergeSessionSummaries(first, [summary("a", "2026-01-03T00:00:00.000Z", 4)]);
    expect(merged.map((session) => session.id)).toEqual(["a", "b", "old"]);
    expect(merged[2].messageCount).toBeUndefined();
    expect(merged[1].messageCount).toBe(0);
    expect(first.map((session) => session.id)).toEqual(["old", "b"]);
  });

  test("deduplicates by id, updates metadata, and retains a batch across empty pages", () => {
    const first = [summary("a", "2026-01-01T00:00:00.000Z")];
    expect(mergeSessionSummaries(first, [])).toEqual(first);
    const updated = { ...first[0], name: "Renamed", modified: "2026-01-02T00:00:00.000Z" };
    expect(mergeSessionSummaries(first, [updated])).toEqual([updated]);
  });
});

test("tool page merging preserves completed render blocks while enriching the input summary", () => {
  const started: ToolItem = {
    ...start,
    render: { inputSummary: "file.ts", blocks: [{ type: "file", filePath: "file.ts" }] },
  };
  const completed: ToolItem = {
    ...result,
    render: { outputSummary: "read complete", blocks: [{ type: "text", text: "contents" }] },
  };
  const [merged] = mergeHistoryItems([started], [completed]);
  expect(merged).toMatchObject({
    input: { path: "file.ts" },
    startedAt: 10,
    timestamp: 20,
    render: { inputSummary: "file.ts", outputSummary: "read complete", blocks: [{ type: "text", text: "contents" }] },
  });
  expect(mergeHistoryItems([merged], [started])[0]).toMatchObject({
    output: "contents",
    render: { inputSummary: "file.ts", outputSummary: "read complete", blocks: [{ type: "text", text: "contents" }] },
  });
});
