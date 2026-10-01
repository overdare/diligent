// @summary Tests the isolated cross-Studio launcher environment precedence and listener-only port cleanup.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  mkdirSync(join(root, "apps", "overdare-ai-agent", "bootstrap", "skills"), { recursive: true });
  mkdirSync(join(root, "apps", "overdare-ai-agent", "bootstrap", "agents"), { recursive: true });
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
      ...(overrides.DILIGENT_TEST_COPY_FAILURE === "1"
        ? ['cp() { case "$4" in */z-failing-skill) return 1 ;; esac; command cp "$@"; }']
        : []),
      ...(overrides.DILIGENT_TEST_MV_FAILURE === "1"
        ? ['mv() { case "$1" in */new/a-skill) return 1 ;; esac; command mv "$@"; }']
        : []),
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

function writeBundleEntry(root: string, kind: "skills" | "agents", name: string, file: string, content: string): void {
  const entryDirectory = join(root, "apps", "overdare-ai-agent", "bootstrap", kind, name);
  mkdirSync(entryDirectory, { recursive: true });
  writeFileSync(join(entryDirectory, file), content, "utf8");
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
    expect(listenerQueries).toHaveLength(4);
    for (const query of listenerQueries) {
      const args = query.split(" ").slice(1);
      expect(args).toContain("-b");
      expect(args).toContain("-w");
      expect(args).toContain("-sTCP:LISTEN");
      expect(args.some((arg) => arg.startsWith("-iTCP:"))).toBe(true);
    }
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

  test("copies bundled skills and agents into global storage so they survive bootstrap removal", () => {
    const fixture = createLauncherFixture();
    writeBundleEntry(fixture.root, "skills", "sample-skill", "SKILL.md", "skill content");
    writeBundleEntry(fixture.root, "agents", "sample-agent", "AGENT.md", "agent content");

    const result = runLauncher(fixture);

    expect(result.status).toBe(0);
    const globalDirectory = join(fixture.env.HOME!, ".overdare");
    const installedSkill = join(globalDirectory, "skills", "sample-skill");
    const installedAgent = join(globalDirectory, "agents", "sample-agent");
    expect(lstatSync(installedSkill).isSymbolicLink()).toBe(false);
    expect(lstatSync(installedAgent).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(installedSkill, "SKILL.md"), "utf8")).toBe("skill content");
    expect(readFileSync(join(installedAgent, "AGENT.md"), "utf8")).toBe("agent content");

    rmSync(join(fixture.root, "apps", "overdare-ai-agent", "bootstrap"), { recursive: true, force: true });

    expect(readFileSync(join(installedSkill, "SKILL.md"), "utf8")).toBe("skill content");
    expect(readFileSync(join(installedAgent, "AGENT.md"), "utf8")).toBe("agent content");
  });

  test("refreshes a whole bundled entry and preserves unrelated or previously bundled names", () => {
    const fixture = createLauncherFixture();
    writeBundleEntry(fixture.root, "skills", "sample-skill", "SKILL.md", "old content");
    writeFileSync(
      join(fixture.root, "apps", "overdare-ai-agent", "bootstrap", "skills", "sample-skill", "obsolete.txt"),
      "stale content",
      "utf8",
    );
    writeBundleEntry(fixture.root, "skills", "removed-skill", "SKILL.md", "stale content");
    const globalSkills = join(fixture.env.HOME!, ".overdare", "skills");
    mkdirSync(join(globalSkills, "custom-skill"), { recursive: true });
    writeFileSync(join(globalSkills, "custom-skill", "SKILL.md"), "user content", "utf8");

    expect(runLauncher(fixture).status).toBe(0);

    writeFileSync(
      join(fixture.root, "apps", "overdare-ai-agent", "bootstrap", "skills", "sample-skill", "SKILL.md"),
      "updated content",
      "utf8",
    );
    rmSync(join(fixture.root, "apps", "overdare-ai-agent", "bootstrap", "skills", "sample-skill", "obsolete.txt"));
    rmSync(join(fixture.root, "apps", "overdare-ai-agent", "bootstrap", "skills", "removed-skill"), {
      recursive: true,
      force: true,
    });

    expect(runLauncher(fixture).status).toBe(0);
    expect(readFileSync(join(globalSkills, "sample-skill", "SKILL.md"), "utf8")).toBe("updated content");
    expect(() => lstatSync(join(globalSkills, "sample-skill", "obsolete.txt"))).toThrow();
    expect(readFileSync(join(globalSkills, "removed-skill", "SKILL.md"), "utf8")).toBe("stale content");
    expect(readFileSync(join(globalSkills, "custom-skill", "SKILL.md"), "utf8")).toBe("user content");
  });

  test("replaces a broken legacy bundle symlink with a readable copy", () => {
    const fixture = createLauncherFixture();
    writeBundleEntry(fixture.root, "skills", "sample-skill", "SKILL.md", "recovered content");
    const installedSkill = join(fixture.env.HOME!, ".overdare", "skills", "sample-skill");
    mkdirSync(join(fixture.env.HOME!, ".overdare", "skills"), { recursive: true });
    symlinkSync(join(fixture.root, "deleted-checkout", "apps", "bootstrap", "skills", "sample-skill"), installedSkill);

    const result = runLauncher(fixture);

    expect(result.status).toBe(0);
    expect(lstatSync(installedSkill).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(installedSkill, "SKILL.md"), "utf8")).toBe("recovered content");
  });

  test("replaces a live legacy symlink without changing its checkout target", () => {
    const fixture = createLauncherFixture();
    writeBundleEntry(fixture.root, "skills", "sample-skill", "SKILL.md", "installed content");
    const legacyTarget = join(fixture.root, "old-checkout", "skills", "sample-skill");
    mkdirSync(legacyTarget, { recursive: true });
    writeFileSync(join(legacyTarget, "SKILL.md"), "legacy checkout content", "utf8");
    const installedSkill = join(fixture.env.HOME!, ".overdare", "skills", "sample-skill");
    mkdirSync(join(fixture.env.HOME!, ".overdare", "skills"), { recursive: true });
    symlinkSync(legacyTarget, installedSkill);

    const result = runLauncher(fixture);

    expect(result.status).toBe(0);
    expect(lstatSync(installedSkill).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(installedSkill, "SKILL.md"), "utf8")).toBe("installed content");
    expect(readFileSync(join(legacyTarget, "SKILL.md"), "utf8")).toBe("legacy checkout content");
  });

  test("preserves a stale global symlink whose name is not in the current bundle", () => {
    const fixture = createLauncherFixture();
    const globalSkills = join(fixture.env.HOME!, ".overdare", "skills");
    mkdirSync(globalSkills, { recursive: true });
    const staleSkill = join(globalSkills, "removed-skill");
    symlinkSync("/deleted-checkout/apps/overdare-ai-agent/bootstrap/skills/removed-skill", staleSkill);

    const result = runLauncher(fixture);

    expect(result.status).toBe(0);
    expect(lstatSync(staleSkill).isSymbolicLink()).toBe(true);
    expect(readlinkSync(staleSkill)).toBe("/deleted-checkout/apps/overdare-ai-agent/bootstrap/skills/removed-skill");
  });

  test("preserves existing global entries if staging a later bundle entry fails", () => {
    const fixture = createLauncherFixture({ DILIGENT_TEST_COPY_FAILURE: "1" });
    writeBundleEntry(fixture.root, "skills", "a-skill", "SKILL.md", "new content");
    writeBundleEntry(fixture.root, "skills", "z-failing-skill", "SKILL.md", "new content");
    const globalSkills = join(fixture.env.HOME!, ".overdare", "skills");
    for (const name of ["a-skill", "z-failing-skill"]) {
      mkdirSync(join(globalSkills, name), { recursive: true });
      writeFileSync(join(globalSkills, name, "SKILL.md"), "existing content", "utf8");
    }

    const result = runLauncher(fixture);

    expect(result.status).not.toBe(0);
    for (const name of ["a-skill", "z-failing-skill"]) {
      expect(readFileSync(join(globalSkills, name, "SKILL.md"), "utf8")).toBe("existing content");
    }
    expect(() => readFileSync(fixture.callLog, "utf8")).toThrow();
  });

  test("restores the existing entry when moving its staged replacement fails", () => {
    const fixture = createLauncherFixture({ DILIGENT_TEST_MV_FAILURE: "1" });
    writeBundleEntry(fixture.root, "skills", "a-skill", "SKILL.md", "new content");
    const installedSkill = join(fixture.env.HOME!, ".overdare", "skills", "a-skill");
    mkdirSync(installedSkill, { recursive: true });
    writeFileSync(join(installedSkill, "SKILL.md"), "existing content", "utf8");

    const result = runLauncher(fixture);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(installedSkill, "SKILL.md"), "utf8")).toBe("existing content");
  });
});
