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
  test("uses full discovery for unknown classes without requiring it for known classes", async () => {
    const prompt = await readFile(join(import.meta.dir, "../../bootstrap/system-prompt.txt"), "utf-8");
    expect(prompt).toContain("studiorpc_instance_schema_search");
    expect(prompt).toContain("not the complete Luau member list");
    expect(prompt).toContain("mutation_attempted");
    expect(prompt).toContain("never automatically replay failed code");
    expect(prompt).toContain('with `{"query":""}`');
    expect(prompt).toContain("If you do not know which class to use");
    expect(prompt).toContain("If the class is already known, query it directly");
    expect(prompt).not.toContain("At the start of Studio authoring, call");
    expect(prompt).toContain("There is no bulk JSON upsert tool");
    expect(prompt).toContain("as the default for world creation and editing");
    expect(prompt).toContain("Successful Editor execution already saves the level");
    expect(prompt).toContain("Do not reject a class based on an old local catalog");
    expect(prompt).not.toContain("studiorpc_proceduralmodel_");
    expect(prompt).toContain("procedural-model-builder");
  });
  test("VFX guidance uses Editor authoring without retired JSON conversions", async () => {
    const skill = await readFile(join(import.meta.dir, "../../bootstrap/skills/vfx-recipe/SKILL.md"), "utf-8");
    expect(skill).not.toContain("are injected by the sidecar");
    expect(skill).not.toContain("default true");
    expect(skill).toContain("studiorpc_execute_luau");
  });
  test("explains execution lifetimes without routing request categories to a fixed class", async () => {
    const prompt = await readFile(join(import.meta.dir, "../../bootstrap/system-prompt.txt"), "utf-8");
    expect(prompt).toContain("OVDR_PARAMETERS");
    expect(prompt).toContain("on_generate(model, size, attributes)");
    expect(prompt).toContain("not Blender");
    expect(prompt).toContain("without starting PIE");
    expect(prompt).toContain("when it must run and what must remain active");
    expect(prompt).toContain("Values and attributes store data");
    expect(prompt).toContain("without re-running the authoring command");
    expect(prompt).toContain("generation rules and parameters");
    expect(prompt).toContain("derived output");
    expect(prompt).not.toContain("Default to ProceduralModel");
  });
  test("includes native authoring reference without treating search misses as permission to change execution mode", async () => {
    const prompt = await readFile(join(import.meta.dir, "../../bootstrap/system-prompt.txt"), "utf-8");
    expect(prompt).toContain("literal property");
    expect(prompt).toContain("parts.chamfered_box");
    expect(prompt).toContain("G.append_mesh");
    expect(prompt).toContain("G.dispose_mesh");
    expect(prompt).toContain("This workflow applies to gameplay Lua scripts");
    expect(prompt).not.toContain("then proceed with best practices from Roblox or general game dev");
  });
  test("separates coordinate and execution contracts from generation evidence", async () => {
    const prompt = await readFile(join(import.meta.dir, "../../bootstrap/system-prompt.txt"), "utf-8");
    expect(prompt).toContain("# Gameplay Script Behavior");
    expect(prompt).toContain("ordinary nil checks");
    expect(prompt).toContain("Editor Size.Y is the vertical extent");
    expect(prompt).toContain("(Editor Size.Z, Editor Size.X, Editor Size.Y)");
    expect(prompt).toContain("derived dimensions must remain positive");
    expect(prompt).toContain("A later empty result does not identify the cause");
    expect(prompt).toContain("image could not be inspected");
  });
});
