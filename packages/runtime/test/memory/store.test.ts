// @summary Tests for the Markdown memory directory format shared with Claude Code auto memory
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMemory, upsertMemory } from "@diligent/runtime/memory";
import { parse as parseYaml } from "yaml";

const CLAUDE_WRITTEN_FILE = `---
name: combat-damage-model
description: "Server-authoritative hitscan; damage is applied only on the server"
metadata:
  node_type: memory
  type: project
  originSessionId: 63893700-cb00-4508-a273-f004cb7e79a1
---

Decision: damage is computed on the server with hitscan rays.
**Why:** client-side hits allowed speed hacks.
`;

const CLAUDE_WRITTEN_INDEX = `# Memory Index

- [Combat damage model](combat-damage-model.md) — server-authoritative hitscan
- [User profile](user-profile.md) — prefers Korean answers
`;

describe("memory directory", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads memory files written by Claude Code, titled by their MEMORY.md link text", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    await writeFile(join(tmpDir, "MEMORY.md"), CLAUDE_WRITTEN_INDEX);
    await writeFile(join(tmpDir, "combat-damage-model.md"), CLAUDE_WRITTEN_FILE);

    expect(await readMemory(tmpDir)).toEqual([
      {
        id: "combat-damage-model",
        name: "Combat damage model",
        description: "Server-authoritative hitscan; damage is applied only on the server",
        type: "project",
        content:
          "Decision: damage is computed on the server with hitscan rays.\n**Why:** client-side hits allowed speed hacks.",
        modified: expect.any(String),
        sessionId: "63893700-cb00-4508-a273-f004cb7e79a1",
      },
    ]);
  });

  it("skips the index, hidden files, and files without a memory type", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    await writeFile(join(tmpDir, "MEMORY.md"), CLAUDE_WRITTEN_INDEX);
    await writeFile(join(tmpDir, ".draft.md"), CLAUDE_WRITTEN_FILE);
    await writeFile(join(tmpDir, "notes.md"), "plain notes without frontmatter\n");
    await writeFile(join(tmpDir, "unknown.md"), "---\nname: unknown\nmetadata:\n  type: scratch\n---\nbody\n");

    expect(await readMemory(tmpDir)).toEqual([]);
  });

  it("writes files Claude Code can read and keeps frontmatter and index lines written by other tools", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    await writeFile(join(tmpDir, "MEMORY.md"), CLAUDE_WRITTEN_INDEX);
    await writeFile(join(tmpDir, "combat-damage-model.md"), CLAUDE_WRITTEN_FILE);

    await upsertMemory(tmpDir, {
      id: "combat-damage-model",
      type: "project",
      name: "Combat damage model",
      description: "Floating damage numbers replace the HP bar",
      content: "Decision: show floating damage numbers.\n**Why:** playtesters could not read the HP bar on mobile.",
    });

    const text = await readFile(join(tmpDir, "combat-damage-model.md"), "utf8");
    const [, frontmatter, body] = text.split(/^---$/m);
    expect(parseYaml(frontmatter)).toEqual({
      name: "combat-damage-model",
      description: "Floating damage numbers replace the HP bar",
      metadata: {
        node_type: "memory",
        type: "project",
        originSessionId: "63893700-cb00-4508-a273-f004cb7e79a1",
        modified: expect.any(String),
      },
    });
    expect(body.trim()).toBe(
      "Decision: show floating damage numbers.\n**Why:** playtesters could not read the HP bar on mobile.",
    );
    expect(await readFile(join(tmpDir, "MEMORY.md"), "utf8")).toBe(`# Memory Index

- [Combat damage model](combat-damage-model.md) — Floating damage numbers replace the HP bar
- [User profile](user-profile.md) — prefers Korean answers
`);
  });

  it("keeps a non-ASCII title after Claude Code rewrites the frontmatter name to an empty slug", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    // Claude Code lowercases `name` to a slug and drops non-ASCII characters, so a Korean title becomes "".
    await writeFile(
      join(tmpDir, "combat-damage.md"),
      '---\nname: ""\ndescription: 데미지 작업 전 ADR을 참조한다.\nmetadata:\n  node_type: memory\n  type: project\n---\n\nADR 0001을 참조한다.\n',
    );
    await writeFile(
      join(tmpDir, "MEMORY.md"),
      "# Memory Index\n\n- [전투 데미지 \\[결정\\] 기록](combat-damage.md) — 데미지 작업 전 ADR을 참조한다.\n",
    );

    expect((await readMemory(tmpDir)).map(({ name }) => name)).toEqual(["전투 데미지 [결정] 기록"]);

    const { entry } = await upsertMemory(tmpDir, {
      id: "combat-damage",
      type: "project",
      content: "ADR 0001과 데미지 숫자 작업 순서를 참조한다.",
    });

    expect(entry.name).toBe("전투 데미지 [결정] 기록");
    expect(await readFile(join(tmpDir, "MEMORY.md"), "utf8")).toContain(
      "- [전투 데미지 \\[결정\\] 기록](combat-damage.md) — ",
    );
    const [, frontmatter] = (await readFile(join(tmpDir, "combat-damage.md"), "utf8")).split(/^---$/m);
    expect(parseYaml(frontmatter).name).toBe("combat-damage");
  });

  it("leaves only memory files and the index after concurrent writes", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        upsertMemory(tmpDir, { id: `c-${i}`, type: "project", content: `Item ${i}` }),
      ),
    );

    const names = (await readdir(tmpDir)).sort();
    expect(names).toEqual(["MEMORY.md", ...Array.from({ length: 20 }, (_, i) => `c-${i}.md`)].sort());
    const index = await readFile(join(tmpDir, "MEMORY.md"), "utf8");
    expect(index.split("\n").filter((line) => line.startsWith("- ["))).toHaveLength(20);
  });

  it("continues processing writes after a failed write", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    await writeFile(join(tmpDir, "blocked.md"), "not a directory");

    const failed = upsertMemory(join(tmpDir, "blocked.md"), { type: "project", content: "never written" });
    const written = upsertMemory(tmpDir, { id: "after-failure", type: "project", content: "written" });

    await expect(failed).rejects.toThrow();
    await written;
    expect((await readMemory(tmpDir)).map((entry) => entry.id)).toEqual(["after-failure"]);
  });
});
