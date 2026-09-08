// @summary Verifies the native Rig Builder tool contract and write lifecycle.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@diligent/core/tool-contract";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import { StudioRpcError } from "../../../../src/tools/studiorpc/rpc";
import { snapshotsDir } from "../../../../src/tools/studiorpc/tools/snapshot";

interface RpcCall {
  method: string;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

const ROOT_MODEL_GUID = "rig-root-guid-123";

function toolContext(signal = new AbortController().signal) {
  return { toolCallId: "rig-builder-test", signal, abort: () => {} };
}

async function loadRigTool(
  callRpc: (
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ) => Promise<unknown>,
  approve: () => Promise<"once" | "always" | "reject"> = async () => "once",
): Promise<Tool> {
  const provider = createStudioRpcToolProvider({ callRpc });
  const tools = await provider.createTools({ cwd: "/tmp/project", host: { approve } });
  const tool = tools.find((candidate) => candidate.name === "studiorpc_rig_builder_insert");
  if (!tool) throw new Error("studiorpc_rig_builder_insert is not registered");
  return tool;
}

describe("studiorpc_rig_builder_insert", () => {
  test("is discoverable with the exact optional native parameter contract", async () => {
    const tool = await loadRigTool(async () => ({ success: true, instanceGuid: ROOT_MODEL_GUID }));

    expect(tool.parameters.parse({})).toEqual({});
    expect(
      tool.parameters.parse({
        ParentActorGuid: "workspace-child-guid",
        Position: { x: 125, y: 300, z: -50 },
      }),
    ).toEqual({
      ParentActorGuid: "workspace-child-guid",
      Position: { x: 125, y: 300, z: -50 },
    });

    for (const invalid of [
      { Position: { x: 1, y: 2 } },
      { Position: { x: 1, y: 2, z: Number.POSITIVE_INFINITY } },
      { Position: { x: Number.NaN, y: 2, z: 3 } },
      { parentActorGuid: "wrong-casing" },
      { Position: { x: 1, y: 2, z: 3, w: 4 } },
    ]) {
      expect(() => tool.parameters.parse(invalid)).toThrow();
    }
  });

  test("omits defaults, preserves native casing and centimeter coordinates, and saves the created GUID", async () => {
    const calls: RpcCall[] = [];
    const tool = await loadRigTool(async (method, params, options) => {
      calls.push({ method, params, signal: options?.signal });
      return method === "rig_builder.insert" ? { success: true, instanceGuid: ROOT_MODEL_GUID } : { success: true };
    });
    const context = toolContext();

    const defaultResult = await tool.execute(tool.parameters.parse({}), context);
    const positionedResult = await tool.execute(
      tool.parameters.parse({
        ParentActorGuid: "target-parent-guid",
        Position: { x: 125, y: 300, z: -50 },
      }),
      context,
    );

    expect(calls).toEqual([
      { method: "rig_builder.insert", params: {}, signal: context.signal },
      { method: "level.save.file", params: {}, signal: context.signal },
      {
        method: "rig_builder.insert",
        params: { ParentActorGuid: "target-parent-guid", Position: { x: 125, y: 300, z: -50 } },
        signal: context.signal,
      },
      { method: "level.save.file", params: {}, signal: context.signal },
    ]);
    expect(defaultResult.metadata).toEqual({
      method: "rig_builder.insert",
      result: { success: true, instanceGuid: ROOT_MODEL_GUID },
    });
    expect(positionedResult.output).toContain(`"instanceGuid": "${ROOT_MODEL_GUID}"`);
  });

  test("rejects unsuccessful or malformed results without saving", async () => {
    for (const response of [
      { success: false, message: "insert failed" },
      { success: true },
      { success: true, instanceGuid: "" },
    ]) {
      const calls: RpcCall[] = [];
      const tool = await loadRigTool(async (method, params, options) => {
        calls.push({ method, params, signal: options?.signal });
        return response;
      });

      if (response.success === true) {
        await expect(tool.execute({}, toolContext())).rejects.toThrow(/inspect Studio before retrying/i);
      } else {
        await expect(tool.execute({}, toolContext())).rejects.toThrow(/insert failed/);
      }
      expect(calls.map(({ method }) => method)).toEqual(["rig_builder.insert"]);
    }
  });

  test("preserves the created GUID and forbids reinsertion when saving fails", async () => {
    for (const [saveFailure, expectedReason] of [
      [new Error("disk is full"), "disk is full"],
      [{ success: false, message: "save denied" }, "save denied"],
      [{}, "success must be true"],
      [null, "success must be true"],
      [{ success: "yes" }, "success must be true"],
    ] as const) {
      const calls: RpcCall[] = [];
      const tool = await loadRigTool(async (method, params, options) => {
        calls.push({ method, params, signal: options?.signal });
        if (method === "rig_builder.insert") return { success: true, instanceGuid: ROOT_MODEL_GUID };
        if (saveFailure instanceof Error) throw saveFailure;
        return saveFailure;
      });

      const result = await tool.execute({}, toolContext());

      const saveError = (result.metadata?.result as { saveError: string }).saveError;
      expect(typeof saveError).toBe("string");
      expect(saveError.includes(expectedReason)).toBe(true);
      expect(result.metadata?.result).toMatchObject({
        success: true,
        instanceGuid: ROOT_MODEL_GUID,
        saved: false,
        saveError: expect.stringContaining("Do not retry rig_builder.insert"),
      });
      expect(calls.map(({ method }) => method)).toEqual(["rig_builder.insert", "level.save.file"]);
    }
  });

  test("honors approval rejection without calling Studio", async () => {
    const calls: RpcCall[] = [];
    const tool = await loadRigTool(
      async (method, params, options) => {
        calls.push({ method, params, signal: options?.signal });
        return { success: true, instanceGuid: ROOT_MODEL_GUID };
      },
      async () => "reject",
    );

    const result = await tool.execute({}, toolContext());

    expect(result).toEqual({
      output: "[Rejected by user]",
      metadata: { error: true, method: "rig_builder.insert" },
    });
    expect(calls).toEqual([]);
  });

  test("captures the turn snapshot before inserting the rig", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "rig-builder-snapshot-"));
    writeFileSync(join(cwd, "world.umap"), "");
    writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{"InstanceType":"Workspace"}}');
    const snapshotPath = join(snapshotsDir(cwd), "rig-session_0.ovdrjm");
    const snapshotSeenAtInsert: boolean[] = [];
    const provider = createStudioRpcToolProvider({
      callRpc: async (method) => {
        if (method === "rig_builder.insert") snapshotSeenAtInsert.push(existsSync(snapshotPath));
        return method === "rig_builder.insert" ? { success: true, instanceGuid: ROOT_MODEL_GUID } : { success: true };
      },
    });
    const providerWithHook = provider as typeof provider & {
      onUserPromptSubmit: NonNullable<typeof provider.onUserPromptSubmit>;
    };

