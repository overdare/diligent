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

test("plan header uses status-based progress for modern plan payloads", () => {
  const input = JSON.stringify({
    title: "Ship fix",
    steps: [
      { text: "Investigate", status: "done" },
      { text: "Implement", status: "in_progress" },
      { text: "Verify", status: "pending" },
    ],
  });
  expect(getToolHeaderTitle("plan", input)).toBe("Plan Updated 1/3 — Ship fix");
});

test("summarizeInput shows read target path", () => {
  const input = JSON.stringify({ file_path: "/Users/devbv-mini4/git/diligent/packages/web/src/client/App.tsx" });
  expect(summarizeInput("read", input)).toBe("Read client/App.tsx");
});

test("summarizeInput shows patch target path", () => {
  const input = JSON.stringify({
    patch: "*** Begin Patch\n*** Update File: packages/web/src/client/lib/tool-info.ts\n*** End Patch",
  });
  expect(summarizeInput("apply_patch", input)).toBe("Patch lib/tool-info.ts");
});
