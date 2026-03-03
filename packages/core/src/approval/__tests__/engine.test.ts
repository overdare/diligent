// @summary Tests for PermissionEngine — rule matching, last-match-wins, session cache, wildcards
import { describe, expect, it } from "bun:test";
import { createPermissionEngine, extractSubject, generatePattern, wildcardMatch } from "../engine";
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
// extractSubject
// ---------------------------------------------------------------------------
describe("extractSubject", () => {
  it("prefers file_path over path, command, and toolName", () => {
    expect(
      extractSubject({
        permission: "write",
        toolName: "write",
        description: "write file",
        details: { file_path: "/a/b.ts", path: "/x/y.ts", command: "echo hi" },
      }),
    ).toBe("/a/b.ts");
  });

  it("falls back to path when file_path is absent", () => {
    expect(
      extractSubject({
        permission: "read",
        toolName: "read",
        description: "read file",
        details: { path: "/x/y.ts", command: "cat foo" },
      }),
    ).toBe("/x/y.ts");
  });

  it("falls back to command when no file_path or path", () => {
    expect(
      extractSubject({
        permission: "execute",
        toolName: "bash",
        description: "run",
        details: { command: "npm test" },
      }),
    ).toBe("npm test");
  });

  it("falls back to toolName when details is empty", () => {
    expect(
      extractSubject({ permission: "read", toolName: "glob", description: "glob" }),
    ).toBe("glob");
  });
});

// ---------------------------------------------------------------------------
// generatePattern
// ---------------------------------------------------------------------------
describe("generatePattern", () => {
  it("generates parent/** for file_path", () => {
    expect(
      generatePattern({
        permission: "write",
        toolName: "write",
        description: "write",
        details: { file_path: "/a/b/c.ts" },
      }),
    ).toBe("/a/b/**");
  });

  it("generates parent/** for path", () => {
    expect(
      generatePattern({
        permission: "read",
        toolName: "read",
        description: "read",
        details: { path: "/src/utils/helper.ts" },
      }),
    ).toBe("/src/utils/**");
  });

  it("prefers file_path over command for pattern generation", () => {
    expect(
      generatePattern({
        permission: "write",
        toolName: "edit",
        description: "edit",
        details: { file_path: "/a/b.ts", command: "echo hi" },
      }),
    ).toBe("/a/**");
  });

  it("generates first-word ** for commands", () => {
    expect(
      generatePattern({
        permission: "execute",
        toolName: "bash",
        description: "run",
        details: { command: "npm test" },
      }),
    ).toBe("npm **");
  });

  it("returns exact command when no space", () => {
    expect(
      generatePattern({
        permission: "execute",
        toolName: "bash",
        description: "run",
        details: { command: "ls" },
      }),
    ).toBe("ls");
  });

  it("returns exact file path when no parent directory", () => {
    expect(
      generatePattern({
        permission: "write",
        toolName: "write",
        description: "write",
        details: { file_path: "/root.ts" },
      }),
    ).toBe("/root.ts");
  });

  it("falls back to toolName when no details", () => {
    expect(
      generatePattern({ permission: "read", toolName: "glob", description: "glob" }),
    ).toBe("glob");
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

  it("matches file_path for write/edit tools (not just path)", () => {
    const rules: PermissionRule[] = [{ permission: "write", pattern: "src/**", action: "allow" }];
    const engine = createPermissionEngine(rules);
    expect(
      engine.evaluate({
        permission: "write",
        toolName: "write",
        description: "write file",
        details: { file_path: "src/utils/helper.ts" },
      }),
    ).toBe("allow");
    expect(
      engine.evaluate({
        permission: "write",
        toolName: "edit",
        description: "edit file",
        details: { file_path: "lib/other.ts" },
      }),
    ).toBe("prompt");
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

  it("session rule uses wildcard — remembering 'npm test' allows 'npm run build'", () => {
    const engine = createPermissionEngine([]);
    const req1 = {
      permission: "execute" as const,
      toolName: "bash",
      description: "run",
      details: { command: "npm test" },
    };
    const req2 = {
      permission: "execute" as const,
      toolName: "bash",
      description: "run",
      details: { command: "npm run build" },
    };

    engine.remember(req1, "allow");
    // "npm test" generates pattern "npm **", which matches "npm run build"
    expect(engine.evaluate(req1)).toBe("allow");
    expect(engine.evaluate(req2)).toBe("allow");
  });

  it("session rule uses wildcard — remembering a file allows sibling files", () => {
    const engine = createPermissionEngine([]);
    const req1 = {
      permission: "write" as const,
      toolName: "write",
      description: "write",
      details: { file_path: "/src/utils/a.ts" },
    };
    const req2 = {
      permission: "write" as const,
      toolName: "write",
      description: "write",
      details: { file_path: "/src/utils/b.ts" },
    };
    const req3 = {
      permission: "write" as const,
      toolName: "write",
      description: "write",
      details: { file_path: "/lib/other.ts" },
    };

    engine.remember(req1, "allow");
    // "/src/utils/a.ts" generates pattern "/src/utils/**"
    expect(engine.evaluate(req1)).toBe("allow");
    expect(engine.evaluate(req2)).toBe("allow");
    expect(engine.evaluate(req3)).toBe("prompt"); // different directory
  });

  it("session wildcard does not cross to different command prefix", () => {
    const engine = createPermissionEngine([]);
    const req1 = {
      permission: "execute" as const,
      toolName: "bash",
      description: "run",
      details: { command: "npm test" },
    };
    const req2 = {
      permission: "execute" as const,
      toolName: "bash",
      description: "run",
      details: { command: "git status" },
    };

    engine.remember(req1, "allow");
    expect(engine.evaluate(req1)).toBe("allow");
    expect(engine.evaluate(req2)).toBe("prompt"); // different prefix
  });
});
