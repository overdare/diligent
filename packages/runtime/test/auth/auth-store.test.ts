// @summary Tests for runtime auth-store load/save/remove behavior and JSONC parsing
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAIOAuthTokens } from "@diligent/core/auth";
import {
  getAuthFilePath,
  loadAuthStore,
  loadOAuthTokens,
  removeAuthKey,
  removeOAuthTokens,
  saveAuthKey,
  saveOAuthTokens,
} from "../../src/auth/auth-store";

const TEST_ROOT = join(tmpdir(), `diligent-auth-test-${Date.now()}`);
let origHome: string | undefined;
let origUserProfile: string | undefined;
let origStorageNamespace: string | undefined;

const TEST_OAUTH_TOKENS: OpenAIOAuthTokens = {
  access_token: "at-test",
  refresh_token: "rt-test",
  id_token: "it-test",
  expires_at: 9_999_999_999_000,
  account_id: "acc-test",
};

beforeEach(async () => {
  await mkdir(TEST_ROOT, { recursive: true });
  origHome = process.env.HOME;
  origUserProfile = process.env.USERPROFILE;
  origStorageNamespace = process.env.DILIGENT_STORAGE_NAMESPACE;
  process.env.HOME = TEST_ROOT;
  process.env.USERPROFILE = TEST_ROOT;
  delete process.env.DILIGENT_STORAGE_NAMESPACE;
});

afterEach(async () => {
  if (origHome !== undefined) {
    process.env.HOME = origHome;
  } else {
    delete process.env.HOME;
  }
  if (origUserProfile !== undefined) {
    process.env.USERPROFILE = origUserProfile;
  } else {
    delete process.env.USERPROFILE;
  }
  if (origStorageNamespace !== undefined) {
    process.env.DILIGENT_STORAGE_NAMESPACE = origStorageNamespace;
  } else {
    delete process.env.DILIGENT_STORAGE_NAMESPACE;
  }
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {}
});

describe("getAuthFilePath", () => {
  test("returns path under ~/.diligent/", () => {
    const path = getAuthFilePath();
    expect(path).toContain("diligent");
    expect(path).toEndWith("auth.jsonc");
  });

  test("uses the selected storage namespace", () => {
    process.env.DILIGENT_STORAGE_NAMESPACE = "overdare";
    expect(getAuthFilePath()).toBe(join(TEST_ROOT, ".overdare", "auth.jsonc"));
  });
});

describe("loadAuthStore", () => {
  test("returns {} when file does not exist", async () => {
    const result = await loadAuthStore(join(TEST_ROOT, "nonexistent.jsonc"));
    expect(result).toEqual({});
  });

  test("loads valid auth keys", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant-123", openai: "sk-456" }));

    const result = await loadAuthStore(path);
    expect(result.anthropic).toBe("sk-ant-123");
    expect(result.openai).toBe("sk-456");
    expect(result.gemini).toBeUndefined();
  });

  test("parses JSONC comments", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, '{\n  // primary provider\n  "anthropic": "sk-ant-123"\n}\n');

    const result = await loadAuthStore(path);
    expect(result.anthropic).toBe("sk-ant-123");
  });

  test("loads chatgpt_oauth tokens", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ chatgpt_oauth: TEST_OAUTH_TOKENS }));

    const result = await loadAuthStore(path);
    expect(result.chatgpt_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("loads both plain key and chatgpt_oauth simultaneously", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant-123", chatgpt_oauth: TEST_OAUTH_TOKENS }));

    const result = await loadAuthStore(path);
    expect(result.anthropic).toBe("sk-ant-123");
    expect(result.chatgpt_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("returns {} for invalid JSON", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, "not json");

    const result = await loadAuthStore(path);
    expect(result).toEqual({});
  });

  test("substitutes {env:VAR} in values", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    process.env.TEST_ANTHROPIC_KEY = "sk-from-env";
    await Bun.write(path, JSON.stringify({ anthropic: "{env:TEST_ANTHROPIC_KEY}" }));

    const result = await loadAuthStore(path);
    expect(result.anthropic).toBe("sk-from-env");
    delete process.env.TEST_ANTHROPIC_KEY;
  });

  test("{env:VAR} resolves to empty string when var is unset", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    delete process.env.NONEXISTENT_AUTH_VAR;
    await Bun.write(path, JSON.stringify({ anthropic: "{env:NONEXISTENT_AUTH_VAR}" }));

    const result = await loadAuthStore(path);
    expect(result.anthropic).toBe("");
  });

  test("returns {} for schema-invalid content (extra fields)", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ anthropic: "key", unknown_provider: "bad" }));

    const result = await loadAuthStore(path);
    expect(result).toEqual({});
  });
});

