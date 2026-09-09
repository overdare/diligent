// @summary Runs pixel-level chroma-key and file-preservation checks when Python/Pillow is available.
import { expect, test } from "bun:test";
import { resolve } from "node:path";

const python = process.env.DILIGENT_TEST_PYTHON ?? "python3";
const available = (() => {
  try {
    return Bun.spawnSync([python, "-c", "from PIL import Image"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  } catch {
    return false;
  }
})();

test.skipIf(!available)("chroma-key pixels, alpha, output, and source preservation (requires Python/Pillow)", () => {
  const result = Bun.spawnSync([python, "-B", resolve(import.meta.dir, "../helpers/chroma-key-checks.py")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const diagnostics = Buffer.from(result.stderr).toString();
  expect(diagnostics).toContain("OK");
  expect(result.exitCode, diagnostics).toBe(0);
});
