// @summary Minimal MCP peer returning a supplied result fixture over stdio
import { createInterface } from "node:readline";

const result = await Bun.file(process.argv[2]!).json();
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let response: unknown;
  switch (request.method) {
    case "initialize":
      response = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "result-fixture", version: "1" },
      };
      break;
    case "tools/list":
      response = { tools: [{ name: "result", inputSchema: { type: "object" } }] };
      break;
    case "tools/call":
      response = result;
      break;
    default:
      throw new Error(`Unexpected MCP request: ${request.method}`);
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: response })}\n`);
}
