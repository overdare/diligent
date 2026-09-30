// @summary Tests the animation.read / animation.write wrappers: params, preview images, and error data passthrough.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dropEmptyOptionals } from "@diligent/core/tool-contract";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import * as animationCheck from "../../../../src/tools/studiorpc/methods/animation.check";
import * as animationPublish from "../../../../src/tools/studiorpc/methods/animation.publish";
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
    const solved = {
      animation: CONTRACT_ANIMATION,
      pins: [
        { bone: "RightHand", frames: [0, 4], pole: [-40, -10, 90], path: [{ frame: 0, position: [-20, 25, 120] }] },
        { bone: "RightFoot", frames: [5, 9], pivot: "toe" },
      ],
    };
    expect(animationWrite.params.safeParse(solved).success).toBe(true);
    expect(
      animationWrite.params.safeParse({
        animation: CONTRACT_ANIMATION,
        pins: [{ bone: "RightFoot", frames: [0, 4], pivot: "heel" }],
      }).success,
    ).toBe(false);
    expect(
      animationWrite.params.safeParse({
        animation: CONTRACT_ANIMATION,
        pins: [{ bone: "RightHand", frames: [0, 4], path: [{ frame: 0, position: [0, 0, 0], rotation: [0, 0, 0] }] }],
      }).success,
    ).toBe(false);
  });

  test("read opens a clip by assetPath or an animation by assetId", () => {
    expect(animationRead.params.parse({ assetId: "ovdrassetid://42", preview: true })).toEqual({
      assetId: "ovdrassetid://42",
      preview: true,
    });
    expect(animationRead.normalizeArgs({ assetId: " ", assetPath: ASSET })).toEqual({ assetPath: ASSET });
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

  test("publish sends the clip and revision, returns the id, and warns against a second upload", async () => {
    const seen: Array<{ method: string; params: unknown; timeoutMs?: number }> = [];
    const result = { assetPath: ASSET, revision: "rev-2", assetId: "ovdrassetid://42", worldAssetId: "42" };
    const tool = await toolFor("studiorpc_animation_publish", async (method, params, options) => {
      seen.push({ method, params, timeoutMs: options?.timeoutMs });
      return result;
    });
    const out = await tool.execute(tool.parameters.parse({ assetPath: ASSET, revision: "rev-2" }), toolContext());
    expect(seen).toEqual([
      { method: "animation.publish", params: { assetPath: ASSET, revision: "rev-2" }, timeoutMs: 180_000 },
    ]);
    expect(JSON.parse(out.output)).toEqual(result);

    const timedOut = await toolFor("studiorpc_animation_publish", async () => {
      throw new Error("Studio RPC timed out (animation.publish).");
    });
    const error = (await timedOut
      .execute(timedOut.parameters.parse({ assetPath: ASSET }), toolContext())
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toContain("Publishing again creates a second asset");
  });
});

describe("animation.check", () => {
  test("takes the write format and pins, never an asset, and reaches Studio as animation.check", async () => {
    const pins = [{ bone: "RightHand", frames: [10, 10], position: [-20, 25, 120] }];
    expect(animationCheck.params.parse({ animation: CONTRACT_ANIMATION, pins, frames: [0, 10] })).toBeDefined();
    expect(() => animationCheck.params.parse({ animation: CONTRACT_ANIMATION, assetPath: ASSET })).toThrow();
    expect(() =>
      animationCheck.params.parse({ animation: CONTRACT_ANIMATION, frames: Array.from({ length: 25 }, (_, i) => i) }),
    ).toThrow();
    expect(animationCheck.normalizeArgs({ animation: CONTRACT_ANIMATION, pins: [], frames: [] })).toEqual({
      animation: CONTRACT_ANIMATION,
    });
    expect(mutatingMethods.has(animationCheck.method)).toBe(false);
    expect(savingMethods.has(animationCheck.method)).toBe(false);
    const seen: string[] = [];
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method) => {
        seen.push(method);
        return { status: "completed", frames: [] };
      },
    }).createTools({ cwd: tmpdir() });
    const tool = tools.find((candidate) => candidate.name === "studiorpc_animation_check")!;
    await tool.execute(tool.parameters.parse({ animation: CONTRACT_ANIMATION }), toolContext());
    expect(seen).toEqual(["animation.check"]);
  });

  test("puts each frame on one line at 0.1 cm and keeps valid JSON", () => {
    const result = {
      status: "completed",
      saved: false,
      floor: { status: "completed", belowFloor: [] },
      frames: [
        { frame: 0, joints: { RightHand: [-35.61234, 4.3456, 75.2] }, penetrations: [] },
        { frame: 10, joints: { RightHand: [-20.04, 25.01, 119.96] }, penetrations: [] },
      ],
    };
    const text = animationCheck.postProcess(result) as string;
    expect(text.split("\n").filter((line) => line.includes('"joints"'))).toHaveLength(2);
    expect(JSON.parse(text).frames[0].joints.RightHand).toEqual([-35.6, 4.3, 75.2]);
    expect(text.indexOf('"floor"')).toBeLessThan(text.indexOf('"frames"'));
  });
});

describe("animation.publish params", () => {
  test("need an assetPath, take an optional revision, and touch neither the level nor its save", () => {
    expect(animationPublish.params.safeParse({}).success).toBe(false);
    expect(animationPublish.params.safeParse({ assetPath: ASSET, public: true }).success).toBe(false);
    expect(animationPublish.normalizeArgs({ assetPath: ASSET, revision: " " })).toEqual({ assetPath: ASSET });
    expect(mutatingMethods.has(animationPublish.method)).toBe(false);
    expect(savingMethods.has(animationPublish.method)).toBe(false);
  });
});

