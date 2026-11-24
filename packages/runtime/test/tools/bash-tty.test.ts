// @summary Tests for bash commands in a pseudo-terminal: terminal detection, input, plain output, and process-group cleanup

import { afterEach, describe, expect, test } from "bun:test";
import {
  executeTool,
  type Tool,
  type ToolContext,
  type ToolRegistry,
  toToolInputSchema,
} from "@diligent/core/tool-contract";
import { createBashTools, restrictBash } from "../../src/tools/bash";
import { ShellProcessRegistry } from "../../src/tools/shell-processes";
import { waitUntilDead } from "../helpers/process";

const posix = process.platform !== "win32";
const SESSION = "session";
/** Starts a descendant that ignores both SIGTERM and the SIGHUP sent when the terminal's session leader exits. */
const STUBBORN_CHILD = `sh -c 'trap "" TERM HUP; echo "pid:$$"; exec sleep 30' &`;

const registries: ShellProcessRegistry[] = [];

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.dispose()));
});

function setup() {
  const registry = new ShellProcessRegistry();
  registries.push(registry);
  const [bash, bashWait] = createBashTools(process.cwd(), undefined, registry);
  return { registry, bash, bashWait };
}

function makeCtx(options: { signal?: AbortSignal; onUpdate?: (partial: string) => void } = {}): ToolContext {
  return {
    toolCallId: "tc",
    sessionId: SESSION,
    signal: options.signal ?? new AbortController().signal,
    abort: () => {},
    onUpdate: options.onUpdate,
  };
}

function processId(output: string): string {
  const id = output.match(/process_id: ([\w-]+)/)?.[1];
  if (!id) throw new Error(`Expected a process ID, got ${output}`);
  return id;
}

function childPid(output: string): number {
  const pid = Number(output.match(/pid:(\d+)/)?.[1]);
  if (!(pid > 0)) throw new Error(`Expected a child PID, got ${output}`);
  return pid;
}

