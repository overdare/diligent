// @summary Test server factory creating DiligentAppServer with fake stream and optional tools

import type { StreamFunction, Tool } from "@diligent/core";
import { DiligentAppServer, ensureDiligentDir } from "@diligent/core";
import { createSimpleStream } from "./fake-stream";

export function createTestServer(opts: {
  cwd: string;
  streamFunction?: StreamFunction;
  tools?: Tool[];
}): DiligentAppServer {
  const streamFn = opts.streamFunction ?? createSimpleStream("ok");
  const tools = opts.tools ?? [];

  return new DiligentAppServer({
    cwd: opts.cwd,
    resolvePaths: async (cwd) => ensureDiligentDir(cwd),
    buildAgentConfig: ({ mode, signal, approve, ask }) => ({
      model: { id: "fake", provider: "fake", contextWindow: 8192, maxOutputTokens: 4096 },
      systemPrompt: [],
      tools,
      mode,
      signal,
      approve,
      ask,
      streamFunction: streamFn,
    }),
  });
}
