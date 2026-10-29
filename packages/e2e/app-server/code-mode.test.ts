// @summary App-server e2e tests for code mode: exec-only tool exposure, nested tool events, background dispatch, history

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@diligent/core/message-contract";
import type { ProviderEvent, ProviderResult } from "@diligent/core/provider-contract";
import { type AgentEvent, DILIGENT_SERVER_NOTIFICATION_METHODS, type ThreadReadResponse } from "@diligent/protocol";
import { EventStream, type StreamFunction } from "@diligent/runtime";
import { createToolUseStream } from "./helpers/fake-stream";
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

function agentEvents(notifications: ProtocolTestClient["notifications"]): AgentEvent[] {
  return notifications
    .filter((notification) => notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.AGENT_EVENT)
    .map((notification) => (notification.params as { event: AgentEvent }).event);
}

describe("code mode", () => {
  test.each([undefined, "only"] as const)("exec runs nested calls with code mode %s", async (codeMode) => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-code-mode-"));
    const notePath = join(tmpDir, "note.txt");
    await writeFile(notePath, "code-mode-marker\n");

    const requests: Array<{ toolNames: string[]; messages: Message[] }> = [];
    const inner = createToolUseStream(
      [
        {
          id: "tc-exec",
          name: "exec",
          input: {
            code: `const content = await tools.read({ file_path: ${JSON.stringify(notePath)} });\ntext(content.includes("code-mode-marker") ? "found" : "missing");`,
          },
        },
      ],
      "done",
    );
    const streamFunction: StreamFunction = (model, context, options) => {
      requests.push({
        toolNames: context.tools.map((tool) => ("name" in tool ? tool.name : tool.kind)),
        messages: [...context.messages],
      });
      return inner(model, context, options);
    };

    const server = createTestServer({ cwd: tmpDir, runtimeToolsConfig: { codeMode }, streamFunction });
    client = createProtocolClient(server);
    const threadId = await client.initAndStartThread(tmpDir);
    const notifications = await client.sendTurnAndWait(threadId, "read the note through exec");

    const firstToolNames = requests[0]?.toolNames ?? [];
    expect(firstToolNames).toContain("exec");
    expect(firstToolNames).toContain("exec_wait");
    expect(firstToolNames.includes("read")).toBe(codeMode !== "only");
    expect(firstToolNames).toContain("request_user_input");

    const events = agentEvents(notifications);
    const nestedStart = events.find((event) => event.type === "tool_start" && event.toolName === "read");
    expect(nestedStart).toMatchObject({ parentToolCallId: "tc-exec" });
    const execEnd = events.find((event) => event.type === "tool_end" && event.toolCallId === "tc-exec");
    expect(execEnd?.type === "tool_end" ? execEnd.output : "").toBe("Script completed\nfound");

    // Nested calls are not conversation messages: the model only sees the exec result.
    const toolResults = (requests[1]?.messages ?? []).filter((message) => message.role === "tool_result");
    expect(toolResults.map((message) => message.toolCallId)).toEqual(["tc-exec"]);

    const read = (await client.request("thread/read", { threadId })) as ThreadReadResponse;
    const nestedItem = read.items.find((item) => item.type === "toolCall" && item.toolName === "read");
    expect(nestedItem).toMatchObject({ parentToolCallId: "tc-exec", isError: false });
    expect(nestedItem?.type === "toolCall" ? nestedItem.output : "").toContain("code-mode-marker");
  });

  test("a yielded script keeps calling tools before the model waits, and history groups them under exec", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-code-mode-"));
    const markerPath = join(tmpDir, "marker.txt");
    const execStream = createToolUseStream(
      [
        {
          id: "tc-exec",
          name: "exec",
          input: {
            code: `yield_control();\nawait tools.bash({ command: ${JSON.stringify(`printf bg > ${JSON.stringify(markerPath)}`)} });\ntext("written");`,
          },
        },
      ],
      "unused",
    );
    const waitStream = createToolUseStream([{ id: "tc-wait", name: "exec_wait", input: { cell_id: "1" } }], "done");
    let requestCount = 0;
    const streamFunction: StreamFunction = (model, context, options) => {
      const request = requestCount++;
      if (request === 0) return execStream(model, context, options);
      if (request > 1) return waitStream(model, context, options);
      // The model's next response is held until the yielded script's bash call has finished, so the
      // call can only have run in the background, not under exec_wait.
      const gated = new EventStream<ProviderEvent, ProviderResult>(
        (event) => event.type === "done",
        (event) => ({ message: (event as Extract<ProviderEvent, { type: "done" }>).message }),
      );
      void (async () => {
        await client!.waitFor((notification) => {
          const event = (notification.params as { event?: AgentEvent }).event;
          return event?.type === "tool_end" && event.toolCallId === "tc-exec#1";
        });
        for await (const event of waitStream(model, context, options) as AsyncIterable<ProviderEvent>) {
          gated.push(event);
        }
      })();
      return gated as never;
    };

    const server = createTestServer({ cwd: tmpDir, runtimeToolsConfig: {}, streamFunction });
    client = createProtocolClient(server);
    const threadId = await client.initAndStartThread(tmpDir);
    const notifications = await client.sendTurnAndWait(threadId, "write the marker in the background");

    expect(await Bun.file(markerPath).text()).toBe("bg");
    const events = agentEvents(notifications);
    const order = events.flatMap((event) =>
      event.type === "tool_start" || event.type === "tool_end" ? [`${event.type}:${event.toolCallId}`] : [],
    );
    expect(order).toEqual([
      "tool_start:tc-exec",
      "tool_end:tc-exec",
      "tool_start:tc-exec#1",
      "tool_end:tc-exec#1",
      "tool_start:tc-wait",
      "tool_end:tc-wait",
    ]);
    const waitEnd = events.find((event) => event.type === "tool_end" && event.toolCallId === "tc-wait");
    expect(waitEnd?.type === "tool_end" ? waitEnd.output : "").toBe("Script completed\nwritten");

    const read = (await client.request("thread/read", { threadId })) as ThreadReadResponse;
    const tools = read.items.flatMap((item) =>
      item.type === "toolCall" && item.output !== undefined
        ? [`${item.toolCallId}<${item.parentToolCallId ?? ""}`]
        : [],
    );
    expect(tools).toEqual(["tc-exec<", "tc-exec#1<tc-exec", "tc-wait<"]);
  });
});
