// @summary VS Code child-process launcher for `diligent app-server --stdio` with stderr capture
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

export interface DiligentProcessOptions {
  cwd: string;
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface DiligentProcessHandle {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly exit: Promise<number | null>;
  kill(): void;
}

export class DiligentProcess {
  private handle: DiligentProcessHandle | null = null;

  start(options: DiligentProcessOptions): DiligentProcessHandle {
    if (this.handle) {
      return this.handle;
    }

    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const exit = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => {
        resolve(code);
      });
    });

    this.handle = {
      child,
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      exit,
      kill() {
        child.kill();
      },
    };
    return this.handle;
  }

  async dispose(): Promise<void> {
    if (!this.handle) {
      return;
    }
    this.handle.kill();
    await this.handle.exit.catch(() => undefined);
    this.handle = null;
  }
}

export function buildDiligentCommand(config: { binaryPath: string; extraArgs?: string[] }): {
  command: string;
  args: string[];
} {
  return {
    command: config.binaryPath,
    args: [...(config.extraArgs ?? []), "app-server", "--stdio"],
  };
}
