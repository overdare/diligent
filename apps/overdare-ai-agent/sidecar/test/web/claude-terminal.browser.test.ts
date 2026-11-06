// @summary Opt-in Chrome + native PTY acceptance; Node drives Playwright on Windows.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClaudeTerminalHost } from "../../src/claude/host";
import { nativeHostBinary } from "../../src/claude/launch";
import { ClaudeTerminalSession } from "../../src/claude/session";
import { createStudioViewState } from "../../src/claude/view-state";

test.skipIf(process.env.CLAUDE_HOST_BROWSER_TEST !== "1")(
  "browser renders, types Unicode, resizes, interrupts and reconnects to native PTY",
  async () => {
    const node = process.env.NODE_BINARY ?? Bun.which("node");
    if (!node) throw new Error("Browser acceptance requires Node.js (NODE_BINARY) and Chrome (CHROME_PATH).");
    const dist = resolve(import.meta.dir, "../../dist/client");
    const viewRoot = await mkdtemp(join(tmpdir(), "overdare-view-browser-"));
    const session = new ClaudeTerminalSession({
      helperPath: nativeHostBinary("overdare-terminal"),
      launch: async (conversation) => ({
        program: process.execPath,
        args: [resolve(import.meta.dir, "../fixtures/claude-console.ts")],
        cwd: process.cwd(),
        env: Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
        launchDir: "browser-fixture",
        conversationId: conversation?.id,
        cleanup: async () => {},
      }),
    });
    let host: ReturnType<typeof createClaudeTerminalHost>;
    let shell: ReturnType<typeof createClaudeTerminalHost>;
    let viewState: ReturnType<typeof createStudioViewState>;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/claude/bootstrap") return host.bootstrap(req);
        if (path === "/terminal/bootstrap") return shell.bootstrap(req);
        if (path === "/studio/view") return viewState.handle(req);
        if (path === "/test/shell-status") return Response.json(shell.session.snapshot());
        if (path === "/test/status")
          return Response.json(session.snapshot(), { headers: { "Cache-Control": "no-store" } });
        return new Response(Bun.file(path.startsWith("/assets/") ? join(dist, path) : join(dist, "index.html")));
      },
    });
    host = createClaudeTerminalHost({
      cwd: process.cwd(),
      webOrigin: `http://127.0.0.1:${server.port}`,
      studioId: () => "browser-fixture",
      session,
      conversations: async () => [
        { id: "14b6d3c0-b5b3-4d88-a880-c5ea8cd55d51", title: "Latest arena", updatedAt: 200 },
        { id: "24b6d3c0-b5b3-4d88-a880-c5ea8cd55d51", title: "Older design", updatedAt: 100 },
      ],
    });
    shell = createClaudeTerminalHost({
      mode: "shell",
      cwd: process.cwd(),
      webOrigin: `http://127.0.0.1:${server.port}`,
      studioId: () => "browser-fixture",
    });
    viewState = createStudioViewState({
      cwd: process.cwd(),
      storageRoot: viewRoot,
      webOrigin: `http://127.0.0.1:${server.port}`,
    });
    try {
      const worker = Bun.spawn(
        [node, resolve(import.meta.dir, "../fixtures/claude-browser.cjs"), `http://127.0.0.1:${server.port}`],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, stdout, stderr] = await Promise.all([
        worker.exited,
        new Response(worker.stdout).text(),
        new Response(worker.stderr).text(),
      ]);
      if (code) throw new Error(`Browser acceptance failed:\n${stdout}\n${stderr}`);
      expect(code).toBe(0);
      expect(session.snapshot().state).toBe("exited");
    } finally {
      await host.close();
      await shell.close();
      server.stop(true);
      await rm(viewRoot, { recursive: true, force: true });
    }
  },
  60_000,
);
