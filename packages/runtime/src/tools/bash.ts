// @summary Shell command execution with timeout and output truncation

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { MAX_OUTPUT_BYTES, truncateHeadTail, truncateTail } from "@diligent/core/tool-contract";
import { existsSync } from "fs";
import { z } from "zod";
import { spawnProcess } from "../util/process";
import { type RuntimeToolHost, requestToolApprovalOutcome, resolveRejectedApproval } from "./capabilities";
import { createCommandRenderPayload } from "./render-payload";
import { SHELL_INPUT_LIMIT, type ShellProcess, type ShellProcessRegistry } from "./shell-processes";

const ForegroundBashParams = z.object({
  command: z.string().min(1).describe("The shell command to execute"),
  description: z.string().optional().describe("Short description of what the command does (5-10 words)"),
  timeout: z.number().positive().optional().describe("Foreground timeout in milliseconds. Default: 120000 (2 min)"),
});

const DEFAULT_TIMEOUT = 120_000;
const BASH_DESCRIPTION =
  "Execute a shell command. Use this to run programs, install packages, manage files, or interact with the system.";

const DEFAULT_WAIT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
const yieldTime = z.number().int().nonnegative().max(2_147_483_647);
const outputBudget = z
  .number()
  .int()
  .positive()
  .max(250_000)
  .optional()
  .describe("Maximum output tokens (default 10000 for background commands).");
const BashParams = ForegroundBashParams.extend({
  yield_time_ms: yieldTime
    .optional()
    .describe("Return early while the command keeps running. Omit to run in the foreground."),
  max_output_tokens: outputBudget,
});
const ForegroundOnlyBashParams = ForegroundBashParams.strict();
const BackgroundOnlyBashParams = BashParams.omit({ timeout: true }).extend({
  yield_time_ms: yieldTime.describe("Return after this many milliseconds while the process keeps running."),
});
const BashWaitParams = z.object({
  process_id: z.string().min(1).describe("ID returned by a yielded bash call in this session."),
  yield_time_ms: yieldTime.optional().describe("Maximum wait in ms (default 10000); use 0 to poll without waiting."),
  input: z.string().max(SHELL_INPUT_LIMIT).optional().describe("Text to write to stdin. Include a newline if needed."),
  terminate: z.boolean().optional().describe("Stop the process and return its remaining output."),
  max_output_tokens: outputBudget,
});

export function isYieldingBash(tool: Tool): boolean {
  return tool.name === "bash" && tool.parameters === BashParams;
}

export function restrictBash(tool: Tool, mode: "foreground" | "background"): Tool {
  return mode === "foreground"
    ? { ...tool, description: BASH_DESCRIPTION, parameters: ForegroundOnlyBashParams }
    : {
        ...tool,
        description:
          "Run a shell command in the background. Use bash_wait to read output, send stdin, or terminate it.",
        parameters: BackgroundOnlyBashParams,
      };
}

export function hasBuiltinBashWait(tools: readonly Tool[]): boolean {
  return tools.some((tool) => tool.name === "bash_wait" && tool.parameters === BashWaitParams);
}

/** Live output is coalesced into at most one tool update per interval. */
const LIVE_UPDATE_INTERVAL_MS = 250;
/** Characters per live update; a larger burst keeps its head and tail and marks what it skipped. */
const LIVE_UPDATE_MAX_CHARS = 8 * 1024;

/**
 * Coalesces process output into `tool_update` deltas. Clients append each delta to the live tool view, so every
 * update carries only output produced since the previous one. `close` flushes what is left.
 */
