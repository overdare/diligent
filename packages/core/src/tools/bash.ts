// @summary Shell command execution with timeout and output truncation
import { z } from "zod";
import { MAX_OUTPUT_BYTES } from "../tool/truncation";
import type { Tool, ToolResult } from "../tool/types";

const BashParams = z.object({
  command: z.string().min(1).describe("The shell command to execute"),
  description: z.string().optional().describe("Short description of what the command does (5-10 words)"),
  timeout: z.number().positive().optional().describe("Timeout in milliseconds. Default: 120000 (2 min)"),
});

const DEFAULT_TIMEOUT = 120_000;

const SENSITIVE_PATTERNS = [/(_API_KEY|_TOKEN|_PASSWORD)$/, /_SECRET/, /^(API_KEY|SECRET_KEY|TOKEN|PASSWORD)$/];

export function filterSensitiveEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const filtered: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!SENSITIVE_PATTERNS.some((p) => p.test(key))) {
      filtered[key] = value;
    }
  }
  return filtered;
}

async function readStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch {
    // reader was cancelled
  }
  return Buffer.concat(chunks).toString();
}

export function createBashTool(cwd: string): Tool<typeof BashParams> {
  return {
    name: "bash",
    description:
      "Execute a shell command. Use this to run programs, install packages, manage files, or interact with the system.",
    parameters: BashParams,
    async execute(args, ctx): Promise<ToolResult> {
      const approval = await ctx.approve({
        permission: "execute",
        toolName: "bash",
        description: args.description ?? args.command,
        details: { command: args.command },
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true }, abortRequested: true };
      }

      const timeout = args.timeout ?? DEFAULT_TIMEOUT;

      const isWindows = process.platform === "win32";
      const shellArgs = isWindows
        ? [process.env.SHELL || process.env.ComSpec || "cmd.exe", process.env.SHELL ? "-c" : "/C", args.command]
        : [process.env.SHELL || "bash", "-c", args.command];
      const proc = Bun.spawn(shellArgs, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: filterSensitiveEnv(process.env),
      });

      const stdoutReader = proc.stdout.getReader();
      const stderrReader = proc.stderr.getReader();

      let timedOut = false;
      let aborted = false;

      const killProc = () => {
        proc.kill(9);
        // Cancel readers to unblock pending reads — on Windows, child processes can
        // outlive the shell and keep the pipe handles open after proc.kill().
        stdoutReader.cancel().catch(() => {});
        stderrReader.cancel().catch(() => {});
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killProc();
      }, timeout);

      const onAbort = () => {
        aborted = true;
        killProc();
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      let stdout = "";
      let stderr = "";
      try {
        [stdout, stderr] = await Promise.all([readStream(stdoutReader), readStream(stderrReader)]);
        await proc.exited;
      } finally {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
      }

      const exitCode = proc.exitCode;

      let output = stdout;
      let truncated = false;
      if (stderr) output += `${output ? "\n" : ""}[stderr]\n${stderr}`;
      if (new TextEncoder().encode(output).length > MAX_OUTPUT_BYTES) {
        output = output.slice(-MAX_OUTPUT_BYTES);
        truncated = true;
      }

      let header = "";
      if (timedOut) header = `[Timed out after ${timeout / 1000}s]\n`;
      if (aborted) header = `[Aborted by user]\n`;
      if (exitCode !== 0 && exitCode !== null) header += `[Exit code: ${exitCode}]\n`;

      return {
        output: header + output,
        metadata: {
          exitCode,
          timedOut,
          aborted,
          truncated,
          ...(args.description && { description: args.description }),
        },
      };
    },
  };
}

/** @deprecated Use createBashTool(cwd) instead — this uses process.cwd() which is incorrect in server contexts */
export const bashTool = createBashTool(process.cwd());
