// @summary Verifies that the tools which write Lua validate what they wrote, and only that.
//
// The provider takes an injected `callRpc`, so the fake Studio is that function
// rather than a socket or a module mock — `mock.module("studiorpc/rpc.ts")` in
// mcp-server.test.ts and procedural-tools.test.ts is process-global and would
// otherwise swallow the calls once those files have run.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioRpcToolProvider, scriptEditTargets } from "../../../src/tools/studiorpc";

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

type WorldNode = Record<string, unknown> & { ActorGuid?: string; LuaChildren?: WorldNode[] };

function makeWorld(): WorldNode {
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

function findWorldNode(node: WorldNode, guid: string): WorldNode | undefined {
  if (node.ActorGuid === guid) return node;
  for (const child of node.LuaChildren ?? []) {
    const found = findWorldNode(child, guid);
    if (found) return found;
  }
  return undefined;
}

/** Stands in for Studio's instance RPCs: reads come from the fixture world, creates get a fresh GUID. */
function studioResult(method: string, params?: Record<string, unknown>): unknown {
  if (method === "instance.read") {
    const node = findWorldNode(makeWorld(), params?.ActorGuid as string);
    return node ? { success: true, instance: node } : { success: true };
  }
  if (method === "instance.create") return { success: true, ActorGuids: ["NEW-1"] };
  return { success: true };
}

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
  if (method !== "lua.validate") return studioResult(method, params);
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
  rpcCalls.length = 0;
  validateFails = false;
});

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scripts are validated by the tool that wrote them", () => {
  test("script_edit validates the script it rewrote and appends the report", async () => {
    const tools = await loadTools(makeStudioProject());
    const result = await tools
      .get("studiorpc_script_edit")!
      .execute({ guid: SCRIPT_GUID, old_string: "print(1)", new_string: "print(2)" }, toolContext());

    expect(validateCalls()).toHaveLength(1);
    expect(validateCalls()[0].params).toMatchObject({ mode: "strict", targetGuids: [SCRIPT_GUID] });
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
});

describe("everything else is left alone", () => {
  test("a rejected edit writes nothing, so it validates nothing", async () => {
    const tools = await loadTools(makeStudioProject(), async () => "reject");

    const result = await tools
      .get("studiorpc_script_edit")!
      .execute({ guid: SCRIPT_GUID, old_string: "print(1)", new_string: "print(2)" }, toolContext());

    expect(result.output).toContain("[Rejected by user]");
    expect(validateCalls()).toHaveLength(0);
  });

  test("an edit whose result names a non-Lua class validates nothing", () => {
    // script_edit also edits a ProceduralModel, whose Source is a Python recipe.
    const edited = (cls?: string) => ({
      output: "",
      metadata: { targetGuid: SCRIPT_GUID, ...(cls && { class: cls }) },
    });
    expect(scriptEditTargets({}, edited("ProceduralModel"))).toEqual([]);
    expect(scriptEditTargets({}, edited("LocalScript"))).toEqual([SCRIPT_GUID]);
    // A path that reports no class is still validated, so validation cannot go quiet unnoticed.
    expect(scriptEditTargets({}, edited())).toEqual([SCRIPT_GUID]);
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
