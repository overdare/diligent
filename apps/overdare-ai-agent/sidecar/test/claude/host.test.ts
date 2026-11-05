// @summary Loopback terminal authorization and reconnect integration tests.
import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { ClaudeConversation } from "../../src/claude/history";
import { createClaudeTerminalHost } from "../../src/claude/host";
import { ClaudeTerminalSession } from "../../src/claude/session";

const hosts: ReturnType<typeof createClaudeTerminalHost>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});
function hostFixture(
  records: ClaudeConversation[] = [],
  helperArgs: string[] = [],
  list?: () => Promise<ClaudeConversation[]>,
  mode?: "claude" | "shell",
) {
  const session = new ClaudeTerminalSession({
    helperPath: process.execPath,
    helperArgs: [resolve(import.meta.dir, "../fixtures/claude-pty-helper.ts"), ...helperArgs],
    launch: async (conversation) => ({
      program: "fixture",
      args: [],
      cwd: process.cwd(),
      env: {},
      launchDir: "fixture",
      conversationId: conversation?.id,
      cleanup: async () => {},
    }),
  });
  const host = createClaudeTerminalHost({
    mode,
    cwd: process.cwd(),
    studioId: () => "owner",
    webOrigin: "http://127.0.0.1:7777",
    session,
    conversations: list ?? (async () => records),
  });
  hosts.push(host);
  return host;
}
const bootstrapRequest = () => new Request("http://127.0.0.1:7777/claude/bootstrap");

test("plain shell host is independent of Claude history, installation, and the Claude process", async () => {
  const claude = hostFixture();
  const shell = hostFixture(
    [],
    [],
    async () => {
      throw new Error("Shell must not read Claude history");
    },
    "shell",
  );
  const first = await claude.bootstrap(bootstrapRequest()).json();
  const second = await shell.bootstrap(bootstrapRequest()).json();
  expect(first.wsUrl).not.toBe(second.wsUrl);
  expect(first.token).not.toBe(second.token);
  expect(second.unavailable).toBeUndefined();
  const ws = new WebSocket(second.wsUrl, {
    protocols: ["overdare-terminal", second.token],
    headers: { Origin: "http://127.0.0.1:7777" },
  });
  const states: Array<{
    type: string;
    conversations?: unknown[];
    status?: { state: string; conversationId?: string };
  }> = [];
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") states.push(JSON.parse(event.data));
  });
  await new Promise<void>((resolve) => {
    ws.onopen = () => resolve();
  });
  const wait = async (condition: () => boolean) => {
    for (let index = 0; index < 300; index++) {
      if (condition()) return;
      await Bun.sleep(10);
    }
    throw new Error("Shell host timed out");
  };
  try {
    ws.send(JSON.stringify({ type: "conversations" }));
    await wait(() => states.some((state) => state.type === "conversations"));
    expect(states.find((state) => state.type === "conversations")?.conversations).toEqual([]);
    ws.send(JSON.stringify({ type: "start", cols: 80, rows: 24 }));
    await wait(() => shell.session.snapshot().state === "running");
    expect(shell.session.snapshot().conversationId).toBeUndefined();
    expect(claude.session.snapshot().state).toBe("idle");
    ws.send(JSON.stringify({ type: "stop" }));
    await wait(() => shell.session.snapshot().state === "exited");
    expect(claude.session.snapshot().state).toBe("idle");
  } finally {
    ws.close();
  }
});

