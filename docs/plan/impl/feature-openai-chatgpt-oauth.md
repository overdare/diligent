# Feature: OpenAI ChatGPT Subscription OAuth

## Goal

사용자가 OpenAI API 키 없이 ChatGPT Plus/Pro 구독만으로 Diligent를 인증하고 사용할 수 있다. `/provider openai` 실행 시 API 키 직접 입력 외에 "Login with ChatGPT" 옵션이 나타나고, 브라우저 OAuth 플로우를 통해 구독 전용 모델(gpt-5.3-codex 등)에 접근할 수 있다.

## Background: Why ChatGPT OAuth Is Different

| 방식 | 대상 | 인증 | 접근 모델 |
|------|------|------|----------|
| API Key (`sk-...`) | 개발자, platform.openai.com | 직접 발급 | 유료 API 과금 모델 |
| ChatGPT OAuth | Plus/Pro 구독자 | auth.openai.com PKCE flow | 구독 포함 Codex 모델 |

Anthropic과 Gemini는 이 방식이 없다 — API 키만 지원한다.

## Prerequisites

- Phase 4c 완료 (✅): TUI overlay system, provider command, auth.json, ProviderManager 모두 구현됨
- `packages/core/src/auth/auth-store.ts`: `loadAuthStore()`, `saveAuthKey()` 존재
- `packages/cli/src/provider-manager.ts`: `ProviderManager` 클래스 존재
- `packages/cli/src/tui/commands/builtin/provider.ts`: `promptApiKey()`, `promptSaveKey()` 존재

## Artifact

```
User → /provider openai
TUI  → [ListPicker] "Enter API key" | "Login with ChatGPT"
User → "Login with ChatGPT" 선택
TUI  → "Opening browser..." (localhost:1455 서버 시작)
[Browser opens: https://auth.openai.com/oauth/authorize?...]
User → ChatGPT로 로그인
[Callback: localhost:1455/auth/callback?code=...]
TUI  → "Authenticated! Exchanging token..."
[token exchange: id_token → sk-... API key]
TUI  → "OpenAI configured via ChatGPT subscription."
TUI  → "Save to auth.json? [Y/N]"
User → Y
TUI  → "Saved. Model: gpt-5.3-codex"
```

이후 실행 시: auth.json의 `openai_oauth`를 로드하고, 만료 5분 전 자동 갱신.

## Layer Touchpoints

| Layer | Depth | What Changes |
|-------|-------|-------------|
| L0 (Provider) | +oauth-auth | 모델 레지스트리에 Codex OAuth 모델 추가. OpenAI 스트림 생성자는 변화 없음 (api_key는 동일) |
| L5 (Config) | — | 변화 없음 |
| Auth (core) | +oauth-store | auth.json 스키마 확장: `openai_oauth` 필드 추가. `saveOAuthTokens()`, `loadOAuthTokens()` 추가 |
| Auth/OAuth (core) | CREATE | 새 모듈: PKCE, callback server, token exchange, refresh |
| ProviderManager (cli) | +oauth-dispatch | 시작 시 oauth 토큰 로드. OpenAI 디스패치 전 만료 확인 후 자동 갱신 |
| Provider Command (cli) | +oauth-ui | OpenAI 선택 시 "API 키 입력" / "ChatGPT 로그인" 선택지 추가 |

**Not touched:** L1 (agent loop), L2 (tool system), L3 (core tools), L4 (approval), L6 (session), L7 (TUI framework), L8 (skills), L9 (MCP), L10 (multi-agent)

## Decisions

### D088: auth.json 스키마 — OAuth 토큰 저장

**결정**: `openai_oauth` 필드를 auth.json에 추가. 기존 `openai` (plain API key) 필드와 공존 가능하지만, `openai_oauth`가 존재하면 우선 사용한다.

```json
{
  "openai_oauth": {
    "access_token": "eyJ...",
    "refresh_token": "ey...",
    "id_token": "eyJ...",
    "expires_at": 1234567890000,
    "api_key": "sk-..."
  }
}
```

**이유**:
- Plain API 키와 OAuth 토큰은 구조가 다름 — string vs. object. AuthKeys 타입에 `openai_oauth` 필드를 별도 추가.
- `api_key` (토큰 교환으로 얻은 `sk-...`)를 함께 저장해 매번 재교환 불필요.
- 기존 `openai` plain key 사용자는 영향 없음.

