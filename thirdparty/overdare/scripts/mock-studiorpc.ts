import net from "node:net";
import readline from "node:readline";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MockNode {
  guid: string;
  name: string;
  class: string;
  filename?: string;
  properties?: Record<string, unknown>;
  children?: MockNode[];
}

interface MockState {
  roots: MockNode[];
  guidSeed: number;
}

export interface StudioRpcMockContext {
  request: JsonRpcRequest;
  requests: JsonRpcRequest[];
  state: MockState;
}

export type StudioRpcMockHandler = (ctx: StudioRpcMockContext) => unknown | Promise<unknown>;

export interface StartStudioRpcMockServerOptions {
  host?: string;
  port?: number;
  handlers?: Record<string, StudioRpcMockHandler>;
  quiet?: boolean;
  initialTree?: MockNode[];
}

export interface StudioRpcMockServer {
  host: string;
  port: number;
  requests: JsonRpcRequest[];
  stop: () => Promise<void>;
  snapshot: () => MockNode[];
}

function asParams(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function rpcError(code: number, message: string, data?: unknown): JsonRpcError {
  return { code, message, ...(data === undefined ? {} : { data }) };
}

function isRpcError(value: unknown): value is JsonRpcError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

function logLine(quiet: boolean | undefined, message: string): void {
  if (!quiet) console.log(`[mock-studiorpc] ${message}`);
}

function cloneNode(node: MockNode): MockNode {
  return {
    ...node,
    properties: node.properties ? { ...node.properties } : undefined,
    children: node.children?.map(cloneNode),
  };
}

function createDefaultTree(): MockNode[] {
  return [
    {
      guid: "WORKSPACE_GUID",
      name: "Workspace",
      class: "Folder",
      children: [
        {
          guid: "SCRIPTS_GUID",
          name: "Scripts",
          class: "Folder",
          children: [
            {
              guid: "HELLO_SCRIPT_GUID",
              name: "HelloScript",
              class: "Script",
              filename: "HelloScript.lua",
              properties: {},
              children: [],
            },
          ],
        },
        {
          guid: "SPAWN_POINT_GUID",
          name: "SpawnPoint",
          class: "Part",
          properties: { Visible: true },
          children: [],
        },
      ],
    },
  ];
}

function inferGuidSeed(roots: MockNode[]): number {
  const guids = JSON.stringify(roots).match(/MOCK_GUID_(\d+)/g) ?? [];
  const maxSeed = guids.reduce((max, guid) => {
    const match = guid.match(/MOCK_GUID_(\d+)/);
    const value = match ? Number(match[1]) : 0;
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return maxSeed + 1;
}

function nextGuid(state: MockState): string {
  const guid = `MOCK_GUID_${String(state.guidSeed).padStart(4, "0")}`;
  state.guidSeed += 1;
  return guid;
}

function findNode(nodes: MockNode[], guid: string): MockNode | undefined {
  for (const node of nodes) {
    if (node.guid === guid) return node;
    const found = node.children ? findNode(node.children, guid) : undefined;
    if (found) return found;
  }
  return undefined;
}

function findParent(nodes: MockNode[], guid: string): { parent: MockNode | null; index: number } | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.guid === guid) return { parent: null, index };
    if (node.children) {
      const childIndex = node.children.findIndex((child) => child.guid === guid);
      if (childIndex >= 0) return { parent: node, index: childIndex };
      const nested = findParent(node.children, guid);
      if (nested) return nested;
    }
  }
  return undefined;
}

function toBrowseNode(node: MockNode): Record<string, unknown> {
  return {
    guid: node.guid,
    name: node.name,
    class: node.class,
    ...(node.filename ? { filename: node.filename } : {}),
    children: (node.children ?? []).map(toBrowseNode),
  };
}

function toReadableNode(node: MockNode, recursive: boolean): Record<string, unknown> {
  return {
    guid: node.guid,
    name: node.name,
    class: node.class,
    properties: node.properties ?? {},
    ...(recursive && node.children && node.children.length > 0
      ? { children: node.children.map((child) => toReadableNode(child, true)) }
      : {}),
  };
}

