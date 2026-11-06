// @summary Run a standalone Windows terminal IME lab with the production native ConPTY path.
import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createClaudeTerminalHost } from "../../../src/claude/host";
import { findClaude } from "../../../src/claude/launch";
import { ClaudeTerminalSession, validTerminalSize } from "../../../src/claude/session";
import { createAttachedTerminalRelay } from "./relay";

const root = resolve(import.meta.dir, "../../../../../..");
const artifacts = join(root, "artifacts/terminal-ime-lab");
const workspace = join(artifacts, "workspace");
await mkdir(workspace, { recursive: true });
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "client.ts")],
  target: "browser",
  sourcemap: "inline",
});
if (!build.success) throw new AggregateError(build.logs, "Lab client build failed");
const javascript = build.outputs.find((output) => output.path.endsWith(".js"))!;
const css = Bun.file(Bun.resolveSync("@xterm/xterm/css/xterm.css", import.meta.dir));
const attachOrigin = process.argv.find((arg) => arg.startsWith("--attach="))?.slice("--attach=".length);
const productClient = process.argv
  .find((arg) => arg.startsWith("--product-client="))
  ?.slice("--product-client=".length);
let mode = attachOrigin ? "attached" : process.argv.includes("--claude") ? "claude" : "pty";
const token = randomBytes(32).toString("hex");
const environment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
delete environment.NO_COLOR;
Object.assign(environment, { TERM: "xterm-256color", COLORTERM: "truecolor", FORCE_COLOR: "3" });
const session = attachOrigin
  ? null
  : new ClaudeTerminalSession({
      launch: async () => ({
        program: mode === "claude" ? findClaude() : process.execPath,
        args: mode === "claude" ? ["--session-id", randomUUID()] : [join(import.meta.dir, "console.ts")],
        cwd: workspace,
        env: environment,
        launchDir: "standalone-ime-lab",
        cleanup: async () => {},
      }),
    });
