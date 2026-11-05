// @summary Isolated attachment relay tests; no live Studio, Claude process, or user conversation is accessed.
import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createAttachedTerminalRelay } from "../fixtures/terminal-ime-lab/relay";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const webOrigin = "http://127.0.0.1:7789";
const request = (headers?: HeadersInit) => new Request(`${webOrigin}/claude/bootstrap`, { headers });
const until = async (condition: () => boolean) => {
  for (let index = 0; index < 200; index++) {
    if (condition()) return;
    await Bun.sleep(10);
  }
  throw new Error("Relay condition timed out");
};
function sourceFixture(options: { wsUrl?: string; redirect?: string; handshakeDelay?: number } = {}) {
  const token = "a".repeat(64);
  const status = { id: "existing-session", state: "running", conversationId: "existing-conversation" };
  const peers = new Set<ServerWebSocket<unknown>>();
  const messages: unknown[] = [];
  const handshake: Array<{ origin: string | null; protocols: string | null }> = [];
  const binary = new Uint8Array([0, 255, 27, 91, 50, 74, 237, 149, 156]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/claude/bootstrap") {
        if (options.redirect) return Response.redirect(options.redirect);
        return Response.json({ wsUrl: options.wsUrl ?? `ws://127.0.0.1:${server.port}/terminal`, token, status });
      }
      if (url.pathname === "/terminal") {
        handshake.push({ origin: req.headers.get("origin"), protocols: req.headers.get("sec-websocket-protocol") });
        if (
          req.headers.get("origin") !== `http://127.0.0.1:${server.port}` ||
          req.headers.get("sec-websocket-protocol") !== `overdare-terminal, ${token}`
        )
          return new Response("Forbidden", { status: 403 });
        if (options.handshakeDelay)
          return Bun.sleep(options.handshakeDelay).then(() => {
            if (req.signal.aborted) return new Response(null, { status: 499 });
            if (server.upgrade(req, { headers: { "Sec-WebSocket-Protocol": "overdare-terminal" } })) return;
            return new Response("Not found", { status: 404 });
          });
        if (server.upgrade(req, { headers: { "Sec-WebSocket-Protocol": "overdare-terminal" } })) return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        peers.add(ws);
        ws.send(JSON.stringify({ type: "reset", cols: 80, rows: 24 }));
        ws.send(binary);
        ws.send(JSON.stringify({ type: "status", status }));
        ws.send(JSON.stringify({ type: "control", resizeOwner: true }));
      },
      message(ws, raw) {
        const message = JSON.parse(String(raw));
        messages.push(message);
        if (message.type === "input") ws.send(new TextEncoder().encode(message.data));
        if (message.type === "resize")
          ws.send(JSON.stringify({ type: "resize", cols: message.cols, rows: message.rows }));
        if (message.type === "stop") status.state = "exited";
      },
      close(ws) {
        peers.delete(ws);
      },
    },
  });
  cleanup.push(() => server.stop(true));
  return { origin: `http://127.0.0.1:${server.port}`, token, status, peers, messages, handshake, binary };
}
async function relayFixture(source = sourceFixture()) {
  const relay = await createAttachedTerminalRelay({ sourceOrigin: source.origin, webOrigin });
  cleanup.push(() => relay.close());
  const bootstrap = await relay.bootstrap(request()).json();
  return { source, relay, bootstrap };
}
async function connect(bootstrap: { wsUrl: string; token: string }) {
  const WebSocketClient = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => WebSocket;
  const ws = new WebSocketClient(bootstrap.wsUrl, {
    protocols: ["overdare-terminal", bootstrap.token],
    headers: { Origin: webOrigin },
  });
  ws.binaryType = "arraybuffer";
  const messages: Array<Record<string, unknown> | Uint8Array> = [];
  ws.addEventListener("message", (event) =>
    messages.push(typeof event.data === "string" ? JSON.parse(event.data) : new Uint8Array(event.data)),
  );
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("Relay connection failed"));
  });
  cleanup.push(() => ws.close());
  return { ws, messages };
}

test("attachment forwards exact bytes and allowed controls without owning the source lifecycle", async () => {
  const { source, relay, bootstrap } = await relayFixture();
  expect(bootstrap.status).toEqual(source.status);
  expect(bootstrap.token).not.toBe(source.token);
  expect(relay.bootstrap(request()).headers.get("cache-control")).toBe("no-store");
  const first = await connect(bootstrap);
  await until(() => first.messages.some((message) => !(message instanceof Uint8Array) && message.type === "control"));
  expect(first.messages.find((message) => message instanceof Uint8Array)).toEqual(source.binary);
  expect(source.handshake[0]).toEqual({ origin: source.origin, protocols: `overdare-terminal, ${source.token}` });
  first.ws.send(JSON.stringify({ type: "input", id: source.status.id, data: "한글", ignored: "discard" }));
  first.ws.send(JSON.stringify({ type: "resize", id: source.status.id, cols: 91, rows: 31, ignored: true }));
  await until(() => first.messages.some((message) => !(message instanceof Uint8Array) && message.type === "resize"));
  expect(source.messages).toEqual([
    { type: "input", id: source.status.id, data: "한글" },
    { type: "resize", id: source.status.id, cols: 91, rows: 31 },
  ]);
  first.ws.close();
  await until(() => source.peers.size === 0);
  expect(source.status.state).toBe("running");
  await connect(bootstrap);
  await until(() => source.peers.size === 1);
  await relay.close();
  await until(() => source.peers.size === 0);
  expect((await (await fetch(`${source.origin}/claude/bootstrap`)).json()).status).toEqual(source.status);
  expect(source.messages.some((message) => (message as { type: string }).type === "stop")).toBe(false);
});

