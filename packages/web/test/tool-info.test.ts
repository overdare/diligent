// @summary Tests for tool header and summary generation in tool-info helpers
import { expect, test } from "bun:test";
import {
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
  expect(summarizeInput("task", input)).toContain("Refactor the sidebar");
});
