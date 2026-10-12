// @summary Tests for QuestionInput: option.value mapping (e.g. assetId) and multi-select rendering/submission.

import { describe, expect, test } from "bun:test";
import { QuestionInput } from "../../../src/tui/components/question-input";

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("QuestionInput value mapping", () => {
  test("single select returns option.value when present", () => {
    let result: string | string[] | null = "unset";
    const input = new QuestionInput(
      { question: "Pick an asset", options: [{ label: "Katana, Rusty", description: "MODEL", value: "6584600" }] },
      (value) => {
        result = value;
      },
    );

    input.handleInput("\r"); // Enter submits the focused (first) option
    expect(result).toBe("6584600");
  });

  test("single select falls back to label when value is absent", () => {
    let result: string | string[] | null = "unset";
    const input = new QuestionInput({ question: "Pick", options: [{ label: "Yes", description: "" }] }, (value) => {
      result = value;
    });

    input.handleInput("\r");
    expect(result).toBe("Yes");
  });
});

describe("QuestionInput", () => {
  test("renders multi-select options with clear checkbox glyphs", () => {
    const input = new QuestionInput(
      {
        question: "Choose next steps",
        options: [
          { label: "Fix UI", description: "Recommended" },
          { label: "Wait", description: "No changes" },
        ],
        allowMultiple: true,
      },
      () => {},
    );

    let plain = input.render(80).map(stripAnsi).join("\n");
    expect(plain).toContain("☐ Fix UI");
    expect(plain).not.toContain("[ ]");

    input.handleInput(" ");
    plain = input.render(80).map(stripAnsi).join("\n");

    expect(plain).toContain("☑ Fix UI");
    expect(plain).toContain("☐ Wait");
    expect(plain).not.toContain("[x]");
    expect(plain).not.toContain("[ ]");
  });
});

describe("asset palette choices", () => {
  test("submits pack and none values and keeps escape as cancellation", () => {
    for (const [key, expected] of [
      ["\r", "pack:pack_metro"],
      ["\u001b[B\r", "none"],
      ["\u001b", null],
    ]) {
      let result: string | string[] | null = "unset";
      const input = new QuestionInput(
        {
          question: "Pick an asset or pack",
          options: [
            { label: "Use metro palette", description: "12 assets", value: "pack:pack_metro" },
            { label: "None of these are suitable", description: "Try another approach", value: "none" },
          ],
        },
        (value) => {
          result = value;
        },
      );
      if (key === "\u001b[B\r") {
        input.handleInput("\u001b[B");
        input.handleInput("\r");
      } else input.handleInput(key as string);
      expect(result).toBe(expected);
    }
  });
});
