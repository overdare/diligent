// @summary Shared-profile Claude launch with per-Studio instructions and optional profile isolation.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { prepareClaudePlugin } from "./plugin";

export interface ClaudeLaunchOptions {
  cwd: string;
  studioId: string;
  env?: NodeJS.ProcessEnv;
  storageRoot?: string;
  routerPath?: string;
  promptTemplate?: string;
  profileMode?: "shared" | "isolated";
  conversation?: { mode: "resume" | "new"; id: string };
}

export interface ClaudeLaunch {
  program: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  launchDir: string;
  conversationId?: string;
  cleanup(): Promise<void>;
}

const snapshotSupport = new Map<string, Promise<boolean>>();
function supportsPromptSnapshot(program: string, env: Record<string, string>): Promise<boolean> {
  const key = `${program}:${statSync(program).mtimeMs}`;
  let support = snapshotSupport.get(key);
  if (!support) {
    support = new Promise<boolean>((resolveSupport) => {
      execFile(program, ["--help"], { env, windowsHide: true, timeout: 4000, maxBuffer: 128 * 1024 }, (error, output) =>
        resolveSupport(!error && output.includes("--system-prompt-snapshot")),
      );
    });
    snapshotSupport.set(key, support);
  }
  return support;
}

export function productStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.USERPROFILE ?? env.HOME ?? homedir(), `.${env.DILIGENT_STORAGE_NAMESPACE ?? "overdare"}`);
}

export function claudeConfigDirectory(options: ClaudeLaunchOptions): string {
  const env = options.env ?? process.env;
  const mode = options.profileMode ?? env.OVERDARE_CLAUDE_PROFILE_MODE ?? "shared";
  if (mode !== "shared" && mode !== "isolated")
    throw new Error("OVERDARE_CLAUDE_PROFILE_MODE must be shared or isolated.");
  return mode === "isolated"
    ? join(options.storageRoot ?? productStorageRoot(env), "claude-code", "profile")
    : resolve(env.CLAUDE_CONFIG_DIR ?? join(env.USERPROFILE ?? env.HOME ?? homedir(), ".claude"));
}

export function nativeHostBinary(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  const override = env[name === "overdare-terminal" ? "OVERDARE_TERMINAL_PATH" : "OVERDARE_MCP_PATH"];
  const candidates = [
    override,
    join(dirname(process.execPath), "assets", "bin", name + ext),
    resolve(import.meta.dir, "../../../target/debug", name + ext),
  ];
  const found = candidates.find((path): path is string => Boolean(path && existsSync(path)));
  if (!found)
    throw new Error(
      `${name} is missing. Install an updated OVERDARE agent runtime, or build its Rust helpers for development.`,
    );
  return found;
}

export function findClaude(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OVERDARE_CLAUDE_PATH;
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  const found =
    override ??
    Bun.which(name, { PATH: env.PATH ?? env.Path ?? "" }) ??
    [join(env.USERPROFILE ?? env.HOME ?? homedir(), ".local", "bin", name)].find(existsSync);
  if (!found || !existsSync(found) || !statSync(found).isFile()) {
    throw new Error(
      "Claude Code is not installed. Install the official Claude Code CLI, then retry. OVERDARE_CLAUDE_PATH can select an existing executable.",
    );
  }
  return resolve(found);
}

export function renderClaudeStudioPrompt(template: string, cwd: string, now = new Date(), projectDir = cwd): string {
  const adapted = template
    .replace(
      /Delegate new props to one `general` sub-agent \(it edits the level\):/g,
      "If Claude Code supports a suitable subagent, delegate new props to one subagent (it edits the level); otherwise do the work directly:",
    )
    .replaceAll("`general` sub-agent", "available Claude Code subagent")
    .replaceAll("{{currentDate}}", now.toISOString().slice(0, 10))
    .replaceAll("{{cwd}}", cwd)
    .replaceAll("{{platform}}", process.platform);
  return `${adapted}\n\n<claude-code-studio-host>
You are running inside OVERDARE Studio using the user's unmodified Claude Code CLI.
These Studio instructions supplement Claude Code's native system prompt and tool guidance.
The MCP connection is already bound to the Studio that opened this terminal. Never switch to another Studio.
Use Claude Code's native Skill tool for the available overdare plugin skills. Tool names may carry an MCP server prefix.
Use Claude Code's own tools for filesystem work, questions, memory, and subagents. Compatible product agents are supplied through this launch's native agent definitions. Diligent Knowledge handoff cards are not injected here.
Skills are shared with other agent harnesses. Follow a skill only when its required tools and model capabilities are available in this session. Tool names in memory guidance are examples: preserve the recording intent using native memory or project documents. Do not use Diligent-only agent configuration or reporting instructions as Claude configuration. If a required capability is missing, explain the limitation instead of claiming it ran.
Your launch directory is the Studio project directory ${JSON.stringify(projectDir)}. Store supporting docs and generated working files here unless the user requests another location.
Studio scripts and scene edits must go through Studio MCP tools; do not edit the world file directly. Product session data under .overdare or .overdare-dev is managed by OVERDARE; do not rewrite it as part of game development.
Inspect the level yourself when a specialized Studio explorer role is unavailable. Run scene-editing agents sequentially.
</claude-code-studio-host>\n`;
}

