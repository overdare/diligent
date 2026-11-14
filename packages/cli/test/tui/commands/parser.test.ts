// @summary Tests for command parsing and validation
import { describe, expect, it } from "bun:test";
import { isCommandPrefix, parseCommand } from "../../../src/tui/commands/parser";

describe("parseCommand", () => {
  it("parses a simple command with no args", () => {
    expect(parseCommand("/help")).toEqual({
      name: "help",
      args: undefined,
      raw: "/help",
    });
  });

  it("parses a command with args", () => {
    expect(parseCommand("/model gpt-4o")).toEqual({
      name: "model",
      args: "gpt-4o",
      raw: "/model gpt-4o",
    });
  });

  it("parses a direct skill command with no args", () => {
    const result = parseCommand("/review");
    expect(result).toEqual({
      name: "review",
      args: undefined,
      raw: "/review",
    });
  });

  it("parses a direct skill command with args", () => {
    const result = parseCommand("/review check PR");
    expect(result).toEqual({
      name: "review",
      args: "check PR",
      raw: "/review check PR",
    });
  });

  it("returns null for double-slash escape", () => {
    expect(parseCommand("//escaped")).toBeNull();
  });

  it("returns null for regular text", () => {
    expect(parseCommand("regular text")).toBeNull();
  });

  it("returns null for empty command (just slash)", () => {
    expect(parseCommand("/")).toBeNull();
  });

  it("trims leading and trailing whitespace", () => {
    expect(parseCommand("  /help  ")).toEqual({
      name: "help",
      args: undefined,
      raw: "/help",
    });
  });

  it("trims args whitespace", () => {
    expect(parseCommand("/model   gpt-4o  ")).toEqual({
      name: "model",
      args: "gpt-4o",
      raw: "/model   gpt-4o",
    });
  });

  it("returns undefined args when args are only whitespace", () => {
    expect(parseCommand("/model  ")).toEqual({
      name: "model",
      args: undefined,
      raw: "/model",
    });
  });
});

describe("isCommandPrefix", () => {
  it("returns true for a slash command", () => {
    expect(isCommandPrefix("/help")).toBe(true);
  });

  it("returns false for double-slash escape", () => {
    expect(isCommandPrefix("//escaped")).toBe(false);
  });

  it("returns false for regular text", () => {
    expect(isCommandPrefix("text")).toBe(false);
  });

  it("returns true for bare slash", () => {
    expect(isCommandPrefix("/")).toBe(true);
  });
});
