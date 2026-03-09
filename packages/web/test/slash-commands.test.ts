// @summary Unit tests for slash command parser, filter, prefix detection, and skill merging

import { describe, expect, test } from "bun:test";
import {
  BUILTIN_COMMANDS,
  buildCommandList,
  filterCommands,
  isSlashPrefix,
  parseSlashCommand,
} from "../src/client/lib/slash-commands";

describe("parseSlashCommand", () => {
  test("parses command without args", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: undefined });
  });

  test("parses command with args", () => {
    expect(parseSlashCommand("/mode plan")).toEqual({ name: "mode", args: "plan" });
  });

  test("trims whitespace", () => {
    expect(parseSlashCommand("  /help  ")).toEqual({ name: "help", args: undefined });
  });

  test("trims arg whitespace", () => {
    expect(parseSlashCommand("/effort   high  ")).toEqual({ name: "effort", args: "high" });
  });

  test("returns null for non-command text", () => {
    expect(parseSlashCommand("hello")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseSlashCommand("")).toBeNull();
  });

  test("returns null for double-slash escape", () => {
    expect(parseSlashCommand("//escaped")).toBeNull();
  });

  test("returns null for just whitespace", () => {
    expect(parseSlashCommand("   ")).toBeNull();
  });

  test("handles command with empty args after space", () => {
    expect(parseSlashCommand("/help ")).toEqual({ name: "help", args: undefined });
  });
});

describe("filterCommands", () => {
  test("empty partial returns all commands", () => {
    expect(filterCommands(BUILTIN_COMMANDS, "")).toEqual(BUILTIN_COMMANDS);
  });

  test("filters by prefix", () => {
    const result = filterCommands(BUILTIN_COMMANDS, "mo");
    expect(result.map((c) => c.name)).toEqual(["mode", "model"]);
  });

  test("exact match returns single command", () => {
    const result = filterCommands(BUILTIN_COMMANDS, "help");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("help");
  });

  test("no match returns empty array", () => {
    expect(filterCommands(BUILTIN_COMMANDS, "zzz")).toEqual([]);
  });

  test("case insensitive partial", () => {
    const result = filterCommands(BUILTIN_COMMANDS, "HE");
    expect(result.map((c) => c.name)).toEqual(["help"]);
  });

  test("filters combined commands including skills", () => {
    const commands = buildCommandList([
      { name: "backlog", description: "Manage backlog" },
      { name: "tech-lead", description: "Tech lead review" },
    ]);
    const result = filterCommands(commands, "b");
    expect(result.map((c) => c.name)).toEqual(["backlog"]);
  });
});

describe("isSlashPrefix", () => {
  test("returns true for /", () => {
    expect(isSlashPrefix("/")).toBe(true);
  });

  test("returns true for /m", () => {
    expect(isSlashPrefix("/m")).toBe(true);
  });

  test("returns true for /mode", () => {
    expect(isSlashPrefix("/mode")).toBe(true);
  });

  test("returns false for /mode plan (has space)", () => {
    expect(isSlashPrefix("/mode plan")).toBe(false);
  });

  test("returns false for // (escape)", () => {
    expect(isSlashPrefix("//")).toBe(false);
  });

  test("returns false for regular text", () => {
    expect(isSlashPrefix("hello")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isSlashPrefix("")).toBe(false);
  });
});

describe("BUILTIN_COMMANDS", () => {
  test("has expected core commands", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    expect(names).toContain("help");
    expect(names).toContain("new");
    expect(names).toContain("mode");
    expect(names).toContain("effort");
    expect(names).toContain("model");
  });

  test("mode has options", () => {
    const mode = BUILTIN_COMMANDS.find((c) => c.name === "mode");
    expect(mode?.options).toBeDefined();
    expect(mode?.options?.map((o) => o.value)).toEqual(["default", "plan", "execute"]);
  });

  test("effort has options", () => {
    const effort = BUILTIN_COMMANDS.find((c) => c.name === "effort");
    expect(effort?.options).toBeDefined();
    expect(effort?.options?.map((o) => o.value)).toEqual(["low", "medium", "high", "max"]);
  });

  test("help has no options", () => {
    const help = BUILTIN_COMMANDS.find((c) => c.name === "help");
    expect(help?.options).toBeUndefined();
  });
});

describe("buildCommandList", () => {
  test("returns builtins when no skills", () => {
    const commands = buildCommandList([]);
    expect(commands).toEqual(BUILTIN_COMMANDS);
  });

  test("appends skill commands after builtins", () => {
    const commands = buildCommandList([
      { name: "backlog", description: "Manage backlog" },
      { name: "tech-lead", description: "Tech lead review" },
    ]);
    expect(commands.length).toBe(BUILTIN_COMMANDS.length + 2);
    const backlog = commands.find((c) => c.name === "backlog");
    expect(backlog).toBeDefined();
    expect(backlog?.isSkill).toBe(true);
    expect(backlog?.description).toBe("Manage backlog");
  });

  test("skips skills that collide with builtin names", () => {
    const commands = buildCommandList([
      { name: "help", description: "Collides with builtin" },
      { name: "backlog", description: "Manage backlog" },
    ]);
    // "help" skill should be skipped
    expect(commands.length).toBe(BUILTIN_COMMANDS.length + 1);
    const help = commands.find((c) => c.name === "help");
    expect(help?.isSkill).toBeUndefined();
  });

  test("skill commands have no options", () => {
    const commands = buildCommandList([{ name: "deploy", description: "Deploy app" }]);
    const deploy = commands.find((c) => c.name === "deploy");
    expect(deploy?.options).toBeUndefined();
  });
});
