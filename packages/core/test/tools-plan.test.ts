// @summary Tests for plan tool: output format, step rendering, empty title default
import { describe, expect, it } from "bun:test";
import type { ToolContext } from "../src/tool/types";
import { createPlanTool } from "../src/tools/plan";

function makeCtx(): ToolContext {
  return {
    toolCallId: "test-tc",
    signal: new AbortController().signal,
    approve: async () => "once" as const,
    onUpdate: () => {},
  };
}

describe("plan tool", () => {
  it("returns JSON with title and steps", async () => {
    const tool = createPlanTool();
    const result = await tool.execute(
      {
        steps: [
          { text: "Read the code", done: true },
          { text: "Write the fix", done: false },
          { text: "Run tests", done: false },
        ],
      },
      makeCtx(),
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.title).toBe("Plan");
    expect(parsed.steps).toHaveLength(3);
    expect(parsed.steps[0]).toEqual({ text: "Read the code", done: true });
    expect(parsed.steps[1]).toEqual({ text: "Write the fix", done: false });
  });

  it("uses custom title when provided", async () => {
    const tool = createPlanTool();
    const result = await tool.execute({ title: "Refactor Plan", steps: [{ text: "Step 1", done: false }] }, makeCtx());
    const parsed = JSON.parse(result.output);
    expect(parsed.title).toBe("Refactor Plan");
  });

  it("defaults done to false when omitted", async () => {
    const tool = createPlanTool();
    const result = await tool.execute({ steps: [{ text: "Do something" }] }, makeCtx());
    const parsed = JSON.parse(result.output);
    expect(parsed.steps[0].done).toBe(false);
  });

  it("rejects empty steps array", async () => {
    const tool = createPlanTool();
    await expect(tool.execute({ steps: [] }, makeCtx())).rejects.toThrow();
  });

  it("preserves step order", async () => {
    const tool = createPlanTool();
    const steps = [
      { text: "Alpha", done: false },
      { text: "Beta", done: true },
      { text: "Gamma", done: false },
    ];
    const result = await tool.execute({ steps }, makeCtx());
    const parsed = JSON.parse(result.output);
    expect(parsed.steps.map((s: { text: string }) => s.text)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});