    try {
      await providerWithHook.onUserPromptSubmit({
        session_id: "rig-session",
        transcript_path: "/tmp/rig-session.jsonl",
        cwd,
        hook_event_name: "UserPromptSubmit",
        prompt: "insert a rig",
      });
      const tools = await provider.createTools({ cwd, host: { approve: async () => "once" } });
      const tool = tools.find((candidate) => candidate.name === "studiorpc_rig_builder_insert")!;

      await tool.execute({}, toolContext());

      expect(snapshotSeenAtInsert).toEqual([true]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("serializes concurrent rig writes through the shared Studio write lock", async () => {
    let releaseFirstInsert!: () => void;
    const firstInsertGate = new Promise<void>((resolve) => {
      releaseFirstInsert = resolve;
    });
    let reportFirstInsertStarted!: () => void;
    const firstInsertStarted = new Promise<void>((resolve) => {
      reportFirstInsertStarted = resolve;
    });
    let insertCount = 0;
    const tool = await loadRigTool(async (method) => {
      if (method === "level.save.file") return { success: true };
      insertCount += 1;
      if (insertCount === 1) {
        reportFirstInsertStarted();
        await firstInsertGate;
      }
      return { success: true, instanceGuid: `${ROOT_MODEL_GUID}-${insertCount}` };
    });

    const first = tool.execute({}, toolContext());
    await firstInsertStarted;
    const second = tool.execute({}, toolContext());
    await Promise.resolve();

    expect(insertCount).toBe(1);
    releaseFirstInsert();
    await Promise.all([first, second]);
    expect(insertCount).toBe(2);
  });

  test("propagates Studio remote errors unchanged and does not retry or save", async () => {
    const remoteError = new StudioRpcError("invalid position", -32001, { field: "Position" });
    const calls: RpcCall[] = [];
    const tool = await loadRigTool(async (method, params, options) => {
      calls.push({ method, params, signal: options?.signal });
      throw remoteError;
    });

    let caught: unknown;
    try {
      await tool.execute({ Position: { x: 1, y: 2, z: 3 } }, toolContext());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(remoteError);
    expect(calls.map(({ method }) => method)).toEqual(["rig_builder.insert"]);
  });

  test("does not retry or save after timeout or cancellation", async () => {
    for (const mode of ["timeout", "cancel"] as const) {
      const controller = new AbortController();
      const calls: RpcCall[] = [];
      const failure =
        mode === "timeout"
          ? new Error("Studio RPC timed out (rig_builder.insert).")
          : new DOMException("cancelled", "AbortError");
      const tool = await loadRigTool(async (method, params, options) => {
        calls.push({ method, params, signal: options?.signal });
        if (mode === "cancel") controller.abort(failure);
        throw failure;
      });

      await expect(tool.execute({}, toolContext(controller.signal))).rejects.toBe(failure);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ method: "rig_builder.insert", signal: controller.signal });
    }
  });
});