export async function prepareClaudeLaunch(options: ClaudeLaunchOptions): Promise<ClaudeLaunch> {
  const sourceEnv = options.env ?? process.env;
  const profileMode = options.profileMode ?? sourceEnv.OVERDARE_CLAUDE_PROFILE_MODE ?? "shared";
  if (profileMode !== "shared" && profileMode !== "isolated")
    throw new Error("OVERDARE_CLAUDE_PROFILE_MODE must be shared or isolated.");
  const program = findClaude(sourceEnv);
  if (
    options.conversation &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(options.conversation.id)
  )
    throw new Error("Invalid Claude conversation id.");
  if (!options.studioId.trim()) throw new Error("A live owning Studio is required to launch Claude Code.");
  const router = options.routerPath ?? nativeHostBinary("overdare-mcp", sourceEnv);
  const root = options.storageRoot ?? productStorageRoot(sourceEnv);
  const template = options.promptTemplate ?? (await readFile(join(root, "system-prompt.txt"), "utf8"));
  const hostRoot = join(root, "claude-code");
  const cwd = resolve(options.cwd);
  const profile = claudeConfigDirectory(options);
  const launchDir = join(hostRoot, "launches", randomUUID());
  await Promise.all([
    mkdir(cwd, { recursive: true, mode: 0o700 }),
    ...(profileMode === "isolated" ? [mkdir(profile, { recursive: true, mode: 0o700 })] : []),
    mkdir(launchDir, { recursive: true, mode: 0o700 }),
  ]);
  const prompt = join(launchDir, "studio-prompt.txt");
  const mcp = join(launchDir, "mcp.json");
  const settings = join(launchDir, "settings.json");
  try {
    const plugin = await prepareClaudePlugin(root);
    await Promise.all([
      writeFile(
        prompt,
        renderClaudeStudioPrompt(template, cwd, new Date(), options.cwd) +
          (plugin.revokedSkills.length
            ? `\nProduct-retired skills must not be used even if stale installed files remain: ${plugin.revokedSkills.join(", ")}.\n`
            : ""),
        { mode: 0o600 },
      ),
      writeFile(
        mcp,
        JSON.stringify({
          mcpServers: {
            overdare: {
              type: "stdio",
              command: router,
              args: [
                `--agent-env=${sourceEnv.DILIGENT_ENV === "dev" || sourceEnv.DILIGENT_STORAGE_NAMESPACE === "overdare-dev" ? "dev" : "prod"}`,
                `--embedded-studio=${options.studioId}`,
              ],
            },
          },
        }),
        { mode: 0o600 },
      ),
      writeFile(
        settings,
        JSON.stringify({
          claudeMdExcludes: ["**/CLAUDE.md", "**/CLAUDE.local.md", "**/AGENTS.md", "**/.claude/rules/**"],
          hooks: {
            Stop: [
              {
                hooks: [
                  { type: "mcp_tool", server: "overdare", tool: "studiorpc_level_save_file", input: {}, timeout: 15 },
                ],
              },
            ],
          },
        }),
        { mode: 0o600 },
      ),
    ]);
    // Native Claude reads and refreshes its own login. Shared mode follows the user's
    // existing profile and native authentication environment without copying credential
    // files. Isolated mode drops inherited authentication and redirects the profile.
    const env = Object.fromEntries(
      Object.entries(sourceEnv).filter(
        (entry): entry is [string, string] => entry[1] !== undefined && !/^(CLAUDE|ANTHROPIC|OTEL_)/i.test(entry[0]),
      ),
    );
    if (sourceEnv.CLAUDE_CODE_GIT_BASH_PATH) env.CLAUDE_CODE_GIT_BASH_PATH = sourceEnv.CLAUDE_CODE_GIT_BASH_PATH;
    if (profileMode === "isolated") {
      env.CLAUDE_CONFIG_DIR = profile;
      env.ANTHROPIC_CONFIG_DIR = join(profile, "anthropic");
    } else {
      for (const name of [
        "CLAUDE_CONFIG_DIR",
        "ANTHROPIC_CONFIG_DIR",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_PROFILE",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
      ])
        if (sourceEnv[name]) env[name] = sourceEnv[name];
    }
    env.DISABLE_TELEMETRY = "1";
    // Telemetry-off also disables Claude's native-cursor feature flag. Its fallback
    // draws a cursor cell while parking the real cursor elsewhere, which moves IME
    // preedit away from the input. Keep the native cursor without enabling telemetry.
    env.CLAUDE_CODE_NATIVE_CURSOR = sourceEnv.CLAUDE_CODE_NATIVE_CURSOR ?? "1";
    // The host is a truecolor terminal, even when its parent is a colorless build runner.
    delete env.NO_COLOR;
    env.FORCE_COLOR = "3";
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    const disableSnapshot = await supportsPromptSnapshot(program, env);
    return {
      program,
      args: [
        ...(options.conversation
          ? [options.conversation.mode === "resume" ? "--resume" : "--session-id", options.conversation.id]
          : []),
        ...(disableSnapshot ? ["--system-prompt-snapshot", "off"] : []),
        "--permission-mode",
        "auto",
        "--plugin-dir",
        plugin.path,
        ...(Object.keys(plugin.agents).length ? ["--agents", JSON.stringify(plugin.agents)] : []),
        "--append-system-prompt-file",
        prompt,
        "--mcp-config",
        mcp,
        "--strict-mcp-config",
        "--setting-sources",
        "user",
        "--settings",
        settings,
      ],
      cwd,
      conversationId: options.conversation?.id,
      env,
      launchDir,
      cleanup: () => rm(launchDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(launchDir, { recursive: true, force: true });
    throw error;
  }
}
