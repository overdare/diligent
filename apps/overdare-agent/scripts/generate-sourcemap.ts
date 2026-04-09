// Generate sourcemap.json from OVERDARE Studio's level.browse RPC
// Usage: bun run scripts/generate-sourcemap.ts [output-path]
//
// Connects to Studio RPC (localhost:13377), fetches the full instance tree,
// and writes a luau-lsp compatible sourcemap.json.

import { writeFile } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import readline from "node:readline";

const HOST = "127.0.0.1";
const PORT = 13377;

function rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = { jsonrpc: "2.0", id: 1, method, ...(params && { params }) };
    const socket = net.createConnection({ host: HOST, port: PORT }, () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    const rl = readline.createInterface({ input: socket });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
    }, 10_000);
    rl.once("line", (line) => {
      clearTimeout(timer);
      rl.close();
      socket.destroy();
      const res = JSON.parse(line);
      if (res.error) reject(new Error(`RPC error: ${res.error.message}`));
      else resolve(res.result);
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// --- level.browse response shape ---
interface BrowseNode {
  guid: string;
  name: string;
  class: string;
  filename?: string;
  children?: BrowseNode[];
}

// --- sourcemap.json shape (luau-lsp compatible) ---
interface SourcemapNode {
  name: string;
  className: string;
  children?: SourcemapNode[];
  filePaths?: string[];
}

/** Convert a level.browse node to a sourcemap node (recursive). */
function toSourcemapNode(node: BrowseNode): SourcemapNode {
  const result: SourcemapNode = {
    name: node.name,
    className: node.class,
  };

  if (node.filename) {
    result.filePaths = [node.filename];
  }

  if (node.children && node.children.length > 0) {
    result.children = node.children.map(toSourcemapNode);
  }

  return result;
}

async function main() {
  const outputPath = resolve(process.argv[2] || "sourcemap.json");

  console.log("Fetching instance tree from Studio RPC...");
  const raw = await rpc("level.browse");

  // Server returns { level: [...] } or plain array
  let nodes: BrowseNode[];
  if (Array.isArray(raw)) {
    nodes = raw as BrowseNode[];
  } else if (raw && typeof raw === "object" && "level" in raw && Array.isArray((raw as { level: unknown }).level)) {
    nodes = (raw as { level: BrowseNode[] }).level;
  } else {
    console.error("Unexpected response shape:", JSON.stringify(raw).slice(0, 200));
    process.exit(1);
  }

  // Build root DataModel node wrapping the top-level services
  const sourcemap: SourcemapNode = {
    name: "DataModel",
    className: "DataModel",
    children: nodes.map(toSourcemapNode),
  };

  await writeFile(outputPath, JSON.stringify(sourcemap, null, 2), "utf-8");
  console.log(`sourcemap.json written to ${outputPath}`);
  console.log(`Total top-level services: ${nodes.length}`);
}

main().catch((err) => {
  console.error("Failed:", (err as Error).message);
  process.exit(1);
});