test("attachment blocks lifecycle/history/claim and malformed input before the source", async () => {
  const { source, bootstrap } = await relayFixture();
  const { ws, messages } = await connect(bootstrap);
  const forbidden = ["start", "select", "stop", "conversations", "claim"].map((type) => ({ type }));
  const invalid = [
    { type: "input", id: source.status.id, data: "한".repeat(12000) },
    { type: "input", data: "missing id" },
    { type: "resize", id: source.status.id, cols: 0, rows: 24 },
    { type: "resize", id: source.status.id, cols: 80, rows: 301 },
  ];
  for (const message of [...forbidden, ...invalid]) ws.send(JSON.stringify(message));
  await until(
    () =>
      messages.filter((message) => !(message instanceof Uint8Array) && message.type === "error").length ===
      forbidden.length + invalid.length,
  );
  expect(source.messages).toEqual([]);
  expect(source.status.state).toBe("running");
  ws.send(JSON.stringify({ type: "input", id: source.status.id, data: "still attached" }));
  await until(() => source.messages.length === 1);
});

test("relay token and Origin protect both bootstrap and socket attachment", async () => {
  const { source, relay, bootstrap } = await relayFixture();
  expect(relay.bootstrap(new Request("http://evil.test/claude/bootstrap")).status).toBe(403);
  expect(relay.bootstrap(request({ origin: "https://evil.test" })).status).toBe(403);
  expect(relay.bootstrap(request({ "sec-fetch-site": "cross-site" })).status).toBe(403);
  for (const [origin, token] of [
    ["https://evil.test", bootstrap.token],
    [webOrigin, source.token],
  ]) {
    const response = await fetch(bootstrap.wsUrl.replace("ws:", "http:"), {
      headers: { Origin: origin, "Sec-WebSocket-Protocol": `overdare-terminal, ${token}` },
    });
    expect(response.status).toBe(403);
  }
  expect(source.handshake).toEqual([]);
});

test("source bootstrap cannot redirect or return a non-loopback WebSocket", async () => {
  await expect(createAttachedTerminalRelay({ sourceOrigin: "http://localhost:11000", webOrigin })).rejects.toThrow();
  await expect(createAttachedTerminalRelay({ sourceOrigin: "https://127.0.0.1:11000", webOrigin })).rejects.toThrow();
  const remote = sourceFixture({ wsUrl: "ws://example.com/terminal" });
  await expect(createAttachedTerminalRelay({ sourceOrigin: remote.origin, webOrigin })).rejects.toThrow();
  const redirect = sourceFixture({ redirect: "http://example.com/claude/bootstrap" });
  await expect(createAttachedTerminalRelay({ sourceOrigin: redirect.origin, webOrigin })).rejects.toThrow();
});

test("oversized source output closes the relay connection without stopping the source", async () => {
  const { source, bootstrap } = await relayFixture();
  const { ws } = await connect(bootstrap);
  await until(() => source.peers.size === 1);
  const closed = new Promise<number>((resolve) =>
    ws.addEventListener("close", (event) => resolve(event.code), { once: true }),
  );
  [...source.peers][0]!.send(new Uint8Array(1024 * 1024 + 1));
  expect(await closed).toBe(1009);
  await until(() => source.peers.size === 0);
  expect(source.status.state).toBe("running");
});

test("input queued before the source handshake is bounded and disposed with the connection", async () => {
  const source = sourceFixture({ handshakeDelay: 300 });
  const { relay, bootstrap } = await relayFixture(source);
  const { ws } = await connect(bootstrap);
  const closed = new Promise<number>((resolve) =>
    ws.addEventListener("close", (event) => resolve(event.code), { once: true }),
  );
  for (let index = 0; index < 3; index++)
    ws.send(JSON.stringify({ type: "input", id: source.status.id, data: "x".repeat(30 * 1024) }));
  expect(await closed).toBe(1013);
  await relay.close();
  await Bun.sleep(350);
  expect(source.messages).toEqual([]);
  expect(source.peers.size).toBe(0);
  expect(source.status.state).toBe("running");
});
