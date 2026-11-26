// @summary Tests for debug-viewer server entry CLI argument handling (data dir, port, mode banner)

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { mkdir, mkdtemp, realpath, rm } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

const ENTRY = resolve(import.meta.dir, "../../src/server/index.ts");
const HAS_STATIC_CLIENT =
  existsSync(resolve(import.meta.dir, "../../dist/client")) || existsSync(join(dirname(process.execPath), "client"));

interface Banner {
  port: number;
  data: string;
  mode: string;
}

interface RunResult {
  banner: Banner | null;
  exitCode: number | null;
  stderr: string;
}

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "debug-viewer-index-")));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeDir(...parts: string[]): Promise<string> {
  const dir = join(root, ...parts);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function runServer(args: string[], cwd: string): Promise<RunResult> {
  const child = Bun.spawn([process.execPath, ENTRY, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  try {
    while (!stdout.includes("WebSocket:")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  const exitCode = await child.exited;
  const stderr = await new Response(child.stderr).text();
  const port = stdout.match(/Server running at http:\/\/localhost:(\d+)/)?.[1];
  const data = stdout.match(/^ {2}Data: (.*)$/m)?.[1];
  const mode = stdout.match(/^ {2}Mode: (.*)$/m)?.[1];
  if (port === undefined || data === undefined || mode === undefined) {
    return { banner: null, exitCode, stderr };
  }
  return { banner: { port: Number(port), data, mode }, exitCode, stderr };
}

describe("debug-viewer server entry", () => {
  test("--dir=<path> selects that directory and --port=0 binds an ephemeral port", async () => {
    const dir = await makeDir("eq-dir", ".diligent");
    const other = await makeDir("eq-other", ".diligent");
    const { banner } = await runServer([`--dir=${dir}`, `--data-dir=${other}`, "--port=0"], root);
    expect(banner?.data).toBe(dir);
    expect(banner?.port).toBeGreaterThan(0);
    expect(banner?.port).not.toBe(7432);
  });

  test("--dir <path> wins over --data-dir=<path> and --port <n> form is honored", async () => {
    const dir = await makeDir("space-dir", ".diligent");
    const other = await makeDir("space-other", ".diligent");
    const { banner } = await runServer([`--data-dir=${other}`, "--dir", dir, "--port", "0"], root);
    expect(banner?.data).toBe(dir);
    expect(banner?.port).toBeGreaterThan(0);
    expect(banner?.port).not.toBe(7432);
  });

  test("--data-dir=<path> is used when no --dir is given", async () => {
    const dir = await makeDir("eq-data", ".diligent");
    const other = await makeDir("eq-data-other", ".diligent");
    const { banner } = await runServer([`--data-dir=${dir}`, "--data-dir", other, "--port=0"], root);
    expect(banner?.data).toBe(dir);
  });

  test("--data-dir <path> is used as the last fallback", async () => {
    const dir = await makeDir("space-data", ".diligent");
    const { banner } = await runServer(["--data-dir", dir, "--port=0"], root);
    expect(banner?.data).toBe(dir);
  });

  test("relative dir resolves against cwd and descends into a nested .diligent", async () => {
    const project = await makeDir("rel-project");
    await makeDir("rel-project", ".diligent");
    const { banner } = await runServer(["--dir", "rel-project", "--port=0"], root);
    expect(banner?.data).toBe(join(project, ".diligent"));
  });

  test("absolute dir without a nested .diligent is used as-is", async () => {
    const plain = await makeDir("plain-data");
    const { banner } = await runServer([`--dir=${plain}`, "--port=0"], root);
    expect(banner?.data).toBe(plain);
  });

  test("empty --dir= is not skipped in favor of --data-dir and falls back to cwd discovery", async () => {
    const project = await makeDir("empty-arg-project");
    const discovered = await makeDir("empty-arg-project", ".diligent");
    const other = await makeDir("empty-arg-other", ".diligent");
    const { banner } = await runServer(["--dir=", `--data-dir=${other}`, "--port=0"], project);
    expect(banner?.data).toBe(discovered);
  });

  test("no dir argument discovers .diligent by walking up from cwd", async () => {
    const discovered = await makeDir("walk-project", ".diligent");
    const nested = await makeDir("walk-project", "src", "deep");
    const { banner } = await runServer(["--port=0"], nested);
    expect(banner?.data).toBe(discovered);
  });

  test("exits with an error when no data directory can be found", async () => {
    const lonely = await makeDir("lonely");
    const result = await runServer(["--port=0"], lonely);
    expect(result.banner).toBeNull();
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Could not find .diligent/ directory");
  });

  test("--dev reports development mode", async () => {
    const dir = await makeDir("dev-mode", ".diligent");
    const { banner } = await runServer([`--dir=${dir}`, "--port=0", "--dev"], root);
    expect(banner?.mode).toBe("development (use Vite dev server at :5173)");
  });

  test.if(!HAS_STATIC_CLIENT)("without --dev and without a built client reports API only mode", async () => {
    const dir = await makeDir("api-mode", ".diligent");
    const { banner } = await runServer([`--dir=${dir}`, "--port=0"], root);
    expect(banner?.mode).toBe("API only");
  });

  test.if(HAS_STATIC_CLIENT)("without --dev and with a built client reports production mode", async () => {
    const dir = await makeDir("prod-mode", ".diligent");
    const { banner } = await runServer([`--dir=${dir}`, "--port=0"], root);
    expect(banner?.mode).toBe("production");
  });
});