function buildDefaultHandlers(): Record<string, StudioRpcMockHandler> {
  return {
    "level.browse": ({ state }) => state.roots.map(toBrowseNode),
    "level.save.file": () => "World file saved.",
    "level.apply": () => ({ ok: true }),
    "game.play": ({ request }) => {
      const playerCount = request.params?.numberOfPlayer;
      return `Game started (${typeof playerCount === "number" ? playerCount : 1} player(s)).`;
    },
    "game.stop": () => "Game stopped.",
    "script.add": ({ request, state }) => {
      const parentGuid = typeof request.params?.parentGuid === "string" ? request.params.parentGuid : "";
      const parent = findNode(state.roots, parentGuid);
      if (!parent) return rpcError(-32001, `Parent GUID not found: ${parentGuid}`);
      const name = typeof request.params?.name === "string" ? request.params.name : "unnamed";
      const className = typeof request.params?.class === "string" ? request.params.class : "Script";
      const child: MockNode = {
        guid: nextGuid(state),
        name,
        class: className,
        filename: `${name}.lua`,
        properties: { source: request.params?.source },
        children: [],
      };
      parent.children = [...(parent.children ?? []), child];
      return `Script added: ${name}`;
    },
    "script.delete": ({ request, state }) => {
      const targetGuid = typeof request.params?.targetGuid === "string" ? request.params.targetGuid : "";
      const parentInfo = findParent(state.roots, targetGuid);
      if (!parentInfo) return rpcError(-32001, `Target GUID not found: ${targetGuid}`);
      if (parentInfo.parent === null) state.roots.splice(parentInfo.index, 1);
      else parentInfo.parent.children?.splice(parentInfo.index, 1);
      return "Deleted.";
    },
    "asset_drawer.import": ({ request, state }) => {
      const assetName = typeof request.params?.assetName === "string" ? request.params.assetName : "ImportedAsset";
      const imported: MockNode = {
        guid: nextGuid(state),
        name: assetName,
        class: "Model",
        properties: {
          assetid: request.params?.assetid,
          assetType: request.params?.assetType,
        },
        children: [],
      };
      const workspace = state.roots[0];
      workspace.children = [...(workspace.children ?? []), imported];
      return `Asset imported: ${assetName}`;
    },
    "asset_manager.image.import": ({ request }) => ({
      asset: {
        assetid: "ovdrassetid://mock-image-1",
        file: typeof request.params?.file === "string" ? request.params.file : "/tmp/mock-image.png",
      },
    }),
    "action_sequencer_service.apply_json": () => "Sequencer JSON applied.",
    "instance.read": ({ request, state }) => {
      const guid = typeof request.params?.guid === "string" ? request.params.guid : "";
      const recursive = request.params?.recursive === true;
      const node = findNode(state.roots, guid);
      if (!node) return rpcError(-32001, `Instance not found: ${guid}`);
      return toReadableNode(node, recursive);
    },
    "instance.upsert": ({ request, state }) => {
      const items = Array.isArray(request.params?.items) ? request.params.items : [];
      const createdGuids: string[] = [];
      const updatedGuids: string[] = [];

      for (const item of items) {
        if (typeof item !== "object" || item === null) continue;
        const record = item as Record<string, unknown>;
        if (typeof record.guid === "string") {
          const target = findNode(state.roots, record.guid);
          if (!target) return rpcError(-32001, `ActorGuid not found: ${record.guid}`);
          if (typeof record.name === "string") target.name = record.name;
          if (
            typeof record.properties === "object" &&
            record.properties !== null &&
            !Array.isArray(record.properties)
          ) {
            target.properties = { ...(target.properties ?? {}), ...(record.properties as Record<string, unknown>) };
          }
          updatedGuids.push(record.guid);
          continue;
        }

        const parentGuid = typeof record.parentGuid === "string" ? record.parentGuid : "";
        const parent = findNode(state.roots, parentGuid);
        if (!parent) return rpcError(-32001, `Parent GUID not found: ${parentGuid}`);
        const guid = nextGuid(state);
        const child: MockNode = {
          guid,
          name: typeof record.name === "string" ? record.name : "Unnamed",
          class: typeof record.class === "string" ? record.class : "Folder",
          properties:
            typeof record.properties === "object" && record.properties !== null && !Array.isArray(record.properties)
              ? { ...(record.properties as Record<string, unknown>) }
              : {},
          children: [],
        };
        parent.children = [...(parent.children ?? []), child];
        createdGuids.push(guid);
      }

      return {
        ok: true,
        createdGuids,
        updatedGuids,
      };
    },
    "instance.delete": ({ request, state }) => {
      const items = Array.isArray(request.params?.items) ? request.params.items : [];
      const deletedGuids: string[] = [];

      for (const item of items) {
        if (typeof item !== "object" || item === null) continue;
        const targetGuid =
          typeof (item as Record<string, unknown>).targetGuid === "string"
            ? ((item as Record<string, unknown>).targetGuid as string)
            : "";
        const parentInfo = findParent(state.roots, targetGuid);
        if (!parentInfo) return rpcError(-32001, `Target GUID not found: ${targetGuid}`);
        if (parentInfo.parent === null) state.roots.splice(parentInfo.index, 1);
        else parentInfo.parent.children?.splice(parentInfo.index, 1);
        deletedGuids.push(targetGuid);
      }

      return {
        ok: true,
        deletedGuids,
      };
    },
  };
}

