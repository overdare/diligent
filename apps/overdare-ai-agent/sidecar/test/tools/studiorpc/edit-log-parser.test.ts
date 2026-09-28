// @summary Parses complete records without swallowing unfinished tails or unrelated source names
import { expect, test } from "bun:test";
import { isStudioEditLogSourceName, parseEditLogText } from "../../../src/tools/studiorpc/tools/edit-log";

const record = (guid: string) => ({
  Timestamp: "today",
  ActorGuids: [guid],
  Objects: [{ ActorGuid: guid, Name: 'escaped " { }', InstanceType: "Part", Changes: [] }],
});

test("concatenated records retain a consumed boundary before an unfinished tail", () => {
  const first = JSON.stringify(record("first"), null, 2);
  const parsed = parseEditLogText(first + '\n{"Timestamp":');
  expect(parsed.envelopes.map((entry) => entry.objects[0].guid)).toEqual(["first"]);
  expect(parsed.incomplete).toBe(true);
  expect(parsed.consumedChars).toBe(first.length + 1);
  expect(parsed.failures).toBe(0);
});

test("arrays, adjacent envelopes and JSONL preserve transaction occurrences", () => {
  const value = JSON.stringify(record("same"));
  for (const text of [`[${value},${value}]`, value + value, `${value}\r\n${value}`]) {
    const parsed = parseEditLogText(text);
    expect(parsed.envelopes.map((entry) => entry.objects[0].guid)).toEqual(["same", "same"]);
    expect(parsed.incomplete).toBe(false);
    expect(parsed.failures).toBe(0);
  }
});

test("balanced malformed values and non-JSON garbage are failures, not empty success", () => {
  expect(parseEditLogText('{"broken":}').failures).toBe(1);
  expect(parseEditLogText("garbage").failures).toBe(1);
  expect(parseEditLogText(JSON.stringify(record("good")) + "garbage").failures).toBe(1);
  expect(parseEditLogText("{}").failures).toBe(1);
});

test("source name allowlist never accepts arbitrary consuming files", () => {
  expect(isStudioEditLogSourceName("Edit.Log")).toBe(true);
  expect(isStudioEditLogSourceName("EDIT.LOG.mg3z-1.consuming")).toBe(true);
  for (const name of ["Play.log", "notes.consuming", "Edit.Log.old.consuming", "../Edit.Log", "Edit.Log/child"]) {
    expect(isStudioEditLogSourceName(name)).toBe(false);
  }
});
