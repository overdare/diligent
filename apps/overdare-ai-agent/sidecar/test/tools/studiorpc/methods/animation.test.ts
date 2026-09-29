// @summary Tests the animation.read / animation.write wrappers: params, preview images, and error data passthrough.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dropEmptyOptionals } from "@diligent/core/tool-contract";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import * as animationRead from "../../../../src/tools/studiorpc/methods/animation.read";
import * as animationWrite from "../../../../src/tools/studiorpc/methods/animation.write";
import { StudioRpcError } from "../../../../src/tools/studiorpc/rpc";
import { mutatingMethods, savingMethods } from "../../../../src/tools/studiorpc/tool-registry";

const CONTRACT_ANIMATION = {
  version: 1,
  name: "PoC_Elbow",
  fps: 30,
  durationFrames: 30,
  tracks: {
    RightLowerArm: [
      { frame: 0, rotation: [0, 0, 0] },
      { frame: 15, rotation: [0, 30, 0], translation: [0, 0, 0] },
      { frame: 30, rotation: [0, 0, 0] },
    ],
  },
};
const ASSET = "/Temp/AnimationAssets/PoC_Elbow.PoC_Elbow";

const dir = mkdtempSync(join(tmpdir(), "animation-preview-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function toolContext() {
  return { toolCallId: "call", sessionId: "agent-session", signal: new AbortController().signal, abort() {} };
}

describe("animation params", () => {
  test("accept the contract examples unchanged", () => {
    const create = { animation: CONTRACT_ANIMATION };
    expect(animationWrite.params.parse(create)).toEqual(create);
    const replace = { animation: CONTRACT_ANIMATION, assetPath: ASSET, revision: "rev-1", preview: false };
    expect(animationWrite.params.parse(replace)).toEqual(replace);
    const empty = { animation: { ...CONTRACT_ANIMATION, tracks: {} }, preview: { frames: [0, 15], views: ["side"] } };
    expect(animationWrite.params.parse(empty)).toEqual(empty);

    expect(animationRead.params.parse({})).toEqual({});
    const read = { assetPath: ASSET, preview: { frames: [15], views: ["front", "side"] } };
    expect(animationRead.params.parse(read)).toEqual(read);
    expect(animationRead.params.parse({ assetPath: ASSET, preview: false })).toEqual({
      assetPath: ASSET,
      preview: false,
    });
  });

  test("reject unknown fields at every level", () => {
    const withKey = (key: Record<string, unknown>) => ({
      animation: { ...CONTRACT_ANIMATION, tracks: { RightLowerArm: [{ frame: 0, ...key }] } },
    });
    expect(animationWrite.params.safeParse({ animation: CONTRACT_ANIMATION, extra: 1 }).success).toBe(false);
    expect(animationWrite.params.safeParse({ animation: { ...CONTRACT_ANIMATION, loop: true } }).success).toBe(false);
    expect(animationWrite.params.safeParse(withKey({ scale: [1, 1, 1] })).success).toBe(false);
    expect(animationWrite.params.safeParse(withKey({ interpolation: "cubic" })).success).toBe(false);
    expect(
      animationWrite.params.safeParse({ animation: CONTRACT_ANIMATION, preview: { frames: [0], size: 2 } }).success,
    ).toBe(false);
    expect(animationRead.params.safeParse({ assetPath: ASSET, revision: "rev-1" }).success).toBe(false);
  });

  test("reject malformed values instead of fixing them", () => {
    const bad = (animation: Record<string, unknown>) =>
      animationWrite.params.safeParse({ animation: { ...CONTRACT_ANIMATION, ...animation } }).success;
    expect(bad({ version: 2 })).toBe(false);
    expect(bad({ fps: 24 })).toBe(false);
    expect(bad({ durationFrames: 0 })).toBe(false);
    expect(bad({ name: "1bad" })).toBe(false);
    expect(bad({ tracks: { RightLowerArm: [] } })).toBe(false);
    expect(bad({ tracks: { RightLowerArm: [{ frame: 1.5 }] } })).toBe(false);
    expect(bad({ tracks: { RightLowerArm: [{ frame: 0, rotation: [0, 30] }] } })).toBe(false);
    expect(bad({ tracks: { RightLowerArm: [{ frame: 0, rotation: [0, "30", 0] }] } })).toBe(false);
    expect(bad({ tracks: { RightLowerArm: [{ frame: 0, translation: [0, Number.POSITIVE_INFINITY, 0] }] } })).toBe(
      false,
    );
    expect(
      animationWrite.params.safeParse({
        animation: CONTRACT_ANIMATION,
        preview: { frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
      }).success,
    ).toBe(false);
    expect(
      animationWrite.params.safeParse({ animation: CONTRACT_ANIMATION, preview: { views: ["top"] } }).success,
    ).toBe(false);
  });

  test("accept interp, pins and the motion column", () => {
    const withKey = (key: Record<string, unknown>) => ({
      animation: { ...CONTRACT_ANIMATION, tracks: { RightLowerArm: [{ frame: 0, ...key }] } },
    });
    const cubic = withKey({ interp: "cubic" });
    expect(animationWrite.params.safeParse(cubic).success).toBe(true);
    expect(animationWrite.params.safeParse(withKey({ interp: "bezier" })).success).toBe(false);
    const pinned = {
      animation: CONTRACT_ANIMATION,
      pins: [
        { bone: "RightHand", frames: [0, 10] },
        { bone: "LeftFoot", frames: [5, 20], position: [10, 0, 0], flat: true },
      ],
      preview: { frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], motion: false },
    };
    expect(animationWrite.params.safeParse(pinned).success).toBe(true);
    expect(
      animationWrite.params.safeParse({ animation: CONTRACT_ANIMATION, pins: [{ bone: "Head", frames: [0, 1] }] })
        .success,
    ).toBe(false);
    expect(
      animationWrite.params.safeParse({ animation: CONTRACT_ANIMATION, pins: [{ bone: "RightHand", frames: [0] }] })
        .success,
    ).toBe(false);
  });

  test("blank optional strings from strict-schema models read as not given", () => {
    expect(animationRead.normalizeArgs({ assetPath: " \u200b", preview: false })).toEqual({ preview: false });
    expect(
      animationWrite.normalizeArgs({ animation: CONTRACT_ANIMATION, assetPath: "", revision: " ", pins: [] }),
    ).toEqual({ animation: CONTRACT_ANIMATION });
  });

  test("preview true reaches Studio as the default-capture object", () => {
    // The tool loops drop `{}` on an optional parameter, so `true` is how an agent asks for defaults.
    expect(dropEmptyOptionals(animationRead.params, { assetPath: ASSET, preview: {} })).toEqual({ assetPath: ASSET });
    const args = animationRead.params.parse(
      dropEmptyOptionals(animationRead.params, { assetPath: ASSET, preview: true }),
    );
    expect(animationRead.normalizeArgs(args)).toEqual({ assetPath: ASSET, preview: {} });
    expect(animationWrite.normalizeArgs({ animation: CONTRACT_ANIMATION, preview: false })).toEqual({
      animation: CONTRACT_ANIMATION,
      preview: false,
    });
  });

  test("writes a clip asset, not the level", () => {
    expect(animationRead.readOnly).toBe(true);
    expect(mutatingMethods.has(animationWrite.method)).toBe(false);
    expect(savingMethods.has(animationWrite.method)).toBe(false);
    expect(animationRead.timeoutMs).toBeGreaterThanOrEqual(120_000);
    expect(animationWrite.timeoutMs).toBeGreaterThanOrEqual(120_000);
  });
});

describe("animation preview images", () => {
  const png = join(dir, "PoC_Elbow_rev.png");
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  test("returns the contact sheet for a completed preview", async () => {
    const images = await animationWrite.attachImages({ preview: { status: "completed", imagePath: png } });
    expect(images).toEqual([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
        },
      },
    ]);
    expect(await animationRead.attachImages({ preview: { status: "completed", imagePath: png } })).toEqual(images);
  });

  test("returns nothing for skipped, failed, missing file, or no preview", async () => {
    expect(await animationWrite.attachImages({ preview: { status: "skipped" } })).toBeUndefined();
    expect(
      await animationWrite.attachImages({ preview: { status: "failed", imagePath: png, diagnostic: "x" } }),
    ).toBeUndefined();
    expect(
      await animationWrite.attachImages({ preview: { status: "completed", imagePath: join(dir, "gone.png") } }),
    ).toBeUndefined();
    expect(await animationRead.attachImages({ rig: {}, template: {} })).toBeUndefined();
    expect(await animationRead.attachImages(undefined)).toBeUndefined();
  });
});

