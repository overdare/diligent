// @summary Executes the shipped skill examples through the actual authenticated report tool.
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createGatewayToolProvider } from "../src/tools/gateway";
import type { AgentReportWire } from "../src/tools/gateway/agent-report-client";

const realFetch = globalThis.fetch;
const realToken = process.env.DILIGENT_GATEWAY_TOKEN;
const realUrl = process.env.DILIGENT_GATEWAY_URL;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.DILIGENT_GATEWAY_TOKEN;
  else process.env.DILIGENT_GATEWAY_TOKEN = realToken;
  if (realUrl === undefined) delete process.env.DILIGENT_GATEWAY_URL;
  else process.env.DILIGENT_GATEWAY_URL = realUrl;
});

test("the shipped issue-report examples submit each report kind through the real tool", async () => {
  const skill = readFileSync(new URL("../../bootstrap/skills/session-issue-report/SKILL.md", import.meta.url), "utf8");
  const examples = [...skill.matchAll(/^```json\s*\n([\s\S]*?)^```/gm)].map((match) => JSON.parse(match[1] ?? ""));
  expect(new Set(examples.map((example) => example.kind))).toEqual(
    new Set(["agent_failure", "studio_bug", "feature_request"]),
  );
  process.env.DILIGENT_GATEWAY_TOKEN = "synthetic-token";
  process.env.DILIGENT_GATEWAY_URL = "https://gateway.example";
  const posted: AgentReportWire[] = [];
  globalThis.fetch = (async (_input, init) => {
    posted.push(JSON.parse(String(init?.body)));
    return Response.json({
      report_id: 1,
      reported_at: "2026-10-14T01:00:00Z",
      stored: true,
      notified: false,
      reason: null,
    });
  }) as typeof fetch;
  const provider = createGatewayToolProvider({ cwd: "/workspace", projectId: "p", canTransmitRecords: () => true });
  const tool = (await provider.createTools({ cwd: "/workspace" })).find((item) => item.name === "agent_report");
  if (!tool) throw new Error("agent_report tool missing");
  for (const [index, example] of examples.entries()) {
    const args = tool.parameters.parse(example);
    const result = await tool.execute(args, {
      sessionId: "s",
      toolCallId: "call-" + index,
      signal: new AbortController().signal,
      abort: () => {},
    });
    expect(result.output).toContain("Report saved");
    expect(posted[index]?.kind).toBe(example.kind);
    expect(posted[index]?.payload.title).toBe(example.payload.title);
    expect(posted[index]?.session_id).toBe("s");
  }
});
