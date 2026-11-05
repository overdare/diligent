// @summary Bounded loopback attachment relay for comparing the lab UI with an existing terminal process.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ServerWebSocket } from "bun";
import { validTerminalSize } from "../../../src/claude/session";

interface RelayOptions {
  sourceOrigin: string;
  webOrigin: string;
}
type UpstreamSocket = WebSocket & { terminate(): void };
const WebSocketClient = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => UpstreamSocket;
interface Peer {
  finished?: boolean;
  upstream?: UpstreamSocket;
  pending: string[];
  pendingBytes: number;
  timer?: ReturnType<typeof setTimeout>;
}
const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

function origin(value: string, source: boolean): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.hostname !== "127.0.0.1" && (source || url.hostname !== "localhost"))
  )
    throw new Error("The terminal relay requires a loopback HTTP origin; the source must use 127.0.0.1.");
  return url.origin;
}

async function readBootstrap(sourceOrigin: string) {
  const response = await fetch(`${sourceOrigin}/claude/bootstrap`, {
    headers: { Origin: sourceOrigin },
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok || !response.body) throw new Error("Cannot read the source terminal bootstrap.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > MAX_CONTROL_BYTES) {
      await reader.cancel();
      throw new Error("Source terminal bootstrap is too large.");
    }
    chunks.push(chunk.value);
  }
  let value: { wsUrl?: unknown; token?: unknown; status?: unknown; unavailable?: unknown };
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Invalid source terminal bootstrap.");
  }
  if (
    !value ||
    typeof value.wsUrl !== "string" ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.token) ||
    !value.status ||
    typeof value.status !== "object"
  )
    throw new Error("Invalid source terminal bootstrap.");
  const socket = new URL(value.wsUrl);
  if (
    socket.protocol !== "ws:" ||
    socket.hostname !== "127.0.0.1" ||
    socket.pathname !== "/terminal" ||
    socket.username ||
    socket.password ||
    socket.search ||
    socket.hash
  )
    throw new Error("The source terminal WebSocket must be a 127.0.0.1 terminal endpoint.");
  return {
    wsUrl: socket.href,
    token: value.token,
    status: value.status,
    unavailable: typeof value.unavailable === "string" ? value.unavailable : undefined,
  };
}