describe("animation tools over the generic Studio RPC path", () => {
  async function toolFor(name: string, callRpc: Parameters<typeof createStudioRpcToolProvider>[0]["callRpc"]) {
    const tools = await createStudioRpcToolProvider({ callRpc }).createTools({ cwd: tmpdir() });
    return tools.find((tool) => tool.name === name)!;
  }

  test("are registered under the studiorpc_ names and attach the image", async () => {
    const png = join(dir, "sheet.png");
    writeFileSync(png, "png-bytes");
    const seen: Array<{ method: string; params: unknown; timeoutMs?: number }> = [];
    const result = { assetPath: ASSET, revision: "rev-2", preview: { status: "completed", imagePath: png } };
    const tool = await toolFor("studiorpc_animation_write", async (method, params, options) => {
      seen.push({ method, params, timeoutMs: options?.timeoutMs });
      return result;
    });
    const out = await tool.execute(
      tool.parameters.parse({ animation: CONTRACT_ANIMATION, preview: true }),
      toolContext(),
    );
    expect(seen).toEqual([
      { method: "animation.write", params: { animation: CONTRACT_ANIMATION, preview: {} }, timeoutMs: 120_000 },
    ]);
    expect(out.outputImages).toHaveLength(1);
    expect(JSON.parse(out.output)).toEqual(result);
    expect(await toolFor("studiorpc_animation_read", async () => ({}))).toBeDefined();
  });

  test("carry Studio error data into the message the agent reads", async () => {
    const data = {
      kind: "REVISION_CONFLICT",
      errors: [{ path: "revision", message: "stale" }],
      currentRevision: "rev-9",
      assetPath: ASSET,
      applied: false,
      saved: false,
    };
    const tool = await toolFor("studiorpc_animation_write", async () => {
      throw new StudioRpcError("Studio RPC error [-32602]: revision conflict", -32602, data);
    });
    const args = tool.parameters.parse({ animation: CONTRACT_ANIMATION, assetPath: ASSET, revision: "rev-1" });
    const error = (await tool.execute(args, toolContext()).catch((e: unknown) => e)) as StudioRpcError;
    expect(error).toBeInstanceOf(StudioRpcError);
    expect(error.code).toBe(-32602);
    expect(error.data).toEqual(data);
    expect(error.message).toContain("revision conflict");
    expect(error.message).toContain('"kind": "REVISION_CONFLICT"');
    expect(error.message).toContain('"currentRevision": "rev-9"');
    expect(error.message).toContain('"saved": false');
  });

  test("warn against repeating a create after a timeout", async () => {
    const tool = await toolFor("studiorpc_animation_write", async () => {
      throw new Error("Studio RPC timed out (animation.write).");
    });
    const error = (await tool
      .execute(tool.parameters.parse({ animation: CONTRACT_ANIMATION }), toolContext())
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toContain("Studio RPC timed out");
    expect(error.message).toContain("Do not repeat it blindly");
  });
});
