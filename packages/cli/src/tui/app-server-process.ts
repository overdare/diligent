// @summary Spawns and manages the CLI app-server child process for stdio JSON-RPC communication

export interface SpawnCliAppServerOptions {
  cwd: string;
  yolo?: boolean;
}

export function spawnCliAppServerProcess(options: SpawnCliAppServerOptions): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  // When running as a compiled binary (bun build --compile), argv[1] is the first CLI arg,
  // not a source file. Spawn ourselves directly instead of via bun + source path.
  const isCompiledBinary = !process.argv[1]?.endsWith(".ts");
  const args = isCompiledBinary
    ? [process.execPath, "app-server", "--stdio"]
    : ["bun", "packages/cli/src/index.ts", "app-server", "--stdio"];
  if (options.yolo) {
    args.push("--yolo");
  }

  return Bun.spawn(args, {
    cwd: options.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
}
