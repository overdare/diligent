// @summary Verifies bounded, immutable reads of tree, instance, and script data from saved snapshots.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSnapshotData, type SnapshotDataPage } from "../../../../src/tools/studiorpc/tools/snapshot-data";

const dirs: string[] = [];

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), "snapshot-data-"));
  dirs.push(cwd);
  return cwd;
}

function document(scriptSource = "return 'saved'") {
  return {
    Root: {
      Name: "Workspace",
      InstanceType: "Workspace",
      ActorGuid: "root-guid",
      Gravity: 196.2,
      LuaChildren: [
        {
          Name: "OldPart",
          InstanceType: "Part",
          ActorGuid: "part-guid",
          Size: { X: 4, Y: 1, Z: 8 },
          Anchored: true,
          LuaChildren: [
            {
              Name: "OldScript",
              InstanceType: "Script",
              ActorGuid: "script-guid",
              Source: scriptSource,
              Enabled: false,
            },
          ],
        },
        {
          Name: "NoSource",
          InstanceType: "Folder",
          ActorGuid: "no-source-guid",
        },
        {
          Name: "BadSource",
          InstanceType: "Script",
          ActorGuid: "bad-source-guid",
          Source: 42,
        },
      ],
    },
  };
}

function writeSnapshot(cwd: string, value: unknown, utf16 = false): string {
  const path = join(cwd, "saved.ovdrjm");
  const json = JSON.stringify(value);
  writeFileSync(path, utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, "utf16le")]) : json);
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readSnapshotData", () => {
  test("reads only immutable snapshot bytes after the live map changes and is deleted", async () => {
    const cwd = project();
    const snapshotPath = writeSnapshot(cwd, document());
    const livePath = join(cwd, "live.ovdrjm");
    writeFileSync(livePath, JSON.stringify({ Root: { Name: "ChangedLiveMap", InstanceType: "Workspace" } }));
    unlinkSync(livePath);

    const page = await readSnapshotData(snapshotPath, { view: "tree", offset: 0, limit: 20 });

    expect(page.view).toBe("tree");
    if (page.view !== "tree") throw new Error("Expected tree page");
    expect(page.nodes.map((node) => node.name)).toEqual(["Workspace", "OldPart", "OldScript", "NoSource", "BadSource"]);
  });

  test("allows a root without a GUID and bounds identity label previews", async () => {
    const cwd = project();
    const snapshotPath = writeSnapshot(cwd, {
      Root: {
        Name: "n".repeat(300),
        InstanceType: "c".repeat(300),
        LuaChildren: [{ Name: "Child", InstanceType: "Part", ActorGuid: "child-guid" }],
      },
    });

    const page = await readSnapshotData(snapshotPath, { view: "tree", offset: 0, limit: 20 });

    if (page.view !== "tree") throw new Error("Expected tree page");
    expect(page.nodes[0]).toMatchObject({ guid: "", depth: 0, childCount: 1 });
    expect(page.nodes[0].name).toHaveLength(200);
    expect(page.nodes[0].name.endsWith("…")).toBe(true);
    expect(page.nodes[0].class).toHaveLength(200);
    expect(page.nodes[1]).not.toHaveProperty("parentGuid");
  });

  test("decodes UTF-16LE snapshots with a BOM", async () => {
    const cwd = project();
    const snapshotPath = writeSnapshot(cwd, document("print('utf16')"), true);

    const page = await readSnapshotData(snapshotPath, {
      view: "script",
      guid: "script-guid",
      offset: 0,
      limit: 100,
    });

    expect(page).toMatchObject({
      view: "script",
      units: "characters",
      offset: 0,
      total: 14,
      content: "print('utf16')",
      instance: { guid: "script-guid", name: "OldScript", class: "Script" },
    });
  });

  test("paginates a preorder tree and can select a subtree", async () => {
    const cwd = project();
    const snapshotPath = writeSnapshot(cwd, document());

    const first = await readSnapshotData(snapshotPath, { view: "tree", offset: 0, limit: 2 });
    const second = await readSnapshotData(snapshotPath, { view: "tree", offset: first.nextOffset ?? 0, limit: 20 });
    const subtree = await readSnapshotData(snapshotPath, {
      view: "tree",
      guid: "part-guid",
      offset: 0,
      limit: 20,
    });

    if (first.view !== "tree" || second.view !== "tree" || subtree.view !== "tree") {
      throw new Error("Expected tree pages");
    }
    expect(first).toMatchObject({ units: "nodes", offset: 0, total: 5, nextOffset: 2 });
    expect([...first.nodes, ...second.nodes].map((node) => node.guid)).toEqual([
      "root-guid",
      "part-guid",
      "script-guid",
      "no-source-guid",
      "bad-source-guid",
    ]);
    expect(subtree.nodes).toEqual([
      {
        guid: "part-guid",
        name: "OldPart",
        class: "Part",
        parentGuid: "root-guid",
        depth: 0,
        childCount: 1,
      },
      {
        guid: "script-guid",
        name: "OldScript",
        class: "Script",
        parentGuid: "part-guid",
        depth: 1,
        childCount: 0,
      },
    ]);
  });

  test("returns paged raw instance properties without Source", async () => {
    const cwd = project();
    const snapshotPath = writeSnapshot(cwd, document("secret source"));
    const pages: Extract<SnapshotDataPage, { view: "instance" }>[] = [];
    let offset = 0;
    do {
      const page = await readSnapshotData(snapshotPath, {
        view: "instance",
        guid: "script-guid",
        offset,
        limit: 8,
      });
      if (page.view !== "instance") throw new Error("Expected instance page");
      pages.push(page);
      offset = page.nextOffset ?? page.total;
    } while (pages.at(-1)?.nextOffset !== undefined);

    const content = pages.map((page) => page.content).join("");
    expect(JSON.parse(content)).toEqual({ Enabled: false });
    expect(content).not.toContain("secret source");
    expect(pages[0].instance).toMatchObject({
      guid: "script-guid",
      name: "OldScript",
      class: "Script",
      parentGuid: "part-guid",
      depth: 2,
      childCount: 0,
    });
  });

  test("paginates long script Source without gaps", async () => {
    const cwd = project();
    const source = "0123456789".repeat(30);
    const snapshotPath = writeSnapshot(cwd, document(source));
    const chunks: string[] = [];
    let offset = 0;
    let total = -1;
    for (;;) {
      const page = await readSnapshotData(snapshotPath, {
        view: "script",
        guid: "script-guid",
        offset,
        limit: 37,
      });
      if (page.view !== "script") throw new Error("Expected script page");
      chunks.push(page.content);
      total = page.total;
      if (page.nextOffset === undefined) break;
      offset = page.nextOffset;
    }
    expect(chunks.join("")).toBe(source);
    expect(total).toBe(source.length);
  });

  test("returns empty content for an offset beyond the end", async () => {
    const cwd = project();
    const snapshotPath = writeSnapshot(cwd, document("short"));

    const page = await readSnapshotData(snapshotPath, {
      view: "script",
      guid: "script-guid",
      offset: 999,
      limit: 10,
    });

    expect(page).toMatchObject({ content: "", offset: 999, total: 5 });
    expect(page.nextOffset).toBeUndefined();
  });

  test("distinguishes unknown instances, absent Source, and non-string Source", async () => {
    const cwd = project();
    const snapshotPath = writeSnapshot(cwd, document());

    await expect(
      readSnapshotData(snapshotPath, { view: "instance", guid: "missing", offset: 0, limit: 20 }),
    ).rejects.toThrow('Snapshot instance "missing" was not found');
    await expect(
      readSnapshotData(snapshotPath, { view: "script", guid: "no-source-guid", offset: 0, limit: 20 }),
    ).rejects.toThrow("has no Source property");
    await expect(
      readSnapshotData(snapshotPath, { view: "script", guid: "bad-source-guid", offset: 0, limit: 20 }),
    ).rejects.toThrow("Source is not a string");
  });

  test.each([
    ["malformed JSON", "{", "Invalid snapshot .ovdrjm JSON"],
    ["missing Root", JSON.stringify({ Other: {} }), "Root must be an object"],
    ["array Root", JSON.stringify({ Root: [] }), "Root must be an object"],
  ])("rejects %s", async (_name, contents, message) => {
    const cwd = project();
    const snapshotPath = join(cwd, "bad.ovdrjm");
    writeFileSync(snapshotPath, contents);

    await expect(readSnapshotData(snapshotPath, { view: "tree", offset: 0, limit: 20 })).rejects.toThrow(message);
  });
});
