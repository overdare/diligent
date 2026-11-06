// @summary Routed legacy Gemini Flash sessions resume through JSON-RPC with their canonical wire model
import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModel } from "@diligent/core/model-registry";
import { ensureDiligentDir, ProviderManager } from "@diligent/runtime";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

for (const [legacyId, canonicalId] of [
  ["gemini-3.5-flash", "gemini-3.6-flash"],
  ["gemini-3.7-flash", "gemini-3.8-flash"],
] as const) {
  for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
    test(`resumes saved ${legacyId}/${effort} onto the documented ${canonicalId} endpoint`, async () => {
      const cwd = await mkdtemp(join(tmpdir(), "diligent-gemini-resume-"));
      let client: ProtocolTestClient | undefined;
      const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
      // The real SDK sends only to loopback with a synthetic key; responses are fixtures, not model evidence.
      const endpoint = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          requests.push({ path: new URL(request.url).pathname, body: await request.json() });
          return new Response(
            `data: ${JSON.stringify({
              candidates: [
                { content: { role: "model", parts: [{ text: "resumed fixture" }] }, finishReason: "STOP", index: 0 },
              ],
              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
            })}\n\n`,
            { headers: { "Content-Type": "text/event-stream" } },
          );
        },
      });
      try {
        const card = resolveModel({ provider: "gemini", modelId: canonicalId });
        const manager = new ProviderManager({ provider: { gemini: { baseUrl: `${endpoint.url}v1beta` } } });
        manager.setApiKey("gemini", "local-test-key");
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

        // Reproduce an existing pre-migration session without normalizing its saved model or effort.
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
        for (const entry of modelEntries) entry.modelId = legacyId;
        for (const entry of effortEntries) entry.effort = effort;
        const saved = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
        await writeFile(sessionPath, saved);

        client = createProtocolClient(
          createTestServer({
            cwd,
            runtimeToolsConfig: {},
            streamFunction: manager.createProxyStream(),
            // Use a different default so discarding the saved model cannot pass the wire assertion.
            runtimeConfigOverrides: {
              model: resolveModel({
                provider: "gemini",
                modelId: canonicalId === "gemini-3.6-flash" ? "gemini-3.8-flash" : "gemini-3.6-flash",
              }),
              providerManager: manager,
            },
          }),
        );
        await client.request("initialize", { clientName: "test", clientVersion: "0.0.1", protocolVersion: 1 });
        expect(await client.request("thread/resume", { threadId })).toMatchObject({ found: true, threadId });
        const notifications = await client.sendTurnAndWait(threadId, "continue fixture");
        expect(notifications.some((notification) => notification.method === "turn/completed")).toBe(true);
        expect(requests).toHaveLength(1);
        expect(requests[0]?.path).toBe(`/v1beta/models/${canonicalId}:streamGenerateContent`);
        expect(requests[0]?.body.generationConfig).toMatchObject({
          thinkingConfig: {
            thinkingLevel: effort === "xhigh" || effort === "max" ? "high" : effort,
            includeThoughts: true,
          },
        });
        // Resume appends new history; it does not rewrite historical model references.
        expect((await readFile(sessionPath, "utf8")).startsWith(saved)).toBe(true);
      } finally {
        client?.close();
        await endpoint.stop(true);
        await rm(cwd, { recursive: true, force: true });
      }
    });
  }
}
