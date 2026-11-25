// @summary Tests for .diligent directory initialization and structure
import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_STORAGE_NAMESPACE,
  ensureDiligentDir,
  resolvePaths,
  resolveProjectDirName,
  resolveStorageNamespace,
} from "@diligent/runtime/infrastructure";
import { readMemory } from "@diligent/runtime/memory";

const TEST_ROOT = join(tmpdir(), `diligent-test-${Date.now()}`);

afterEach(async () => {
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {}
});

describe("resolvePaths", () => {
  it("returns correct subdirectory paths", () => {
    const base = join("/project", ".diligent");
    const paths = resolvePaths("/project");
    expect(paths.root).toBe(base);
    expect(paths.sessions).toBe(join(base, "sessions"));
    expect(paths.memory).toBe(join(base, "memory"));
    expect(paths.skills).toBe(join(base, "skills"));
    expect(paths.images).toBe(join(base, "images"));
  });

  it("supports a branded namespace from env", () => {
    const env = { DILIGENT_STORAGE_NAMESPACE: "sample-host" } as NodeJS.ProcessEnv;
    const base = join("/project", ".sample-host");
    const paths = resolvePaths("/project", env);
    expect(resolveStorageNamespace(env)).toBe("sample-host");
    expect(resolveProjectDirName(env)).toBe(".sample-host");
    expect(paths.root).toBe(base);
  });

  it("preserves the generic runtime namespace compatibility contract without env", () => {
    expect(resolveStorageNamespace({} as NodeJS.ProcessEnv)).toBe(DEFAULT_STORAGE_NAMESPACE);
    expect(resolveProjectDirName({} as NodeJS.ProcessEnv)).toBe(".diligent");
  });
});

describe("ensureDiligentDir", () => {
  it("creates all subdirectories", async () => {
    const paths = await ensureDiligentDir(TEST_ROOT);

    expect(await Bun.file(join(paths.sessions, ".")).exists()).toBe(false); // dir exists check
    const sessionsGlob = new Bun.Glob("*");
    // Verify dirs exist by checking we can scan them
    const sessionEntries = [];
    for await (const f of sessionsGlob.scan(paths.sessions)) sessionEntries.push(f);
    expect(sessionEntries).toEqual([]); // empty dir, but scannable

    const memoryEntries = [];
    for await (const f of sessionsGlob.scan(paths.memory)) memoryEntries.push(f);
    expect(memoryEntries).toEqual([]);

    const imageEntries = [];
    for await (const f of sessionsGlob.scan(paths.images)) imageEntries.push(f);
    expect(imageEntries).toEqual([]);
  });

  it("creates .gitignore with correct content", async () => {
    const paths = await ensureDiligentDir(TEST_ROOT);

    const gitignorePath = join(paths.root, ".gitignore");
    const content = await Bun.file(gitignorePath).text();
    expect(content).toContain("sessions/");
    expect(content).toContain("memory/");
    expect(content).toContain("images/");
    expect(content).not.toContain("skills/");
  });

  it("creates branded namespace directories when env is set", async () => {
    const env = { DILIGENT_STORAGE_NAMESPACE: "sample-host" } as NodeJS.ProcessEnv;
    const paths = await ensureDiligentDir(TEST_ROOT, env);
    expect(paths.root).toBe(join(TEST_ROOT, ".sample-host"));
    expect(await Bun.file(join(paths.root, ".gitignore")).exists()).toBe(true);
  });

  it("is idempotent — second call does not overwrite .gitignore", async () => {
    await ensureDiligentDir(TEST_ROOT);

    // Modify .gitignore
    const paths = resolvePaths(TEST_ROOT);
    const gitignorePath = join(paths.root, ".gitignore");
    await Bun.write(gitignorePath, "custom content\n");

    await ensureDiligentDir(TEST_ROOT);

    const content = await Bun.file(gitignorePath).text();
    expect(content).toBe("custom content\n");
  });
});