function createLiveOutput(onUpdate: (partial: string) => void): { push: (text: string) => void; close: () => void } {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (!pending) return;
    let text = pending;
    pending = "";
    if (text.length > LIVE_UPDATE_MAX_CHARS) {
      const half = LIVE_UPDATE_MAX_CHARS / 2;
      text = `${text.slice(0, half)}\n[… ${text.length - 2 * half} characters …]\n${text.slice(-half)}`;
    }
    onUpdate(text);
  };
  return {
    push(text) {
      pending += text;
      timer ??= setTimeout(flush, LIVE_UPDATE_INTERVAL_MS);
    },
    close() {
      clearTimeout(timer);
      flush();
    },
  };
}

const SENSITIVE_PATTERNS = [/(_API_KEY|_TOKEN|_PASSWORD)$/, /_SECRET/, /^(API_KEY|SECRET_KEY|TOKEN|PASSWORD)$/];

/**
 * Variables that are intentionally provided for tool use (e.g. GitHub CLI auth)
 * and must pass through even if they match a sensitive pattern.
 */
const ENV_PASSTHROUGH_ALLOWLIST = new Set(["GH_TOKEN", "GITHUB_TOKEN"]);

/**
 * Convert Windows-style backslash paths to forward slashes so bash doesn't
 * strip them as escape sequences. e.g. C:\Users\foo → C:/Users/foo
 */
function normalizePathSeparators(command: string): string {
  return command.replace(/([A-Za-z]):\\([\w\\. -]*)/g, (_, drive, rest) => `${drive}:/${rest.replace(/\\/g, "/")}`);
}

/** On Windows, prefer bash (Git Bash / WSL / MSYS2) over cmd.exe to avoid metacharacter issues. */
function resolveWindowsShell(command: string): string[] {
  const normalized = normalizePathSeparators(command);
  if (process.env.SHELL) return [process.env.SHELL, "-c", normalized];
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\msys64\\usr\\bin\\bash.exe",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return [candidate, "-c", normalized];
  }
  return [process.env.ComSpec || "cmd.exe", "/C", command];
}

function resolveShell(command: string): string[] {
  return process.platform === "win32" ? resolveWindowsShell(command) : [process.env.SHELL || "bash", "-c", command];
}

async function approveCommand(
  args: { command: string; description?: string },
  ctx: ToolContext,
  host?: RuntimeToolHost,
): Promise<ToolResult | undefined> {
  const approval = await requestToolApprovalOutcome(
    host,
    {
      permission: "execute",
      toolName: "bash",
      description: args.description ?? args.command,
      details: { command: args.command },
    },
    { signal: ctx.signal },
  );
  if (approval.decision !== "reject") return;
  const rejection = resolveRejectedApproval(approval, ctx);
  return {
    ...rejection,
    render: createCommandRenderPayload(args.command, rejection.output, true),
  };
}

