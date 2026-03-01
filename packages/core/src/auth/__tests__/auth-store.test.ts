// @summary Tests for auth-store load/save: missing file, valid, invalid, permissions, key preservation
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAuthFilePath, loadAuthStore, saveAuthKey } from "../auth-store";

const TEST_ROOT = join(tmpdir(), `diligent-auth-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TEST_ROOT, { recursive: true });
});

afterEach(async () => {
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {}
});

describe("getAuthFilePath", () => {
  test("returns path under ~/.config/diligent/", () => {
    const path = getAuthFilePath();
    expect(path).toContain("diligent");
    expect(path).toEndWith("auth.json");
  });
});

describe("loadAuthStore", () => {
  test("returns {} when file does not exist", async () => {
    const result = await loadAuthStore(join(TEST_ROOT, "nonexistent.json"));
    expect(result).toEqual({});
  });

  test("loads valid auth keys", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant-123", openai: "sk-456" }));

    const result = await loadAuthStore(path);
    expect(result.anthropic).toBe("sk-ant-123");
    expect(result.openai).toBe("sk-456");
    expect(result.gemini).toBeUndefined();
  });

  test("returns {} for invalid JSON", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, "not json");

    const result = await loadAuthStore(path);
    expect(result).toEqual({});
  });

  test("returns {} for schema-invalid content (extra fields)", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, JSON.stringify({ anthropic: "key", unknown_provider: "bad" }));

    const result = await loadAuthStore(path);
    expect(result).toEqual({});
  });
});

describe("saveAuthKey", () => {
  test("creates auth.json with single key", async () => {
    const path = join(TEST_ROOT, "new-auth.json");

    await saveAuthKey("anthropic", "sk-ant-new", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-ant-new");
  });

  test("preserves existing keys when adding new one", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant-existing" }));

    await saveAuthKey("openai", "sk-openai-new", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-ant-existing");
    expect(content.openai).toBe("sk-openai-new");
  });

  test("overwrites existing key for same provider", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, JSON.stringify({ anthropic: "old-key" }));

    await saveAuthKey("anthropic", "new-key", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("new-key");
  });

  test("sets file permissions to 0o600", async () => {
    const path = join(TEST_ROOT, "auth.json");

    await saveAuthKey("gemini", "AIza-test", path);

    const st = await stat(path);
    // Check owner-only read/write (0o600 = 0o100600, mask with 0o777)
    expect(st.mode & 0o777).toBe(0o600);
  });

  test("creates parent directories if needed", async () => {
    const path = join(TEST_ROOT, "nested", "dir", "auth.json");

    await saveAuthKey("anthropic", "sk-deep", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-deep");
  });
});
