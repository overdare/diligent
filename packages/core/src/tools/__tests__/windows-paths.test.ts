// @summary Regression tests: Windows backslash paths are normalized before being passed to ripgrep

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createGlobTool } from "../glob";
import { createGrepTool } from "../grep";

const UNIX_CWD = "/home/user/project";
const WIN_CWD_BACKSLASH = "C:\\Users\\devbv\\git\\diligent";
const WIN_CWD_FORWARD = "C:/Users/devbv/git/diligent";

const mockCtx = {
  toolCallId: "test-call-id",
  signal: new AbortController().signal,
  approve: async () => "once" as const,
};

function mockProc(stdoutText = "", exitCode = 0) {
  return {
    stdout: new Response(stdoutText).body as ReadableStream<Uint8Array>,
    stderr: new Response("").body as ReadableStream<Uint8Array>,
    exited: Promise.resolve(exitCode),
    exitCode,
  } as ReturnType<typeof Bun.spawn>;
}

// Extracts the last element of the rg command args (the search path)
function capturedSearchPath(spy: ReturnType<typeof spyOn>): string {
  const cmdArgs = spy.mock.calls[0][0] as string[];
  return cmdArgs[cmdArgs.length - 1];
}

describe("glob - Windows path normalization", () => {
  let spy: ReturnType<typeof spyOn>;

  afterEach(() => spy?.mockRestore());

  it("normalizes backslash path to forward slashes", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc("file.ts\n"));
    const tool = createGlobTool(UNIX_CWD);

    await tool.execute({ pattern: "**/*.ts", path: WIN_CWD_BACKSLASH }, mockCtx);

    expect(capturedSearchPath(spy)).toBe(WIN_CWD_FORWARD);
  });

  it("normalizes backslash cwd when no path arg", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc("file.ts\n"));
    const tool = createGlobTool(WIN_CWD_BACKSLASH);

    await tool.execute({ pattern: "**/*.ts" }, mockCtx);

    expect(capturedSearchPath(spy)).toBe(WIN_CWD_FORWARD);
  });

  it("normalizes nested backslash paths", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc(""));
    const tool = createGlobTool(UNIX_CWD);

    await tool.execute({ pattern: "*.ts", path: "C:\\Users\\devbv\\git\\diligent\\packages\\core\\src" }, mockCtx);

    expect(capturedSearchPath(spy)).toBe("C:/Users/devbv/git/diligent/packages/core/src");
  });

  it("leaves forward-slash paths unchanged", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc(""));
    const tool = createGlobTool(UNIX_CWD);

    await tool.execute({ pattern: "**/*.ts", path: WIN_CWD_FORWARD }, mockCtx);

    expect(capturedSearchPath(spy)).toBe(WIN_CWD_FORWARD);
  });

  it("leaves Unix paths unchanged", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc(""));
    const tool = createGlobTool(UNIX_CWD);

    await tool.execute({ pattern: "**/*.ts", path: "/home/user/project/src" }, mockCtx);

    expect(capturedSearchPath(spy)).toBe("/home/user/project/src");
  });

  it("normalizes double backslash path (literal \\\\) to single forward slashes", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc(""));
    const tool = createGlobTool(UNIX_CWD);

    // Double backslash: C:\\Users\\devbv (two backslash chars between segments)
    await tool.execute({ pattern: "*.ts", path: "C:\\\\Users\\\\devbv\\\\git" }, mockCtx);

    expect(capturedSearchPath(spy)).toBe("C:/Users/devbv/git");
  });

  it("rejects relative paths with error", async () => {
    const tool = createGlobTool(UNIX_CWD);

    const result = await tool.execute({ pattern: "**/*.ts", path: "relative/path" }, mockCtx);

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("must be absolute");
  });
});

describe("grep - Windows path normalization", () => {
  let spy: ReturnType<typeof spyOn>;

  afterEach(() => spy?.mockRestore());

  it("normalizes backslash path to forward slashes", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc("file.ts:1:match\n"));
    const tool = createGrepTool(UNIX_CWD);

    await tool.execute({ pattern: "foo", path: WIN_CWD_BACKSLASH }, mockCtx);

    expect(capturedSearchPath(spy)).toBe(WIN_CWD_FORWARD);
  });

  it("normalizes backslash cwd when no path arg", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc(""));
    const tool = createGrepTool(WIN_CWD_BACKSLASH);

    await tool.execute({ pattern: "foo" }, mockCtx);

    expect(capturedSearchPath(spy)).toBe(WIN_CWD_FORWARD);
  });

  it("normalizes resolved path when relative path given against backslash cwd", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc(""));
    const tool = createGrepTool(WIN_CWD_BACKSLASH);

    await tool.execute({ pattern: "foo", path: "packages/core" }, mockCtx);

    expect(capturedSearchPath(spy)).not.toContain("\\");
  });

  it("normalizes nested backslash paths", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc(""));
    const tool = createGrepTool(UNIX_CWD);

    await tool.execute({ pattern: "foo", path: "C:\\Users\\devbv\\git\\diligent\\packages\\core\\src" }, mockCtx);

    expect(capturedSearchPath(spy)).toBe("C:/Users/devbv/git/diligent/packages/core/src");
  });

  it("leaves forward-slash paths unchanged", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc(""));
    const tool = createGrepTool(UNIX_CWD);

    await tool.execute({ pattern: "foo", path: WIN_CWD_FORWARD }, mockCtx);

    expect(capturedSearchPath(spy)).toBe(WIN_CWD_FORWARD);
  });

  it("leaves Unix paths unchanged", async () => {
    spy = spyOn(Bun, "spawn").mockReturnValue(mockProc(""));
    const tool = createGrepTool(UNIX_CWD);

    await tool.execute({ pattern: "foo", path: "/home/user/project/src" }, mockCtx);

    expect(capturedSearchPath(spy)).toBe("/home/user/project/src");
  });
});
