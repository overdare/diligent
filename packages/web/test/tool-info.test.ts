// @summary Tests for tool header and summary generation in tool-info helpers
import { expect, test } from "bun:test";
import { getToolHeaderTitle, summarizeInput } from "../src/client/lib/tool-info";

test("request_user_input title prefers question text", () => {
  const input = JSON.stringify({
    questions: [{ id: "scope", header: "Scope", question: "What scope should I use?", options: [] }],
  });
  expect(getToolHeaderTitle("request_user_input", input)).toBe("Ask - What scope should I use?");
});

test("request_user_input falls back to Ask when no parsable question title", () => {
  expect(getToolHeaderTitle("request_user_input", "{invalid")).toBe("Ask");
});

test("request_user_input header is inferred from output when input is missing", () => {
  const output = "[Meaning] What do you want me to do with your message?\nAnswer: Help with a task";
  expect(getToolHeaderTitle("request_user_input", "", output)).toBe(
    "Ask - What do you want me to do with your message?",
  );
});

test("summary prefers explicit intent fields for non-request tools", () => {
  const input = JSON.stringify({
    prompt: "Refactor the sidebar list interaction to preserve keyboard focus.",
    path: "/tmp/ignored.txt",
  });
  expect(summarizeInput("task", input)).toContain("Refactor the sidebar");
});