**우선순위**: `openai_oauth.api_key` > `openai` (plain key). 둘 다 없으면 에러.

### D089: ChatGPT OAuth 플로우 — PKCE + 로컬 서버

**결정**: 표준 OAuth 2.0 Authorization Code + PKCE(S256) 방식. 로컬 서버는 Bun.serve()로 `localhost:1455`에서 실행, 콜백 수신 후 즉시 종료. 브라우저는 플랫폼별 셸 명령으로 열기.

```
Client ID:    app_EMoamEEZ73f0CkXaXp7hrann  (OpenAI 공개 클라이언트)
Callback:     http://localhost:1455/auth/callback
Auth URL:     https://auth.openai.com/oauth/authorize
Token URL:    https://auth.openai.com/oauth/token
Scopes:       openid profile email offline_access
```

**이유**: Codex CLI (공식), term-llm, opencode 등 다수의 OSS 도구가 동일 client_id와 플로우를 사용. 공개 클라이언트이므로 client_secret 불필요.

### D090: 토큰 갱신 — 만료 5분 전 자동 갱신

**결정**: ProviderManager가 OpenAI API 호출 전 `expires_at - 300_000 < Date.now()` 확인. 만족하면 refresh_token으로 갱신 후 auth.json 업데이트.

**주의**: Refresh token은 단일 사용(single-use with rotation). 갱신 후 응답의 새 refresh_token을 반드시 저장해야 함. 동시 갱신 방지를 위해 갱신 중 lock (Promise) 사용.

## File Manifest

### packages/core/src/auth/

| File | Action | Description |
|------|--------|-------------|
| `auth-store.ts` | MODIFY | `AuthKeys` 타입 확장, `openai_oauth` 스키마 추가, `saveOAuthTokens()` / `loadOAuthTokens()` 추가 |
| `types.ts` | CREATE | `OpenAIOAuthTokens` 인터페이스 정의 |
| `index.ts` | MODIFY | 새 export 추가 |

### packages/core/src/auth/oauth/

| File | Action | Description |
|------|--------|-------------|
| `pkce.ts` | CREATE | PKCE code verifier/challenge 생성 (SHA-256, base64url) |
| `callback-server.ts` | CREATE | Bun.serve()로 localhost:1455 콜백 서버 — 코드 수신 후 종료 |
| `token-exchange.ts` | CREATE | Authorization code→tokens, id_token→api_key 교환 |
| `refresh.ts` | CREATE | Refresh token으로 새 access/refresh/api_key 교환 |
| `browser.ts` | CREATE | 플랫폼별 브라우저 열기 (macOS: open, Linux: xdg-open, Windows: start) |
| `chatgpt-oauth.ts` | CREATE | 메인 플로우 오케스트레이터 — start() 반환 `OpenAIOAuthTokens` |
| `index.ts` | CREATE | public exports |

### packages/core/src/provider/

| File | Action | Description |
|------|--------|-------------|
| `models.ts` | MODIFY | OAuth 전용 Codex 모델 추가 (gpt-5.3-codex 등), `oauthRequired` 플래그 추가 |

### packages/cli/src/

| File | Action | Description |
|------|--------|-------------|
| `provider-manager.ts` | MODIFY | OAuth 토큰 저장/로드, 만료 확인 + 자동 갱신, `setOAuthTokens()`, `hasOAuthFor()` |
| `config.ts` | MODIFY | 시작 시 `openai_oauth` 로드해서 ProviderManager에 세팅 |

### packages/cli/src/tui/commands/builtin/

| File | Action | Description |
|------|--------|-------------|
| `provider.ts` | MODIFY | OpenAI 선택 시 auth method picker overlay 추가, OAuth 플로우 시작 |

### packages/core/src/auth/__tests__/

| File | Action | Description |
|------|--------|-------------|
| `auth-store.test.ts` | MODIFY | `openai_oauth` 필드 로드/저장 테스트 추가 |

### packages/core/src/auth/oauth/__tests__/

| File | Action | Description |
|------|--------|-------------|
| `pkce.test.ts` | CREATE | PKCE verifier/challenge 생성 검증 |
| `token-exchange.test.ts` | CREATE | 토큰 교환 함수 mock 테스트 |
| `refresh.test.ts` | CREATE | 갱신 함수 mock 테스트 |

