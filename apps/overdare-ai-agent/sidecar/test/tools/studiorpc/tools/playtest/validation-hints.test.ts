// @summary Verifies strict validator output maps to concise, deduplicated harness fix hints.
import { expect, test } from "bun:test";
import { validationHints } from "../../../../../src/tools/studiorpc/tools/playtest/validation-hints";

const REAL_OUTPUT = [
  "E type 13:95-13:144 1029 Table type '{ action: string, durationMs: number, key: string, type: string }' not compatible with type '{ pitchDegrees: number, type: string, yawDegrees: number }' because extra fields",
  "E type 12:133-12:225 1002 Key 'FireServer' not found in class 'Instance'",
  "E type 20:10-20:30 1002 Key 'PlayerGui' not found in class 'Player'",
  "E type 21:10-21:40 1002 Key 'F05Night1Blocks' not found in class 'Workspace'",
  "E type 39:3-39:32 1007 Function only returns 1 value, but 2 are required here",
  "SUMMARY scripts=3 errors=5 warnings=0",
].join("\n");

test("maps real strict validation failures to one hint per problem kind", () => {
  const hints = validationHints(REAL_OUTPUT);
  expect(hints).toHaveLength(3);
  expect(hints[0]).toMatch(/P\.key.*P\.wait.*P\.look/);
  expect(hints[0]).toContain("{P.Event}");
  expect(hints[1]).toMatch(/FindFirstChild\/WaitForChild/);
  expect(hints[1]).toContain(":: RemoteEvent");
  expect(hints[2]).toMatch(/return type/);
});

test("returns no hints for clean or unrecognized output", () => {
  expect(validationHints("SUMMARY scripts=3 errors=0 warnings=0")).toEqual([]);
  expect(validationHints("E type 1:1-1:2 1000 Unknown global 'x'")).toEqual([]);
  expect(
    validationHints("E type 1:1-1:2 1029 Table type '{ a: number }' not compatible with type '{ b: string }'"),
  ).toEqual([]);
});
