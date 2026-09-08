// @summary Verifies v1 upsert recovery without overwriting later file changes or claiming Studio rollback.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../../../../src/tools/studiorpc/methods/instance.upsert";
import { executeInstanceUpsertInner } from "../../../../src/tools/studiorpc/tools/instance-upsert-tool";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "upsert-recovery-"));
  directories.push(cwd);
  const path = join(cwd, "Test.ovdrjm");
  const original = Buffer.from(
    JSON.stringify({
      Root: {
        InstanceType: "Workspace",
        ActorGuid: "W",
        LuaChildren: [{ InstanceType: "Part", ActorGuid: "P", Name: "Part", CanCollide: true }],
      },
    }),
  );
  writeFileSync(join(cwd, "Test.umap"), "");
  writeFileSync(path, original);
  const args = parseArgs({ items: [{ guid: "P", properties: { CanCollide: "invalid" } }] });
  return { cwd, path, original, args };
}

describe("v1 instance.upsert apply recovery", () => {
  test("restores exact pre-write bytes on rejection and preserves the original error", async () => {
    const { cwd, path, original, args } = fixture();
    const failure = new Error("Studio rejected invalid CanCollide");
    let attempts = 0;
    let caught: unknown;
    try {
      await executeInstanceUpsertInner(args, cwd, {
        applyLevelChanges: async () => {
          attempts++;
          expect(JSON.parse(readFileSync(path, "utf8")).Root.LuaChildren[0].CanCollide).toBe("invalid");
          throw failure;
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).cause).toBe(failure);
    expect((caught as Error).message).toContain("Studio rejected invalid CanCollide");
    expect((caught as Error).message).toContain("file restored");
    expect((caught as Error).message).toContain("Studio state is unconfirmed");
    expect(readFileSync(path)).toEqual(original);
    expect(attempts).toBe(1);
  });

  test("preserves a later external write when apply fails", async () => {
    const { cwd, path, args } = fixture();
    const newer = Buffer.from('{"external":"saved during apply"}');
    await expect(
      executeInstanceUpsertInner(args, cwd, {
        applyLevelChanges: async () => {
          writeFileSync(path, newer);
          throw new Error("connection lost");
        },
      }),
    ).rejects.toThrow("file changed after upsert; not restored");
    expect(readFileSync(path)).toEqual(newer);
  });

  test("reports failed recovery without hiding the apply error or recreating a removed file", async () => {
    const { cwd, path, args } = fixture();
    await expect(
      executeInstanceUpsertInner(args, cwd, {
        applyLevelChanges: async () => {
          rmSync(path);
          throw new Error("apply failed");
        },
      }),
    ).rejects.toThrow(/apply failed.*file restoration failed/s);
    expect(() => readFileSync(path)).toThrow();
  });

  test("retains the updated file after successful apply", async () => {
    const { cwd, path } = fixture();
    const args = parseArgs({ items: [{ guid: "P", properties: { CanCollide: false } }] });
    let attempts = 0;
    const result = await executeInstanceUpsertInner(args, cwd, {
      applyLevelChanges: async () => {
        attempts++;
      },
    });
    expect(result.metadata?.updateCount).toBe(1);
    expect(JSON.parse(readFileSync(path, "utf8")).Root.LuaChildren[0].CanCollide).toBe(false);
    expect(attempts).toBe(1);
  });

  test("keeps file-only writes when apply is disabled", async () => {
    const { cwd, path, args } = fixture();
    let attempts = 0;
    await executeInstanceUpsertInner(args, cwd, {
      applyAndSaveChanges: false,
      applyLevelChanges: async () => {
        attempts++;
      },
    });
    expect(attempts).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8")).Root.LuaChildren[0].CanCollide).toBe("invalid");
  });
});