describe("ensureDiligentDir legacy knowledge migration", () => {
  const legacyLines = [
    {
      id: "preference.language",
      timestamp: "2026-07-01T00:00:00.000Z",
      type: "preference",
      content: "Answer in Korean.",
      confidence: 0.8,
    },
    {
      id: "0b6f2f3e-8c1a-4f53-9d3e-2a7b9c4d5e6f",
      timestamp: "2026-07-02T00:00:00.000Z",
      type: "backlog",
      content: "Connect the HP bar to damage events.",
      confidence: 0.8,
      sessionId: "s1",
    },
    { id: "old-runtime", timestamp: "2026-07-03T00:00:00.000Z", type: "pattern", content: "Use npm.", confidence: 0.8 },
    {
      id: "new-runtime",
      timestamp: "2026-07-04T00:00:00.000Z",
      type: "correction",
      content: "Use Bun.",
      confidence: 0.9,
      supersedes: "old-runtime",
    },
  ];
  const legacyStore = `${legacyLines.map((line) => JSON.stringify(line)).join("\n")}\n{"id":"truncated\n`;

  it("converts the legacy knowledge store into memory files and keeps the original beside them", async () => {
    const { root } = resolvePaths(TEST_ROOT);
    await mkdir(join(root, "knowledge"), { recursive: true });
    await Bun.write(join(root, "knowledge", "knowledge.jsonl"), legacyStore);

    const paths = await ensureDiligentDir(TEST_ROOT);

    expect(
      (await readMemory(paths.memory)).map(({ id, type, content, sessionId }) => ({ id, type, content, sessionId })),
    ).toEqual([
      { id: "new-runtime", type: "feedback", content: "Use Bun.", sessionId: undefined },
      {
        id: "connect-the-hp-bar-to-damage-events",
        type: "project",
        content: "Connect the HP bar to damage events.",
        sessionId: "s1",
      },
      { id: "preference.language", type: "feedback", content: "Answer in Korean.", sessionId: undefined },
    ]);
    expect(await Bun.file(join(paths.memory, "MEMORY.md")).text()).toBe(
      [
        "# Memory Index",
        "",
        "- [preference.language](preference.language.md) — Answer in Korean.",
        "- [connect-the-hp-bar-to-damage-events](connect-the-hp-bar-to-damage-events.md) — Connect the HP bar to damage events.",
        "- [new-runtime](new-runtime.md) — Use Bun.",
        "",
      ].join("\n"),
    );
    expect(await Bun.file(join(paths.memory, ".memory.jsonl.migrated")).text()).toBe(legacyStore);
    expect(await stat(join(root, "knowledge")).catch(() => null)).toBeNull();
  });

  it("converts a JSONL memory store written before the Markdown format", async () => {
    const { memory } = resolvePaths(TEST_ROOT);
    await mkdir(memory, { recursive: true });
    await Bun.write(join(memory, "memory.jsonl"), legacyStore);

    await ensureDiligentDir(TEST_ROOT);

    expect((await readMemory(memory)).map(({ id }) => id)).toEqual([
      "new-runtime",
      "connect-the-hp-bar-to-damage-events",
      "preference.language",
    ]);
    expect(await Bun.file(join(memory, ".memory.jsonl.migrated")).text()).toBe(legacyStore);
    expect(await Bun.file(join(memory, "memory.jsonl")).exists()).toBe(false);
  });

  it("keeps an earlier converted store and leaves a later knowledge store for the user", async () => {
    const { root, memory } = resolvePaths(TEST_ROOT);
    await mkdir(join(root, "knowledge"), { recursive: true });
    await mkdir(memory, { recursive: true });
    await Bun.write(join(root, "knowledge", "knowledge.jsonl"), legacyStore);
    await Bun.write(join(memory, ".memory.jsonl.migrated"), "earlier\n");

    await ensureDiligentDir(TEST_ROOT);

    expect(await Bun.file(join(memory, ".memory.jsonl.migrated")).text()).toBe("earlier\n");
    expect(await Bun.file(join(root, "knowledge", "knowledge.jsonl")).text()).toBe(legacyStore);
  });

  it("never overwrites memory that already exists", async () => {
    const { root, memory } = resolvePaths(TEST_ROOT);
    await mkdir(join(root, "knowledge"), { recursive: true });
    await mkdir(memory, { recursive: true });
    await Bun.write(join(root, "knowledge", "knowledge.jsonl"), legacyStore);
    const current = "---\nname: language\ndescription: current\nmetadata:\n  type: user\n---\n\nCurrent text.\n";
    await Bun.write(join(memory, "preference.language.md"), current);
    await Bun.write(join(memory, "MEMORY.md"), "# Memory Index\n\n- [language](preference.language.md) — current\n");

    await ensureDiligentDir(TEST_ROOT);

    expect(await Bun.file(join(memory, "preference.language.md")).text()).toBe(current);
    const index = await Bun.file(join(memory, "MEMORY.md")).text();
    expect(index).toContain("- [language](preference.language.md) — current\n");
    expect(index.match(/preference\.language\.md/g)).toHaveLength(1);
    expect(index).toContain("(new-runtime.md)");
  });

  it("rewrites the legacy knowledge ignore rule and preserves custom lines", async () => {
    const { root } = resolvePaths(TEST_ROOT);
    await mkdir(root, { recursive: true });
    await Bun.write(join(root, ".gitignore"), "sessions/\nknowledge/\ncustom/\n");

    await ensureDiligentDir(TEST_ROOT);

    expect(await Bun.file(join(root, ".gitignore")).text()).toBe("sessions/\nmemory/\ncustom/\n");
  });
});
