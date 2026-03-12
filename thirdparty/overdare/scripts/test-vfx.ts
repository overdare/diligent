// Quick test: create a VFXPreset via Studio RPC
// Usage: bun run scripts/test-vfx.ts [parentGuid]

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
  console.log("Usage: bun run scripts/test-vfx.ts <parentGuid>");
  console.log("\nFetching workspace to find a valid parent...");
  try {
    const result = await rpc("level.browse");
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Failed:", (e as Error).message);
  }
  process.exit(0);
}

// Test VFXPreset creation
const presets = ["Hit", "Explosion", "Flash Hit", "Electric Dragon"] as const;

for (const preset of presets) {
  console.log(`\nCreating VFXPreset: ${preset}`);
  try {
    const result = await rpc("instance.vfx_preset.add", {
      parentGuid,
      class: "VFXPreset",
      name: `Test_${preset.replace(/ /g, "_")}`,
      properties: {
        PresetName: preset,
        Color: [
          { Time: 0, Color: { R: 255, G: 100, B: 50 } },
          { Time: 1, Color: { R: 255, G: 100, B: 50 } },
        ],
        Enabled: true,
        InfiniteLoop: false,
        LoopCount: 3,
        Size: 1.5,
        Transparency: 0.2,
      },
    });
    console.log("  OK:", JSON.stringify(result));
  } catch (e) {
    console.error("  FAIL:", (e as Error).message);
  }
}

console.log("\nDone!");
