// @summary Plain project shell launch using the same native PTY transport as Claude.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ClaudeLaunch } from "./launch";

export async function prepareShellLaunch(options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<ClaudeLaunch> {
  const source = options.env ?? process.env;
  const env = Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const program =
    process.platform === "win32"
      ? (Bun.which("pwsh.exe", { PATH: source.PATH ?? source.Path ?? "" }) ??
        join(source.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))
      : (source.SHELL ?? "/bin/sh");
  if (!existsSync(program)) throw new Error("A local command shell is not available.");
  delete env.NO_COLOR;
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return {
    program,
    args: process.platform === "win32" ? ["-NoLogo"] : [],
    cwd: resolve(options.cwd),
    env,
    launchDir: "",
    cleanup: async () => {},
  };
}
