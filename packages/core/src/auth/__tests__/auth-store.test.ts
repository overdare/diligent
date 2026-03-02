// @summary Tests for auth-store load/save: missing file, valid, invalid, permissions, key preservation, OAuth tokens
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAuthFilePath, loadAuthStore, loadOAuthTokens, saveAuthKey, saveOAuthTokens } from "../auth-store";
import type { OpenAIOAuthTokens } from "../types";

const TEST_ROOT = join(tmpdir(), `diligent-auth-test-${Date.now()}`);

const TEST_OAUTH_TOKENS: OpenAIOAuthTokens = {
  access_token: "at-test",
  refresh_token: "rt-test",
  id_token: "it-test",
  expires_at: 9_999_999_999_000,
  account_id: "acc-test",
};

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

  test("loads openai_oauth tokens", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, JSON.stringify({ openai_oauth: TEST_OAUTH_TOKENS }));

    const result = await loadAuthStore(path);
    expect(result.openai_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("loads both plain key and openai_oauth simultaneously", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant-123", openai_oauth: TEST_OAUTH_TOKENS }));

    const result = await loadAuthStore(path);
    expect(result.anthropic).toBe("sk-ant-123");
    expect(result.openai_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("returns {} for invalid JSON", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, "not json");

    const result = await loadAuthStore(path);
    expect(result).toEqual({});
  });

  test("substitutes {env:VAR} in values", async () => {
    const path = join(TEST_ROOT, "auth.json");
    process.env.TEST_ANTHROPIC_KEY = "sk-from-env";
    await Bun.write(path, JSON.stringify({ anthropic: "{env:TEST_ANTHROPIC_KEY}" }));

    const result = await loadAuthStore(path);
    expect(result.anthropic).toBe("sk-from-env");
    delete process.env.TEST_ANTHROPIC_KEY;
  });

  test("{env:VAR} resolves to empty string when var is unset", async () => {
    const path = join(TEST_ROOT, "auth.json");
    delete process.env.NONEXISTENT_AUTH_VAR;
    await Bun.write(path, JSON.stringify({ anthropic: "{env:NONEXISTENT_AUTH_VAR}" }));

    const result = await loadAuthStore(path);
    expect(result.anthropic).toBe("");
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

  test("preserves openai_oauth when saving plain key", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, JSON.stringify({ openai_oauth: TEST_OAUTH_TOKENS }));

    await saveAuthKey("anthropic", "sk-ant-new", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-ant-new");
    expect(content.openai_oauth).toEqual(TEST_OAUTH_TOKENS);
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

describe("saveOAuthTokens", () => {
  test("saves openai_oauth to new file", async () => {
    const path = join(TEST_ROOT, "oauth-auth.json");

    await saveOAuthTokens(TEST_OAUTH_TOKENS, path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.openai_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("preserves plain API keys when saving OAuth tokens", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await saveAuthKey("anthropic", "sk-ant-test", path);

    await saveOAuthTokens(TEST_OAUTH_TOKENS, path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-ant-test");
    expect(content.openai_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("overwrites existing openai_oauth", async () => {
    const path = join(TEST_ROOT, "auth.json");
    const oldTokens: OpenAIOAuthTokens = { ...TEST_OAUTH_TOKENS, account_id: "acc-old" };
    await Bun.write(path, JSON.stringify({ openai_oauth: oldTokens }));

    const newTokens: OpenAIOAuthTokens = { ...TEST_OAUTH_TOKENS, account_id: "acc-new" };
    await saveOAuthTokens(newTokens, path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.openai_oauth.account_id).toBe("acc-new");
  });

  test("sets file permissions to 0o600", async () => {
    const path = join(TEST_ROOT, "oauth.json");

    await saveOAuthTokens(TEST_OAUTH_TOKENS, path);

    const st = await stat(path);
    expect(st.mode & 0o777).toBe(0o600);
  });
});

describe("loadOAuthTokens", () => {
  test("returns undefined when no openai_oauth in file", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant" }));

    const result = await loadOAuthTokens(path);
    expect(result).toBeUndefined();
  });

  test("returns OAuth tokens when present", async () => {
    const path = join(TEST_ROOT, "auth.json");
    await Bun.write(path, JSON.stringify({ openai_oauth: TEST_OAUTH_TOKENS }));

    const result = await loadOAuthTokens(path);
    expect(result).toEqual(TEST_OAUTH_TOKENS);
  });

  test("returns undefined when file does not exist", async () => {
    const result = await loadOAuthTokens(join(TEST_ROOT, "missing.json"));
    expect(result).toBeUndefined();
  });
});
