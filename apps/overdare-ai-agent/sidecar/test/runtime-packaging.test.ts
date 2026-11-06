// @summary Windows runtime ZIP creation ignores PATH-provided tar executables.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.skipIf(process.platform !== "win32")(
  "runtime bundle is a valid ZIP when another tar.exe shadows the Windows archiver",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "overdare-runtime-zip-"));
    try {
      const system = join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32");
      const shadow = join(root, "shadow bin");
      const stage = join(root, "staged runtime 한글");
      const output = join(root, "runtime bundle.zip");
      const extracted = join(root, "extracted");
      await Promise.all([mkdir(shadow), mkdir(join(stage, "assets", "bin"), { recursive: true }), mkdir(extracted)]);
      // A real executable ahead of System32 proves the packaging boundary does
      // not resolve tar through PATH. It cannot create an archive if selected.
      await copyFile(join(system, "where.exe"), join(shadow, "tar.exe"));
      const payload = Buffer.from([0, 1, 255, 80, 75, 0, 42]);
      await writeFile(join(stage, "assets", "bin", "overdare-mcp.exe"), payload);
      await writeFile(join(stage, "notes 한글.txt"), "round-trip 한글\n");
      const script = resolve(import.meta.dir, "../../../../scripts/build-overdare-runtime-bundle.ts");
      const worker = join(root, "package.ts");
      await writeFile(
        worker,
        `import { zipRuntimeBundle } from ${JSON.stringify(script)};\nzipRuntimeBundle(process.argv[2], process.argv[3]);\n`,
      );
      const packaged = spawnSync(process.execPath, [worker, stage, output], {
        env: { ...process.env, PATH: `${shadow};${process.env.PATH ?? ""}` },
        encoding: "utf8",
        timeout: 20_000,
      });
      expect({ status: packaged.status, error: packaged.error?.message, stderr: packaged.stderr }).toMatchObject({
        status: 0,
      });
      expect((await readFile(output)).subarray(0, 4)).toEqual(Buffer.from([80, 75, 3, 4]));
      const unpacked = spawnSync(join(system, "tar.exe"), ["-xf", output, "-C", extracted], {
        encoding: "utf8",
        timeout: 20_000,
      });
      expect({ status: unpacked.status, stderr: unpacked.stderr }).toMatchObject({ status: 0 });
      expect(await readFile(join(extracted, "assets", "bin", "overdare-mcp.exe"))).toEqual(payload);
      expect(await readFile(join(extracted, "notes 한글.txt"), "utf8")).toBe("round-trip 한글\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  45_000,
);
