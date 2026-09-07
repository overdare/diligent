// @summary Verifies that the tools which write Lua validate what they wrote, and only that.
//
// The provider takes an injected `callRpc`, so assertions read that rather than a
// socket or a module mock — `mock.module("studiorpc/rpc.ts")` in mcp-server.test.ts
// and procedural-tools.test.ts is process-global and would otherwise swallow the
// calls once those files have run. A local socket server still backs the tools'
// own module-level `applyLevelChanges` for a standalone run.
//
// The tools run on the v1 file path, which keeps the fake Studio small: the wrapper
// only ever reads the tool's metadata, and v1 and v2 emit identical metadata for
// all three tools (v2-tools.test.ts is what pins that equivalence).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { createStudioRpcToolProvider } from "../../../src/tools/studiorpc";

interface RpcCall {
  method: string;
  params?: Record<string, unknown>;
}

const WORKSPACE_GUID = "WS";
const PART_GUID = "P1";
const SCRIPT_GUID = "S1";
const REPORT =
  "LUA_VALIDATE v1 requested=nonstrict\nSCRIPT S1 Greeter effective=nonstrict\nSUMMARY scripts=1 errors=0 warnings=0";

const rpcCalls: RpcCall[] = [];
let validateFails = false;

function makeWorld() {
  return {
    InstanceType: "Workspace",
    ActorGuid: WORKSPACE_GUID,
    Name: "Workspace",
    LuaChildren: [
      { InstanceType: "Part", ActorGuid: PART_GUID, Name: "Part1" },
      { InstanceType: "Script", ActorGuid: SCRIPT_GUID, Name: "Greeter", Source: "print(1)\n" },
    ],
  };
}

let server: net.Server;
const previousEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ["STUDIO_HOST", "STUDIO_PORT"]) previousEnv[key] = process.env[key];

  server = net.createServer((socket) => {
    const lines = readline.createInterface({ input: socket });
    lines.on("line", (line) => {
      const request = JSON.parse(line) as { id: number };
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { success: true } })}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  process.env.STUDIO_HOST = "127.0.0.1";
  process.env.STUDIO_PORT = String((server.address() as net.AddressInfo).port);
});

afterAll(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const createdDirs: string[] = [];

function makeStudioProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "lua-validate-wrap-"));
  writeFileSync(join(cwd, "Test.umap"), "");
  writeFileSync(join(cwd, "Test.ovdrjm"), JSON.stringify({ Root: makeWorld() }, null, 2));
  createdDirs.push(cwd);
  return cwd;
}

/** Records what the provider asks Studio for, and answers lua.validate with a report. */
const recordingCallRpc = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
  rpcCalls.push({ method, params });
  if (method !== "lua.validate") return { success: true };
  if (validateFails) throw new Error("Studio RPC error [-32601]: method not found");
  return { output: REPORT };
};

async function loadTools(cwd: string, approve: () => Promise<"once" | "reject"> = async () => "once") {
  const provider = createStudioRpcToolProvider({ callRpc: recordingCallRpc as never });
  const tools = await provider.createTools({ cwd, host: { approve } });
  return new Map(tools.map((tool) => [tool.name, tool] as const));
}

function toolContext() {
  return { toolCallId: "test", signal: new AbortController().signal, abort: () => {} };
}

function validateCalls(): RpcCall[] {
  return rpcCalls.filter((entry) => entry.method === "lua.validate");
}

beforeEach(() => {
  previousEnv.STUDIO_API_VERSION = process.env.STUDIO_API_VERSION;
  process.env.STUDIO_API_VERSION = "v1";
  rpcCalls.length = 0;
  validateFails = false;
});

afterEach(() => {
  if (previousEnv.STUDIO_API_VERSION === undefined) delete process.env.STUDIO_API_VERSION;
  else process.env.STUDIO_API_VERSION = previousEnv.STUDIO_API_VERSION;
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scripts are validated by the tool that wrote them", () => {
  test("script_edit validates the script it rewrote and appends the report", async () => {
    const tools = await loadTools(makeStudioProject());
    const result = await tools
      .get("studiorpc_script_edit")!
      .execute({ guid: SCRIPT_GUID, old_string: "print(1)", new_string: "print(2)" }, toolContext());

    expect(validateCalls()).toHaveLength(1);
    expect(validateCalls()[0].params).toMatchObject({ mode: "nonstrict", targetGuids: [SCRIPT_GUID] });
    expect(result.output).toContain("SUMMARY scripts=1 errors=0");
  });

  test("script_add validates the script it created", async () => {
    const tools = await loadTools(makeStudioProject());
    const result = await tools
      .get("studiorpc_script_add")!
      .execute({ class: "Script", parentGuid: WORKSPACE_GUID, name: "Fresh", source: "print(1)" }, toolContext());

    expect(validateCalls()).toHaveLength(1);
    expect((validateCalls()[0].params?.targetGuids as string[])[0]).toBeTruthy();
    expect(result.output).toContain("SUMMARY");
  });

  test("instance_upsert validates a script it added", async () => {
    const tools = await loadTools(makeStudioProject());
    await tools
      .get("studiorpc_instance_upsert")!
      .execute(
        { items: [{ class: "Script", parentGuid: WORKSPACE_GUID, name: "Made", properties: { Source: "print(1)" } }] },
        toolContext(),
      );

    expect(validateCalls()).toHaveLength(1);
  });

  test("instance_upsert validates an update that set Source", async () => {
    const tools = await loadTools(makeStudioProject());
    await tools
      .get("studiorpc_instance_upsert")!
      .execute({ items: [{ guid: SCRIPT_GUID, properties: { Source: "print(9)" } }] }, toolContext());

    expect(validateCalls()).toHaveLength(1);
    expect(validateCalls()[0].params).toMatchObject({ targetGuids: [SCRIPT_GUID] });
  });
});

describe("everything else is left alone", () => {
  test("an upsert that touched no Lua does not validate", async () => {
    const tools = await loadTools(makeStudioProject());
    await tools
      .get("studiorpc_instance_upsert")!
      .execute({ items: [{ guid: PART_GUID, properties: { Anchored: true } }] }, toolContext());

    expect(validateCalls()).toHaveLength(0);
  });

  test("a rejected edit writes nothing, so it validates nothing", async () => {
    const tools = await loadTools(makeStudioProject(), async () => "reject");

    const result = await tools
      .get("studiorpc_script_edit")!
      .execute({ guid: SCRIPT_GUID, old_string: "print(1)", new_string: "print(2)" }, toolContext());

    expect(result.output).toContain("[Rejected by user]");
    expect(validateCalls()).toHaveLength(0);
  });

  test("a validation failure reports itself without failing the edit", async () => {
    validateFails = true;
    const tools = await loadTools(makeStudioProject());
    const result = await tools
      .get("studiorpc_script_edit")!
      .execute({ guid: SCRIPT_GUID, old_string: "print(1)", new_string: "print(2)" }, toolContext());

    expect(result.metadata?.error).not.toBe(true);
    expect(result.output).toContain("lua.validate skipped");
  });
});
