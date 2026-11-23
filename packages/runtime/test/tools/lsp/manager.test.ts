// @summary Tests for the language server manager: lazy start, root resolution, idle shutdown, crash backoff
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToUri } from "../../../src/tools/lsp/client";
import { createFakeLspProject, type FakeLspProject } from "../../helpers/lsp";

let project: FakeLspProject | undefined;

afterEach(async () => {
  await project?.cleanup();
  project = undefined;
});

/**
 * Polls a condition on real server processes (exit, idle timer, restart backoff). Their exits are OS events the
 * manager does not expose as promises, so fake timers cannot drive them.
 */
async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(10);
  }
}

describe("LspManager", () => {
  test("starts a server only on first use and reuses it for the same root", async () => {
    project = await createFakeLspProject();
    const file = join(project.dir, "a.fake");
    await writeFile(file, "x\n");

    expect(await project.workspace.acquire(file, { start: false })).toBeUndefined();
    expect(await project.log()).toEqual([]);

    const first = await project.workspace.acquire(file, { start: true });
    const second = await project.workspace.acquire(file, { start: false });
    expect(second?.client).toBe(first?.client);
    expect((await project.log()).filter((method) => method === "initialize")).toHaveLength(1);
    expect(project.manager.status()).toMatchObject([{ name: "fake", root: project.dir, state: "running" }]);
  });

  test("runs one server per nearest root marker under the working directory", async () => {
    project = await createFakeLspProject();
    await mkdir(join(project.dir, "pkg", "src"), { recursive: true });
    await writeFile(join(project.dir, "pkg", "fake.json"), "{}");
    const nested = join(project.dir, "pkg", "src", "a.fake");
    const top = join(project.dir, "b.fake");

    const inPackage = await project.workspace.acquire(nested, { start: true });
    const atTop = await project.workspace.acquire(top, { start: true });

    expect(inPackage?.client).not.toBe(atTop?.client);
    expect(inPackage?.client.root).toBe(join(project.dir, "pkg"));
    expect(atTop?.client.root).toBe(project.dir);
    expect(
      project.manager
        .status()
        .map((status) => status.root)
        .sort(),
    ).toEqual([project.dir, join(project.dir, "pkg")].sort());
  });

  test("stops an idle server and starts a fresh one on the next use", async () => {
    project = await createFakeLspProject({ manager: { idleTimeoutMs: 50 } });
    const file = join(project.dir, "a.fake");
    const acquired = await project.workspace.acquire(file, { start: true });

    await waitFor(() => !acquired?.client.alive);
    expect(project.manager.status()).toEqual([]);
    expect(await project.workspace.acquire(file, { start: false })).toBeUndefined();

    await project.workspace.acquire(file, { start: true });
    expect((await project.log()).filter((method) => method === "initialize")).toHaveLength(2);
  });

  test("restarts a crashed server after the backoff and reports it failed once the backoff is exhausted", async () => {
    project = await createFakeLspProject({
      server: { crashOn: "textDocument/hover" },
      manager: { restartBackoffMs: [20, 20] },
    });
    const file = join(project.dir, "a.fake");
    const crash = async () => {
      const acquired = await project!.workspace.acquire(file, { start: true });
      await acquired!.client
        .request(
          "textDocument/hover",
          { textDocument: { uri: pathToUri(file) }, position: { line: 0, character: 0 } },
          { timeoutMs: 2_000 },
        )
        .catch(() => {});
      await waitFor(() => !acquired!.client.alive);
    };

    await crash();
    await waitFor(() => project!.manager.status()[0]?.state === "restarting");
    expect(project.manager.status()[0]).toMatchObject({ crashes: 1 });

    await crash(); // restart 1, crash 2
    await crash(); // restart 2, crash 3: backoff exhausted
    await waitFor(() => project!.manager.status()[0]?.state === "failed");
    await expect(project.workspace.acquire(file, { start: true })).rejects.toThrow("stays stopped");
    expect((await project.log()).filter((method) => method === "initialize")).toHaveLength(3);

    await project.manager.shutdown();
    const restarted = await project.workspace.acquire(file, { start: true });
    expect(restarted?.client.alive).toBe(true);
  });

  test("a server that fails to initialize counts as a crash", async () => {
    project = await createFakeLspProject({ server: { failInitialize: true }, manager: { restartBackoffMs: [] } });
    const file = join(project.dir, "a.fake");

    await expect(project.workspace.acquire(file, { start: true })).rejects.toThrow("fake failed to start");
    expect(project.manager.status()).toMatchObject([{ state: "failed", crashes: 1 }]);
  });
});
