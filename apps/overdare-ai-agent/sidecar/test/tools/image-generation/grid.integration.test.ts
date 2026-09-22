// @summary Exercises model selection, grid validation, and omission of blank cells through the public MCP transport.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectImageAlpha } from "@diligent/core/image-contract";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../../src/mcp-server";
import { createImageGenerationToolProvider } from "../../../src/tools/image-generation";

// An 8x6 synthetic sheet: ten 2x2 cells with one visible pixel each, followed by two transparent cells.
const sheet = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAVUlEQVR4nG3KMRGAMAAEwROBCERQU1NTRwQiIgIRiEAEXsgl82WKnS/+YD9/sbhidcXmCvqZgAQkGDgsRXHF5Yrq1gQkIAEJBm5L8bjijS96QAJmQQMQZDyXthJ5iQAAAABJRU5ErkJggg==",
  "base64",
);

test("MCP returns a selected-model sheet and 10 ordered assets from 12 cells, and rejects invalid grids before generation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "image-grid-mcp-"));
  let calls = 0;
  const tools = await createImageGenerationToolProvider({
    generateImage: async (input) => {
      calls++;
      expect(input.model).toBe("gpt-image-2.5-flare");
      expect(input.background).toBe("transparent");
      expect(input.prompt).toContain("4 columns x 3 rows");
      return { bytes: sheet, mediaType: "image/png", requestedModel: input.model };
    },
  }).createTools({ cwd, modelProvider: "chatgpt" });
  const server = createMcpServer({ tools: new Map(tools.map((tool) => [tool.name, tool])), prompts: new Map() });
  const client = new Client({ name: "grid-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listing = await client.listTools();
    expect(listing.tools.find((tool) => tool.name === "generate_image")?.inputSchema.properties).toHaveProperty("grid");
    const invalid = await client.callTool({
      name: "generate_image",
      arguments: { prompt: "Icons", grid: { rows: 3, columns: 4, items: ["coin"] } },
    });
    expect(invalid.isError).toBe(true);
    expect(calls).toBe(0);
    const items = [...Array.from({ length: 10 }, (_, index) => `Decoration ${index + 1}`), null, null];
    const result = await client.callTool({
      name: "generate_image",
      arguments: {
        prompt: "Pastel wall decorations",
        model: "gpt-image-2.5-flare",
        grid: { rows: 3, columns: 4, items },
      },
    });
    expect(result.isError).not.toBe(true);
    expect(calls).toBe(1);
    const content = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    const output = JSON.parse(content[0].text!);
    expect(await readFile(output.file)).toEqual(sheet);
    expect(content).toHaveLength(12);
    expect(content[1].data).toBe(sheet.toString("base64"));
    expect(output.grid.cells).toHaveLength(10);
    expect(output.grid.skippedCells.map((cell: { index: number }) => cell.index)).toEqual([11, 12]);
    expect(output.grid.skippedCells.every((cell: { file?: string }) => !cell.file)).toBe(true);
    for (const [index, cell] of output.grid.cells.entries()) {
      expect(cell).toMatchObject({
        index: index + 1,
        row: Math.floor(index / 4) + 1,
        column: (index % 4) + 1,
        item: items[index],
        requestedEmpty: index >= 10,
      });
      expect(cell.warning).toBeUndefined();
      const bytes = await readFile(cell.file);
      expect(content[index + 2]).toMatchObject({
        type: "image",
        mimeType: "image/png",
        data: bytes.toString("base64"),
      });
      expect(await inspectImageAlpha(Uint8Array.from(bytes).buffer, "image/png")).toMatchObject({
        width: 2,
        height: 2,
        opaquePixels: index < 10 ? 1 : 0,
        transparentPixels: index < 10 ? 3 : 4,
      });
    }
  } finally {
    await client.close();
    await server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
