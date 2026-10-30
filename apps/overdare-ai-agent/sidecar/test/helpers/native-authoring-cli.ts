// @summary Runs actual bundled authoring tools against a test-only native process mailbox.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createStudioRpcTools } from "../../src/tools/studiorpc";
import { call, StudioRpcError } from "../../src/tools/studiorpc/rpc";

export async function createNativeAuthoringClient(mailbox: string, evidence: string) {
  mailbox = resolve(mailbox);
  evidence = resolve(evidence);
  await mkdir(evidence, { recursive: true });
  const ready = JSON.parse(await readFile(join(mailbox, "ready.json"), "utf8"));
  if (ready.rpcPort) {
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(ready.rpcPort);
  }
  let counter = 0;
  const callNative: typeof call = async (method, params = {}, options) => {
    const id = `${Date.now()}-${process.pid}-${++counter}`;
    const request = { id, method, params };
    if (ready.rpcPort && !method.startsWith("evaluation.")) {
      try {
        const result = await call(method, params, options);
        await writeFile(
          join(evidence, `${id}.native.json`),
          JSON.stringify(
            { request, response: { result }, transport: "production_tcp_rpc_client", nativeProcess: ready },
            null,
            2,
          ),
        );
        return result;
      } catch (error) {
        await writeFile(
          join(evidence, `${id}.native.json`),
          JSON.stringify(
            {
              request,
              response: {
                error:
                  error instanceof StudioRpcError
                    ? { code: error.code, message: error.message, data: error.data }
                    : { message: String(error), transportFailure: true },
              },
              transport: "production_tcp_rpc_client",
              nativeProcess: ready,
            },
            null,
            2,
          ),
        );
        throw error;
      }
    }
    const filename = join(mailbox, `${id}.request.json`);
    await writeFile(`${filename}.tmp`, JSON.stringify(request));
    await rename(`${filename}.tmp`, filename);
    const started = Date.now();
    const responseFile = join(mailbox, `${id}.response.json`);
    while (Date.now() - started < (options?.timeoutMs ?? 900_000)) {
      options?.signal?.throwIfAborted();
      let text: string;
      try {
        text = await readFile(responseFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await Bun.sleep(50);
        continue;
      }
      const response = JSON.parse(text);
      await writeFile(join(evidence, `${id}.native.json`), JSON.stringify({ request, response }, null, 2));
      if (response.error) {
        throw new StudioRpcError(response.error.message, response.error.code, response.error.data);
      }
      return response.result;
    }
    throw new Error(`Native evaluation timeout: ${method}; inspect the existing request before retrying`);
  };
  const tools = await createStudioRpcTools({ cwd: evidence, callRpc: callNative });
  return {
    tools,
    prepareGeneral: (buildId: string) => callNative("evaluation.prepare_general", { buildId }),
    prepareSourceModel: (params: { name: string; kind: "procedural_model" | "static_model"; fromGuid?: string }) =>
      callNative("evaluation.prepare_source_model", params),
    async invoke(name: string, args: unknown, label: string) {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown bundled tool: ${name}`);
      const started = Date.now();
      let record: Record<string, unknown>;
      try {
        const parsed = tool.parameters.parse(args);
        const result = await tool.execute(parsed as never, {
          toolCallId: label,
          sessionId: "isolated-authoring-evaluation",
          signal: new AbortController().signal,
          abort: () => {},
          approve: async () => "allow",
        });
        record = {
          label,
          name,
          args,
          elapsedMs: Date.now() - started,
          output: result.output,
          metadata: result.metadata,
          imageCount: result.outputImages?.length ?? 0,
        };
      } catch (error) {
        record = {
          label,
          name,
          args,
          elapsedMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof StudioRpcError ? { code: error.code, data: error.data } : {}),
        };
      }
      if (!/^[A-Za-z0-9_-]+$/.test(label)) throw new Error("Use a simple unique evidence label");
      await writeFile(join(evidence, `${label}.tool.json`), JSON.stringify(record, null, 2), { flag: "wx" });
      return record;
    },
  };
}

if (import.meta.main) {
  const [mailbox, input, evidence] = process.argv.slice(2);
  if (!mailbox || !input || !evidence)
    throw new Error("Usage: bun native-authoring-cli.ts MAILBOX INPUT_JSON EVIDENCE");
  const request = JSON.parse(await readFile(input, "utf8"));
  const client = await createNativeAuthoringClient(mailbox, evidence);
  console.log(JSON.stringify(await client.invoke(request.name, request.args, request.label), null, 2));
}
