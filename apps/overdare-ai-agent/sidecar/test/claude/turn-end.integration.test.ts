// @summary Opt-in official Claude Stop hook acceptance against local synthetic API/MCP servers.
import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareClaudeLaunch } from "../../src/claude/launch";

test.skipIf(process.env.CLAUDE_HOOK_NATIVE_TEST !== "1")(
  "official Claude saves once at main-turn completion and a save failure does not continue the model",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "overdare-native-stop-"));
    // Windows can retain a just-exited native CLI's working-directory handle
    // until its owner closes. Keep this empty diagnostic workspace separate
    // from the disposable credentials/settings tree that must be removed.
    const world = join(import.meta.dir, "../../artifacts/claude-stop-workspace");
    await mkdir(world, { recursive: true });
    let failed = false;
    let saves = 0;
    let modelCalls = 0;
    const api = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        const body = await req.json().catch(() => null);
        if (path === "/mcp") {
          if (body?.id === undefined) return new Response(null, { status: 202 });
          const respond = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
          if (body.method === "initialize")
            return respond({
              protocolVersion: body.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "stop-fixture", version: "1" },
            });
          if (body.method === "tools/list")
            return respond({
              tools: [
                {
                  name: "studiorpc_level_save_file",
                  description: "Synthetic save",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            });
          if (body.method === "tools/call") {
            expect(body.params.name).toBe("studiorpc_level_save_file");
            expect(body.params.arguments).toEqual({});
            saves++;
            return respond({
              content: [{ type: "text", text: failed ? "SYNTHETIC_SAVE_FAILED" : "SYNTHETIC_SAVED" }],
              isError: failed,
            });
          }
          return respond({});
        }
        if (path.endsWith("/messages/count_tokens")) return Response.json({ input_tokens: 50 });
        if (!path.endsWith("/messages")) return Response.json({});
        modelCalls++;
        const message = {
          id: "msg_stop_fixture",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "LOCAL_TURN_DONE" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 50, output_tokens: 5 },
        };
        if (!body?.stream) return Response.json(message);
        const events = [
          ["message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
          [
            "content_block_delta",
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "LOCAL_TURN_DONE" } },
          ],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          [
            "message_delta",
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: 5 },
            },
          ],
          ["message_stop", { type: "message_stop" }],
        ];
        return new Response(
          events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    try {
      for (const fail of [false, true]) {
        failed = fail;
        saves = 0;
        modelCalls = 0;
        const storageRoot = join(root, String(fail));
        const launch = await prepareClaudeLaunch({
          cwd: world,
          studioId: "synthetic-owner",
          storageRoot,
          promptTemplate: "Synthetic local Stop integration.",
          profileMode: "isolated",
          env: { ...process.env, HOME: root, USERPROFILE: root },
        });
        try {
          const key = "sk-ant-local-hook-fixture-no-upstream";
          await mkdir(launch.env.CLAUDE_CONFIG_DIR!, { recursive: true });
          await writeFile(
            join(launch.env.CLAUDE_CONFIG_DIR!, ".claude.json"),
            JSON.stringify({
              hasCompletedOnboarding: true,
              theme: "dark",
              customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] },
            }),
          );
          // Keep the generated Stop settings. Replace only the transport destination
          // with this disposable synthetic MCP server; no real Studio is contacted.
          await writeFile(
            launch.args[launch.args.indexOf("--mcp-config") + 1]!,
            JSON.stringify({ mcpServers: { overdare: { type: "http", url: `http://127.0.0.1:${api.port}/mcp` } } }),
          );
          const commandArgs = [
            ...launch.args,
            "--no-session-persistence",
            "--model",
            "claude-sonnet-4-6",
            "--max-turns",
            "1",
            "--print",
            "Synthetic local fixture.",
          ];
          const execution = {
            cwd: launch.cwd,
            env: {
              ...launch.env,
              ANTHROPIC_API_KEY: key,
              ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`,
              DISABLE_AUTOUPDATER: "1",
              DISABLE_ERROR_REPORTING: "1",
              CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
            },
            timeout: 30_000,
          };
          const { exit, stdout, stderr } = await new Promise<{ exit: number; stdout: string; stderr: string }>(
            (resolve) => {
              execFile(launch.program, commandArgs, execution, (error, stdout, stderr) =>
                resolve({ exit: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout, stderr }),
              );
            },
          );
          expect({ exit, stdout, stderr }).toMatchObject({
            exit: 0,
            stdout: expect.stringContaining("LOCAL_TURN_DONE"),
          });
          expect(saves).toBe(1);
          expect(modelCalls).toBe(1);
        } finally {
          await launch.cleanup();
        }
      }
    } finally {
      api.stop(true);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
  75_000,
);