describe("saveAuthKey", () => {
  test("creates auth.jsonc with single key", async () => {
    const path = join(TEST_ROOT, "new-auth.jsonc");

    await saveAuthKey("anthropic", "sk-ant-new", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-ant-new");
  });

  test("preserves existing keys when adding new one", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant-existing" }));

    await saveAuthKey("openai", "sk-openai-new", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-ant-existing");
    expect(content.openai).toBe("sk-openai-new");
  });

  test("preserves chatgpt_oauth when saving plain key", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ chatgpt_oauth: TEST_OAUTH_TOKENS }));

    await saveAuthKey("anthropic", "sk-ant-new", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-ant-new");
    expect(content.chatgpt_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("overwrites existing key for same provider", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ anthropic: "old-key" }));

    await saveAuthKey("anthropic", "new-key", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("new-key");
  });

  test.skipIf(process.platform === "win32")("sets file permissions to 0o600", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");

    await saveAuthKey("gemini", "AIza-test", path);

    const st = await stat(path);
    expect(st.mode & 0o777).toBe(0o600);
  });

  test("creates parent directories if needed", async () => {
    const path = join(TEST_ROOT, "nested", "dir", "auth.jsonc");

    await saveAuthKey("anthropic", "sk-deep", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-deep");
  });
});

describe("saveOAuthTokens", () => {
  test("saves chatgpt_oauth to new file", async () => {
    const path = join(TEST_ROOT, "oauth-auth.jsonc");

    await saveOAuthTokens(TEST_OAUTH_TOKENS, path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.chatgpt_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("preserves plain API keys when saving OAuth tokens", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await saveAuthKey("anthropic", "sk-ant-test", path);

    await saveOAuthTokens(TEST_OAUTH_TOKENS, path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-ant-test");
    expect(content.chatgpt_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("overwrites existing chatgpt_oauth", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    const oldTokens: OpenAIOAuthTokens = { ...TEST_OAUTH_TOKENS, account_id: "acc-old" };
    await Bun.write(path, JSON.stringify({ chatgpt_oauth: oldTokens }));

    const newTokens: OpenAIOAuthTokens = { ...TEST_OAUTH_TOKENS, account_id: "acc-new" };
    await saveOAuthTokens(newTokens, path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.chatgpt_oauth.account_id).toBe("acc-new");
  });

  test.skipIf(process.platform === "win32")("sets file permissions to 0o600", async () => {
    const path = join(TEST_ROOT, "oauth.jsonc");

    await saveOAuthTokens(TEST_OAUTH_TOKENS, path);

    const st = await stat(path);
    expect(st.mode & 0o777).toBe(0o600);
  });
});

describe("remove auth entries", () => {
  test("removes a plain API key without disturbing oauth tokens", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant", chatgpt_oauth: TEST_OAUTH_TOKENS }));

    await removeAuthKey("anthropic", path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBeUndefined();
    expect(content.chatgpt_oauth).toEqual(TEST_OAUTH_TOKENS);
  });

  test("removes oauth tokens without disturbing API keys", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant", chatgpt_oauth: TEST_OAUTH_TOKENS }));

    await removeOAuthTokens(path);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content.anthropic).toBe("sk-ant");
    expect(content.chatgpt_oauth).toBeUndefined();
  });
});

describe("loadOAuthTokens", () => {
  test("returns undefined when no chatgpt_oauth in file", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ anthropic: "sk-ant" }));

    const result = await loadOAuthTokens(path);
    expect(result).toBeUndefined();
  });

  test("returns OAuth tokens when present", async () => {
    const path = join(TEST_ROOT, "auth.jsonc");
    await Bun.write(path, JSON.stringify({ chatgpt_oauth: TEST_OAUTH_TOKENS }));

    const result = await loadOAuthTokens(path);
    expect(result).toEqual(TEST_OAUTH_TOKENS);
  });

  test("returns undefined when file does not exist", async () => {
    const result = await loadOAuthTokens(join(TEST_ROOT, "missing.jsonc"));
    expect(result).toBeUndefined();
  });
});
