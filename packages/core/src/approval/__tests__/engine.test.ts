// @summary Tests for PermissionEngine — rule matching, last-match-wins, session cache, wildcards
import { describe, expect, it } from "bun:test";
import { createPermissionEngine, wildcardMatch } from "../engine";
import type { PermissionRule } from "../types";

// ---------------------------------------------------------------------------
// wildcardMatch
// ---------------------------------------------------------------------------
describe("wildcardMatch", () => {
  it("matches exact strings", () => {
    expect(wildcardMatch("foo", "foo")).toBe(true);
    expect(wildcardMatch("foo", "bar")).toBe(false);
  });

  it("* matches anything without /", () => {
    expect(wildcardMatch("*.ts", "index.ts")).toBe(true);
    expect(wildcardMatch("*.ts", "src/index.ts")).toBe(false);
    expect(wildcardMatch("src/*", "src/foo")).toBe(true);
    expect(wildcardMatch("src/*", "src/foo/bar")).toBe(false);
  });

  it("** matches anything including /", () => {
    expect(wildcardMatch("**", "src/foo/bar.ts")).toBe(true);
    expect(wildcardMatch("src/**", "src/foo/bar.ts")).toBe(true);
    expect(wildcardMatch("src/**", "other/foo.ts")).toBe(false);
    expect(wildcardMatch("src/**/*.ts", "src/a/b/c.ts")).toBe(true);
    expect(wildcardMatch("src/**/*.ts", "src/a/b/c.js")).toBe(false);
  });

  it("* at end matches remainder without /", () => {
    expect(wildcardMatch("ls*", "ls")).toBe(true);
    expect(wildcardMatch("ls *", "ls src")).toBe(true);
    // * does not cross /
    expect(wildcardMatch("ls *", "ls src/")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PermissionEngine.evaluate
// ---------------------------------------------------------------------------
describe("PermissionEngine.evaluate", () => {
  it("returns 'prompt' when no rules match", () => {
    const engine = createPermissionEngine([]);
    expect(
      engine.evaluate({ permission: "execute", toolName: "bash", description: "run", details: { command: "ls" } }),
    ).toBe("prompt");
  });

  it("returns 'allow' for a matching allow rule", () => {
    const rules: PermissionRule[] = [{ permission: "execute", pattern: "**", action: "allow" }];
    const engine = createPermissionEngine(rules);
    expect(
      engine.evaluate({ permission: "execute", toolName: "bash", description: "run", details: { command: "ls" } }),
    ).toBe("allow");
  });

  it("returns 'deny' for a matching deny rule", () => {
    const rules: PermissionRule[] = [{ permission: "execute", pattern: "**", action: "deny" }];
    const engine = createPermissionEngine(rules);
    expect(
      engine.evaluate({ permission: "execute", toolName: "bash", description: "run", details: { command: "rm" } }),
    ).toBe("deny");
  });

  it("does not match wrong permission type", () => {
    const rules: PermissionRule[] = [{ permission: "read", pattern: "*", action: "allow" }];
    const engine = createPermissionEngine(rules);
    expect(engine.evaluate({ permission: "execute", toolName: "bash", description: "run" })).toBe("prompt");
  });

  it("last-match-wins — later rule overrides earlier", () => {
    const rules: PermissionRule[] = [
      { permission: "execute", pattern: "**", action: "allow" },
      { permission: "execute", pattern: "rm *", action: "deny" },
    ];
    const engine = createPermissionEngine(rules);
    // matches both rules — last (deny) wins
    expect(
      engine.evaluate({ permission: "execute", toolName: "bash", description: "run", details: { command: "rm -rf" } }),
    ).toBe("deny");
    // only matches first rule
    expect(
      engine.evaluate({ permission: "execute", toolName: "bash", description: "run", details: { command: "ls src/" } }),
    ).toBe("allow");
  });

  it("uses toolName when no path/command in details", () => {
    const rules: PermissionRule[] = [{ permission: "read", pattern: "read_file", action: "allow" }];
    const engine = createPermissionEngine(rules);
    expect(engine.evaluate({ permission: "read", toolName: "read_file", description: "read" })).toBe("allow");
    expect(engine.evaluate({ permission: "read", toolName: "glob", description: "glob" })).toBe("prompt");
  });
});

// ---------------------------------------------------------------------------
// PermissionEngine.remember — session cache
// ---------------------------------------------------------------------------
describe("PermissionEngine.remember", () => {
  it("session allow rule overrides config deny rule (last-match-wins)", () => {
    const rules: PermissionRule[] = [{ permission: "execute", pattern: "**", action: "deny" }];
    const engine = createPermissionEngine(rules);
    const req = {
      permission: "execute" as const,
      toolName: "bash",
      description: "run",
      details: { command: "npm test" },
    };

    expect(engine.evaluate(req)).toBe("deny");

    engine.remember(req, "allow");
    // session rule added for "npm test" — last-match wins
    expect(engine.evaluate(req)).toBe("allow");
  });

  it("config allow rule is overridden by session deny rule", () => {
    const rules: PermissionRule[] = [{ permission: "execute", pattern: "**", action: "allow" }];
    const engine = createPermissionEngine(rules);
    const req = {
      permission: "execute" as const,
      toolName: "bash",
      description: "run",
      details: { command: "rm -rf" },
    };

    expect(engine.evaluate(req)).toBe("allow");

    engine.remember(req, "deny");
    expect(engine.evaluate(req)).toBe("deny");
  });

  it("session rule only affects matching subject", () => {
    const engine = createPermissionEngine([]);
    const req1 = { permission: "execute" as const, toolName: "bash", description: "run", details: { command: "ls" } };
    const req2 = {
      permission: "execute" as const,
      toolName: "bash",
      description: "run",
      details: { command: "git status" },
    };

    engine.remember(req1, "allow");
    expect(engine.evaluate(req1)).toBe("allow");
    expect(engine.evaluate(req2)).toBe("prompt"); // different command, not cached
  });
});
