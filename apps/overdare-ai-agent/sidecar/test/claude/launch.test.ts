// @summary Claude host launch isolation and prompt adaptation regression tests.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareClaudeLaunch, renderClaudeStudioPrompt } from "../../src/claude/launch";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

test("launch appends instructions, isolates files and environment, and binds MCP to its owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "overdare-claude-"));
  temporary.push(root);
  const world = join(root, "user world");
  await mkdir(world);
  const ordinary = join(world, ".claude");
  await mkdir(ordinary);
  await writeFile(join(ordinary, "settings.json"), "PERSONAL SETTINGS");
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(root, "personal"),
    OVERDARE_CLAUDE_PATH: process.execPath,
    ANTHROPIC_CONFIG_DIR: join(root, "personal-anthropic"),
    ANTHROPIC_API_KEY: "synthetic-key",
    CLAUDE_CODE_PROJECT_DIR_NAME: "shared-project",
    CLAUDE_CODE_OAUTH_TOKEN: "synthetic-isolated-token",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://telemetry.invalid",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    TERM: "dumb",
  };
  const before = { ...env };
  const options = {
    cwd: world,
    studioId: "owner-1",
    env,
    storageRoot: join(root, "product"),
    routerPath: process.execPath,
    promptTemplate: "Domain rules {{cwd}} {{platform}} {{currentDate}}",
    profileMode: "isolated" as const,
  };
  const first = await prepareClaudeLaunch(options);
  const second = await prepareClaudeLaunch(options);
  expect(first.cwd).toBe(resolve(world));
  expect(first.cwd).toBe(second.cwd);
  expect(first.env.CLAUDE_CONFIG_DIR).toBe(second.env.CLAUDE_CONFIG_DIR);
  expect(first.env.CLAUDE_CONFIG_DIR).not.toBe(env.CLAUDE_CONFIG_DIR);
  expect(first.env.ANTHROPIC_CONFIG_DIR).not.toBe(env.ANTHROPIC_CONFIG_DIR);
  expect(first.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(first.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect(first.env.CLAUDE_CODE_PROJECT_DIR_NAME).toBeUndefined();
  expect(first.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  expect(first.env.NO_COLOR).toBeUndefined();
  expect(first.env.FORCE_COLOR).toBe("3");
  expect(first.env.TERM).toBe("xterm-256color");
  expect(first.env.COLORTERM).toBe("truecolor");
  expect(first.args).toContain("--append-system-prompt-file");
  expect(first.args).not.toContain("--system-prompt");
  expect(first.args).not.toContain("--bare");
  expect(first.args).toContain("--strict-mcp-config");
  expect(first.args).toContain("--permission-mode");
  expect(first.args[first.args.indexOf("--permission-mode") + 1]).toBe("auto");
  expect(first.args).not.toContain("--dangerously-skip-permissions");
  expect(first.args).not.toContain("--allow-dangerously-skip-permissions");
  expect(first.args).not.toContain("bypassPermissions");
  expect(first.args).toContain("--plugin-dir");
  expect(first.args[first.args.indexOf("--plugin-dir") + 1]).toBe(resolve(options.storageRoot));
  const promptPath = first.args[first.args.indexOf("--append-system-prompt-file") + 1];
  const rendered = await readFile(promptPath!, "utf8");
  expect(rendered).toContain(first.cwd);
  expect(rendered).toContain(JSON.stringify(world));
  const configPath = first.args[first.args.indexOf("--mcp-config") + 1];
  const mcp = JSON.parse(await readFile(configPath!, "utf8"));
  expect(mcp.mcpServers.overdare.args).toContain("--embedded-studio=owner-1");
  const settings = JSON.parse(await readFile(first.args[first.args.indexOf("--settings") + 1]!, "utf8"));
  expect(settings.hooks).toEqual({
    Stop: [
      { hooks: [{ type: "mcp_tool", server: "overdare", tool: "studiorpc_level_save_file", input: {}, timeout: 15 }] },
    ],
  });
  expect(env).toEqual(before);
  expect(await readFile(join(ordinary, "settings.json"), "utf8")).toBe("PERSONAL SETTINGS");
  expect(first.launchDir).not.toBe(second.launchDir);
  await first.cleanup();
  await second.cleanup();
});

test("shared profile is the default without redirecting native Claude authentication", async () => {
  const root = await mkdtemp(join(tmpdir(), "overdare-shared-claude-"));
  temporary.push(root);
  const profile = join(root, ".claude");
  await mkdir(profile);
  await writeFile(join(profile, ".credentials.json"), "SYNTHETIC NATIVE CREDENTIALS");
  const base = {
    cwd: join(root, "world"),
    studioId: "owner",
    storageRoot: join(root, "product"),
    routerPath: process.execPath,
    promptTemplate: "Studio rules",
  };
  const first = await prepareClaudeLaunch({
    ...base,
    env: {
      USERPROFILE: root,
      HOME: root,
      OVERDARE_CLAUDE_PATH: process.execPath,
    },
  });
  expect(first.env.CLAUDE_CONFIG_DIR).toBeUndefined();
  expect(first.env.ANTHROPIC_CONFIG_DIR).toBeUndefined();
  expect(first.args).toContain("--strict-mcp-config");
  expect(first.args).toContain("--append-system-prompt-file");
  expect(first.cwd).toBe(resolve(base.cwd));
  expect(await readFile(join(profile, ".credentials.json"), "utf8")).toBe("SYNTHETIC NATIVE CREDENTIALS");
  await first.cleanup();
  const selected = await prepareClaudeLaunch({
    ...base,
    env: {
      USERPROFILE: root,
      HOME: root,
      OVERDARE_CLAUDE_PATH: process.execPath,
      CLAUDE_CONFIG_DIR: profile,
      ANTHROPIC_CONFIG_DIR: join(root, "anthropic"),
      CLAUDE_CODE_OAUTH_TOKEN: "synthetic-native-token",
    },
  });
  expect(selected.env.CLAUDE_CONFIG_DIR).toBe(profile);
  expect(selected.env.ANTHROPIC_CONFIG_DIR).toBe(join(root, "anthropic"));
  expect(selected.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("synthetic-native-token");
  await selected.cleanup();
});

test("telemetry-disabled native Claude keeps its real input cursor unless explicitly opted out", async () => {
  const root = await mkdtemp(join(tmpdir(), "overdare-native-cursor-"));
  temporary.push(root);
  for (const override of [undefined, "0", "1"]) {
    const launch = await prepareClaudeLaunch({
      cwd: root,
      studioId: "owner",
      storageRoot: join(root, "product"),
      routerPath: process.execPath,
      promptTemplate: "Studio rules",
      env: {
        OVERDARE_CLAUDE_PATH: process.execPath,
        CLAUDE_CODE_NATIVE_CURSOR: override,
        CLAUDE_CODE_PROJECT_DIR_NAME: "unrelated-inherited-override",
      },
    });
    try {
      expect(launch.env.DISABLE_TELEMETRY).toBe("1");
      expect(launch.env.CLAUDE_CODE_NATIVE_CURSOR).toBe(override ?? "1");
      expect(launch.env.CLAUDE_CODE_PROJECT_DIR_NAME).toBeUndefined();
    } finally {
      await launch.cleanup();
    }
  }
});

test("prompt renders context, preserves shared memory guidance, and adapts agent conventions", () => {
  const text = renderClaudeStudioPrompt(
    "Rules\n# Project Memory\nUse available project memory.\n</general-guidelines>\nDelegate to one `general` sub-agent. record-project-memory {{cwd}}",
    "/world",
    new Date("2026-11-04T00:00:00Z"),
  );
  expect(text).toContain("Rules");
  expect(text).toContain("/world");
  expect(text).toContain("Use available project memory.");
  expect(text).toContain("record-project-memory");
  expect(text).not.toContain("`general` sub-agent");
  expect(text).toContain("native Skill tool");
  expect(text).not.toContain("load_skill");
});

test("missing local Claude installation gives an actionable error before creating a session", async () => {
  await expect(
    prepareClaudeLaunch({
      cwd: "/world",
      studioId: "owner",
      env: { PATH: "", OVERDARE_CLAUDE_PATH: "Z:/missing/claude.exe" },
    }),
  ).rejects.toThrow("Claude Code");
});

test("native launch passes converted agents as session JSON while sharing the product skill root", async () => {
  const root = await mkdtemp(join(tmpdir(), "overdare-agent-launch-"));
  temporary.push(root);
  const source = join(root, "product", "agents", "studio-explorer");
  await mkdir(source, { recursive: true });
  const text =
    "---\nname: studio-explorer\ndescription: Inspect the world\nmodel_class: lite\ntools: read, studiorpc_level_browse\n---\nRead-only exploration.\n";
  await writeFile(join(source, "AGENT.md"), text);
  const launch = await prepareClaudeLaunch({
    cwd: root,
    studioId: "owner",
    storageRoot: join(root, "product"),
    routerPath: process.execPath,
    promptTemplate: "Rules",
    env: { OVERDARE_CLAUDE_PATH: process.execPath },
  });
  try {
    const agents = JSON.parse(launch.args[launch.args.indexOf("--agents") + 1]!);
    expect(agents["studio-explorer"].model).toBe("haiku");
    expect(agents["studio-explorer"].tools).toEqual(["Read", "mcp__overdare__studiorpc_level_browse"]);
    expect(agents["studio-explorer"].prompt).toContain("Read-only exploration.");
    expect(launch.args[launch.args.indexOf("--plugin-dir") + 1]).toBe(resolve(root, "product"));
  } finally {
    await launch.cleanup();
  }
  expect(await readFile(join(source, "AGENT.md"), "utf8")).toBe(text);
});

test("native resume and new-session arguments keep fresh Studio instructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "overdare-resume-"));
  temporary.push(root);
  const base = {
    cwd: root,
    studioId: "owner",
    storageRoot: join(root, "host"),
    routerPath: process.execPath,
    promptTemplate: "Studio rules",
    env: { OVERDARE_CLAUDE_PATH: process.execPath },
  };
  const id = "14b6d3c0-b5b3-4d88-a880-c5ea8cd55d51";
  const resumed = await prepareClaudeLaunch({ ...base, conversation: { mode: "resume", id } });
  expect(resumed.args.slice(0, 2)).toEqual(["--resume", id]);
  expect(resumed.args[resumed.args.indexOf("--permission-mode") + 1]).toBe("auto");
  expect(resumed.args).not.toContain("--dangerously-skip-permissions");
  // The synthetic native executable is Bun, which does not support this newer Claude option.
  expect(resumed.args).not.toContain("--system-prompt-snapshot");
  expect(resumed.conversationId).toBe(id);
  await resumed.cleanup();
  const fresh = await prepareClaudeLaunch({ ...base, conversation: { mode: "new", id } });
  expect(fresh.args.slice(0, 2)).toEqual(["--session-id", id]);
  expect(fresh.args[fresh.args.indexOf("--permission-mode") + 1]).toBe("auto");
  expect(fresh.args).not.toContain("--dangerously-skip-permissions");
  expect(fresh.args).not.toContain("--resume");
  await fresh.cleanup();
  await expect(prepareClaudeLaunch({ ...base, conversation: { mode: "resume", id: "../../other" } })).rejects.toThrow(
    "Invalid Claude conversation",
  );
});
