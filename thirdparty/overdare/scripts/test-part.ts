// Test Part creation via Studio RPC
// Usage: bun run scripts/test-part.ts <parentGuid>

import net from "node:net";
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
    }, 5000);
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

const parentGuid = process.argv[2] || "";

if (!parentGuid) {
  console.log("Usage: bun run scripts/test-part.ts <parentGuid>");
  console.log("\nFetching workspace to find a valid parent...");
  try {
    const result = await rpc("level.browse");
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Failed:", (e as Error).message);
  }
  process.exit(0);
}

console.log("Creating Part: APITestCylinder");
try {
  const result = await rpc("instance.part.add", {
    class: "Part",
    parentGuid,
    name: "APITestCylinder",
    properties: {
      Shape: "Enum.Cylinder",
      CFrame: {
        Position: { x: 2200, y: 120, z: 0 },
        Orientation: { x: 0, y: 0, z: 0 },
      },
      Size: { x: 400, y: 200, z: 400 },
      Color: { r: 0, g: 170, b: 255 },
      Material: "Enum.Material.Neon",
    },
  });
  console.log("OK:", JSON.stringify(result));
} catch (e) {
  console.error("FAIL:", (e as Error).message);
  process.exit(1);
}
