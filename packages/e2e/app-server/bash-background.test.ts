// @summary Background shell commands through the app-server tool and thread lifecycle

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadReadResponse } from "@diligent/protocol";
import { createPermissionEngine, type PermissionEngine, type StreamFunction } from "@diligent/runtime";
import { createSimpleStream, createToolUseStream, type ToolCallSpec } from "./helpers/fake-stream";
import { createProtocolClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

async function setup(codeMode: "on" | "only" = "on", permissionEngine?: PermissionEngine) {
  const cwd = await mkdtemp(join(tmpdir(), "diligent-background-bash-"));
  const streams = new Map<string, StreamFunction>();
  const server = createTestServer({
    cwd,
    runtimeToolsConfig: { codeMode },
    runtimeConfigOverrides: permissionEngine ? { permissionEngine } : undefined,
    streamFunction: (...args) => {
      const message = args[1].messages.findLast((message) => message.role === "user");
      const stream = typeof message?.content === "string" ? streams.get(message.content) : undefined;
      return (stream ?? createSimpleStream("done"))(...args);
    },
  });
  const client = createProtocolClient(server);
  return {
    server,
    client,
    cwd,
    streams,
    async call(threadId: string, spec: ToolCallSpec) {
      streams.set(spec.id, createToolUseStream([spec], "done"));
      const notifications = await client.sendTurnAndWait(threadId, spec.id);
      const thread = (await client.request("thread/read", { threadId })) as ThreadReadResponse;
      const item = thread.items.findLast((item) => item.type === "toolCall" && item.toolCallId === spec.id);
      if (item?.type !== "toolCall") throw new Error(`No tool result for ${spec.id}`);
      return { item, notifications };
    },
    async close() {
      client.close();
      await server.shutdown();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

function processId(output: string | undefined): string {
  const id = output?.match(/process_id: ([\w-]+)/)?.[1];
  if (!id) throw new Error(`Expected a process ID, got ${output}`);
  return id;
}

test.if(process.platform !== "win32")("background Bash survives turns and mode changes", async () => {
  const app = await setup("only", createPermissionEngine([]));
  const approved: string[] = [];
  app.client.onServerRequest(async (request) => {
    if (request.method !== "approval/request") throw new Error(`Unexpected request ${request.method}`);
    approved.push(request.params.request.toolName);
    return { method: request.method, result: { decision: "once" } };
  });
  try {
    const owner = await app.client.initAndStartThread(app.cwd);
    const started = await app.call(owner, {
      id: "start",
      name: "bash",
      input: {
        command: `exec sh -c 'printf ready; read value; printf "answer:%s" "$value"; read done; printf finished'`,
        yield_time_ms: 0,
      },
    });
    const id = processId(started.item.output);
    expect(started.item.isError).toBeFalsy();

    const { threadId: other } = (await app.client.request("thread/start", { cwd: app.cwd })) as { threadId: string };
    const denied = await app.call(other, {
      id: "other",
      name: "bash_wait",
      input: { process_id: id, terminate: true },
    });
    expect(denied.item.isError).toBe(true);
    expect(denied.item.output).toContain("Unknown process_id");

    await app.client.request("mode/set", { threadId: owner, mode: "execute" });
    const { item: waiting } = await app.call(owner, {
      id: "poll",
      name: "bash_wait",
      input: { process_id: id, yield_time_ms: 350 },
    });
    expect(`${started.item.output}${waiting.output}`.match(/ready/g)).toHaveLength(1);
    expect(waiting.output).toContain("running");

    const { item: received, notifications } = await app.call(owner, {
      id: "send",
      name: "bash_wait",
      input: { process_id: id, input: "hello\n", yield_time_ms: 350 },
    });
    expect(received.isError).toBeFalsy();
    expect(received.output).toContain("answer:hello");
    expect(received.output).not.toContain("ready");
    const events = notifications.flatMap((n) => (n.method === "agent/event" ? [n.params.event] : []));
    const updated = events.findIndex(
      (event) =>
        event.type === "tool_update" && event.toolName === "bash_wait" && event.partialResult === "answer:hello",
    );
    const ended = events.findIndex((event) => event.type === "tool_end" && event.toolName === "bash_wait");
    expect(updated).toBeGreaterThanOrEqual(0);
    expect(ended).toBeGreaterThan(updated);
    const { item: done } = await app.call(owner, {
      id: "finish",
      name: "bash_wait",
      input: { process_id: id, input: "\n", yield_time_ms: 500 },
    });
    expect(done.output).toBe("[Exit code: 0]\nfinished");
    expect(approved).toEqual(["bash", "bash_wait"]);
    const { item: consumed } = await app.call(owner, {
      id: "consumed",
      name: "bash_wait",
      input: { process_id: id, yield_time_ms: 0 },
    });
    expect(consumed.output).toContain("Unknown process_id");
  } finally {
    await app.close();
  }
});

test.if(process.platform !== "win32")("policy denials block background Bash and stdin", async () => {
  const blockedCommand = "printf blocked";
  const stdinRule = "bash_wait:*";
  const app = await setup(
    "on",
    createPermissionEngine([
      { permission: "execute", action: "deny", pattern: blockedCommand },
      { permission: "execute", action: "deny", pattern: stdinRule },
    ]),
  );
  try {
    const threadId = await app.client.initAndStartThread(app.cwd);
    const deniedSpawn = await app.call(threadId, {
      id: "denied-spawn",
      name: "bash",
      input: { command: blockedCommand, yield_time_ms: 0 },
    });
    expect(deniedSpawn.item.output).toContain(`Denied by permission rule "${blockedCommand}"`);
    expect(deniedSpawn.notifications.some((event) => event.method === "turn/completed")).toBe(true);

    const { item: started } = await app.call(threadId, {
      id: "start-for-denied-input",
      name: "bash",
      input: { command: `exec sh -c 'read value; printf "received:%s" "$value"'`, yield_time_ms: 0 },
    });
    const id = processId(started.output);
    const deniedInput = await app.call(threadId, {
      id: "denied-input",
      name: "bash_wait",
      input: { process_id: id, input: "blocked\n" },
    });
    expect(deniedInput.item.output).toContain(`Denied by permission rule "${stdinRule}"`);
    expect(deniedInput.notifications.some((event) => event.method === "turn/completed")).toBe(true);

    const { item: polled } = await app.call(threadId, {
      id: "poll-after-denied-input",
      name: "bash_wait",
      input: { process_id: id, yield_time_ms: 350 },
    });
    expect(polled.output).toBe(`[Process running. process_id: ${id}]`);
  } finally {
    await app.close();
  }
});

test.if(process.platform !== "win32")("bash_wait terminates a yielded process and keeps its final output", async () => {
  const app = await setup();
  try {
    const threadId = await app.client.initAndStartThread(app.cwd);
    const { item } = await app.call(threadId, {
      id: "start-stop",
      name: "bash",
      input: {
        command: `exec sh -c 'trap "printf stopped; exit 0" TERM; echo ready; sleep 30 & wait'`,
        yield_time_ms: 350,
      },
    });
    expect(item.output).toContain("ready");
    const { item: stopped } = await app.call(threadId, {
      id: "stop",
      name: "bash_wait",
      input: { process_id: processId(item.output), terminate: true },
    });
    expect(stopped.isError).toBeFalsy();
    expect(stopped.output).toContain("stopped");
    expect(stopped.output).not.toContain("ready");
  } finally {
    await app.close();
  }
});

test.if(process.platform !== "win32")("thread deletion and server shutdown clean up yielded commands", async () => {
  const app = await setup();
  try {
    const deletedId = await app.client.initAndStartThread(app.cwd);
    const { threadId: shutdownId } = (await app.client.request("thread/start", { cwd: app.cwd })) as {
      threadId: string;
    };
    const start = async (threadId: string, marker: string) => {
      const { item } = await app.call(threadId, {
        id: `start-${marker}`,
        name: "bash",
        input: {
          command: `exec sh -c 'trap "echo stopped > ${marker}; exit 0" TERM; echo ready; sleep 30 & wait'`,
          yield_time_ms: 350,
        },
      });
      expect(item.output).toContain("ready");
    };
    await start(deletedId, "deleted");
    await start(shutdownId, "shutdown");
    await app.client.request("thread/delete", { threadId: deletedId });
    expect(await readFile(join(app.cwd, "deleted"), "utf8")).toBe("stopped\n");
    await app.server.shutdown();
    expect(await readFile(join(app.cwd, "shutdown"), "utf8")).toBe("stopped\n");
  } finally {
    await app.close();
  }
});

test.if(process.platform !== "win32")("child completion stops the child's background command", async () => {
  const app = await setup();
  try {
    const root = await app.client.initAndStartThread(app.cwd);
    app.streams.set(
      "child job",
      createToolUseStream(
        [
          {
            id: "child-shell",
            name: "bash",
            input: {
              command: `exec sh -c 'trap "echo stopped > child-stopped; exit 0" TERM; sleep 30 & wait'`,
              yield_time_ms: 350,
            },
          },
        ],
        "child done",
      ),
    );
    const { item: spawned } = await app.call(root, {
      id: "spawn",
      name: "spawn_agent",
      input: { message: "child job", agent_type: "general", description: "start a background command" },
    });
    expect(spawned.isError).toBeFalsy();
    const { thread_id: child } = JSON.parse(spawned.output ?? "{}");
    expect(typeof child).toBe("string");
    const { item: waited } = await app.call(root, {
      id: "wait-child",
      name: "wait",
      input: { ids: [child] },
    });
    expect(JSON.parse(waited.output ?? "{}")).toMatchObject({ status: { [child]: { kind: "completed" } } });
    expect(await readFile(join(app.cwd, "child-stopped"), "utf8")).toBe("stopped\n");
  } finally {
    await app.close();
  }
});

/** Polls because process death has no event to await; a Linux zombie counts as dead because it cannot run. */
async function waitUntilDead(pid: number): Promise<boolean> {
  for (const deadline = Date.now() + 1000; Date.now() < deadline; await Bun.sleep(25)) {
    try {
      process.kill(pid, 0);
      if (process.platform === "linux" && (await readFile(`/proc/${pid}/stat`, "utf8")).match(/\) Z /)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

test.if(process.platform !== "win32")(
  "a tty background command takes terminal input and its whole group stops with the thread",
  async () => {
    const app = await setup("on", createPermissionEngine([]));
    const approved: string[] = [];
    app.client.onServerRequest(async (request) => {
      if (request.method !== "approval/request") throw new Error(`Unexpected request ${request.method}`);
      approved.push(request.params.request.toolName);
      return { method: request.method, result: { decision: "once" } };
    });
    try {
      const threadId = await app.client.initAndStartThread(app.cwd);
      const { item: started } = await app.call(threadId, {
        id: "start-tty",
        name: "bash",
        input: {
          command: [
            `sh -c 'trap "" TERM HUP; echo $$ > stubborn.pid; exec sleep 30' &`,
            `[ -t 0 ] && printf 'name? '`,
            `read name`,
            String.raw`printf '\033[32mhello %s\033[0m\n' "$name"`,
            `wait`,
          ].join("\n"),
          tty: true,
          yield_time_ms: 350,
        },
      });
      expect(started.output).toContain("name? ");

      const { item: answered } = await app.call(threadId, {
        id: "answer",
        name: "bash_wait",
        input: { process_id: processId(started.output), input: "world\n", yield_time_ms: 350 },
      });
      expect(answered.output).toContain("hello world\n");
      expect(answered.output).not.toContain("\x1b");
      expect(approved).toEqual(["bash", "bash_wait"]);

      const pid = Number(await readFile(join(app.cwd, "stubborn.pid"), "utf8"));
      expect(pid).toBeGreaterThan(0);
      await app.client.request("thread/delete", { threadId });
      expect(await waitUntilDead(pid)).toBe(true);
    } finally {
      await app.close();
    }
  },
);
