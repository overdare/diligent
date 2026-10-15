// @summary Verifies read-only sequence reads, bounded timeline output and offline catalog fallback.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import * as read from "../../../../src/tools/studiorpc/methods/action-sequence.read";
import {
  enrichClipDurations,
  parseAnimationCatalog,
} from "../../../../src/tools/studiorpc/methods/action-sequence-shared";

const dir = mkdtempSync(join(tmpdir(), "action-sequence-read-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("action_sequence.read", () => {
  test("reads list/detail without approval, snapshot or save", async () => {
    const calls: string[] = [];
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        return { sequences: [] };
      },
    }).createTools({ cwd: dir });
    const tool = tools.find((candidate) => candidate.name === "studiorpc_action_sequence_read")!;
    expect(tool).toBeDefined();
    const result = await tool.execute(
      {},
      { toolCallId: "read", sessionId: "test", signal: new AbortController().signal, abort() {} },
    );
    expect(result.metadata?.error).not.toBe(true);
    expect(calls).toEqual(["action_sequence.read"]);
    expect(JSON.parse(result.output)).toEqual({ sequences: [] });
  });

  test("validates explicit raw reads and rejects ambiguous list options", () => {
    expect(read.params.parse({})).toEqual({});
    expect(read.params.parse({ instanceGuid: "guid", raw: true })).toEqual({ instanceGuid: "guid", raw: true });
    expect(read.params.safeParse({ raw: true }).success).toBe(false);
    expect(read.params.safeParse({ instanceGuid: "" }).success).toBe(false);
    expect(read.params.safeParse({ instanceGuid: "guid", Data: "{}" }).success).toBe(false);
  });

  test("keeps each timeline track on one line and raw JSON as a path", async () => {
    const input = {
      Name: "Attack",
      rawJsonPath: "C:/fixture.json",
      timeline: [{ trackIndex: 0, kind: "Animation", StartTime: 0, EndTime: 1 }],
      issues: [],
    };
    const result = await read.postProcess(input);
    expect(JSON.parse(result)).toEqual(input);
    expect(result).toContain('    {"trackIndex":0,"kind":"Animation","StartTime":0,"EndTime":1}');
    expect(result).not.toContain('"Data"');
  });

  test("bounds preview times and requires an explicit source", () => {
    expect(read.params.parse({ instanceGuid: "guid", preview: { times: [0, 0.2] } }).preview).toEqual({
      times: [0, 0.2],
    });
    expect(read.params.parse({ instanceGuid: "guid", preview: true }).preview).toBe(true);
    expect(read.params.parse({ instanceGuid: "guid", preview: {} }).preview).toEqual({});
    expect(
      read.params.safeParse({ instanceGuid: "guid", preview: { times: Array.from({ length: 22 }, (_, i) => i) } })
        .success,
    ).toBe(true);
    for (const preview of [
      { times: [] },
      { times: [-1] },
      { times: [0, 0] },
      { times: [NaN] },
      { times: Array.from({ length: 23 }, (_, i) => i) },
      { times: [0], views: ["front"] },
    ]) {
      expect(read.params.safeParse({ instanceGuid: "guid", preview }).success).toBe(false);
    }
    expect(read.params.safeParse({ preview: { times: [0] } }).success).toBe(false);
    expect(read.timeoutMs).toBeGreaterThan(120_000);
  });

  test("attaches a completed preview image and preserves failed numeric output", async () => {
    const path = join(dir, "preview.png");
    writeFileSync(path, Buffer.from([137, 80, 78, 71]));
    const result = { preview: { status: "completed", imagePath: path, poseSamples: [{ timeSeconds: 0 }] } };
    const output = await read.postProcess(result);
    expect(JSON.parse(output)).toEqual(result);
    expect((await read.attachImages(output))?.[0]?.source).toEqual({
      type: "base64",
      media_type: "image/png",
      data: "iVBORw==",
    });
    expect(await read.attachImages({ preview: { status: "failed", reason: "mesh unavailable" } })).toBeUndefined();
  });
});

describe("offline animation duration catalog", () => {
  test("parses asset IDs and seconds only within the same animation entry", () => {
    const result = parseAnimationCatalog(
      "## Known\n- Asset ID: ovdrassetid://123\n- Duration: 0.43s\n## Unknown\n- Asset ID: ovdrassetid://456\n## Other\n- Duration: 9s",
    );
    expect(result.get("ovdrassetid://123")).toBe(0.43);
    expect(result.has("ovdrassetid://456")).toBe(false);
  });

  test("fills unknown durations without overriding loaded clips or inventing missing data", async () => {
    const catalog = join(dir, "catalog");
    mkdirSync(catalog);
    writeFileSync(join(catalog, "test.md"), "## Clip\n- Asset ID: ovdrassetid://123\n- Duration: 0.43s");
    const row = (id: string, duration: number | null) => ({
      kind: "Animation",
      trackIndex: 0,
      StartTime: 0,
      EndTime: 1,
      OvdrAssetId: { ovdrAssetId: id },
      clipDurationSeconds: duration,
      clipDurationSource: duration === null ? "unknown" : "memory",
    });
    const result = await enrichClipDurations(
      {
        timeline: [row("ovdrassetid://123", null), row("ovdrassetid://123", 2), row("ovdrassetid://999", null)],
        issues: [],
      },
      catalog,
    );
    expect(result.timeline[0]?.clipDurationSeconds).toBe(0.43);
    expect(result.timeline[0]?.clipDurationSource).toBe("catalog");
    expect(result.timeline[1]?.clipDurationSeconds).toBe(2);
    expect(result.timeline[2]?.clipDurationSeconds).toBeNull();
    expect(result.issues[0]?.kind).toBe("clipRepeats");
    expect(result.issues[0]?.severity).toBe("info");
    expect(result.issues[0]?.evidence).toEqual({
      clipDurationSeconds: 0.43,
      remainingClipSeconds: 0.43,
      intervalSeconds: 1,
      source: "catalog",
    });
  });
});