describe("animation result text", () => {
  test("keeps a pinned write small: counts instead of the baked keys, short fields first, still valid JSON", async () => {
    const bones = Array.from({ length: 14 }, (_, i) => `Bone${i}`);
    const poseSamples = Array.from({ length: 12 }, (_, frame) => ({
      frame,
      bones: Object.fromEntries(
        bones.map((bone) => [
          bone,
          { componentTranslationCm: [21.234, 0.125, 99.241], rotationQuat: [0.443, 0.1, 0.2, 0.87] },
        ]),
      ),
      lowestCm: 0.5,
      touchingFloor: ["LeftFoot"],
    }));
    const baked = Array.from({ length: 76 }, (_, frame) => ({
      frame,
      rotation: [1.25, -12.5, 33.75],
      interp: "cubic",
    }));
    const png = join(dir, "sheet.png");
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = {
      assetPath: ASSET,
      revision: "r1-x",
      animation: { ...CONTRACT_ANIMATION, tracks: { LeftUpperLeg: baked, LeftLowerLeg: baked, LeftFoot: baked } },
      saved: true,
      pins: [{ bone: "LeftFoot", frames: [0, 75], maxErrorCm: 0, outOfReachFrames: 0 }],
      preview: { status: "completed", imagePath: png, poseSamples, floor: { status: "completed", belowFloor: [] } },
    };
    const text = animationWrite.postProcess(result) as string;
    expect(typeof text).toBe("string");
    const { animation, ...rest } = JSON.parse(text);
    const { animation: _sent, ...resultRest } = result;
    expect(rest).toEqual(resultRest);
    expect(animation).toMatchObject({ name: CONTRACT_ANIMATION.name, tracks: 3, keys: 228 });
    expect(text).not.toContain("33.75");
    expect(text.indexOf('"floor"')).toBeLessThan(text.indexOf('"poseSamples"'));
    expect(text.indexOf('"poseSamples"')).toBeLessThan(text.indexOf('"animation"'));
    expect(await animationWrite.attachImages(text)).toHaveLength(1);
    const noisy = { preview: { status: "skipped", poseSamples: [{ frame: 0, lowestCm: 1.23456789e-13 }] } };
    expect(JSON.parse(animationWrite.postProcess(noisy) as string).preview.poseSamples[0].lowestCm).toBe(0);
  });

  test("drops the capture cameras and a small compression error, keeps a large or failed one", () => {
    const preview = (compression: Record<string, unknown>) => ({
      preview: {
        status: "completed",
        cameras: [{ view: "front", componentPosition: [0, 500, 90] }],
        compression,
        clearance: { status: "completed", penetrations: [] },
      },
    });
    const small = { status: "completed", maxTranslationErrorCm: 0.02, maxRotationErrorDeg: 0.3 };
    const large = { status: "completed", maxTranslationErrorCm: 0.02, maxRotationErrorDeg: 4 };
    const failed = { status: "failed", reason: "no compressed data" };
    const shown = (compression: Record<string, unknown>) =>
      JSON.parse(animationRead.postProcess(preview(compression)) as string).preview;
    expect(shown(small)).toEqual({
      status: "completed",
      clearance: { status: "completed", penetrations: [] },
    });
    expect(shown(large).compression).toEqual(large);
    expect(shown(failed).compression).toEqual(failed);
    expect(shown(large).cameras).toBeUndefined();
  });

  test("a read with assetPath keeps the whole animation", () => {
    const result = { assetPath: ASSET, revision: "r1-x", animation: CONTRACT_ANIMATION };
    expect(JSON.parse(animationRead.postProcess(result) as string)).toEqual(result);
  });

  test("the rig keeps animatable bones one line each and names the others", () => {
    const transform = (x: number) => ({
      refLocal: { translation: [x, 0.123456, 0], rotation: [0, 0, 0], rotationQuat: [0, 0, 0, 1] },
      refComponent: {
        translation: [x, 0, 1e-9],
        rotationQuat: [0, 0, 0, 1],
        axisX: [1, 0, 0],
        axisY: [0, 1, 0],
        axisZ: [0, 0, 1],
      },
    });
    const result = {
      rig: {
        boneCount: 3,
        bones: [
          { name: "Root", index: 0, parent: null, editable: true, inPreviewMesh: true, ...transform(0) },
          { name: "IKFootRoot", index: 1, parent: "Root", editable: false, inPreviewMesh: true, ...transform(1) },
          { name: "LowerTorso", index: 2, parent: "Root", editable: true, inPreviewMesh: true, ...transform(2) },
        ],
      },
      template: { version: 1 },
    };
    const text = animationRead.postProcess(result) as string;
    const rig = JSON.parse(text).rig;
    expect(rig.notAnimatable).toEqual(["IKFootRoot"]);
    expect(rig.bones.map((bone: { name: string }) => bone.name)).toEqual(["Root", "LowerTorso"]);
    expect(rig.bones[1]).toEqual({
      name: "LowerTorso",
      parent: "Root",
      refLocal: { translation: [2, 0.12, 0] },
      refComponent: { translation: [2, 0, 0], axisX: [1, 0, 0], axisY: [0, 1, 0], axisZ: [0, 0, 1] },
    });
    expect(text).toContain('\n      {"name":"LowerTorso"');
    expect(JSON.parse(animationRead.postProcess({ rig: { bones: [] } }) as string)).toEqual({
      rig: { bones: [], notAnimatable: [] },
    });
  });
});