## Implementation Tasks

### Task 1: `OpenAIOAuthTokens` 타입 및 auth-store 스키마 확장

**Files:** `packages/core/src/auth/types.ts`, `packages/core/src/auth/auth-store.ts`, `packages/core/src/auth/index.ts`
**Decisions:** D088

`types.ts` 생성:

```typescript
// @summary OAuth token types for ChatGPT subscription authentication
export interface OpenAIOAuthTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
  /** Unix timestamp in milliseconds */
  expires_at: number;
  /** Derived API key (sk-...) from token exchange */
  api_key: string;
}
```

`auth-store.ts` 수정 — 스키마와 타입 확장:

```typescript
import type { OpenAIOAuthTokens } from "./types";

const OpenAIOAuthSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string(),
  expires_at: z.number(),
  api_key: z.string(),
});

const AuthKeysSchema = z
  .object({
    anthropic: z.string().optional(),
    openai: z.string().optional(),
    gemini: z.string().optional(),
    openai_oauth: OpenAIOAuthSchema.optional(),
  })
  .strict();

export type AuthKeys = {
  anthropic?: string;
  openai?: string;
  gemini?: string;
  openai_oauth?: OpenAIOAuthTokens;
};
```

`saveOAuthTokens()` 추가:

```typescript
/** Save OpenAI OAuth tokens to auth.json (read-modify-write). */
export async function saveOAuthTokens(tokens: OpenAIOAuthTokens, path?: string): Promise<void> {
  // same read-modify-write pattern as saveAuthKey()
  // sets existing.openai_oauth = tokens
  // chmod 0o600
}

/** Load OpenAI OAuth tokens from auth.json. Returns undefined if not present. */
export async function loadOAuthTokens(path?: string): Promise<OpenAIOAuthTokens | undefined> {
  const keys = await loadAuthStore(path);
  return keys.openai_oauth;
}
```

**Verify:** `bun test packages/core/src/auth/__tests__/auth-store.test.ts` — 새 케이스 통과

---

### Task 2: PKCE 유틸리티

**Files:** `packages/core/src/auth/oauth/pkce.ts`
**Decisions:** D089

```typescript
// @summary PKCE code verifier and challenge generation for OAuth 2.0
import { createHash, randomBytes } from "node:crypto";

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

/** Generate a PKCE code verifier (32 random bytes → base64url, no padding) */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Generate SHA-256 code challenge from verifier */
export function generateCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/** Generate a full PKCE pair */
export function generatePKCE(): PKCEPair {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}
```

**Verify:** `bun test packages/core/src/auth/oauth/__tests__/pkce.test.ts`

---

### Task 3: OAuth 콜백 서버

**Files:** `packages/core/src/auth/oauth/callback-server.ts`
**Decisions:** D089

```typescript
// @summary Local HTTP server on port 1455 to receive OAuth authorization code
export interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Start a local server on localhost:1455 to receive the OAuth callback.
 * Resolves with the authorization code, rejects on timeout (default 5min).
 */
export function waitForCallback(
  expectedState: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port: 1455,
      hostname: "localhost",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/auth/callback") {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          server.stop();
          reject(new Error(`OAuth error: ${error}`));
          return new Response(CALLBACK_HTML("Authentication failed."), {
            headers: { "Content-Type": "text/html" },
          });
        }

        if (!code || state !== expectedState) {
          server.stop();
          reject(new Error("Invalid callback: missing code or state mismatch"));
          return new Response(CALLBACK_HTML("Invalid callback."), {
            headers: { "Content-Type": "text/html" },
          });
        }

        setTimeout(() => server.stop(), 1000);
        resolve({ code, state });
        return new Response(CALLBACK_HTML("Authentication successful! You can close this window."), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });

    setTimeout(() => {
      server.stop();
      reject(new Error("OAuth callback timed out after 5 minutes"));
    }, timeoutMs);
  });
}

const CALLBACK_HTML = (message: string) => `<!DOCTYPE html>
<html><head><title>Diligent Auth</title></head>
<body style="font-family:sans-serif;text-align:center;padding:2em">
<h2>${message}</h2></body></html>`;
```

---

### Task 4: 토큰 교환

**Files:** `packages/core/src/auth/oauth/token-exchange.ts`
**Decisions:** D089

