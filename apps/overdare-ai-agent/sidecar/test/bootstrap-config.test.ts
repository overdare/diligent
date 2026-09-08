// @summary Verifies OVERDARE bootstrap config defaults and essential cross-tool prompt policy.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("OVERDARE bootstrap config", () => {
  test("keeps cross-tool play-test policy without duplicating individual tool definitions", async () => {
    const prompt = await readFile(join(import.meta.dir, "../../bootstrap/system-prompt.txt"), "utf-8");

    expect(prompt).toContain("spatial directions and locations in the user's current viewport");
    expect(prompt).toContain("drive it yourself with the play-test input tools");
    expect(prompt).toContain("Ask the user to play-test by hand only when");
    expect(prompt).not.toContain("<play-test-input>");
    expect(prompt).not.toContain("`studiorpc_game_pie_status` ");
  });
  test("injects live JSON discovery and non-retry Editor recovery policy", async () => {
    const prompt = await readFile(join(import.meta.dir, "../../bootstrap/system-prompt.txt"), "utf-8");
    expect(prompt).toContain("studiorpc_instance_schema_search");
    expect(prompt).toContain("not the complete Luau member list");
    expect(prompt).toContain("mutation_attempted");
    expect(prompt).toContain("never automatically replay failed code");
    expect(prompt).toContain("without local defaults");
    expect(prompt).toContain("as the default for world creation and editing");
    expect(prompt).toContain("Successful Editor execution already saves the level");
    expect(prompt).toContain("Do not reject a class based on an old local catalog");
    expect(prompt).not.toContain("studiorpc_proceduralmodel_");
    expect(prompt).not.toContain("geometry-recipe");
  });
  test("VFX guidance requires caller-supplied tags and explicit playback settings", async () => {
    const skill = await readFile(join(import.meta.dir, "../../bootstrap/skills/vfx-recipe/SKILL.md"), "utf-8");
    expect(skill).not.toContain("are injected by the sidecar");
    expect(skill).not.toContain("default true");
    expect(skill).toContain("Include the required ObjectType tags");
  });
});
