// @summary Tests for request_user_input tool — ctx.ask wiring and answer formatting
import { describe, expect, it } from "bun:test";
import type { ToolContext, UserInputRequest, UserInputResponse } from "../../tool/types";
import { requestUserInputTool } from "../request-user-input";

function makeCtx(ask?: (req: UserInputRequest) => Promise<UserInputResponse>): ToolContext {
  return {
    toolCallId: "tc-1",
    signal: new AbortController().signal,
    approve: async () => "once",
    ask,
  };
}

const YES_NO_OPTIONS = [
  { label: "Yes", description: "Proceed with the action" },
  { label: "No", description: "Skip and do nothing" },
];

describe("requestUserInputTool", () => {
  it("returns fallback message when ctx.ask is not available", async () => {
    const result = await requestUserInputTool.execute(
      { questions: [{ id: "q1", header: "confirm", question: "Continue?", options: YES_NO_OPTIONS }] },
      makeCtx(),
    );
    expect(result.output).toBe("User input not available in this context.");
  });

  it("formats single question answer with header prefix", async () => {
    const ctx = makeCtx(async () => ({ answers: { q1: "Yes" } }));
    const result = await requestUserInputTool.execute(
      { questions: [{ id: "q1", header: "confirm", question: "Continue?", options: YES_NO_OPTIONS }] },
      ctx,
    );
    expect(result.output).toBe("[confirm] Continue?\nAnswer: Yes");
  });

  it("formats multiple questions with double newline separator", async () => {
    const ctx = makeCtx(async () => ({ answers: { q1: "Fix in place", q2: "Yes" } }));
    const result = await requestUserInputTool.execute(
      {
        questions: [
          {
            id: "q1",
            header: "approach",
            question: "Which approach?",
            options: [
              { label: "Fix in place", description: "Minimal change" },
              { label: "Rewrite", description: "Clean slate" },
            ],
          },
          {
            id: "q2",
            header: "confirm",
            question: "Proceed?",
            options: YES_NO_OPTIONS,
          },
        ],
      },
      ctx,
    );
    expect(result.output).toBe("[approach] Which approach?\nAnswer: Fix in place\n\n[confirm] Proceed?\nAnswer: Yes");
  });

  it("returns abortRequested when question answer is missing", async () => {
    const ctx = makeCtx(async () => ({ answers: {} }));
    const result = await requestUserInputTool.execute(
      { questions: [{ id: "q1", header: "info", question: "Any thoughts?", options: YES_NO_OPTIONS }] },
      ctx,
    );
    expect(result.abortRequested).toBe(true);
    expect(result.output).toContain("[Cancelled by user]");
  });

  it("returns abortRequested when question answer is blank", async () => {
    const ctx = makeCtx(async () => ({ answers: { q1: "   " } }));
    const result = await requestUserInputTool.execute(
      { questions: [{ id: "q1", header: "info", question: "Any thoughts?", options: YES_NO_OPTIONS }] },
      ctx,
    );
    expect(result.abortRequested).toBe(true);
    expect(result.output).toContain("[Cancelled by user]");
  });

  it("rejects call when options array has fewer than 2 items", () => {
    const parsed = requestUserInputTool.parameters.safeParse({
      questions: [
        { id: "q1", header: "bad", question: "One option only?", options: [{ label: "A", description: "only one" }] },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects call when options array has more than 3 items", async () => {
    const parsed = requestUserInputTool.parameters.safeParse({
      questions: [
        {
          id: "q1",
          header: "too many",
          question: "Pick one?",
          options: [
            { label: "A", description: "a" },
            { label: "B", description: "b" },
            { label: "C", description: "c" },
            { label: "D", description: "d" },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects call when more than 3 questions", async () => {
    const q = { id: "q", header: "h", question: "Q?", options: YES_NO_OPTIONS };
    const parsed = requestUserInputTool.parameters.safeParse({ questions: [q, q, q, q] });
    expect(parsed.success).toBe(false);
  });

  it("rejects call when header exceeds 12 characters", async () => {
    const parsed = requestUserInputTool.parameters.safeParse({
      questions: [{ id: "q1", header: "toolongheader", question: "Q?", options: YES_NO_OPTIONS }],
    });
    expect(parsed.success).toBe(false);
  });
});
