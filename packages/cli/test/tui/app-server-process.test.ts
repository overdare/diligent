// @summary Tests for the CLI app-server child process command line in source and compiled-binary modes
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnCliAppServerProcess } from "../../src/tui/app-server-process";

const PRINT_ARGS = "console.log(JSON.stringify(process.argv.slice(2)));\n";

const originalArgv1 = process.argv[1];
const tempDirs: string[] = [];

afterEach(async () => {
  process.argv[1] = originalArgv1;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "diligent-app-server-process-"));
  tempDirs.push(dir);
  return dir;
}

async function runAndReadArgs(cwd: string, yolo?: boolean): Promise<string[]> {
  const child = spawnCliAppServerProcess({ cwd, yolo });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

describe("spawnCliAppServerProcess", () => {
  test("runs the source entrypoint through bun when launched from a .ts script", async () => {
    const cwd = await makeCwd();
    await mkdir(join(cwd, "packages/cli/src"), { recursive: true });
    await writeFile(join(cwd, "packages/cli/src/index.ts"), PRINT_ARGS);
    process.argv[1] = "/repo/packages/cli/src/index.ts";

    expect(await runAndReadArgs(cwd)).toEqual(["app-server", "--stdio"]);
    expect(await runAndReadArgs(cwd, true)).toEqual(["app-server", "--stdio", "--yolo"]);
  });

  test("re-executes the current binary when not launched from a .ts script", async () => {
    const cwd = await makeCwd();
    // The compiled branch runs `<execPath> app-server --stdio`; under bun that resolves ./app-server in cwd.
    await writeFile(join(cwd, "app-server"), PRINT_ARGS);
    process.argv[1] = "/usr/local/bin/diligent";

    expect(await runAndReadArgs(cwd)).toEqual(["--stdio"]);
    expect(await runAndReadArgs(cwd, true)).toEqual(["--stdio", "--yolo"]);
  });

  test("treats a missing script argument as a compiled binary", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "app-server"), PRINT_ARGS);
    process.argv[1] = undefined as unknown as string;

    expect(await runAndReadArgs(cwd)).toEqual(["--stdio"]);
  });
});
