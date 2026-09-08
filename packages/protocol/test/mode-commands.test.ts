// @summary Tests for the per-mode slash command names and the shift+tab cycle

import { describe, expect, test } from "bun:test";
import { MODE_COMMAND_NAMES, type Mode, ModeSchema, nextCycledMode } from "../src/data-model";

describe("MODE_COMMAND_NAMES", () => {
  test("names every mode with a unique, non-empty command", () => {
    const names = ModeSchema.options.map((mode) => MODE_COMMAND_NAMES[mode]);
    expect(names.every((name) => name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("nextCycledMode", () => {
  test("visits every mode once and returns to the start", () => {
    const seen: Mode[] = [];
    let mode: Mode = ModeSchema.options[0];
    for (let i = 0; i < ModeSchema.options.length; i++) {
      seen.push(mode);
      mode = nextCycledMode(mode);
    }
    expect(new Set(seen).size).toBe(ModeSchema.options.length);
    expect(mode).toBe(ModeSchema.options[0]);
  });
});
