// @summary Tests atomic product experiment persistence and response refresh.

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleExperimentsList, handleExperimentsSet } from "../../src/app-server/experiment-handlers";
import { resolveExperimentStates } from "../../src/experiments";

const definitions = [
  {
    id: "procedural",
    title: "Procedural generation",
    description: "Procedural preview.",
    defaultEnabled: false,
    toolNames: ["procedural_tool"],
    skillNames: ["procedural-skill"],
  },
];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("experiment handlers", () => {
  it("persists one override, reloads once, and returns the refreshed coupled state", async () => {
    const home = await mkdtemp(join(tmpdir(), "diligent-experiments-"));
    tempDirs.push(home);
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    let states = resolveExperimentStates(definitions, undefined);
    let reloads = 0;
    const manager = { getDefinitions: () => definitions, getExperiments: () => states };

    try {
      expect(handleExperimentsList(manager).experiments[0]?.enabled).toBe(false);
      const result = await handleExperimentsSet(
        manager,
        async () => {
          reloads += 1;
          states = resolveExperimentStates(definitions, { procedural: true });
          return { skills: [] };
        },
        new Map(),
        { overrides: { procedural: true } },
      );
      expect(reloads).toBe(1);
      expect(result.experiments[0]?.enabled).toBe(true);
      expect(await Bun.file(join(home, ".diligent", "config.jsonc")).json()).toMatchObject({
        experiments: { overrides: { procedural: true } },
      });
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("rejects experiment ids not advertised by the product", async () => {
    const manager = {
      getDefinitions: () => definitions,
      getExperiments: () => resolveExperimentStates(definitions, undefined),
    };
    await expect(
      handleExperimentsSet(manager, async () => ({ skills: [] }), new Map(), { overrides: { unknown: true } }),
    ).rejects.toThrow("Unknown experiment");
  });

  it("runs a product side effect only for experiments whose state changed, without failing the save", async () => {
    const home = await mkdtemp(join(tmpdir(), "diligent-experiments-"));
    tempDirs.push(home);
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    const calls: string[] = [];
    let signalCall = () => {};
    const nextCall = () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      signalCall = resolve;
      return promise;
    };
    const withHooks = [
      {
        ...definitions[0]!,
        onEnabledChange: async (enabled: boolean) => {
          calls.push(`procedural:${enabled}`);
          signalCall();
          throw new Error("Studio is not connected");
        },
      },
      {
        id: "steady",
        title: "Steady",
        description: "Unchanged experiment.",
        defaultEnabled: true,
        onEnabledChange: (enabled: boolean) => {
          calls.push(`steady:${enabled}`);
          signalCall();
        },
      },
    ];
    let states = resolveExperimentStates(withHooks, undefined);
    const manager = { getDefinitions: () => withHooks, getExperiments: () => states };
    const reload = (overrides: Record<string, boolean>) => async () => {
      states = resolveExperimentStates(withHooks, overrides);
      return { skills: [] };
    };

    try {
      const firstCall = nextCall();
      const result = await handleExperimentsSet(manager, reload({ procedural: true }), new Map(), {
        overrides: { procedural: true, steady: true },
      });
      expect(result.experiments.find((entry) => entry.id === "procedural")?.enabled).toBe(true);
      await firstCall;
      expect(calls).toEqual(["procedural:true"]);

      // An unchanged save fires nothing; the next real transition proves no call was queued in between.
      await handleExperimentsSet(manager, reload({ procedural: true }), new Map(), {
        overrides: { procedural: true },
      });
      const disableCall = nextCall();
      await handleExperimentsSet(manager, reload({}), new Map(), { overrides: { procedural: false } });
      await disableCall;
      expect(calls).toEqual(["procedural:true", "procedural:false"]);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});
