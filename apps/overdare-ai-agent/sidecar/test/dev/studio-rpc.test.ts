// @summary Verifies reverse screenshot file mapping in the shared-directory dev adapter.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevStudioRpc } from "../../src/dev/studio-rpc";
import { createStudioRpcToolProvider } from "../../src/tools/studiorpc";

describe("dev screenshot file mapping", () => {
  const options = { enabled: true, localFileRoot: "/Volumes/shared", remoteFileRoot: "C:\\Shared" };

  test("maps screenshot paths back to the agent mount without modifying other fields", async () => {
    const original = {
      success: true,
      path: "C:\\Shared\\Shots\\first.png",
      paths: ["C:\\Shared\\Shots\\first.png", "C:/Shared/Shots/second.png"],
      camera: { marker: "unchanged" },
    };
    const calls: unknown[] = [];
    const rpc = createDevStudioRpc(options, async (...args) => {
      calls.push(args);
      return original;
    });
    const result = await rpc("game.screenshot", { includeGui: false });
    expect(result).toEqual({
      ...original,
      path: "/Volumes/shared/Shots/first.png",
      paths: ["/Volumes/shared/Shots/first.png", "/Volumes/shared/Shots/second.png"],
      studioPath: original.path,
    });
    expect(original.path).toBe("C:\\Shared\\Shots\\first.png");
    expect(calls).toHaveLength(1);
  });

  test("does not remap paths outside the share or traversal paths", async () => {
    for (const path of ["C:\\Elsewhere\\shot.png", "C:\\Shared\\..\\secret.png", "C:\\SharedElsewhere\\shot.png"]) {
      const rpc = createDevStudioRpc(options, async () => ({ success: true, path }));
      expect(await rpc("game.screenshot", {})).toEqual({ success: true, path });
    }
  });

  test("production and unconfigured adapters preserve the original transport", () => {
    const rpc = async () => ({});
    expect(createDevStudioRpc({ ...options, enabled: false }, rpc)).toBe(rpc);
    expect(createDevStudioRpc({ enabled: true }, rpc)).toBe(rpc);
  });

  test("a remote screenshot is attached inline through the shared tool provider", async () => {
    const localFileRoot = mkdtempSync(join(tmpdir(), "studio-shot-mount-"));
    try {
      writeFileSync(join(localFileRoot, "shot.png"), Buffer.from("iVBORw0KGgo=", "base64"));
      const callRpc = createDevStudioRpc({ ...options, localFileRoot }, async () => ({
        success: true,
        path: "C:\\Shared\\shot.png",
      }));
      const tools = await createStudioRpcToolProvider({ callRpc }).createTools({ cwd: localFileRoot });
      const result = await tools
        .find((tool) => tool.name === "studiorpc_game_screenshot")!
        .execute(
          {},
          {
            toolCallId: "shot",
            signal: new AbortController().signal,
            abort() {},
          },
        );
      expect(result.outputImages).toHaveLength(1);
      expect(result.outputImages![0].source.data).toBe("iVBORw0KGgo=");
      expect(JSON.parse(result.output).path).toBe(join(localFileRoot, "shot.png"));
    } finally {
      rmSync(localFileRoot, { recursive: true, force: true });
    }
  });
});
