// @summary Plain shell preparation stays independent from Claude installation and configuration.
import { expect, test } from "bun:test";
import { prepareShellLaunch } from "../../src/claude/shell";

test("plain project shell does not inherit Claude launch arguments or modify its parent environment", async () => {
  const env = { ...process.env, OVERDARE_CLAUDE_PATH: "Z:/missing/claude.exe", NO_COLOR: "1", TERM: "dumb" };
  const before = { ...env };
  const launch = await prepareShellLaunch({ cwd: process.cwd(), env });
  expect(launch.program).toBeTruthy();
  expect(launch.cwd).toBe(process.cwd());
  expect(launch.args).not.toContain("--plugin-dir");
  expect(launch.args).not.toContain("--resume");
  expect(launch.env.TERM).toBe("xterm-256color");
  expect(launch.env.NO_COLOR).toBeUndefined();
  expect(env).toEqual(before);
  await launch.cleanup();
});
