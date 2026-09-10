// @summary Tests the isolated cross-Studio launcher environment precedence and listener-only port cleanup.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");
const LAUNCHER_SOURCE = join(ROOT, "scripts", "dev-cross-studio.sh");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function createLauncherFixture(overrides: Partial<NodeJS.ProcessEnv> = {}): {
  root: string;
  launcher: string;
  callLog: string;
  env: NodeJS.ProcessEnv;
} {
  const root = mkdtempSync(join(tmpdir(), "diligent-cross-studio-"));
  temporaryDirectories.push(root);
  const scripts = join(root, "scripts");
  const bin = join(root, "bin");
  const home = join(root, "home");
  const callLog = join(root, "calls.log");
  const bashEnv = join(root, "bash-env");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  copyFileSync(LAUNCHER_SOURCE, join(scripts, "dev-cross-studio.sh"));
  writeFileSync(
    join(root, ".env.local"),
    ["STUDIO_LOCAL_FILE_ROOT=/from-env-file/local", "STUDIO_REMOTE_FILE_ROOT=//from-env-file/share", ""].join("\n"),
    "utf8",
  );
  writeExecutable(
    join(bin, "bun"),
    '#!/usr/bin/env bash\nprintf \'bun %s local=%s remote=%s\\n\' "$*" "$STUDIO_LOCAL_FILE_ROOT" "$STUDIO_REMOTE_FILE_ROOT" >> "$DILIGENT_TEST_CALL_LOG"\n',
  );
  writeExecutable(
    join(bin, "lsof"),
    "#!/usr/bin/env bash\nprintf 'lsof %s\\n' \"$*\" >> \"$DILIGENT_TEST_CALL_LOG\"\nprintf '999999\\n'\n",
  );
  writeFileSync(
    bashEnv,
    [
      'kill() { if [ "$1" = "-0" ]; then builtin kill "$@"; else printf "kill %s\\n" "$*" >> "$DILIGENT_TEST_CALL_LOG"; fi; }',
      'sleep() { printf "sleep %s\\n" "$*" >> "$DILIGENT_TEST_CALL_LOG"; }',
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    root,
    launcher: join(scripts, "dev-cross-studio.sh"),
    callLog,
    env: {
      ...process.env,
      BASH_ENV: bashEnv,
      DILIGENT_TEST_CALL_LOG: callLog,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      STUDIO_DISABLED: "1",
      ...overrides,
    },
  };
}

describe("dev-cross-studio launcher", () => {
  function runLauncher(fixture: ReturnType<typeof createLauncherFixture>) {
    return spawnSync(fixture.launcher, [], {
      cwd: fixture.root,
      encoding: "utf8",
      env: fixture.env,
      timeout: 5_000,
    });
  }

  function backendInvocation(callLog: string): string {
    const invocation = readFileSync(callLog, "utf8")
      .split("\n")
      .find((line) => line.includes("sidecar/src/server.ts"));
    if (!invocation) throw new Error("Expected the mocked sidecar backend invocation");
    return invocation;
  }

  test("only cleans up listening processes before launching both dev processes", () => {
    const fixture = createLauncherFixture();

    const result = runLauncher(fixture);

    expect(result.status).toBe(0);
    const calls = readFileSync(fixture.callLog, "utf8").split("\n");
    expect(calls.filter((line) => line.startsWith("bun "))).toHaveLength(2);
    const listenerQueries = calls.filter((line) => line.startsWith("lsof "));
    expect(listenerQueries).toEqual([
      "lsof -nP -t -iTCP:7433 -sTCP:LISTEN",
      "lsof -nP -t -iTCP:7433 -sTCP:LISTEN",
      "lsof -nP -t -iTCP:5174 -sTCP:LISTEN",
      "lsof -nP -t -iTCP:5174 -sTCP:LISTEN",
    ]);
  });

  test("loads configured Studio file mappings and exports them to the backend", () => {
    const fixture = createLauncherFixture();
    const result = runLauncher(fixture);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("> Studio file roots: /from-env-file/local -> //from-env-file/share");
    expect(backendInvocation(fixture.callLog)).toContain("local=/from-env-file/local remote=//from-env-file/share");
  });

  test("explicit Studio file mappings override .env.local and reach the backend", () => {
    const fixture = createLauncherFixture({
      STUDIO_LOCAL_FILE_ROOT: "/explicit/local",
      STUDIO_REMOTE_FILE_ROOT: "//explicit/share",
    });
    const result = runLauncher(fixture);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("> Studio file roots: /explicit/local -> //explicit/share");
    expect(result.stdout).not.toContain("/from-env-file/local -> //from-env-file/share");
    expect(backendInvocation(fixture.callLog)).toContain("local=/explicit/local remote=//explicit/share");
  });
});
