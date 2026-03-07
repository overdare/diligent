// @summary Spawns and manages the CLI app-server child process for stdio JSON-RPC communication

export interface SpawnCliAppServerOptions {
  cwd: string;
  yolo?: boolean;
}

export function spawnCliAppServerProcess(options: SpawnCliAppServerOptions): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  const args = ["bun", "packages/cli/src/index.ts", "app-server", "--stdio"];
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
