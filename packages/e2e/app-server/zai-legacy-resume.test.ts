// @summary Legacy Coding Plan session resume through JSON-RPC and a synthetic loopback provider
import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModel } from "@diligent/core/model-registry";
import { ensureDiligentDir, ProviderManager } from "@diligent/runtime";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

for (const modelId of ["glm-5.1", "glm-5.2"]) {
  for (const effort of ["medium", "xhigh"] as const) {
    test(`resumes saved ${modelId}/${effort} with a canonical model and supported wire effort`, async () => {
      const cwd = await mkdtemp(join(tmpdir(), "diligent-zai-resume-"));
      let client: ProtocolTestClient | undefined;
      const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
      // All responses are fixtures. No live provider or credentials are used.
      const endpoint = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          requests.push({ path: new URL(request.url).pathname, body: await request.json() });
          const chunk = {
            id: "resume-fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "glm-5.3",
            choices: [{ index: 0, delta: { content: "resumed fixture" }, finish_reason: "stop" }],
          };
          return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });
      try {
        const card = resolveModel({ provider: "zai-coding-plan", modelId: "glm-5.3" });
        const manager = new ProviderManager({
          provider: { "zai-coding-plan": { baseUrl: `${endpoint.url}api/coding/paas/v4` } },
        });
        manager.setApiKey("zai-coding-plan", "local-test-key");
        client = createProtocolClient(
          createTestServer({
            cwd,
            runtimeToolsConfig: {},
            runtimeConfigOverrides: { model: card, providerManager: manager },
          }),
        );
        const threadId = await client.initAndStartThread(cwd);
        await client.request("config/set", { threadId, model: { provider: card.provider, modelId: card.modelId } });
        await client.request("effort/set", { threadId, effort: "high" });
        await client.sendTurnAndWait(threadId, "saved fixture");
        client.close();

        // Reproduce a pre-migration saved session, including an effort no longer offered by its card.
        const paths = await ensureDiligentDir(cwd);
        const file = (await readdir(paths.sessions)).find((name) => name.includes(threadId) && name.endsWith(".jsonl"));
        expect(file).toBeDefined();
        const sessionPath = join(paths.sessions, file!);
        const entries = (await readFile(sessionPath, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const modelEntries = entries.filter((entry) => entry.type === "model_change");
        const effortEntries = entries.filter((entry) => entry.type === "effort_change");
        expect(modelEntries.length).toBeGreaterThan(0);
        expect(effortEntries.length).toBeGreaterThan(0);
        for (const entry of modelEntries) {
          entry.provider = card.provider;
          entry.modelId = modelId;
        }
        for (const entry of effortEntries) entry.effort = effort;
        await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

        client = createProtocolClient(
          createTestServer({
            cwd,
            runtimeToolsConfig: {},
            streamFunction: manager.createProxyStream(),
            runtimeConfigOverrides: { model: card, providerManager: manager },
          }),
        );
        await client.request("initialize", { clientName: "test", clientVersion: "0.0.1", protocolVersion: 1 });
        expect(await client.request("thread/resume", { threadId })).toMatchObject({ found: true, threadId });
        const notifications = await client.sendTurnAndWait(threadId, "continue fixture");
        expect(notifications.some((notification) => notification.method === "turn/completed")).toBe(true);
        expect(requests).toHaveLength(1);
        expect(requests[0]?.path).toBe("/api/coding/paas/v4/chat/completions");
        expect(requests[0]?.body.model).toBe("glm-5.3");
        expect(requests[0]?.body.reasoning_effort).toBe("low");
        expect(requests[0]?.body.thinking).toEqual({ type: "enabled" });
      } finally {
        client?.close();
        await endpoint.stop(true);
        await rm(cwd, { recursive: true, force: true });
      }
    });
  }
}
