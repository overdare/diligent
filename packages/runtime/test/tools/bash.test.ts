// @summary Tests for bash tool execution, error handling, and env var filtering
import { describe, expect, test } from "bun:test";
import { executeTool, type ToolContext, type ToolRegistry } from "@diligent/core/tool-contract";
import { createBashTool, filterSensitiveEnv } from "@diligent/runtime/tools";

const bashTool = createBashTool(process.cwd());

function makeCtx(signal?: AbortSignal): ToolContext {
  return {
    toolCallId: "tc_bash",
    signal: signal ?? new AbortController().signal,
    abort: () => {},
  };
}

describe("bash tool", () => {
  test("simple command (echo hello)", async () => {
    const result = await bashTool.execute({ command: "echo hello" }, makeCtx());
    expect(result.output.trim()).toBe("hello");
    expect(result.render?.outputSummary).toBe("Command completed");
    expect(result.render?.blocks[0]).toMatchObject({ type: "command", command: "echo hello" });
  });

  test("non-zero exit code → exit code in header", async () => {
    const result = await bashTool.execute({ command: "exit 42" }, makeCtx());
    expect(result.output).toContain("[Exit code: 42]");
    expect(result.render?.outputSummary).toBe("Command failed (exit 42)");
    expect(result.render?.blocks[0]).toMatchObject({ type: "command", isError: true });
    expect(result.metadata?.exitCode).toBe(42);
    expect(result.metadata?.error).toBe(true);
  });

  test("timeout → kills process, timeout message", async () => {
    const result = await bashTool.execute({ command: "sleep 10", timeout: 200 }, makeCtx());
    expect(result.output).toContain("Timed out");
    expect(result.render?.outputSummary).toBe("Command timed out");
    expect(result.metadata?.timedOut).toBe(true);
    expect(result.metadata?.error).toBe(true);
  }, 5000);

  test("AbortSignal → kills process, aborted message", async () => {
    const ac = new AbortController();
    const promise = bashTool.execute({ command: "sleep 10" }, makeCtx(ac.signal));
    setTimeout(() => ac.abort(), 100);
    const result = await promise;
    expect(result.output).toContain("Aborted");
    expect(result.render?.outputSummary).toBe("Command aborted");
    expect(result.metadata?.aborted).toBe(true);
    expect(result.metadata?.error).toBe(true);
  }, 5000);

  test("stderr output → merged with [stderr] prefix", async () => {
    const result = await bashTool.execute({ command: "echo err >&2" }, makeCtx());
    expect(result.output).toContain("[stderr]");
    expect(result.output).toContain("err");
  });

  test("large output stays whole for callers while the executor truncates the model copy", async () => {
    const command = "bun --eval \"process.stdout.write('HEAD' + 'x'.repeat(60001) + 'TAIL')\"";
    const direct = await bashTool.execute({ command }, makeCtx());
    expect(direct.output).toHaveLength(60_009);
    expect(direct.render?.blocks[0]).toMatchObject({ type: "command" });

    const saved: string[] = [];
    const viaExecutor = await executeTool(
      new Map([[bashTool.name, bashTool]]) as ToolRegistry,
      { type: "tool_call", id: "tc_bash", name: "bash", input: { command } },
      makeCtx(),
      {
        outputStore: {
          save: async (output) => {
            saved.push(output);
            return "/tmp/full-output.txt";
          },
        },
      },
    );
    expect(viaExecutor.metadata?.truncated).toBe(true);
    expect(viaExecutor.output).toStartWith("HEAD");
    expect(viaExecutor.output).toContain("TAIL");
    expect(viaExecutor.output).toContain("Full output at: /tmp/full-output.txt");
    expect(saved).toEqual([direct.output]);
  });

  test("description in metadata", async () => {
    const result = await bashTool.execute({ command: "echo hi", description: "test desc" }, makeCtx());
    expect(result.metadata?.description).toBe("test desc");
  });

  test("filters sensitive env variables from child process", async () => {
    const original = process.env.TEST_API_KEY;
    process.env.TEST_API_KEY = "secret-value";
    try {
      const result = await bashTool.execute({ command: 'echo "key=$TEST_API_KEY"' }, makeCtx());
      expect(result.output).not.toContain("secret-value");
    } finally {
      if (original === undefined) delete process.env.TEST_API_KEY;
      else process.env.TEST_API_KEY = original;
    }
  });

  test("preserves non-sensitive env variables", async () => {
    const original = process.env.TEST_NON_SENSITIVE_VAR;
    process.env.TEST_NON_SENSITIVE_VAR = "visible-value";
    try {
      const result = await bashTool.execute({ command: "echo $TEST_NON_SENSITIVE_VAR" }, makeCtx());
      expect(result.output.trim()).toBe("visible-value");
    } finally {
      if (original === undefined) delete process.env.TEST_NON_SENSITIVE_VAR;
      else process.env.TEST_NON_SENSITIVE_VAR = original;
    }
  });
});

describe("filterSensitiveEnv", () => {
  test("removes _API_KEY suffix variables", () => {
    const env = { HOME: "/home", ANTHROPIC_API_KEY: "sk-ant", OPENAI_API_KEY: "sk-oai" };
    const result = filterSensitiveEnv(env as NodeJS.ProcessEnv);
    expect(result.HOME).toBe("/home");
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

  test("removes _SECRET suffix variables", () => {
    const env = { PATH: "/usr/bin", AWS_SECRET_ACCESS_KEY: "aws-secret" };
    const result = filterSensitiveEnv(env as NodeJS.ProcessEnv);
    expect(result.PATH).toBe("/usr/bin");
    expect(result.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  test("removes _TOKEN suffix variables", () => {
    const env = { SLACK_TOKEN: "xoxb-abc", SHELL: "/bin/zsh" };
    const result = filterSensitiveEnv(env as NodeJS.ProcessEnv);
    expect(result.SHELL).toBe("/bin/zsh");
    expect(result.SLACK_TOKEN).toBeUndefined();
  });

  test("passes through GH_TOKEN and GITHUB_TOKEN for GitHub CLI use", () => {
    const env = { GH_TOKEN: "ghp_ghtok", GITHUB_TOKEN: "ghp_ghtok2", ANTHROPIC_API_KEY: "sk-ant", SHELL: "/bin/bash" };
    const result = filterSensitiveEnv(env as NodeJS.ProcessEnv);
    expect(result.GH_TOKEN).toBe("ghp_ghtok");
    expect(result.GITHUB_TOKEN).toBe("ghp_ghtok2");
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.SHELL).toBe("/bin/bash");
  });

  test("removes _PASSWORD suffix variables", () => {
    const env = { DB_PASSWORD: "pass123", USER: "dev" };
    const result = filterSensitiveEnv(env as NodeJS.ProcessEnv);
    expect(result.USER).toBe("dev");
    expect(result.DB_PASSWORD).toBeUndefined();
  });

  test("removes exact-match sensitive names", () => {
    const env = { API_KEY: "key", SECRET_KEY: "sk", TOKEN: "tok", PASSWORD: "pw", HOME: "/home" };
    const result = filterSensitiveEnv(env as NodeJS.ProcessEnv);
    expect(result.HOME).toBe("/home");
    expect(result.API_KEY).toBeUndefined();
    expect(result.SECRET_KEY).toBeUndefined();
    expect(result.TOKEN).toBeUndefined();
    expect(result.PASSWORD).toBeUndefined();
  });
});