/** Polls a background process until its accumulated output matches, so tests do not depend on start-up timing. */
async function readUntil(bashWait: Tool, id: string, pattern: RegExp, initial = ""): Promise<string> {
  let output = initial;
  const deadline = Date.now() + 5000;
  while (!pattern.test(output)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${pattern}; got ${JSON.stringify(output)}`);
    const result = await bashWait.execute({ process_id: id, yield_time_ms: 200 }, makeCtx());
    output += result.output.replace(/^\[Process running\. process_id: [\w-]+\]\n?/, "");
  }
  return output;
}

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  try {
    return await run();
  } finally {
    apply(saved);
  }
}

describe.if(posix)("bash tty", () => {
  test("gives the command a terminal on stdin and stdout, unlike the default pipes", async () => {
    const { bash } = setup();
    // Shell builtins only: the `tty` utility's output differs between coreutils implementations.
    const command = "[ -t 0 ] && [ -t 1 ] && echo terminal";

    const terminal = await bash.execute({ command, tty: true }, makeCtx());
    expect(terminal.metadata?.exitCode).toBe(0);
    expect(terminal.output).toBe("terminal\n");

    const piped = await bash.execute({ command }, makeCtx());
    expect(piped.metadata?.exitCode).toBe(1);
  });

  test("returns one merged stream without escape sequences to the model, the render, and live updates", async () => {
    const { bash } = setup();
    const updates: string[] = [];
    const command = String.raw`printf '\033[1;31mred\033[0m\n\033]0;title\007'; echo err >&2; printf 'step 1\rstep 2\n'`;

    const result = await bash.execute(
      { command, tty: true },
      makeCtx({ onUpdate: (partial) => updates.push(partial) }),
    );

    expect(result.output).toBe("red\nerr\nstep 1\nstep 2\n");
    expect(result.render?.blocks[0]).toMatchObject({ type: "command", output: "red\nerr\nstep 1\nstep 2\n" });
    expect(updates.join("")).toBe(result.output);
  });

  test("defaults pagers to cat so they cannot wait for a keypress, but keeps a pager the user chose", async () => {
    const { bash } = setup();
    const command = `printf '%s|%s' "$PAGER" "$GIT_PAGER"`;

    const defaults = await withEnv({ PAGER: undefined, GIT_PAGER: undefined }, () =>
      bash.execute({ command, tty: true }, makeCtx()),
    );
    expect(defaults.output).toBe("cat|cat");

    const chosen = await withEnv({ PAGER: "less -R", GIT_PAGER: undefined }, () =>
      bash.execute({ command, tty: true }, makeCtx()),
    );
    expect(chosen.output).toBe("less -R|cat");

    const piped = await withEnv({ PAGER: undefined, GIT_PAGER: undefined }, () => bash.execute({ command }, makeCtx()));
    expect(piped.output).toBe("|");
  });

  test("a background prompt reads a line sent through bash_wait input", async () => {
    const { bash, bashWait } = setup();
    const started = await bash.execute(
      { command: `printf 'name? '; read name; echo "hello $name"`, tty: true, yield_time_ms: 0 },
      makeCtx(),
    );
    const id = processId(started.output);
    await readUntil(bashWait, id, /name\? $/);

    const answered = await bashWait.execute({ process_id: id, input: "world\n", yield_time_ms: 5000 }, makeCtx());

    // The terminal echoes typed input before the program prints its reply.
    expect(answered.output).toBe("[Exit code: 0]\nworld\nhello world\n");
    expect(answered.metadata?.status).toBe("exited");
  });

  test("bash_wait terminate kills terminal descendants that ignore SIGTERM and SIGHUP", async () => {
    const { bash, bashWait } = setup();
    const started = await bash.execute(
      { command: `${STUBBORN_CHILD} echo ready; wait`, tty: true, yield_time_ms: 0 },
      makeCtx(),
    );
    const id = processId(started.output);
    const pid = childPid(await readUntil(bashWait, id, /pid:\d+[\s\S]*ready|ready[\s\S]*pid:\d+/));

    const stopped = await bashWait.execute({ process_id: id, terminate: true }, makeCtx());

    expect(stopped.output).toStartWith("[Process terminated]");
    expect(await waitUntilDead(pid, 1000)).toBe(true);
  });

  test("disposing a session's processes kills terminal descendants that ignore SIGTERM and SIGHUP", async () => {
    const { registry, bash, bashWait } = setup();
    const started = await bash.execute({ command: `${STUBBORN_CHILD} wait`, tty: true, yield_time_ms: 0 }, makeCtx());
    const pid = childPid(await readUntil(bashWait, processId(started.output), /pid:\d+/));

    await registry.dispose(SESSION);

    expect(await waitUntilDead(pid, 1000)).toBe(true);
  });

  test("a foreground timeout kills terminal descendants that ignore SIGTERM and SIGHUP", async () => {
    const { bash } = setup();
    const result = await bash.execute({ command: `${STUBBORN_CHILD} wait`, tty: true, timeout: 500 }, makeCtx());

    expect(result.metadata?.timedOut).toBe(true);
    expect(await waitUntilDead(childPid(result.output), 1000)).toBe(true);
  });

  test("an abort kills terminal descendants that ignore SIGTERM and SIGHUP", async () => {
    const { bash } = setup();
    const controller = new AbortController();
    const ctx = makeCtx({
      signal: controller.signal,
      onUpdate: (partial) => {
        if (/pid:\d+/.test(partial)) controller.abort();
      },
    });

    const result = await bash.execute({ command: `${STUBBORN_CHILD} wait`, tty: true }, ctx);

    expect(result.metadata?.aborted).toBe(true);
    expect(await waitUntilDead(childPid(result.output), 1000)).toBe(true);
  });

  test("terminal descendants left behind by a shell that exits normally are cleaned up", async () => {
    const { bash } = setup();
    const result = await bash.execute({ command: `${STUBBORN_CHILD} sleep 0.2`, tty: true }, makeCtx());

    expect(result.metadata?.exitCode).toBe(0);
    expect(await waitUntilDead(childPid(result.output), 1000)).toBe(true);
  });
});

describe("host-provided Bash terminal", () => {
  test.if(!posix)("without a backend, explicit requests fail instead of falling back to pipes", async () => {
    const { bash } = setup();
    const background = restrictBash(bash, "background-or-private");

    for (const tool of [bash, background]) {
      expect(Object.keys(toToolInputSchema(tool).properties as object)).not.toContain("tty");
      const result = await executeTool(
        new Map([[tool.name, tool]]) as ToolRegistry,
        { type: "tool_call", id: "tc", name: "bash", input: { command: "touch should-not-run", tty: true } },
        makeCtx(),
      );
      expect(result.metadata?.error).toBe(true);
      expect(result.output).toContain("tty is not supported on Windows");
    }
    expect(bash.parseArgs?.({ command: "echo hi" })).toEqual({ command: "echo hi" });
    expect(() => bash.parseArgs?.({ command: "" })).toThrow("command");
  });

  test("uses the installed backend for foreground, background, and private terminals", async () => {
    const registry = new ShellProcessRegistry((argv, options) => {
      const exited = Promise.withResolvers<number>();
      const output = (value: string) => options.onData(new TextEncoder().encode(value));
      options.signal?.addEventListener("abort", () => exited.resolve(1), { once: true });
      queueMicrotask(() => {
        output("native prompt");
        const command = argv.at(-1)!;
        const script = posix ? command : Buffer.from(command, "base64").toString("utf16le");
        if (!script.startsWith("private-command")) exited.resolve(0);
      });
      return {
        exited: exited.promise,
        write(input) {
          output(input);
          exited.resolve(0);
          return true;
        },
      };
    });
    registries.push(registry);
    registry.interactiveConnection = () => "owner";
    const [bash, bashWait] = createBashTools(process.cwd(), undefined, registry);
    expect(await bash.execute(bash.parseArgs!({ command: "unused", tty: true }), makeCtx())).toMatchObject({
      output: "native prompt",
    });
    const background = restrictBash(bash, "background-or-private");
    const started = await executeTool(
      new Map([[background.name, background]]),
      { type: "tool_call", id: "tc", name: "bash", input: { command: "unused", tty: true, yield_time_ms: 0 } },
      makeCtx(),
    );
    expect(await readUntil(bashWait, processId(started.output), /native prompt/, started.output)).toContain(
      "native prompt",
    );

    const finished = bash.execute(bash.parseArgs!({ command: "private-command", interactive: true }), makeCtx());
    const params = { threadId: "thread", toolCallId: "tc", cursor: 0 };
    for (let tries = 0; registry.exchangeTerminal("owner", params).state === "waiting"; tries++) {
      if (tries === 20) throw new Error("The private terminal did not start");
      await Bun.sleep(5);
    }
    registry.exchangeTerminal("owner", { ...params, input: "private input" });
    expect(registry.exchangeTerminal("owner", params).output).toContain("private input");
    expect(await finished).toMatchObject({ output: "[Private terminal output is not shared with the agent.]" });
  });
});
