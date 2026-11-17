// @summary App-server e2e tests for permission-rule denials that continue the turn and the consecutive-denial breaker

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentEvent,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  type DiligentServerNotification,
} from "@diligent/protocol";
import { createPermissionEngine } from "@diligent/runtime";
import { createToolRoundsStream, type ToolCallSpec } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

let tmpDir = "";
let client: ProtocolTestClient | undefined;

afterEach(async () => {
  client?.close();
  client = undefined;
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  tmpDir = "";
});

function agentEvents(notifications: DiligentServerNotification[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const notification of notifications) {
    if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.AGENT_EVENT)
      events.push(notification.params.event);
  }
  return events;
}

function toolOutputs(notifications: DiligentServerNotification[]): Map<string, string> {
  const outputs = new Map<string, string>();
  for (const event of agentEvents(notifications)) {
    if (event.type === "tool_end") outputs.set(event.toolCallId, event.output);
  }
  return outputs;
}

function assistantSaid(notifications: DiligentServerNotification[], text: string): boolean {
  return agentEvents(notifications).some(
    (event) =>
      event.type === "message_end" &&
      event.message.content.some((block) => block.type === "text" && block.text === text),
  );
}

function deniedRound(index: number): ToolCallSpec[] {
  return [{ id: `tc-deny-${index}`, name: "bash", input: { command: `rm -rf build-${index}` } }];
}

describe("permission-rule denials", () => {
  test("a deny rule tells the model which rule blocked the call and the turn continues", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-policy-deny-"));
    const server = createTestServer({
      cwd: tmpDir,
      runtimeToolsConfig: { builtin: { bash: true } },
      runtimeConfigOverrides: {
        permissionEngine: createPermissionEngine([{ permission: "execute", pattern: "rm **", action: "deny" }]),
      },
      streamFunction: createToolRoundsStream([deniedRound(1)], "continued without deleting"),
    });
    client = createProtocolClient(server);
    let approvalRequests = 0;
    client.onServerRequest(async (request) => {
      approvalRequests += 1;
      throw new Error(`unexpected server request ${request.method}`);
    });

    const threadId = await client.initAndStartThread(tmpDir);
    const notifications = await client.sendTurnAndWait(threadId, "clean the build output");

    expect(approvalRequests).toBe(0);
    const output = toolOutputs(notifications).get("tc-deny-1") ?? "";
    expect(output).toContain('Denied by permission rule "rm **"');
    expect(output).not.toContain("Rejected by user");
    expect(assistantSaid(notifications, "continued without deleting")).toBe(true);
  });

  test("consecutive denials add an escalation and end the turn at twice the threshold", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-denial-breaker-"));
    const threshold = 2;
    const server = createTestServer({
      cwd: tmpDir,
      runtimeToolsConfig: { builtin: { bash: true } },
      runtimeConfigOverrides: {
        permissionEngine: createPermissionEngine([{ permission: "execute", pattern: "rm **", action: "deny" }]),
        denialBreakerThreshold: threshold,
      },
      streamFunction: createToolRoundsStream(
        [deniedRound(1), deniedRound(2), deniedRound(3), deniedRound(4), deniedRound(5)],
        "should not be reached",
      ),
    });
    client = createProtocolClient(server);

    const threadId = await client.initAndStartThread(tmpDir);
    const notifications = await client.sendTurnAndWait(threadId, "clean the build output");
    const outputs = toolOutputs(notifications);

    expect(outputs.get("tc-deny-1")).not.toContain("consecutive");
    expect(outputs.get("tc-deny-2")).toContain(`${threshold} consecutive operations were denied`);
    expect(outputs.get("tc-deny-4")).toContain("This turn is stopping");
    expect(outputs.has("tc-deny-5")).toBe(false);
    expect(assistantSaid(notifications, "should not be reached")).toBe(false);
  });
});