let host: Pick<ReturnType<typeof createClaudeTerminalHost>, "bootstrap" | "close">;
let control = Promise.resolve();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const origin = `http://127.0.0.1:${server.port}`;
    if (url.origin !== origin) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/claude/bootstrap") return host.bootstrap(request);
    if (url.pathname === "/lab/info") return Response.json({ token, mode });
    if (productClient && url.pathname === "/claude")
      return new Response(Bun.file(join(resolve(productClient), "index.html")), {
        headers: { "Cache-Control": "no-store" },
      });
    if (productClient && /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname))
      return new Response(Bun.file(join(resolve(productClient), url.pathname.slice(1))));
    if (url.pathname === "/lab.js") return new Response(javascript, { headers: { "Content-Type": "text/javascript" } });
    if (url.pathname === "/xterm.css") return new Response(css);
    if (url.pathname === "/lab/control") {
      if (attachOrigin)
        return new Response("Attached comparison cannot start, stop, or replace the source session.", { status: 403 });
      if (
        request.method !== "POST" ||
        request.headers.get("origin") !== origin ||
        request.headers.get("x-lab-token") !== token
      )
        return new Response("Forbidden", { status: 403 });
      const value = (await request.json()) as { mode: string; cols: number; rows: number };
      if (!["local", "pty", "claude"].includes(value.mode) || !validTerminalSize(value))
        return new Response("Invalid mode or size", { status: 400 });
      const next = control.then(async () => {
        await session!.stop();
        mode = value.mode;
        if (mode !== "local") await session!.start(value);
      });
      control = next.catch(() => {});
      try {
        await next;
        return Response.json({ mode });
      } catch (error) {
        console.error("Failed to apply lab control update:", error);
        return new Response("Internal server error", { status: 500 });
      }
    }
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    return new Response(
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>OVERDARE Terminal IME Lab</title>
<link rel="stylesheet" href="/xterm.css"><style>
*{box-sizing:border-box}body{margin:0;background:#181b1f;color:#ececee;font:13px system-ui;height:100vh;display:flex;flex-direction:column}
header,nav{padding:10px 14px;border-bottom:1px solid #414650;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:16px;margin:0}button,select,#reference{color:inherit;background:#252930;border:1px solid #535966;border-radius:4px;padding:5px}
header output{margin-left:auto}main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:12px;padding:12px}
#terminal{min-width:0;min-height:0}aside{min-height:0;display:flex;flex-direction:column;gap:8px}#reference{width:100%;min-height:55px;resize:vertical}
pre{font:11px Consolas,monospace;white-space:pre-wrap;overflow:auto;margin:0;background:#111419;padding:8px}#geometry{max-height:170px}#events{flex:1;min-height:0}
</style><header><h1>Terminal IME Lab</h1><span>xterm 6 · Windows ConPTY · Studio-free</span><output id="status">Connecting</output></header>
<nav>${productClient ? '<a href="/claude" style="color:#86b8ff">Product UI (same Claude process)</a>' : ""}<label>Backend <select id="backend"><option value="pty">ConPTY control prompt</option><option value="local">Local xterm echo (no PTY)</option><option value="claude">Installed Claude (shared authentication, fresh lab session)</option></select></label>
<label><input id="guard" type="checkbox" checked>Production IME guard</label><button id="park">Toggle parked cursor (control prompt)</button><button id="redraw">Redraw</button><button id="clear">Clear trace</button><button id="export">Export test trace</button></nav>
<main><section id="terminal" aria-label="IME test terminal"></section><aside><label>Plain browser textarea (reference)<textarea id="reference" spellcheck="false"></textarea></label>
<span>Real terminal cursor and input geometry</span><pre id="geometry"></pre><span>Local trace includes test text. Export is explicit; nothing is uploaded.</span><pre id="events"></pre></aside></main>
<script type="module" src="/lab.js"></script></html>`,
      { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } },
    );
  },
});
host = attachOrigin
  ? await createAttachedTerminalRelay({ sourceOrigin: attachOrigin, webOrigin: `http://127.0.0.1:${server.port}` })
  : createClaudeTerminalHost({
      cwd: workspace,
      webOrigin: `http://127.0.0.1:${server.port}`,
      studioId: () => "ime-lab",
      session: session!,
      conversations: async () => [],
    });
console.log(`IME_LAB_URL=http://127.0.0.1:${server.port}`);
let window: ReturnType<typeof Bun.spawn> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  window?.kill();
  await host.close();
  server.stop(true);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
if (!process.argv.includes("--headless")) {
  const cef = process.argv.includes("--engine=cef");
  const output = join(artifacts, cef ? "cef-win" : "win");
  const native = join(output, cef ? "TerminalImeLabCef.exe" : "TerminalImeLab.exe");
  const compile = Bun.spawn(
    [
      "dotnet",
      "build",
      join(import.meta.dir, cef ? "native-cef/TerminalImeLabCef.csproj" : "native/TerminalImeLab.csproj"),
      "--output",
      output,
      `-p:BaseIntermediateOutputPath=${join(artifacts, cef ? "cef-obj" : "obj")}/`,
      "--nologo",
      "--verbosity",
      "quiet",
    ],
    { stdout: "inherit", stderr: "inherit", windowsHide: true },
  );
  if (await compile.exited) {
    await close();
    throw new Error("Native lab build failed");
  }
  if (cef) {
    const runtime =
      process.argv.find((arg) => arg.startsWith("--cef-runtime="))?.slice("--cef-runtime=".length) ??
      process.env.OVERDARE_STUDIO_CEF_DIR;
    if (!runtime) {
      await close();
      throw new Error("--engine=cef requires --cef-runtime=<Studio CEF directory>");
    }
    // Copy into this lab's private output; never replace any Studio files.
    await cp(resolve(runtime), output, { recursive: true, force: true });
    const [source, copied] = await Promise.all([
      readFile(join(runtime, "libcef.dll")),
      readFile(join(output, "libcef.dll")),
    ]);
    const sourceHash = new Bun.CryptoHasher("sha256").update(source).digest("hex");
    const copiedHash = new Bun.CryptoHasher("sha256").update(copied).digest("hex");
    if (sourceHash !== copiedHash) {
      await close();
      throw new Error("Studio CEF copy hash mismatch");
    }
    await writeFile(
      join(artifacts, "cef-runtime-identity.json"),
      JSON.stringify({ source: resolve(runtime), sourceHash, copiedHash }, null, 2),
    );
    console.log(`IME_LAB_CEF_SHA256=${copiedHash}`);
  }
  window = Bun.spawn(
    [native, `http://127.0.0.1:${server.port}`, join(artifacts, cef ? "cef-profile" : "webview2-profile")],
    {
      windowsHide: false,
    },
  );
  await window.exited;
  await close();
}
