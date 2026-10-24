// @summary Approved raw loopback invocation using the running sidecar's provider, not shell credentials.
import { readFile } from "node:fs/promises";
import { harnessParams, runParams } from "./tool-shared";

/** Uses the existing authenticated /mcp-router registry route. Does not hot-reload an old backend. */
export async function invokeServerPlaytest(options: {
  serverUrl: string;
  sidecarToken: string;
  args: unknown;
  approved: boolean;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): Promise<unknown> {
  return invokeServerTool({ ...options, tool: "studiorpc_game_playtest" });
}

export async function invokeServerTool(options: {
  serverUrl: string;
  sidecarToken: string;
  tool: "studiorpc_game_playtest" | "studiorpc_game_playtest_harness";
  args: unknown;
  approved: boolean;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): Promise<unknown> {
  if (!options.approved) throw new Error("Explicit approval is required before invoking a live playtest");
  const url = new URL(options.serverUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Use a loopback sidecar origin without credentials, path, query or fragment");
  if (!options.sidecarToken.trim())
    throw new Error("An authorized sidecar router token is required; no credential discovery is performed");
  const args =
    options.tool === "studiorpc_game_playtest" ? runParams.parse(options.args) : harnessParams.parse(options.args);
  const request = options.fetch ?? fetch;
  const headers = { Authorization: `Bearer ${options.sidecarToken}`, "Content-Type": "application/json" };
  const catalog = await request(new URL("/mcp-router/catalog", url), {
    headers,
    signal: options.signal,
    redirect: "error",
  });
  if (!catalog.ok) throw new Error(`Sidecar catalog HTTP ${catalog.status}`);
  const data = (await catalog.json()) as {
    tools?: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
  };
  const tool = data.tools?.find((t) => t.name === options.tool);
  if (!tool) throw new Error("The running sidecar does not expose the requested playtest tool");
  if ("numberOfPlayer" in args && args.numberOfPlayer === 2 && !tool.inputSchema?.properties?.numberOfPlayer)
    throw new Error(
      "The running backend has the old playtest implementation. Parent confirmation is required to load the updated backend; raw HTTP cannot hot-reload it. No playtest was started.",
    );
  const response = await request(new URL("/mcp-router/tools/call", url), {
    method: "POST",
    headers,
    signal: options.signal,
    redirect: "error",
    body: JSON.stringify({ tool: options.tool, args, routerCallId: `multiplayer-${crypto.randomUUID()}` }),
  });
  if (!response.ok) throw new Error(`Sidecar tool invocation HTTP ${response.status}`);
  return response.json();
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const serverUrl = value("--server");
  const argsFile = value("--args");
  const tool = value("--tool") ?? "studiorpc_game_playtest";
  if (
    !serverUrl ||
    !argsFile ||
    !argv.includes("--approve") ||
    !["studiorpc_game_playtest", "studiorpc_game_playtest_harness"].includes(tool)
  ) {
    console.error(
      "Usage: OVERDARE_SIDECAR_TOKEN=<authorized router token> bun run invoke-server.ts --server http://127.0.0.1:<sidecar-port> --tool studiorpc_game_playtest[_harness] --args <json-file|-> --approve (use - for stdin JSON)",
    );
    process.exitCode = 2;
  } else {
    const controller = new AbortController();
    const cancel = () => controller.abort(new DOMException("Cancelled by parent", "AbortError"));
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      const result = await invokeServerTool({
        serverUrl,
        tool: tool as "studiorpc_game_playtest" | "studiorpc_game_playtest_harness",
        args: JSON.parse(argsFile === "-" ? await Bun.stdin.text() : await readFile(argsFile, "utf8")),
        sidecarToken: process.env.OVERDARE_SIDECAR_TOKEN ?? "",
        approved: true,
        signal: controller.signal,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      // Never echo HTTP response bodies or supplied tokens.
      console.error(error instanceof Error ? error.message : "Playtest invocation failed");
      process.exitCode = 1;
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }
}