export function filterSensitiveEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const filtered: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (ENV_PASSTHROUGH_ALLOWLIST.has(key) || !SENSITIVE_PATTERNS.some((p) => p.test(key))) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function createBashTool(cwd: string, host?: RuntimeToolHost): Tool<typeof ForegroundBashParams> {
  return {
    name: "bash",
    description: BASH_DESCRIPTION,
    parameters: ForegroundBashParams,
    async execute(args, ctx): Promise<ToolResult> {
      const rejection = await approveCommand(args, ctx, host);
      if (rejection) return rejection;

      const timeout = args.timeout ?? DEFAULT_TIMEOUT;

      const shellArgs = resolveShell(args.command);

      let timedOut = false;
      let aborted = false;

      const ac = new AbortController();

      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, timeout);

      const onAbort = () => {
        if (ac.signal.aborted) return;
        clearTimeout(timer);
        aborted = true;
        ac.abort();
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      const proc = spawnProcess(shellArgs, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: filterSensitiveEnv(process.env) as NodeJS.ProcessEnv,
        signal: ac.signal,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const live = ctx.onUpdate ? createLiveOutput(ctx.onUpdate) : undefined;
      const stdoutDecoder = new TextDecoder();
      const stderrDecoder = new TextDecoder();
      proc.stdout?.on("data", (c: Buffer) => {
        stdoutChunks.push(c);
        live?.push(stdoutDecoder.decode(c, { stream: true }));
      });
      proc.stderr?.on("data", (c: Buffer) => {
        stderrChunks.push(c);
        live?.push(stderrDecoder.decode(c, { stream: true }));
      });

      let exitCode: number | null = null;
      try {
        exitCode = await proc.exited;
      } catch {
        // process killed — exitCode stays null
      } finally {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        live?.close();
      }

      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();

      let output = stdout;
      if (stderr) output += `${output ? "\n" : ""}[stderr]\n${stderr}`;

      let header = "";
      if (timedOut) header = `[Timed out after ${timeout / 1000}s]\n`;
      if (aborted) header = `[Aborted by user]\n`;
      if (exitCode !== 0 && exitCode !== null) header += `[Exit code: ${exitCode}]\n`;

      // The full output is returned so code mode scripts receive it whole; the executor truncates the
      // model-facing copy (keeping the status header and the recent tail) and spills the rest to disk.
      const finalOutput = header + output;
      const isError = timedOut || aborted || exitCode !== 0;
      return {
        output: finalOutput,
        render: createCommandRenderPayload(
          args.command,
          header + truncateTail(output, MAX_OUTPUT_BYTES).output,
          isError,
        ),
        truncateDirection: "head_tail",
        metadata: {
          error: isError,
          exitCode,
          timedOut,
          aborted,
          ...(args.description && { description: args.description }),
        },
      };
    },
  };
}

function shellError(output: string): ToolResult {
  return { output, metadata: { error: true } };
}

async function waitForShell(entry: ShellProcess, ctx: ToolContext, yieldMs: number | undefined): Promise<void> {
  const live = ctx.onUpdate ? createLiveOutput(ctx.onUpdate) : undefined;
  try {
    await entry.wait(yieldMs, ctx.signal, live?.push);
  } finally {
    live?.close();
  }
}

function formatShellHeader(id: string, completion: ShellProcess["completion"]): string {
  if (!completion) return `[Process running. process_id: ${id}]`;

  switch (completion.reason) {
    case "terminated":
      return "[Process terminated]";
    case "aborted":
      return "[Aborted by user]";
    case "expired":
      return "[Background process lifetime expired]";
    case undefined:
      if (completion.error) return `[Process failed: ${completion.error}]`;
      return `[Exit code: ${completion.exitCode}]`;
  }
}

function collectShellResult(
  registry: ShellProcessRegistry,
  owner: string,
  entry: ShellProcess,
  budget = DEFAULT_MAX_OUTPUT_TOKENS,
): ToolResult {
  const completion = entry.completion;
  const { id, command } = entry;
  const status = completion ? "exited" : "running";
  const reason = completion?.reason;
  const exitCode = completion?.exitCode ?? null;
  const header = formatShellHeader(id, completion);
  const delta = entry.takeOutput();
  const maxDeltaBytes = budget * 4;
  const limited = Buffer.byteLength(delta) > maxDeltaBytes ? truncateHeadTail(delta, maxDeltaBytes).output : delta;
  const output = limited ? `${header}\n${limited}` : header;
  const isError = !!completion && reason !== "terminated" && (reason !== undefined || exitCode !== 0);
  if (completion) registry.forget(owner, entry);
  const render = createCommandRenderPayload(command, truncateTail(output, MAX_OUTPUT_BYTES).output, isError);
  if (!completion) render.outputSummary = `Process running (${id})`;
  else if (reason === "terminated") render.outputSummary = "Process terminated";
  return {
    output,
    render,
    truncateDirection: "head_tail",
    maxOutputBytes: maxDeltaBytes + Buffer.byteLength(header) + 128, // Preserve the status header and omission marker.
    metadata: { status, processId: id, exitCode, error: isError },
  };
}

function createYieldingBashTool(
  cwd: string,
  host: RuntimeToolHost | undefined,
  registry: ShellProcessRegistry,
): Tool<typeof BashParams> {
  const foreground = createBashTool(cwd, host);
  return {
    ...foreground,
    description: `${foreground.description} Set yield_time_ms to keep the command running and return a process ID for bash_wait.`,
    parameters: BashParams,
    async execute(args, ctx) {
      const yieldMs = args.yield_time_ms;
      if (yieldMs === undefined) {
        const result = await foreground.execute(args, ctx);
        if (args.max_output_tokens !== undefined) result.maxOutputBytes = args.max_output_tokens * 4;
        return result;
      }
      const owner = ctx.sessionId;
      if (!owner) return shellError("Background commands require a session");
      const rejection = await approveCommand(args, ctx, host);
      if (rejection) return rejection;
      ctx.signal.throwIfAborted();

      const entry = registry.start(owner, args.command, resolveShell(args.command), {
        cwd,
        env: filterSensitiveEnv(process.env),
      });
      const abort = () => entry.stop("aborted");
      ctx.signal.addEventListener("abort", abort, { once: true });
      try {
        await waitForShell(entry, ctx, yieldMs);
        if (ctx.signal.aborted) await entry.done;
        return collectShellResult(registry, owner, entry, args.max_output_tokens);
      } finally {
        ctx.signal.removeEventListener("abort", abort);
      }
    },
  };
}

async function approveShellInput(
  entry: ShellProcess,
  input: string,
  ctx: ToolContext,
  host: RuntimeToolHost | undefined,
): Promise<ToolResult | undefined> {
  const approval = await requestToolApprovalOutcome(
    host,
    {
      permission: "execute",
      toolName: "bash_wait",
      description: `Allow writes to stdin for this process: ${entry.command}\nInput: ${input}`,
      details: { command: `bash_wait:${entry.id}` },
    },
    { signal: ctx.signal, rememberApproval: false },
  );
  if (approval.decision === "reject") return resolveRejectedApproval(approval, ctx);
  entry.inputApproved = true;
}

function createBashWaitTool(
  host: RuntimeToolHost | undefined,
  registry: ShellProcessRegistry,
): Tool<typeof BashWaitParams> {
  return {
    name: "bash_wait",
    description:
      "Read new output from a yielded bash process, optionally send stdin or terminate it. No PTY is allocated.",
    parameters: BashWaitParams,
    preserveEmptyArgs: ["input"],
    async execute(args, ctx) {
      const { process_id: id, input, terminate } = args;
      const owner = ctx.sessionId;
      const entry = owner && registry.get(owner, id);
      if (!owner || !entry) {
        return shellError(`Unknown process_id ${id}; processes do not survive a runtime restart`);
      }
      if (entry.busy) return shellError(`Another call is already waiting for process_id ${id}`);
      if (terminate && input !== undefined) return shellError("Cannot send input and terminate in the same call");

      entry.busy = true;
      try {
        ctx.signal.throwIfAborted();
        if (input !== undefined && !entry.inputApproved && !entry.completion) {
          const rejection = await approveShellInput(entry, input, ctx, host);
          if (rejection) return rejection;
        }
        if (input !== undefined) {
          ctx.signal.throwIfAborted();
          const error = entry.write(input);
          if (error) return shellError(error);
        }
        if (terminate) entry.stop("terminated");
        const waitMs = terminate ? undefined : (args.yield_time_ms ?? DEFAULT_WAIT_MS);
        await waitForShell(entry, ctx, waitMs);
        if (ctx.signal.aborted) return shellError("[Aborted by user]");
        return collectShellResult(registry, owner, entry, args.max_output_tokens);
      } finally {
        entry.busy = false;
      }
    },
  };
}

export function createBashTools(
  cwd: string,
  host: RuntimeToolHost | undefined,
  registry: ShellProcessRegistry,
): Tool[] {
  return [createYieldingBashTool(cwd, host, registry), createBashWaitTool(host, registry)];
}
