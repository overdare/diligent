// @summary Product host owns collection startup and awaitable cleanup, including failed startup
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudioChangeHost } from "../../../src/studio-change-lifecycle";
import { getStudioChangeCollector } from "../../../src/tools/studiorpc/tools/studio-change-collector";

test("enabled owner stops collection and the host once; disabled host never consumes sources", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "studio-host-"));
  let stops = 0;
  try {
    writeFileSync(join(cwd, "Edit.Log"), "{}");
    const disabled = await startStudioChangeHost(cwd, true, async () => ({
      stop() {
        stops++;
      },
    }));
    await disabled.stop();
    expect(existsSync(join(cwd, "Edit.Log"))).toBe(true);
    const enabled = await startStudioChangeHost(cwd, false, async () => ({
      stop() {
        stops++;
      },
    }));
    const collector = getStudioChangeCollector(cwd);
    await collector.refresh();
    expect(existsSync(join(cwd, "Edit.Log"))).toBe(false);
    await enabled.stop();
    await enabled.stop();
    writeFileSync(join(cwd, "Edit.Log"), "{}");
    await collector.refresh();
    expect(existsSync(join(cwd, "Edit.Log"))).toBe(true);
    expect(stops).toBe(2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("failed host startup stops its collector before rejecting", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "studio-failed-host-"));
  const collector = getStudioChangeCollector(cwd);
  try {
    await expect(
      startStudioChangeHost(cwd, false, async () => {
        throw new Error("startup failure");
      }),
    ).rejects.toThrow("startup failure");
    writeFileSync(join(cwd, "Edit.Log"), "{}");
    await collector.refresh();
    expect(existsSync(join(cwd, "Edit.Log"))).toBe(true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