export async function startStudioRpcMockServer(
  options: StartStudioRpcMockServerOptions = {},
): Promise<StudioRpcMockServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 13377;
  const requests: JsonRpcRequest[] = [];
  const state: MockState = {
    roots: (options.initialTree ?? createDefaultTree()).map(cloneNode),
    guidSeed: inferGuidSeed(options.initialTree ?? createDefaultTree()),
  };
  const handlers = { ...buildDefaultHandlers(), ...(options.handlers ?? {}) };

  const server = net.createServer((socket) => {
    const reader = readline.createInterface({ input: socket, crlfDelay: Number.POSITIVE_INFINITY });

    reader.on("line", async (line) => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch {
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: rpcError(-32700, "Parse error") })}\n`);
        return;
      }

      const normalized: JsonRpcRequest = {
        jsonrpc: request.jsonrpc,
        id: request.id ?? null,
        method: typeof request.method === "string" ? request.method : undefined,
        params: asParams(request.params),
      };
      requests.push(normalized);
      logLine(options.quiet, `→ ${normalized.method ?? "(missing method)"}`);

      if (normalized.jsonrpc !== "2.0" || !normalized.method) {
        socket.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: normalized.id ?? null, error: rpcError(-32600, "Invalid Request") })}\n`,
        );
        return;
      }

      const handler = handlers[normalized.method];
      if (!handler) {
        socket.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: normalized.id, error: rpcError(-32601, `Method not found: ${normalized.method}`) })}\n`,
        );
        return;
      }

      try {
        const result = await handler({ request: normalized, requests, state });
        if (isRpcError(result)) {
          socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: normalized.id, error: result })}\n`);
          return;
        }
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: normalized.id, result })}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: normalized.id, error: rpcError(-32000, message) })}\n`);
      }
    });

    socket.on("close", () => {
      reader.close();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve mock Studio RPC server address.");
  }

  logLine(options.quiet, `listening on ${host}:${address.port}`);

  return {
    host,
    port: address.port,
    requests,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    snapshot: () => state.roots.map(cloneNode),
  };
}

async function main(): Promise<void> {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  const hostArg = process.argv.find((arg) => arg.startsWith("--host="));
  const port = portArg ? Number(portArg.slice("--port=".length)) : undefined;
  const host = hostArg ? hostArg.slice("--host=".length) : undefined;

  const server = await startStudioRpcMockServer({
    host,
    port: Number.isFinite(port) ? port : undefined,
  });

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (import.meta.main) {
  await main();
}