```typescript
// @summary OpenAI OAuth token exchange — authorization code → tokens → API key
import type { OpenAIOAuthTokens } from "../types";

const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/auth/callback";

export interface RawTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<RawTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<RawTokenResponse>;
}

/** Exchange id_token for an OpenAI API key (RFC 8693 token exchange) */
export async function exchangeIdTokenForApiKey(idToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: CLIENT_ID,
    requested_token: "openai-api-key",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API key exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("No API key in token exchange response");
  return data.access_token;
}

/** Convert raw token response to OpenAIOAuthTokens (including API key exchange) */
export async function buildOAuthTokens(raw: RawTokenResponse): Promise<OpenAIOAuthTokens> {
  const apiKey = await exchangeIdTokenForApiKey(raw.id_token);
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    id_token: raw.id_token,
    expires_at: Date.now() + raw.expires_in * 1000,
    api_key: apiKey,
  };
}
```

---

### Task 5: 토큰 갱신

**Files:** `packages/core/src/auth/oauth/refresh.ts`
**Decisions:** D090

```typescript
// @summary Refresh OpenAI OAuth tokens using refresh_token (single-use with rotation)
import type { OpenAIOAuthTokens } from "../types";
import { buildOAuthTokens } from "./token-exchange";

const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/** Check if tokens need refresh (expire within 5 minutes) */
export function shouldRefresh(tokens: OpenAIOAuthTokens): boolean {
  return tokens.expires_at - 5 * 60 * 1000 < Date.now();
}

/** Refresh tokens. Returns new token set with rotated refresh_token. */
export async function refreshOAuthTokens(tokens: OpenAIOAuthTokens): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: tokens.refresh_token,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const raw = await res.json();
  return buildOAuthTokens(raw);
}
```

---

### Task 6: 브라우저 열기 유틸리티

**Files:** `packages/core/src/auth/oauth/browser.ts`

```typescript
// @summary Cross-platform browser launcher for OAuth flows
import { spawn } from "node:child_process";

/** Open a URL in the default browser (macOS, Linux, Windows) */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open"
    : platform === "win32" ? "start"
    : "xdg-open";

  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}
```

---

### Task 7: OAuth 플로우 오케스트레이터

**Files:** `packages/core/src/auth/oauth/chatgpt-oauth.ts`, `packages/core/src/auth/oauth/index.ts`
**Decisions:** D089

```typescript
// @summary ChatGPT subscription OAuth 2.0 PKCE flow — returns OpenAIOAuthTokens
import { randomBytes } from "node:crypto";
import type { OpenAIOAuthTokens } from "../types";
import { openBrowser } from "./browser";
import { waitForCallback } from "./callback-server";
import { buildOAuthTokens, exchangeCodeForTokens } from "./token-exchange";
import { generatePKCE } from "./pkce";

const AUTH_URL = "https://auth.openai.com/oauth/authorize";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPES = "openid profile email offline_access";

export interface OAuthFlowOptions {
  /** Called when the browser URL is ready (for display in TUI before opening) */
  onUrl?: (url: string) => void;
  /** Timeout in ms (default: 5 minutes) */
  timeoutMs?: number;
}

/**
 * Run the full ChatGPT OAuth flow. Opens browser, waits for callback,
 * exchanges code and id_token for OpenAIOAuthTokens.
 */
export async function runChatGPTOAuth(options: OAuthFlowOptions = {}): Promise<OpenAIOAuthTokens> {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  const authUrl = `${AUTH_URL}?${params}`;
  options.onUrl?.(authUrl);

  await openBrowser(authUrl);

  const { code } = await waitForCallback(state, options.timeoutMs);
  const rawTokens = await exchangeCodeForTokens(code, codeVerifier);
  return buildOAuthTokens(rawTokens);
}
```

---

### Task 8: ProviderManager OAuth 지원

**Files:** `packages/cli/src/provider-manager.ts`
**Decisions:** D088, D090

ProviderManager에 OAuth 관련 메서드 추가:

