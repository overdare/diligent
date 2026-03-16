// @summary Tests for agent mode definitions and tool allowlists
import { describe, expect, test } from "bun:test";
import { MODE_SYSTEM_PROMPT_SUFFIXES, PLAN_MODE_ALLOWED_TOOLS } from "../../src/agent/mode";

describe("PLAN_MODE_ALLOWED_TOOLS", () => {
  test("contains only read-only tools", () => {
    expect(PLAN_MODE_ALLOWED_TOOLS.has("read")).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("glob")).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("grep")).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("ls")).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("skill")).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("bash")).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("write")).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("apply_patch")).toBe(false);
    expect(PLAN_MODE_ALLOWED_TOOLS.has("update_knowledge")).toBe(false);
  });
});

describe("MODE_SYSTEM_PROMPT_SUFFIXES", () => {
  test("default mode has empty suffix", () => {
    expect(MODE_SYSTEM_PROMPT_SUFFIXES.default).toBe("");
  });

  test("execute mode prompt instructs agents to wait for running sub-agents before yielding", () => {
    expect(MODE_SYSTEM_PROMPT_SUFFIXES.execute).toContain("wait for them before yielding");
    expect(MODE_SYSTEM_PROMPT_SUFFIXES.execute).toContain(
      "your primary role becomes coordinating them until they finish",
    );
  });

  test("plan mode prompt instructs agents to wait for running explore agents before yielding", () => {
    expect(MODE_SYSTEM_PROMPT_SUFFIXES.plan).toContain("wait for them before yielding");
  });
});
