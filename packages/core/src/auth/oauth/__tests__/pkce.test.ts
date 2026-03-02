// @summary Tests for PKCE verifier and challenge generation

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { generateCodeChallenge, generateCodeVerifier, generatePKCE } from "../pkce";

describe("generateCodeVerifier", () => {
  test("is base64url without padding", () => {
    const v = generateCodeVerifier();
    expect(v).not.toContain("=");
    expect(v).not.toContain("+");
    expect(v).not.toContain("/");
  });

  test("produces a string from 32 bytes (43 chars base64url)", () => {
    const v = generateCodeVerifier();
    // 32 bytes → 43 chars in base64url (no padding)
    expect(v.length).toBeGreaterThanOrEqual(40);
    expect(v.length).toBeLessThanOrEqual(44);
  });

  test("generates unique values", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe("generateCodeChallenge", () => {
  test("is SHA-256 of verifier, base64url encoded", () => {
    const verifier = "test-verifier";
    const challenge = generateCodeChallenge(verifier);
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  test("is base64url without padding", () => {
    const challenge = generateCodeChallenge("some-verifier");
    expect(challenge).not.toContain("=");
    expect(challenge).not.toContain("+");
    expect(challenge).not.toContain("/");
  });

  test("is deterministic for the same input", () => {
    const v = "consistent-input";
    expect(generateCodeChallenge(v)).toBe(generateCodeChallenge(v));
  });
});

describe("generatePKCE", () => {
  test("returns a pair with verifier and challenge", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    expect(typeof codeVerifier).toBe("string");
    expect(typeof codeChallenge).toBe("string");
  });

  test("challenge matches SHA-256 of verifier", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const expected = createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expected);
  });
});
