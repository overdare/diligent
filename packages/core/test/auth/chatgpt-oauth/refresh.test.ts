// @summary Mock tests for OAuth token refresh
import { afterEach, describe, expect, mock, test } from "bun:test";
import { refreshOAuthTokens, shouldRefresh } from "../../../src/auth/chatgpt-oauth/refresh";
import type { OpenAIOAuthTokens } from "../../../src/auth/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const makeTokens = (expiresAt: number): OpenAIOAuthTokens => ({
  access_token: "at",
  refresh_token: "rt",
  id_token: "it",
  expires_at: expiresAt,
});

describe("shouldRefresh", () => {
  test("returns false when token expires more than 5 minutes from now", () => {
    const tokens = makeTokens(Date.now() + 6 * 60 * 1000);
    expect(shouldRefresh(tokens)).toBe(false);
  });

  test("returns false when token expires exactly 5 minutes from now (boundary)", () => {
    // expires_at - 5min = now → NOT < now → no refresh yet
    const tokens = makeTokens(Date.now() + 5 * 60 * 1000);
    expect(shouldRefresh(tokens)).toBe(false);
  });

  test("returns true when token expires 4 minutes from now", () => {
    const tokens = makeTokens(Date.now() + 4 * 60 * 1000);
    expect(shouldRefresh(tokens)).toBe(true);
  });

  test("returns true when token is already expired", () => {
    const tokens = makeTokens(Date.now() - 1000);
    expect(shouldRefresh(tokens)).toBe(true);
  });
});

describe("refreshOAuthTokens", () => {
  test("returns new tokens with rotated refresh_token", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "new-at",
            refresh_token: "new-rt",
            id_token: "new-it",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const tokens = makeTokens(Date.now() + 60_000);
    const newTokens = await refreshOAuthTokens(tokens);

    expect(newTokens.access_token).toBe("new-at");
    expect(newTokens.refresh_token).toBe("new-rt");
    expect(newTokens.expires_at).toBeGreaterThan(Date.now());
  });

  test("throws on refresh endpoint error", async () => {
    globalThis.fetch = mock(async () => new Response("invalid_grant", { status: 400 })) as unknown as typeof fetch;

    const tokens = makeTokens(Date.now() + 60_000);
    await expect(refreshOAuthTokens(tokens)).rejects.toThrow("Token refresh failed (400)");
  });
});
