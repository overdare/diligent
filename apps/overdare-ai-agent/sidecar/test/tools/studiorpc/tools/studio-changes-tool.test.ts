// @summary Studio change query modes remain explicit with stale or unused detail filters.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getStudioChangeCollector,
  stopStudioChangeCollector,
} from "../../../../src/tools/studiorpc/tools/studio-change-collector";
import { createStudioChangesTool } from "../../../../src/tools/studiorpc/tools/studio-changes-tool";

const directories: string[] = [];
const context = { toolCallId: "query", signal: new AbortController().signal, abort() {} };

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "studio-change-query-"));
  directories.push(cwd);
  const tool = createStudioChangesTool(getStudioChangeCollector(cwd), () => ({
    sessionId: "reader",
    rootSessionId: "reader",
    resumed: false,
  }));
  return { cwd, tool };
}

function writeChange(cwd: string, guid: string) {
  writeFileSync(
    join(cwd, "Edit.Log"),
    JSON.stringify({
      Timestamp: "now",
      ActorGuids: [guid],
      Objects: [
        {
          ActorGuid: guid,
          InstanceType: "Part",
          Name: guid,
          Changes: [{ Property: "Name", Before: "old", After: guid }],
        },
      ],
    }),
  );
}

afterEach(async () => {
  for (const cwd of directories.splice(0)) {
    await stopStudioChangeCollector(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test.each([
  { batchId: "expired-batch" },
  { guid: "previous-record" },
  { changeType: "modified" },
  { offset: 1 },
  { batchId: "expired-batch", guid: "previous-record", changeType: "modified", offset: 1, limit: 1 },
])("new queries collect unread changes despite detail fields %j", async (detailFields) => {
  const { cwd, tool } = setup();
  writeChange(cwd, "previous-record");
  await tool.execute({}, context);
  writeChange(cwd, "fresh-record");

  const result = await tool.execute({ view: "new", ...detailFields }, context);

  expect(result.metadata?.error).not.toBe(true);
  expect(result.output).toContain("fresh-record");
  expect(result.output).not.toContain("previous-record");
  expect(existsSync(join(cwd, "Edit.Log"))).toBe(false);
  expect((await tool.execute({ view: "new" }, context)).output).toBe(
    "No Studio changes recorded in the collected edit log.",
  );
});

test("new queries accept null for unused detail fields advertised to strict providers", async () => {
  const { cwd, tool } = setup();
  writeChange(cwd, "fresh-record");

  const result = await tool.execute(
    { view: "new", batchId: null, guid: null, changeType: null, offset: 0, limit: 20 },
    context,
  );

  expect(result.metadata?.error).not.toBe(true);
  expect(result.output).toContain("fresh-record");
  expect(existsSync(join(cwd, "Edit.Log"))).toBe(false);
});

test("details with null filters use the latest retained batch without collecting new changes", async () => {
  const { cwd, tool } = setup();
  writeChange(cwd, "previous-record");
  const previous = await tool.execute({}, context);
  writeChange(cwd, "fresh-record");

  const details = await tool.execute(
    { view: "details", batchId: null, guid: null, changeType: null, offset: 0, limit: 20 },
    context,
  );

  expect(details.metadata?.error).not.toBe(true);
  expect(details.metadata?.batchId).toBe(previous.metadata?.batchId);
  expect(details.output).toContain("previous-record");
  expect(details.output).not.toContain("fresh-record");
  expect(existsSync(join(cwd, "Edit.Log"))).toBe(true);
  expect((await tool.execute({ view: "new" }, context)).output).toContain("fresh-record");
});
