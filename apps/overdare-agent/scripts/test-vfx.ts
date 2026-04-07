// Test all VFX presets via Studio RPC
// Usage: bun run scripts/test-vfx.ts <parentGuid>

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ALL_PRESETS = [
  "Hit",
  "Explosion",
  "Knockback",
  "Dash",
  "Landing",
  "Trail",
  "Crack",
  "Muzzle",
  "Heal",
  "Cast",
  "Barrier",
  //"Hit Blood",
  "Fire",
  "Portal",
  //"Firefly",
  "Rain",
  "Spawn",
  "Buff Zone",
  "Speedup",
  "Warning",
  "Level Up",
  "Get Item",
  "Hit Object",
  //"Impact",
  "Destroy",
  //  "Debuff",
  "Stun",
  "Debuff Toxic",
  "Guard",
  "Simple Hit",
  "Blood",
  "Electric Muzzle",
  "Flash Hit",
  "Electric Explosion",
  "Smoke Explosion",
  "Highlight Burst",
  "Floating Puzzle",
  "Spin Trail",
  "Solar Swirl Trail",
  "Solar Trail Plus",
  "Solar Trail Burst",
  "Electric Attack",
  "Electric Dragon",
  "Electric Dragon Strike",
  "Electric Kick",
  "Game Over",
  "Scratch",
  "Snowflake",
  "Spark",
  "Tornado",
  "Water Swirl Trail",
  "Waterfall Attack",
  "Lightning Arc",
  "Bounce",
  //  "Spear Thurst",
  "Simple Punch",
  "Punch",
  "Strong Punch",
  "Light Cast",
  "Light Charge",
  "Small Barrier",
  "Aura Wave",
  "Swirl Ring",
  "Dash Burst",
  "Soccer Dash",
  "Simple Landing",
  "Void Portal",
  "Water Splash",
  "Mining",
  "Dig",
  "Leaf",
  "Fog",
  //"Collapse",
  "Radial Hit",
  "Flash Knockback",
  "Simple Trail",
  "Ground Crack",
  "Arrow Flash",
  "Flash Cast",
  "Wind Cast",
  "Item Burst",
  "Pulse Hit",
  "Wave Buff",
  "Cartoon Explosion",
  "Toxic Explosion",
  "Power Charge",
  "Fire Charge",
  "Energy Pulse",
  "Fire Sweep",
  "Electric Burst",
  "Poison Explosion",
  "Rose Rain",
  "Fire Ground",
  "Glory Burst",
  "Phantom Leopard",
  "Light Burst",
  "Flash Burst",
  "Impact Link",
  "Simple Explosion",
  "Smoke Burst",
  "Energy Orb",
  "Arc Slash",
  "Glory Explosion",
  "Swirl Strike",
  "Glory Spark",
  "Zombie Hand",
  "Kick",
  "Wood Break",
  "Simple Destroy",
  //"Soft Heal",
  "Block",
  "Heavy Landing",
  "Splash Blood",
  "Electric Crackle",
  "Bird Flock",
  "World Marker",
  "Updraft",
  "Ball Impact",
  "Ground Bounce",
  "Swing",
  "Glory Flash",
  "Ball Trail",
  "Toxic Zone",
  "Sword Slash",
  "Glass Crack",
  "Straight Punch",
  "Fire Drop",
  "Debuff Zone",
  //"Comic Trail",
  //"Blink",
] as const;

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

console.log(`Testing all ${ALL_PRESETS.length} VFX presets`);
console.log(`Parent: ${parentGuid}\n`);

let ok = 0;
let fail = 0;

for (let i = 0; i < ALL_PRESETS.length; i++) {
  const preset = ALL_PRESETS[i];
  const label = `[${i + 1}/${ALL_PRESETS.length}]`;

  try {
    const result = await rpc("instance.vfx_preset.add", {
      parentGuid,
      class: "VFXPreset",
      name: `VFX_${preset.replace(/ /g, "_")}`,
      properties: {
        PresetName: preset,
        Color: [
          { Time: 0, Color: { r: 255, g: 100, b: 50 } },
          { Time: 1, Color: { r: 50, g: 100, b: 255 } },
        ],
        Enabled: true,
        InfiniteLoop: false,
        LoopCount: 1,
        Size: 1,
        Transparency: 0,
      },
    });
    ok++;
    console.log(`${label} OK  "${preset}" -> ${JSON.stringify(result)}`);
  } catch (e) {
    fail++;
    console.error(`${label} FAIL "${preset}" -> ${(e as Error).message}`);
  }

  await sleep(100);
}

console.log(`\n--- Results ---`);
console.log(`Total: ${ALL_PRESETS.length}  OK: ${ok}  FAIL: ${fail}`);
if (fail === 0) console.log("All presets passed!");
else process.exit(1);
