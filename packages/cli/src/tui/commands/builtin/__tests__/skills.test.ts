// @summary Tests for dynamic skill command registration and slash delegation behavior
import { describe, expect, it, mock } from "bun:test";
import type { SkillMetadata } from "@diligent/runtime";
import { CommandRegistry } from "../../registry";
import type { CommandContext } from "../../types";
import { registerBuiltinCommands } from "../index";

function makeSkill(name: string): SkillMetadata {
  return {
    name,
    description: `${name} description`,
    path: `/tmp/${name}/SKILL.md`,
    baseDir: `/tmp/${name}`,
    source: "project",
    disableModelInvocation: false,
  };
}

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  const runAgent = mock(async (_text: string) => {});
  return {
    app: { confirm: async () => true, stop: () => {} },
    config: {} as CommandContext["config"],
    threadId: null,
    skills: [],
    registry: new CommandRegistry(),
    requestRender: () => {},
    displayLines: () => {},
    displayError: () => {},
    showOverlay: () => ({ hide: () => {} }),
    runAgent,
    reload: async () => {},
    currentMode: "default",
    setMode: () => {},
    startNewThread: async () => "thread-1",
    resumeThread: async () => "thread-1",
    deleteThread: async () => true,
    listThreads: async () => [],
    readThread: async () => null,
    onModelChanged: () => {},
    ...overrides,
  } as CommandContext;
}

describe("skill commands", () => {
  it("registers skills as /{skillName}", () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry, [makeSkill("tidy-plan")]);

    expect(registry.get("tidy-plan")).toBeDefined();
    expect(registry.get("skill:tidy-plan")).toBeUndefined();
  });

  it("keeps builtin command precedence on name collision", () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry, [makeSkill("help")]);

    expect(registry.get("help")?.hidden).toBeUndefined();
  });

  it("delegates /skillName invocation through unified slash path", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry, [makeSkill("tidy-plan")]);
    const cmd = registry.get("tidy-plan");
    expect(cmd).toBeDefined();

    const runAgent = mock(async (_text: string) => {});
    const displayLines = mock((_lines: string[]) => {});
    const ctx = makeCtx({ runAgent });
    ctx.displayLines = displayLines;
    await cmd!.handler("with args", ctx);

    expect(runAgent).toHaveBeenCalledWith(
      [
        "The user invoked /tidy-plan.",
        'Before any other action, call the "skill" tool with {"name":"tidy-plan"}.',
        "After loading the skill, continue with this additional user instruction:\nwith args",
      ].join("\n\n"),
    );
    expect(displayLines).toHaveBeenCalled();
  });
});