test("bootstrap refuses foreign origins, cross-site requests, and rebinding hosts", async () => {
  const host = hostFixture();
  expect(host.bootstrap(new Request("http://evil.test:7777/claude/bootstrap")).status).toBe(403);
  expect(host.bootstrap(new Request(bootstrapRequest(), { headers: { origin: "https://evil.test" } })).status).toBe(
    403,
  );
  expect(host.bootstrap(new Request(bootstrapRequest(), { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(
    403,
  );
  const response = host.bootstrap(bootstrapRequest());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const { wsUrl, token } = await response.json();
  expect((await fetch(wsUrl.replace("ws:", "http:"))).status).toBe(403);
  expect(
    (
      await fetch(wsUrl.replace("ws:", "http:"), {
        headers: { origin: "https://evil.test", "sec-websocket-protocol": `overdare-terminal, ${token}` },
      })
    ).status,
  ).toBe(403);
});

test("WebSocket stop cancels startup and invalidates selections waiting for history", async () => {
  for (const delayedHistory of [false, true]) {
    let release!: () => void;
    let reading = false;
    const barrier = new Promise<ClaudeConversation[]>((resolve) => {
      release = () => resolve([]);
    });
    const host = hostFixture([], ["--wait-for-stop"], async () => {
      reading = true;
      return delayedHistory ? barrier : [];
    });
    let output = "";
    host.session.subscribe((event) => {
      if (event instanceof Uint8Array) output += new TextDecoder().decode(event);
    });
    const { wsUrl, token } = await host.bootstrap(bootstrapRequest()).json();
    const ws = new WebSocket(wsUrl, {
      protocols: ["overdare-terminal", token],
      headers: { Origin: "http://127.0.0.1:7777" },
    });
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });
    const wait = async (condition: () => boolean) => {
      for (let index = 0; index < 150; index++) {
        if (condition()) return;
        await Bun.sleep(10);
      }
      throw new Error("Stop did not interrupt startup");
    };
    try {
      ws.send(JSON.stringify({ type: "start", cols: 90, rows: 25 }));
      await wait(() => (delayedHistory ? reading : output.includes("WAITING_FOR_STOP")));
      if (delayedHistory) ws.send(JSON.stringify({ type: "select", conversation: "new", cols: 90, rows: 25 }));
      ws.send(JSON.stringify({ type: "stop" }));
      await wait(() => host.session.snapshot().state === "exited");
      release();
      await Bun.sleep(100);
      expect(host.session.snapshot().state).toBe("exited");
      if (delayedHistory) expect(host.session.snapshot().id).toBeNull();
    } finally {
      release();
      ws.close();
    }
  }
}, 8000);

test("latest selection, scoped list and serialized switches preserve the live process on invalid selection", async () => {
  const records = [
    { id: "34b6d3c0-b5b3-4d88-a880-c5ea8cd55d51", title: "Latest", updatedAt: 200 },
    { id: "54b6d3c0-b5b3-4d88-a880-c5ea8cd55d51", title: "Older", updatedAt: 100 },
  ];
  const host = hostFixture(records);
  const { wsUrl, token } = await host.bootstrap(bootstrapRequest()).json();
  const ws = new WebSocket(wsUrl, {
    protocols: ["overdare-terminal", token],
    headers: { Origin: "http://127.0.0.1:7777" },
  });
  const messages: Array<{ type: string; conversations?: ClaudeConversation[] }> = [];
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") messages.push(JSON.parse(event.data));
  });
  await new Promise<void>((resolve) => {
    ws.onopen = () => resolve();
  });
  const wait = async (condition: () => boolean) => {
    for (let index = 0; index < 500; index++) {
      if (condition()) return;
      await Bun.sleep(10);
    }
    throw new Error("Selection condition timeout");
  };
  const send = (type: string, conversation?: string) =>
    ws.send(JSON.stringify({ type, conversation, cols: 90, rows: 25 }));
  try {
    send("conversations");
    await wait(() => messages.some((item) => item.type === "conversations"));
    expect(messages.find((item) => item.type === "conversations")?.conversations).toEqual(records);
    send("start");
    send("start");
    await wait(() => host.session.snapshot().state === "running");
    const first = host.session.snapshot().id;
    expect(host.session.snapshot().conversationId).toBe(records[0]!.id);
    send("select", "74b6d3c0-b5b3-4d88-a880-c5ea8cd55d51");
    await wait(() => messages.some((item) => item.type === "error"));
    expect(host.session.snapshot().id).toBe(first);
    expect(host.session.snapshot().state).toBe("running");
    send("select", records[1]!.id);
    await wait(
      () => host.session.snapshot().state === "running" && host.session.snapshot().conversationId === records[1]!.id,
    );
    expect(host.session.snapshot().id).not.toBe(first);
    const replacementIds = new Set<string>();
    const detach = host.session.subscribe((event) => {
      if (!(event instanceof Uint8Array) && event.type === "status" && event.status.state === "running")
        replacementIds.add(event.status.id!);
    });
    await wait(() => replacementIds.size === 1);
    send("select", "new");
    send("select", records[0]!.id);
    await wait(
      () => host.session.snapshot().state === "running" && host.session.snapshot().conversationId === records[0]!.id,
    );
    await Bun.sleep(30);
    expect(replacementIds.size).toBe(3);
    detach();
  } finally {
    ws.close();
  }
}, 15000);

