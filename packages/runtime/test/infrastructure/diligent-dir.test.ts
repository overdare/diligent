// @summary Tests for .diligent directory initialization and structure
import { afterEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_STORAGE_NAMESPACE,
  ensureDiligentDir,
  migrateLocalNamespaceIfNeeded,
  migrateNamespaceIfNeeded,
  resolvePaths,
  resolveProjectDirName,
  resolveStorageNamespace,
} from "@diligent/runtime/infrastructure";

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
    expect(paths.knowledge).toBe(join(base, "knowledge"));
    expect(paths.skills).toBe(join(base, "skills"));
    expect(paths.images).toBe(join(base, "images"));
  });

  it("supports a branded namespace from env", () => {
    const env = { DILIGENT_STORAGE_NAMESPACE: "overdare" } as NodeJS.ProcessEnv;
    const base = join("/project", ".overdare");
    const paths = resolvePaths("/project", env);
    expect(resolveStorageNamespace(env)).toBe("overdare");
    expect(resolveProjectDirName(env)).toBe(".overdare");
    expect(paths.root).toBe(base);
  });

  it("defaults to diligent without env", () => {
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

    const knowledgeEntries = [];
    for await (const f of sessionsGlob.scan(paths.knowledge)) knowledgeEntries.push(f);
    expect(knowledgeEntries).toEqual([]);

    const imageEntries = [];
    for await (const f of sessionsGlob.scan(paths.images)) imageEntries.push(f);
    expect(imageEntries).toEqual([]);
  });

  it("creates .gitignore with correct content", async () => {
    const paths = await ensureDiligentDir(TEST_ROOT);

    const gitignorePath = join(paths.root, ".gitignore");
    const content = await Bun.file(gitignorePath).text();
    expect(content).toContain("sessions/");
    expect(content).toContain("knowledge/");
    expect(content).toContain("images/");
    expect(content).not.toContain("skills/");
  });

  it("creates branded namespace directories when env is set", async () => {
    const env = { DILIGENT_STORAGE_NAMESPACE: "overdare" } as NodeJS.ProcessEnv;
    const paths = await ensureDiligentDir(TEST_ROOT, env);
    expect(paths.root).toBe(join(TEST_ROOT, ".overdare"));
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

describe("migrateNamespaceIfNeeded", () => {
  it("migrates legacy directory to target when target does not exist", async () => {
    const { mkdir: mkdirFn, writeFile } = await import("node:fs/promises");
    const legacy = join(TEST_ROOT, ".diligent");
    const target = join(TEST_ROOT, ".overdare");

    await mkdirFn(legacy, { recursive: true });
    await writeFile(join(legacy, "marker.txt"), "hello");

    const outcome = await migrateNamespaceIfNeeded(legacy, target);
    expect(outcome.kind).toBe("migrated");
    if (outcome.kind === "migrated") {
      expect(outcome.from).toBe(legacy);
      expect(outcome.to).toBe(target);
    }

    expect(await Bun.file(join(target, "marker.txt")).text()).toBe("hello");
    expect(await Bun.file(legacy).exists()).toBe(false);
  });

  it("skips migration when target already exists", async () => {
    const { mkdir: mkdirFn } = await import("node:fs/promises");
    const legacy = join(TEST_ROOT, ".diligent-skip");
    const target = join(TEST_ROOT, ".overdare-skip");

    await mkdirFn(legacy, { recursive: true });
    await mkdirFn(target, { recursive: true });

    const outcome = await migrateNamespaceIfNeeded(legacy, target);
    expect(outcome.kind).toBe("skipped_target_exists");

    expect(await Bun.file(legacy).exists()).toBe(false);
  });

  it("skips migration when legacy does not exist", async () => {
    const { mkdir: mkdirFn } = await import("node:fs/promises");
    const legacy = join(TEST_ROOT, ".nonexistent-diligent");
    const target = join(TEST_ROOT, ".nonexistent-overdare");

    await mkdirFn(TEST_ROOT, { recursive: true });

    const outcome = await migrateNamespaceIfNeeded(legacy, target);
    expect(outcome.kind).toBe("skipped_no_legacy");
  });
});

describe("migrateLocalNamespaceIfNeeded", () => {
  it("migrates .diligent to .{namespace} in project cwd", async () => {
    const { mkdir: mkdirFn, writeFile } = await import("node:fs/promises");
    const cwd = join(TEST_ROOT, "local-migration-test");
    await mkdirFn(cwd, { recursive: true });

    const legacy = join(cwd, ".diligent");
    await mkdirFn(join(legacy, "sessions"), { recursive: true });
    await writeFile(join(legacy, "sessions", "session1.json"), "{}");

    const env = { DILIGENT_STORAGE_NAMESPACE: "overdare" } as NodeJS.ProcessEnv;
    const outcome = await migrateLocalNamespaceIfNeeded(cwd, env);
    expect(outcome.kind).toBe("migrated");

    const target = join(cwd, ".overdare");
    expect(await Bun.file(join(target, "sessions", "session1.json")).text()).toBe("{}");
  });

  it("is a no-op when namespace is already 'diligent'", async () => {
    const { mkdir: mkdirFn } = await import("node:fs/promises");
    const cwd = join(TEST_ROOT, "noop-test");
    await mkdirFn(cwd, { recursive: true });

    const env = { DILIGENT_STORAGE_NAMESPACE: "diligent" } as NodeJS.ProcessEnv;
    const outcome = await migrateLocalNamespaceIfNeeded(cwd, env);
    expect(outcome.kind).toBe("skipped_no_legacy");
  });

  it("ensureDiligentDir auto-migrates before creating directories", async () => {
    const { mkdir: mkdirFn, writeFile } = await import("node:fs/promises");
    const cwd = join(TEST_ROOT, "auto-migrate-test");
    await mkdirFn(cwd, { recursive: true });

    // Simulate existing .diligent data
    const legacyDir = join(cwd, ".diligent");
    await mkdirFn(join(legacyDir, "knowledge"), { recursive: true });
    await writeFile(join(legacyDir, "knowledge", "knowledge.jsonl"), '{"id":"k1"}');

    // Initialize with new namespace
    const env = { DILIGENT_STORAGE_NAMESPACE: "overdare" } as NodeJS.ProcessEnv;
    const paths = await ensureDiligentDir(cwd, env);

    // Should land in .overdare, not .diligent
    expect(paths.root).toBe(join(cwd, ".overdare"));

    // Legacy knowledge data should be accessible under new path
    const knowledge = await Bun.file(join(paths.knowledge, "knowledge.jsonl")).text();
    expect(knowledge).toBe('{"id":"k1"}');

    // Legacy dir must be gone
    expect(await Bun.file(legacyDir).exists()).toBe(false);
  });
});
