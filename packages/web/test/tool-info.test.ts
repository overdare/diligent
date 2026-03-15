// @summary Tests for tool header and summary generation in tool-info helpers
import { expect, test } from "bun:test";
import {
  getToolHeaderTitle,
  parseRequestUserInputTitle,
  parseRequestUserInputTitleFromOutput,
  summarizeInput,
} from "../src/client/lib/tool-info";

test("request_user_input: question text is preferred over header", () => {
  const parsed = {
    questions: [{ id: "scope", header: "Scope", question: "What scope should I use?", options: [] }],
  };
  expect(parseRequestUserInputTitle(parsed)).toBe("What scope should I use?");
});

test("request_user_input: falls back to header when question is absent", () => {
  const parsed = { questions: [{ id: "scope", header: "Scope", options: [] }] };
  expect(parseRequestUserInputTitle(parsed)).toBe("Scope");
});

test("request_user_input: returns undefined when questions array is empty", () => {
  expect(parseRequestUserInputTitle({ questions: [] })).toBeUndefined();
});

test("request_user_input: extracts question text after bracket tag in output", () => {
  const output = "[Meaning] What do you want me to do with your message?\nAnswer: Help with a task";
  expect(parseRequestUserInputTitleFromOutput(output)).toBe("What do you want me to do with your message?");
});

test("request_user_input: falls back to bracket tag itself when no trailing text", () => {
  expect(parseRequestUserInputTitleFromOutput("[Scope]")).toBe("Scope");
});

test("request_user_input: returns undefined for empty output", () => {
  expect(parseRequestUserInputTitleFromOutput("")).toBeUndefined();
});

test("summary prefers explicit intent fields for non-request tools", () => {
  const input = JSON.stringify({
    prompt: "Refactor the sidebar list interaction to preserve keyboard focus.",
    path: "/tmp/ignored.txt",
  });
  expect(summarizeInput("spawn_agent", input)).toContain("Refactor the sidebar");
});

test("summary-first payload header becomes summary label for grep", () => {
  const input = JSON.stringify({
    pattern: "TODO",
    path: "/Users/me/project/src/main.ts",
    include: "*.ts",
  });
  const output = "/Users/me/project/src/main.ts:1:// TODO";
  expect(getToolHeaderTitle("grep", input, output)).toBe("Grep — Summary");
});

test("summarizeInput shows read target path", () => {
  const input = JSON.stringify({ file_path: "/Users/alice/git/diligent/packages/web/src/client/App.tsx" });
  expect(summarizeInput("read", input)).toBe("Read client/App.tsx");
});

test("header title uses block title when provided by payload", () => {
  const input = JSON.stringify({
    action: "upsert",
    id: "k1",
    type: "pattern",
    content: "x",
    confidence: 0.9,
    tags: [],
  });
  const output = "saved";
  expect(getToolHeaderTitle("update_knowledge", input, output)).toBe("Knowledge — Details");
});

test("update_knowledge payload-first header remains details with enriched blocks", () => {
  const input = JSON.stringify({
    action: "upsert",
    id: "k1",
    type: "pattern",
    content: "Prefer batched tool calls for independent reads",
    confidence: 0.91,
    tags: ["workflow", "perf"],
  });
  const output = "Knowledge saved: [pattern] Prefer batched tool calls";
  expect(getToolHeaderTitle("update_knowledge", input, output)).toBe("Knowledge — Details");
});

test("summarizeInput falls back to compact single-line JSON for generic tools", () => {
  const input = JSON.stringify(
    {
      alpha: 1,
      nested: { beta: true },
    },
    null,
    2,
  );
  expect(summarizeInput("custom_tool", input)).toBe('{"alpha":1,"nested":{"beta":true}}');
});