test("authenticated socket can start, echo Unicode, reconnect to the same process and stop", async () => {
  const host = hostFixture();
  const { wsUrl, token } = await host.bootstrap(bootstrapRequest()).json();
  const connect = async () => {
    const ws = new WebSocket(wsUrl, {
      protocols: ["overdare-terminal", token],
      headers: { Origin: "http://127.0.0.1:7777" },
    });
    const messages: Array<string | Uint8Array> = [];
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (event) =>
      messages.push(typeof event.data === "string" ? event.data : new Uint8Array(event.data)),
    );
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Socket connection failed"));
    });
    return { ws, messages };
  };
  const wait = async (condition: () => boolean) => {
    for (let i = 0; i < 300; i++) {
      if (condition()) return;
      await Bun.sleep(10);
    }
    throw new Error("Socket condition timeout");
  };
  const first = await connect();
  try {
    first.ws.send(JSON.stringify({ type: "start", cols: 90, rows: 25 }));
    await wait(() => host.session.snapshot().state === "running");
    const id = host.session.snapshot().id;
    first.ws.send(JSON.stringify({ type: "input", id, data: "Studio 한글\r\n" }));
    await wait(() =>
      first.messages.some(
        (message) => message instanceof Uint8Array && new TextDecoder().decode(message).includes("Studio 한글"),
      ),
    );
    first.ws.close();
    await Bun.sleep(20);
    expect(host.session.snapshot().state).toBe("running");
    const second = await connect();
    try {
      await wait(() =>
        second.messages.some(
          (message) => message instanceof Uint8Array && new TextDecoder().decode(message).includes("Studio 한글"),
        ),
      );
      expect(host.session.snapshot().id).toBe(id);
      second.ws.send(JSON.stringify({ type: "stop" }));
      await wait(() => host.session.snapshot().state === "exited");
    } finally {
      second.ws.close();
    }
  } finally {
    first.ws.close();
  }
});

test("one client owns resizing and all readers receive authoritative dimensions", async () => {
  const host = hostFixture();
  const { wsUrl, token } = await host.bootstrap(bootstrapRequest()).json();
  const wait = async (condition: () => boolean) => {
    for (let index = 0; index < 300; index++) {
      if (condition()) return;
      await Bun.sleep(10);
    }
    throw new Error("Terminal ownership condition timed out");
  };
  const connect = async () => {
    const ws = new WebSocket(wsUrl, {
      protocols: ["overdare-terminal", token],
      headers: { Origin: "http://127.0.0.1:7777" },
    });
    const messages: Array<{ type: string; resizeOwner?: boolean; cols?: number; rows?: number }> = [];
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") messages.push(JSON.parse(event.data));
    });
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });
    const owner = () => messages.filter((event) => event.type === "control").at(-1)?.resizeOwner;
    return { ws, messages, owner };
  };
  const first = await connect();
  const second = await connect();
  const resize = (client: typeof first, cols: number, rows: number) =>
    client.ws.send(JSON.stringify({ type: "resize", id: host.session.snapshot().id, cols, rows }));
  try {
    await wait(() => first.owner() === true && second.owner() === false);
    first.ws.send(JSON.stringify({ type: "start", cols: 80, rows: 24 }));
    await wait(() => host.session.snapshot().state === "running");
    resize(second, 40, 10);
    await Bun.sleep(50);
    expect(first.messages.some((event) => event.type === "resize" && event.cols === 40)).toBe(false);
    second.ws.send(JSON.stringify({ type: "claim" }));
    await wait(() => first.owner() === false && second.owner() === true);
    resize(second, 40, 10);
    await wait(() =>
      [first, second].every((client) =>
        client.messages.some((event) => event.type === "resize" && event.cols === 40 && event.rows === 10),
      ),
    );
    resize(first, 100, 30);
    await Bun.sleep(50);
    expect(second.messages.some((event) => event.type === "resize" && event.cols === 100)).toBe(false);
    first.ws.send(JSON.stringify({ type: "select", conversation: "new", cols: 80, rows: 24 }));
    await wait(() => first.owner() === true && second.owner() === false);
    await wait(() => first.messages.filter((event) => event.type === "reset" && event.cols === 80).length >= 2);
    first.ws.close();
    await wait(() => second.owner() === true);
  } finally {
    first.ws.close();
    second.ws.close();
  }
}, 10000);
