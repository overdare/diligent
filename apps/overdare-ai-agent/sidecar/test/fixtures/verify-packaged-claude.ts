// @summary Opt-in packaged-runtime smoke: actual installed Claude starts in an isolated test home.

import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { prepareClaudeLaunch } from "../../src/claude/launch";
import { createStudioRegistry } from "../../src/studio-registry";

const root = await mkdtemp(join(tmpdir(), "overdare-packaged-claude-"));
const runtime = resolve(process.argv[2] ?? "artifacts/claude-host-package");
const world = join(root, "world");
await mkdir(world);
await mkdir(join(root, ".overdare-dev"));
await writeFile(
  join(root, ".overdare-dev/system-prompt.txt"),
  await readFile(join(runtime, "defaults/system-prompt.txt")),
);
await cp(join(runtime, "defaults", "skills"), join(root, ".overdare-dev", "skills"), { recursive: true });
await cp(join(runtime, "defaults", "agents"), join(root, ".overdare-dev", "agents"), { recursive: true });
const env = {
  ...process.env,
  USERPROFILE: root,
  HOME: root,
  DILIGENT_STORAGE_NAMESPACE: "overdare-dev",
  DILIGENT_ENV: "dev",
  STUDIO_PORT: "1",
  SENTRY_DSN: "",
  OVERDARE_CLAUDE_PROFILE_MODE: "isolated",
};
const startServer = () => {
  const process = spawn(join(runtime, "diligent-web-server.exe"), [`--cwd=${world}`, "--port=0"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  process.stderr.resume();
  return process;
};
const waitReady = (child: ReturnType<typeof startServer>) =>
  new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Packaged server startup timed out")), 20_000);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const match = /^DILIGENT_PORT=(\d+)$/.exec(line);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Packaged server exited: ${code}`));
    });
  });
const stopServer = async (child: ReturnType<typeof startServer>) => {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
};
let child = startServer();
try {
  let port = await waitReady(child);
  // The registry is published just after the launcher's readiness line.
  await Bun.sleep(1500);
  const records = await createStudioRegistry(join(root, ".overdare-dev/mcp/studios")).list();
  if (records.length !== 1) throw new Error("Expected the packaged sidecar's owning registration");
  const launch = await prepareClaudeLaunch({
    cwd: world,
    studioId: records[0].id,
    env,
    routerPath: join(runtime, "assets/bin/overdare-mcp.exe"),
  });
  try {
    const plugin = Bun.spawn([launch.program, "plugin", "validate", join(root, ".overdare-dev")], {
      cwd: launch.cwd,
      env: launch.env,
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(10_000),
    });
    const [pluginCode, pluginOutput, pluginError] = await Promise.all([
      plugin.exited,
      new Response(plugin.stdout).text(),
      new Response(plugin.stderr).text(),
    ]);
    if (pluginCode !== 0) throw new Error(`Native plugin validation failed: ${pluginOutput}\n${pluginError}`);
    console.info("Official Claude Code validated the shared product-root plugin.");
    // `mcp list` reads saved configuration, ignoring interactive --mcp-config overrides.
    // Register only inside this disposable test profile using Claude's official command.
    const mcpConfig = JSON.parse(await readFile(join(launch.launchDir, "mcp.json"), "utf8"));
    const server = mcpConfig.mcpServers.overdare as { command: string; args: string[] };
    const add = Bun.spawn(
      [
        launch.program,
        "mcp",
        "add",
        "--scope",
        "user",
        "--transport",
        "stdio",
        "overdare",
        "--",
        server.command,
        ...server.args,
      ],
      {
        cwd: launch.cwd,
        env: launch.env,
        stdout: "pipe",
        stderr: "pipe",
        signal: AbortSignal.timeout(10_000),
      },
    );
    const [added, addOutput, addErrors] = await Promise.all([
      add.exited,
      new Response(add.stdout).text(),
      new Response(add.stderr).text(),
    ]);
    if (added !== 0) throw new Error(`Cannot configure the disposable native MCP check: ${addOutput}\n${addErrors}`);
    const health = Bun.spawn([launch.program, "mcp", "list"], {
      cwd: launch.cwd,
      env: launch.env,
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(25_000),
    });
    const [code, output, errors] = await Promise.all([
      health.exited,
      new Response(health.stdout).text(),
      new Response(health.stderr).text(),
    ]);
    if (code !== 0 || !/overdare:.*Connected/s.test(output))
      throw new Error(`Native Claude MCP health check failed (${code}): ${output}\n${errors}`);
    console.info("Official Claude Code confirmed the packaged MCP connection is healthy.");
  } finally {
    await launch.cleanup();
  }
  const node = process.env.NODE_BINARY ?? Bun.which("node");
  if (!node) throw new Error("NODE_BINARY is required");
  const checkBrowser = async (fromRoot: boolean) => {
    const worker = Bun.spawn([node, resolve(import.meta.dir, "claude-browser.cjs"), `http://127.0.0.1:${port}`], {
      env: { ...process.env, CLAUDE_BROWSER_REAL: "1", CLAUDE_BROWSER_ROOT: fromRoot ? "1" : "0" },
      stdout: "inherit",
      stderr: "inherit",
    });
    if (await worker.exited) throw new Error("Actual Claude startup smoke failed");
  };
  await checkBrowser(false);
  const saved = await fetch(`http://127.0.0.1:${port}/studio/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ view: "claude" }),
  });
  if (!saved.ok) throw new Error("Packaged view preference was not saved");
  await stopServer(child);
  child = startServer();
  port = await waitReady(child);
  const restored = await (await fetch(`http://127.0.0.1:${port}/studio/view`)).json();
  if (restored.view !== "claude") throw new Error("Packaged host restart lost the project view");
  await checkBrowser(true);
  console.info("Packaged host restart restored the Claude view from the root route.");
  console.info(
    "Packaged sidecar + native PTY + actual Claude Code startup passed; no model request or account login was performed.",
  );
} finally {
  await stopServer(child);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
