// @summary Tests that lua.validate surfaces Studio's report as text and asks for strict.

import { describe, expect, test } from "bun:test";
import { normalizeArgs, postProcess } from "../../../../src/tools/studiorpc/methods/lua.validate";

const REPORT = [
  "LUA_VALIDATE v1 requested=strict",
  "SCRIPT ABC Main effective=strict",
  "E TypeError 3:1-3:9 [1000] Unknown global 'foo'",
  "SUMMARY scripts=1 errors=1 warnings=0",
].join("\n");

describe("lua.validate", () => {
  test("the report reaches the agent as plain text, not as escaped JSON", () => {
    expect(postProcess({ output: REPORT })).toBe(REPORT);
  });

  test("a reply without an output string is passed through untouched", () => {
    const reply = { unexpected: true };
    expect(postProcess(reply)).toBe(reply);
  });

  test("strict is requested by default — nonstrict cannot report a typo at all", () => {
    expect(normalizeArgs({}).mode).toBe("strict");
    expect(normalizeArgs({ targetGuids: ["ABC"] }).mode).toBe("strict");
  });

  test("an explicit mode still wins over the default", () => {
    expect(normalizeArgs({ mode: "nonstrict" }).mode).toBe("nonstrict");
  });
});
