// @summary Cascade deletion summaries preserve descendant identity and transaction ordering.
import { expect, test } from "bun:test";
import { parseEditLogText, studioChangeDetails, summarizeEditLog } from "../../../src/tools/studiorpc/tools/edit-log";

const ref = (guid: string, type = "Part") => ({ ActorGuid: guid, InstanceType: type, Name: guid });
const create = (guid: string, type = "Part") => ({
  Action: "Create",
  ActorGuids: [guid],
  Objects: [ref(guid, type)],
});
const deletion = (descendants: unknown[] = [ref("part"), ref("grandchild")]) => ({
  Action: "Delete",
  ActorGuids: ["folder"],
  Objects: [
    { ...ref("folder", "Folder"), Changes: [{ Property: "Descendants", Removed: descendants }] },
    { ...ref("workspace", "Workspace"), Changes: [{ Property: "LuaChildren", Removed: [ref("folder")] }] },
  ],
});
const parse = (records: unknown[]) => parseEditLogText(JSON.stringify(records)).envelopes;

test("created children and grandchildren become transient after their ancestor is deleted", () => {
  const records = parse([create("folder", "Folder"), create("part"), create("grandchild"), deletion()]);
  expect(summarizeEditLog(records).output).toContain("Added then removed (3)");
  expect(summarizeEditLog(records).output).not.toContain("Added (");
  expect(studioChangeDetails(records, { guid: "part", changeType: "addedThenRemoved" }).output).toContain(
    '+- Part "part" (part)',
  );
  expect(studioChangeDetails(records, { guid: "grandchild", changeType: "addedThenRemoved" }).total).toBe(1);
  expect(studioChangeDetails(records, { guid: "workspace" }).total).toBe(0);
});

test("descendant references absent from Objects produce deduplicated removal rows", () => {
  const records = parse([
    deletion([ref("part"), ref("part"), ref("folder", "Folder"), null, { Name: "invalid" }, "invalid"]),
  ]);
  expect(summarizeEditLog(records).output).toContain("Removed (2)");
  const details = studioChangeDetails(records, { guid: "part", changeType: "removed" });
  expect(details.total).toBe(1);
  expect(details.output).toBe('- Part "part" (part)');
});

test("a descendant recreated after cascade deletion remains added", () => {
  const records = parse([create("part"), deletion(), create("part")]);
  expect(studioChangeDetails(records, { guid: "part", changeType: "added" }).total).toBe(1);
  expect(studioChangeDetails(records, { guid: "part", changeType: "removed" }).total).toBe(0);
  expect(studioChangeDetails(records, { guid: "part", changeType: "addedThenRemoved" }).total).toBe(0);
});

test("list removals outside a subject deletion never imply instance deletion", () => {
  const moved = deletion();
  moved.Action = "Update";
  const records = parse([create("part"), moved]);
  expect(studioChangeDetails(records, { guid: "part", changeType: "added" }).total).toBe(1);
  expect(studioChangeDetails(records, { guid: "grandchild" }).total).toBe(0);
  const legacy = deletion([]);
  legacy.Objects[0].Changes = [{ Property: "LuaChildren", Removed: [ref("part")] }];
  expect(studioChangeDetails(parse([create("part"), legacy]), { guid: "part", changeType: "added" }).total).toBe(1);
});

test("multiple selected roots remove overlapping descendant references once", () => {
  const record = deletion([ref("part"), ref("nested", "Folder")]);
  record.ActorGuids.push("nested");
  record.Objects.push({
    ...ref("nested", "Folder"),
    Changes: [{ Property: "Descendants", Removed: [ref("part"), ref("grandchild")] }],
  });
  const records = parse([record]);
  expect(summarizeEditLog(records).output).toContain("Removed (4)");
  expect(studioChangeDetails(records).total).toBe(4);
});
