// @summary Prints the LLM-facing tool definition JSON for studiorpc_instance_upsert.
import { zodToJsonSchema } from "zod-to-json-schema";
import { createTools } from "../../src/index.ts";

const tools = await createTools({ cwd: process.cwd() });
const tool = tools.find((entry) => entry.name === "studiorpc_instance_upsert");

if (!tool) {
  throw new Error("studiorpc_instance_upsert not found");
}

const { $schema, ...inputSchema } = zodToJsonSchema(tool.parameters) as Record<string, unknown>;

console.log(
  JSON.stringify(
    {
      name: tool.name,
      description: tool.description,
      inputSchema,
    },
    null,
    2,
  ),
);
