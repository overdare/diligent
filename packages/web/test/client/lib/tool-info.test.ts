// @summary Tests for tool header and summary generation in tool-info helpers
import { expect, test } from "bun:test";
import {
  deriveRenderPayload,
  getToolHeaderTitle,
  parseRequestUserInputTitle,
  parseRequestUserInputTitleFromOutput,
  summarizeInput,
  summarizeOutput,
} from "../../../src/client/lib/tool-info";

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

test("generic fallback payload uses raw input/output summaries", () => {
  const payload = deriveRenderPayload(
    '{\n  "prompt": "Refactor the sidebar list interaction to preserve keyboard focus."\n}',
    "Done successfully",
  );
  expect(summarizeInput(payload)).toBe("{");
  expect(summarizeOutput(payload)).toBe("Done successfully");
});

test("header title uses toolName - inputSummary rule", () => {
  const payload = {
    version: 2 as const,
    inputSummary: "src/client/App.tsx",
    blocks: [],
  };
  expect(getToolHeaderTitle("read", payload)).toBe("Read - src/client/App.tsx");
});

test("header title falls back to tool display name without summary", () => {
  expect(getToolHeaderTitle("update_knowledge", undefined)).toBe("Knowledge");
});

test("generic fallback emits text blocks for input and output", () => {
  const payload = deriveRenderPayload('{"alpha":1}', "ok");
  expect(payload?.blocks).toEqual([
    { type: "text", title: "Input", text: '{"alpha":1}' },
    { type: "text", title: "Output", text: "ok", isError: false },
  ]);
});
