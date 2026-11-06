// @summary Authenticated loopback WebSocket host for one Studio-owned Claude terminal.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ServerWebSocket } from "bun";
import { type ClaudeConversation, isConversationId, listClaudeConversations } from "./history";
import { type ClaudeLaunchOptions, findClaude, prepareClaudeLaunch } from "./launch";
import { type ClaudeTerminalEvent, ClaudeTerminalSession, type TerminalSize, validTerminalSize } from "./session";
import { prepareShellLaunch } from "./shell";

interface SocketData {
  unsubscribe?: () => void;
}
export interface ClaudeHostOptions {
  mode?: "claude" | "shell";
  cwd: string;
  webOrigin: string;
  studioId: () => string | null;
  env?: NodeJS.ProcessEnv;
  /** Only for an explicit development frontend origin. */
  developmentOrigin?: string;
  launchOptions?: Partial<ClaudeLaunchOptions>;
  session?: ClaudeTerminalSession;
  conversations?: () => Promise<ClaudeConversation[]>;
}

export function createClaudeTerminalHost(options: ClaudeHostOptions) {
  const token = randomBytes(32).toString("hex");
  const origins = new Set([options.webOrigin, ...(options.developmentOrigin ? [options.developmentOrigin] : [])]);
  for (const origin of [...origins]) {
    const url = new URL(origin);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
      origins.add(url.origin);
    }
  }
  const session =
    options.session ??
    new ClaudeTerminalSession({
      launch: (conversation) => {
        if (options.mode === "shell") return prepareShellLaunch({ cwd: options.cwd, env: options.env });
        const studioId = options.studioId();
        if (!studioId) throw new Error("Studio is not ready. Open a Studio project and retry.");
        return prepareClaudeLaunch({
          ...options.launchOptions,
          cwd: options.cwd,
          studioId,
          env: options.env,
          conversation,
        });
      },
    });
  const readConversations =
    options.mode === "shell"
      ? async () => []
      : (options.conversations ??
        (() =>
          listClaudeConversations({
            ...options.launchOptions,
            cwd: options.cwd,
            studioId: options.studioId() ?? "",
            env: options.env,
          })));
  let listing: Promise<ClaudeConversation[]> | undefined;
  const conversations = () => {
    listing ??= readConversations().finally(() => {
      listing = undefined;
    });
    return listing;
  };
  let controls = Promise.resolve();
  let controlEpoch = 0;
  const enqueue = (action: () => Promise<void>) => {
    const next = controls.then(action);
    controls = next.catch(() => {});
    return next;
  };
  const selection = async (choice: unknown): Promise<ClaudeLaunchOptions["conversation"]> => {
    if (options.mode === "shell") {
      if (choice !== undefined && choice !== "new")
        throw new Error("A plain shell does not have Claude conversations.");
      return undefined;
    }
    if (choice === "new") return { mode: "new", id: randomUUID() };
    if (choice !== undefined && choice !== "latest" && !isConversationId(choice))
      throw new Error("Invalid conversation selection.");
    const records = await conversations();
    const item = choice === undefined || choice === "latest" ? records[0] : records.find((item) => item.id === choice);
    if (!item && choice !== undefined && choice !== "latest")
      throw new Error("Conversation not found in this project. Refresh the list.");
    return item ? { mode: "resume", id: item.id } : { mode: "new", id: randomUUID() };
  };
  const authorized = (req: Request) => {
    const supplied =
      req.headers
        .get("sec-websocket-protocol")
        ?.split(",")
        .map((part) => part.trim())[1] ?? "";
    return (
      origins.has(req.headers.get("origin") ?? "") &&
      /^[a-f0-9]{64}$/.test(supplied) &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
    );
  };
  const send = (
    ws: ServerWebSocket<SocketData>,
    event:
      | ClaudeTerminalEvent
      | { type: "control"; resizeOwner: boolean }
      | { type: "error"; message: string }
      | { type: "conversations"; conversations: ClaudeConversation[] },
  ) => {
    if (event instanceof Uint8Array && event.length === 0) return;
    const result = ws.send(event instanceof Uint8Array ? event : JSON.stringify(event));
    if (result === 0 || ws.getBufferedAmount() > 1024 * 1024)
      ws.close(1013, "Terminal reader is behind. Reconnect to recover output.");
  };
  const clients = new Set<ServerWebSocket<SocketData>>();
  let resizeOwner: ServerWebSocket<SocketData> | undefined;
  const claim = (owner: ServerWebSocket<SocketData> | undefined) => {
    if (owner && !clients.has(owner)) return;
    if (resizeOwner === owner) return;
    resizeOwner = owner;
    for (const client of clients) send(client, { type: "control", resizeOwner: client === owner });
  };
  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.hostname !== "127.0.0.1" || url.pathname !== "/terminal" || !authorized(req))
        return new Response("Forbidden", { status: 403 });
      if (server.upgrade(req, { data: {}, headers: { "Sec-WebSocket-Protocol": "overdare-terminal" } }))
        return undefined;
      return new Response("WebSocket required", { status: 400 });
    },
    websocket: {
      idleTimeout: 0,
      maxPayloadLength: 64 * 1024,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      open(ws) {
        clients.add(ws);
        if (!resizeOwner) claim(ws);
        else send(ws, { type: "control", resizeOwner: false });
        ws.data.unsubscribe = session.subscribe((event) => send(ws, event));
      },
      message(ws, raw) {
        void (async () => {
          if (typeof raw !== "string") throw new Error("Terminal control messages must be JSON.");
          const message = JSON.parse(raw) as {
            type: string;
            id?: string;
            data?: string;
            cols?: number;
            rows?: number;
            conversation?: unknown;
          };
          if (message.type === "claim") claim(ws);
          else if (message.type === "conversations")
            send(ws, { type: "conversations", conversations: await conversations() });
          else if (message.type === "start" || message.type === "select") {
            if (!validTerminalSize(message)) throw new Error("Invalid terminal size.");
            const epoch = controlEpoch;
            await enqueue(async () => {
              if (epoch !== controlEpoch) return;
              claim(ws);
              if (message.type === "start" && ["running", "starting"].includes(session.snapshot().state)) {
                await session.start(message);
                return;
              }
              // Resolve and validate before stopping the current process.
              let conversation: ClaudeLaunchOptions["conversation"];
              try {
                conversation = await selection(message.conversation);
              } catch (error) {
                if (epoch !== controlEpoch) return;
                throw error;
              }
              if (epoch !== controlEpoch) return;
              if (message.type === "select") await session.stop();
              if (epoch !== controlEpoch) return;
              await session.start(message, conversation);
            });
          } else if (message.type === "stop") {
            controlEpoch++;
            await session.stop();
          } else if (message.type === "input" && typeof message.id === "string" && typeof message.data === "string")
            session.input(message.id, message.data);
          else if (message.type === "resize" && typeof message.id === "string" && validTerminalSize(message)) {
            if (ws === resizeOwner) session.resize(message.id, message as TerminalSize);
          } else throw new Error("Invalid terminal message.");
        })().catch((error) =>
          send(ws, { type: "error", message: error instanceof Error ? error.message : String(error) }),
        );
      },
      close(ws) {
        ws.data.unsubscribe?.();
        clients.delete(ws);
        if (resizeOwner === ws) claim(clients.values().next().value);
      },
    },
  });
  return {
    bootstrap(req: Request): Response {
      const url = new URL(req.url);
      // The main web origin's same-origin policy protects the bootstrap token. Also reject
      // cross-site reads, foreign Host headers, and DNS rebinding before returning it.
      if (
        !origins.has(url.origin) ||
        req.headers.get("sec-fetch-site") === "cross-site" ||
        (req.headers.has("origin") && !origins.has(req.headers.get("origin")!))
      )
        return new Response("Forbidden", { status: 403 });
      let unavailable: string | undefined;
      try {
        if (options.mode !== "shell") findClaude(options.env);
      } catch (error) {
        unavailable = error instanceof Error ? error.message : String(error);
      }
      return Response.json(
        { wsUrl: `ws://127.0.0.1:${server.port}/terminal`, token, status: session.snapshot(), unavailable },
        { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
      );
    },
    session,
    async close() {
      controlEpoch++;
      await session.close();
      await controls;
      server.stop(true);
    },
  };
}