```typescript
import type { OpenAIOAuthTokens } from "@diligent/core";
import { refreshOAuthTokens, saveOAuthTokens, shouldRefresh } from "@diligent/core";

export class ProviderManager {
  private oauthTokens: OpenAIOAuthTokens | undefined = undefined;
  private refreshLock: Promise<void> | undefined = undefined;

  /** Store OAuth tokens and extract api_key as the provider key */
  setOAuthTokens(tokens: OpenAIOAuthTokens): void {
    this.oauthTokens = tokens;
    this.setApiKey("openai", tokens.api_key);
  }

  /** Whether OpenAI is authenticated via OAuth */
  hasOAuthFor(provider: "openai"): boolean {
    return this.oauthTokens !== undefined;
  }

  /** Return OAuth tokens (for save prompt display) */
  getOAuthTokens(): OpenAIOAuthTokens | undefined {
    return this.oauthTokens;
  }

  /** Ensure OpenAI OAuth tokens are fresh before dispatch. */
  private async ensureOAuthFresh(): Promise<void> {
    if (!this.oauthTokens || !shouldRefresh(this.oauthTokens)) return;

    // Prevent concurrent refreshes
    if (!this.refreshLock) {
      this.refreshLock = (async () => {
        try {
          const newTokens = await refreshOAuthTokens(this.oauthTokens!);
          this.oauthTokens = newTokens;
          this.setApiKey("openai", newTokens.api_key);
          // Persist to auth.json (best-effort, don't throw)
          await saveOAuthTokens(newTokens).catch(() => {});
        } finally {
          this.refreshLock = undefined;
        }
      })();
    }
    await this.refreshLock;
  }

  createProxyStream(): StreamFunction {
    return async (model, context, options) => {
      const provider = (model.provider ?? "anthropic") as ProviderName;

      // Auto-refresh OAuth before OpenAI calls
      if (provider === "openai" && this.oauthTokens) {
        await this.ensureOAuthFresh();
      }

      const apiKey = this.keys[provider];
      if (!apiKey) {
        throw new Error(`No API key configured for ${provider}. Use /provider ${provider} to configure.`);
      }

      return this.getOrCreateStream(provider, apiKey)(model, context, options);
    };
  }
}
```

---

### Task 9: config.ts — 시작 시 OAuth 토큰 로드

**Files:** `packages/cli/src/config.ts`
**Decisions:** D088

```typescript
import { loadAuthStore, loadOAuthTokens } from "@diligent/core";

export async function loadConfig(cwd: string): Promise<AppConfig> {
  // ... existing code ...

  // Load plain API keys
  const authKeys = await loadAuthStore();
  for (const [provider, key] of Object.entries(authKeys)) {
    if (typeof key === "string" && key) {
      providerManager.setApiKey(provider as ProviderName, key);
    }
  }

  // Load OpenAI OAuth tokens (takes priority over plain key if present)
  const oauthTokens = await loadOAuthTokens();
  if (oauthTokens) {
    providerManager.setOAuthTokens(oauthTokens);
  }

  // ... rest ...
}
```

---

### Task 10: Provider Command UI — OpenAI 인증 방법 선택

**Files:** `packages/cli/src/tui/commands/builtin/provider.ts`
**Decisions:** D089

`switchProvider()` 내 OpenAI의 경우 인증 방법 선택 picker를 표시:

```typescript
import { runChatGPTOAuth, saveOAuthTokens } from "@diligent/core";

/** OpenAI: show "Enter API key" vs "Login with ChatGPT" */
async function promptOpenAIAuth(ctx: CommandContext): Promise<void> {
  return new Promise((resolve) => {
    const items: ListPickerItem[] = [
      { label: "Enter API key", description: "Paste sk-... key from platform.openai.com", value: "apikey" },
      { label: "Login with ChatGPT", description: "Use Plus/Pro subscription via browser OAuth", value: "oauth" },
    ];

    const picker = new ListPicker({ title: "OpenAI Authentication", items }, async (value) => {
      handle.hide();
      ctx.requestRender();

      if (value === "apikey") {
        await promptApiKey("openai", ctx);
      } else if (value === "oauth") {
        await startChatGPTOAuthFlow(ctx);
      }
      resolve();
    });

    const handle = ctx.showOverlay(picker, { anchor: "center" });
    ctx.requestRender();
  });
}

async function startChatGPTOAuthFlow(ctx: CommandContext): Promise<void> {
  ctx.displayLines(["  Opening browser for ChatGPT authentication..."]);

  try {
    const tokens = await runChatGPTOAuth({
      onUrl: (url) => {
        ctx.displayLines([`  Auth URL: ${url}`]);
      },
    });

    ctx.config.providerManager.setOAuthTokens(tokens);
    ctx.displayLines(["  Authenticated via ChatGPT subscription."]);

    // Save prompt
    await promptSaveOAuthTokens(tokens, ctx);

    // Switch model to default Codex model
    const model = resolveModel("gpt-5.3-codex");
    ctx.config.model = model;
    ctx.onModelChanged(model.id);
    ctx.displayLines([`  Model: ${t.bold}${model.id}${t.reset}`]);
    saveModel(model.id).catch(() => {});
  } catch (err) {
    ctx.displayError(`OAuth failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function promptSaveOAuthTokens(tokens: OpenAIOAuthTokens, ctx: CommandContext): Promise<void> {
  return new Promise((resolve) => {
    const dialog = new ConfirmDialog(
      { title: "Save Auth?", message: "Save ChatGPT session to ~/.config/diligent/auth.json?" },
      async (confirmed) => {
        handle.hide();
        ctx.requestRender();
        if (confirmed) {
          try {
            await saveOAuthTokens(tokens);
            ctx.displayLines(["  Saved to auth.json."]);
          } catch (err) {
            ctx.displayError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        resolve();
      },
    );
    const handle = ctx.showOverlay(dialog, { anchor: "center" });
    ctx.requestRender();
  });
}
```

`switchProvider()`에서 OpenAI 분기:

```typescript
async function switchProvider(provider: ProviderName, ctx: CommandContext): Promise<void> {
  if (!ctx.config.providerManager.hasKeyFor(provider)) {
    if (provider === "openai") {
      await promptOpenAIAuth(ctx);
    } else {
      await promptApiKey(provider, ctx);
    }
    if (!ctx.config.providerManager.hasKeyFor(provider)) {
      ctx.displayError("Provider switch cancelled.");
      return;
    }
  }
  // ... rest unchanged ...
}
```

---

### Task 11: 모델 레지스트리 — OAuth 전용 Codex 모델

**Files:** `packages/core/src/provider/models.ts`

연구 결과 확인된 ChatGPT 구독으로 접근 가능한 모델 추가:

```typescript
// Subscription-gated Codex models (require ChatGPT OAuth, not plain API key)
{ id: "gpt-5.3-codex", provider: "openai", aliases: ["codex"], contextWindow: 272000, supportsThinking: false },
{ id: "gpt-5.2-codex", provider: "openai", contextWindow: 272000, supportsThinking: false },
{ id: "gpt-5.1-codex", provider: "openai", contextWindow: 272000, supportsThinking: false },
{ id: "codex-mini-latest", provider: "openai", aliases: ["codex-mini"], contextWindow: 272000, supportsThinking: false },
```

> 참고: 서버 측에서 구독 엔타이틀먼트를 검증하므로 클라이언트에 별도 `oauthRequired` 플래그는 불필요. 인증이 안 된 경우 API에서 401/403 반환.

---

### Task 12: 테스트 및 검증

**Files:** `auth-store.test.ts` 수정, `pkce.test.ts` / `token-exchange.test.ts` / `refresh.test.ts` 생성

핵심 테스트 케이스:

```typescript
// pkce.test.ts
test("verifier is base64url without padding", () => {
  const v = generateCodeVerifier();
  expect(v).not.toContain("=");
  expect(v).not.toContain("+");
  expect(v).not.toContain("/");
});

test("challenge is SHA-256 of verifier, base64url", () => {
  const v = "test-verifier";
  const c = generateCodeChallenge(v);
  const expected = createHash("sha256").update(v).digest("base64url");
  expect(c).toBe(expected);
});

// auth-store.test.ts
test("loads openai_oauth tokens from auth.json", async () => {
  const tokens: OpenAIOAuthTokens = {
    access_token: "at", refresh_token: "rt", id_token: "it",
    expires_at: 9999999999000, api_key: "sk-test",
  };
  await writeFile(path, JSON.stringify({ openai_oauth: tokens }));
  const loaded = await loadAuthStore(path);
  expect(loaded.openai_oauth).toEqual(tokens);
});

test("saveOAuthTokens preserves other keys", async () => {
  await saveAuthKey("anthropic", "sk-ant-test", path);
  await saveOAuthTokens({ ...tokens }, path);
  const loaded = await loadAuthStore(path);
  expect(loaded.anthropic).toBe("sk-ant-test");
  expect(loaded.openai_oauth?.api_key).toBe("sk-test");
});
```

Mock fetch로 token exchange 테스트 (실제 네트워크 호출 없이).

## Migration Notes

- `AuthKeys` 타입 변경: `Partial<Record<ProviderName, string>>` → 명시적 타입. 기존 `anthropic`, `openai`, `gemini` string 필드 유지.
- `AuthKeysSchema`에 `.strict()` 유지 — `openai_oauth`가 새 허용 필드로 추가됨.
- `createProxyStream()`이 async로 변경됨 (`ensureOAuthFresh()` await) — `StreamFunction` 타입이 async를 이미 지원하는지 확인 필요.

## Acceptance Criteria

1. `bun test` — 모든 테스트 통과
2. `bun run typecheck` — 타입 오류 없음
3. `/provider openai` 실행 시 "Enter API key" / "Login with ChatGPT" 두 옵션 표시
4. ChatGPT OAuth 플로우: 브라우저 열림 → 로그인 → TUI에 성공 메시지
5. OAuth 완료 후 auth.json에 `openai_oauth` 필드 저장 (chmod 0o600)
6. 재시작 시 auth.json의 `openai_oauth`에서 자동 로드
7. `shouldRefresh()`: `expires_at - 5min < now`일 때 true 반환
8. 기존 plain API key (`openai: "sk-..."`) 사용자에게 영향 없음
9. Anthropic, Gemini provider는 변화 없음

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | PKCE verifier/challenge 생성 정확성 | `pkce.test.ts` — 길이, 인코딩, SHA-256 검증 |
| Unit | auth.json `openai_oauth` 로드/저장/보존 | `auth-store.test.ts` 확장 |
| Unit | `shouldRefresh()` 경계값 | 만료 6분 전 (false), 4분 전 (true) |
| Unit | `refreshOAuthTokens()` | Mock fetch — 새 토큰 반환, refresh_token 교체 확인 |
| Unit | `exchangeCodeForTokens()` + `exchangeIdTokenForApiKey()` | Mock fetch — 성공/실패 케이스 |
| Integration | ProviderManager OAuth 로드 + 자동 갱신 | `refreshLock` 동시 갱신 방지 |
| Manual | 전체 브라우저 OAuth 플로우 | 실제 ChatGPT 계정으로 e2e |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| OpenAI가 client_id를 변경하거나 서드파티 접근 차단 | OAuth 플로우 전체 실패 | client_id를 상수로 모아두고 쉽게 업데이트 가능하게 구성 |
| Refresh token race condition | 두 요청이 동시에 갱신 시도 → `invalid_grant` | `refreshLock` Promise로 직렬화 |
| localhost:1455 포트 충돌 | 콜백 서버 시작 실패 | `Bun.serve()` 에러 catch + 명확한 오류 메시지 |
| Token exchange (id_token → api_key) API 변경 | 인증 성공 후 API 키 발급 실패 | 별도 함수로 분리, 에러 메시지에 HTTP status 포함 |
| TUI 차단 — OAuth 대기 중 UI 멈춤 | 사용자 경험 저하 | `runChatGPTOAuth()` 는 async, TUI overlay가 닫힌 후 await |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D088 | auth.json 스키마 확장 — `openai_oauth` 필드 | auth-store.ts, types.ts |
| D089 | ChatGPT OAuth 플로우 — PKCE + 로컬 서버 | chatgpt-oauth.ts, callback-server.ts, token-exchange.ts |
| D090 | 토큰 갱신 — 만료 5분 전 자동 갱신, refreshLock | refresh.ts, provider-manager.ts |

## What This Feature Does NOT Include

- Gemini, Anthropic OAuth — 해당 제공자는 OAuth를 지원하지 않음 (API 키만)
- Device Code Flow (headless/SSH 환경) — workspace admin opt-in 필요, 복잡도 대비 사용 사례 적음. 향후 추가 가능.
- OpenAI ChatGPT OAuth 토큰으로 기존 `v1/chat/completions` 엔드포인트 접근 — token exchange로 얻은 `sk-...` API 키를 기존 OpenAI 스트림에 그대로 사용
- MCP OAuth (D066에서 deferred)
- OAuth 로그아웃 / 토큰 폐기 (`/provider logout openai` 등) — 향후 추가 가능
- Multiple OpenAI accounts — 단일 OAuth 세션만 지원