export async function createAttachedTerminalRelay(options: RelayOptions) {
  const sourceOrigin = origin(options.sourceOrigin, true);
  const webOrigin = origin(options.webOrigin, false);
  const source = await readBootstrap(sourceOrigin);
  const token = randomBytes(32).toString("hex");
  let status = source.status;
  let closing: Promise<void> | undefined;
  const clients = new Set<ServerWebSocket<Peer>>();
  const upstreams = new Set<UpstreamSocket>();
  const authorized = (request: Request) => {
    const protocols = request.headers
      .get("sec-websocket-protocol")
      ?.split(",")
      .map((part) => part.trim());
    return (
      request.headers.get("origin") === webOrigin &&
      protocols?.length === 2 &&
      protocols[0] === "overdare-terminal" &&
      /^[a-f0-9]{64}$/.test(protocols[1]!) &&
      timingSafeEqual(Buffer.from(protocols[1]!), Buffer.from(token))
    );
  };
  const finish = (ws: ServerWebSocket<Peer>, code: number, reason: string) => {
    if (ws.data.finished) return;
    ws.data.finished = true;
    clearTimeout(ws.data.timer);
    ws.data.pending = [];
    ws.data.pendingBytes = 0;
    ws.close(code, reason);
    if (ws.data.upstream) {
      upstreams.delete(ws.data.upstream);
      ws.data.upstream.terminate();
    }
  };
  const send = (ws: ServerWebSocket<Peer>, data: string | Uint8Array) => {
    if (ws.data.finished) return;
    if (ws.send(data) === 0 || ws.getBufferedAmount() > MAX_OUTPUT_BYTES)
      finish(ws, 1013, "Terminal reader is behind. Reconnect to recover output.");
  };
  const forward = (ws: ServerWebSocket<Peer>, message: string) => {
    if (ws.data.finished) return;
    const upstream = ws.data.upstream;
    const bytes = Buffer.byteLength(message);
    if (upstream?.readyState === WebSocket.OPEN) {
      if (upstream.bufferedAmount + bytes > MAX_CONTROL_BYTES) {
        finish(ws, 1013, "Terminal input is busy.");
        return;
      }
      upstream.send(message);
    } else if (upstream?.readyState === WebSocket.CONNECTING) {
      if (ws.data.pendingBytes + bytes > MAX_CONTROL_BYTES) {
        finish(ws, 1013, "Terminal input is busy.");
        return;
      }
      ws.data.pending.push(message);
      ws.data.pendingBytes += bytes;
    } else finish(ws, 1011, "Source terminal is disconnected.");
  };
  const server = Bun.serve<Peer>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url);
      if (
        closing ||
        url.origin !== `http://127.0.0.1:${server.port}` ||
        url.pathname !== "/terminal" ||
        !authorized(request)
      )
        return new Response("Forbidden", { status: 403 });
      if (clients.size >= 4) return new Response("Too many terminal readers", { status: 503 });
      if (
        server.upgrade(request, {
          data: { pending: [], pendingBytes: 0 },
          headers: { "Sec-WebSocket-Protocol": "overdare-terminal" },
        })
      )
        return;
      return new Response("WebSocket required", { status: 400 });
    },
    websocket: {
      idleTimeout: 0,
      maxPayloadLength: MAX_CONTROL_BYTES,
      backpressureLimit: MAX_OUTPUT_BYTES,
      closeOnBackpressureLimit: true,
      open(ws) {
        if (closing || clients.size >= 4) {
          ws.close(1013, "Too many terminal readers");
          return;
        }
        clients.add(ws);
        const upstream = new WebSocketClient(source.wsUrl, {
          protocols: ["overdare-terminal", source.token],
          headers: { Origin: sourceOrigin },
        });
        ws.data.upstream = upstream;
        upstreams.add(upstream);
        upstream.binaryType = "arraybuffer";
        ws.data.timer = setTimeout(() => finish(ws, 1011, "Source terminal connection timed out."), 4000);
        upstream.onopen = () => {
          clearTimeout(ws.data.timer);
          if (closing || ws.data.finished || !clients.has(ws)) {
            upstream.terminate();
            return;
          }
          const pending = ws.data.pending;
          ws.data.pending = [];
          ws.data.pendingBytes = 0;
          for (const message of pending) forward(ws, message);
        };
        upstream.onmessage = (event) => {
          if (!clients.has(ws)) return;
          if (event.data instanceof ArrayBuffer) {
            if (event.data.byteLength > MAX_OUTPUT_BYTES) finish(ws, 1009, "Source terminal output is too large.");
            else send(ws, new Uint8Array(event.data));
            return;
          }
          if (typeof event.data !== "string" || Buffer.byteLength(event.data) > MAX_CONTROL_BYTES) {
            finish(ws, 1009, "Source terminal message is too large.");
            return;
          }
          try {
            const message = JSON.parse(event.data);
            if (["status", "reset", "resize", "control", "error"].includes(message?.type)) {
              if (message.type === "status" && message.status && typeof message.status === "object")
                status = message.status;
              send(ws, event.data);
            }
          } catch {
            finish(ws, 1011, "Invalid source terminal message.");
          }
        };
        upstream.onerror = () => finish(ws, 1011, "Source terminal connection failed.");
        upstream.onclose = () => {
          clearTimeout(ws.data.timer);
          upstreams.delete(upstream);
          finish(ws, 1001, "Source terminal is disconnected.");
        };
      },
      message(ws, raw) {
        try {
          if (typeof raw !== "string") throw new Error();
          const message = JSON.parse(raw);
          if (typeof message?.id !== "string" || message.id.length === 0 || message.id.length > 128) throw new Error();
          const id = message.id;
          if (
            message.type === "input" &&
            typeof message.data === "string" &&
            Buffer.byteLength(message.data) <= 32 * 1024
          )
            forward(ws, JSON.stringify({ type: "input", id, data: message.data }));
          else if (message.type === "resize" && validTerminalSize(message))
            forward(ws, JSON.stringify({ type: "resize", id, cols: message.cols, rows: message.rows }));
          else throw new Error();
        } catch {
          send(
            ws,
            JSON.stringify({ type: "error", message: "Attached lab allows valid input and resize messages only." }),
          );
        }
      },
      close(ws) {
        ws.data.finished = true;
        clients.delete(ws);
        clearTimeout(ws.data.timer);
        ws.data.pending = [];
        ws.data.pendingBytes = 0;
        if (ws.data.upstream) {
          upstreams.delete(ws.data.upstream);
          ws.data.upstream.terminate();
        }
      },
    },
  });
  return {
    bootstrap(request: Request): Response {
      if (
        new URL(request.url).origin !== webOrigin ||
        request.headers.get("sec-fetch-site") === "cross-site" ||
        (request.headers.has("origin") && request.headers.get("origin") !== webOrigin)
      )
        return new Response("Forbidden", { status: 403 });
      if (closing) return new Response("Terminal relay is closed", { status: 503 });
      return Response.json(
        { wsUrl: `ws://127.0.0.1:${server.port}/terminal`, token, status, unavailable: source.unavailable },
        { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
      );
    },
    close(): Promise<void> {
      if (!closing) {
        closing = Promise.resolve();
        // Termination is immediate. Bun can omit a close event for a terminated
        // CONNECTING client, so shutdown must not wait indefinitely for that event.
        for (const upstream of upstreams) upstream.terminate();
        for (const client of clients) {
          clearTimeout(client.data.timer);
          client.data.finished = true;
          client.data.pending = [];
          client.data.pendingBytes = 0;
          client.terminate();
        }
        upstreams.clear();
        server.stop(true);
      }
      return closing;
    },
  };
}
