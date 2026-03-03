---
id: P015
status: done
created: 2026-03-03
---

status: done
---

# Notification-based Account Auth Protocol

## Context

`createAuthCallbacks()`는 L4 Application Adapter 코드가 core(L2)에 위치한 추상화 수준 불일치.
OAuth 완료 감지가 2초 간격 폴링(`auth/oauth/status`). codex-rs는 `AccountLoginCompleted` + `AccountUpdated` notification으로 push.
이 변경은 codex-rs 패턴을 참고하여 auth를 notification 기반 프로토콜로 전환하고, `createAuthCallbacks`를 해체한다.

## 변경 범위

### 1. Protocol: auth notification 타입 추가

**`packages/protocol/src/data-model.ts`** — auth 관련 데이터 스키마 추가

```typescript
export const ProviderNameSchema = z.enum(["anthropic", "openai", "gemini"]);

export const ProviderAuthStatusSchema = z.object({
  provider: ProviderNameSchema,
  configured: z.boolean(),
  maskedKey: z.string().optional(),
  oauthConnected: z.boolean().optional(),
});
export type ProviderAuthStatus = z.infer<typeof ProviderAuthStatusSchema>;
```

**`packages/protocol/src/methods.ts`** — 2개 notification method 추가

```typescript
export const DILIGENT_SERVER_NOTIFICATION_METHODS = {
  // ... existing
  ACCOUNT_LOGIN_COMPLETED: "account/login/completed",
  ACCOUNT_UPDATED: "account/updated",
} as const;
```

**`packages/protocol/src/server-notifications.ts`** — 2개 notification 스키마 + union 확장

```typescript
// OAuth 흐름 완료 (비동기 결과)
export const AccountLoginCompletedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED),
  params: z.object({
    loginId: z.string().nullable(),      // null=API key, UUID=OAuth
    success: z.boolean(),
    error: z.string().nullable(),
  }),
});

// 인증 상태 변경 (set/remove/oauth 모든 경우)
export const AccountUpdatedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED),
  params: z.object({
    providers: z.array(ProviderAuthStatusSchema),
  }),
});

// DiligentServerNotificationSchema union에 추가
```

### 2. Core: `createAuthCallbacks` 삭제

**삭제**: `packages/core/src/auth/auth-callbacks.ts` (117줄)

**수정**: `packages/core/src/auth/index.ts`
- `createAuthCallbacks`, `AuthCallbacks`, `ProviderAuthInfo` export 제거

**수정**: `packages/core/src/index.ts`
- 같은 export 제거

core의 raw 프리미티브는 그대로 유지:
- `auth-store.ts`: `loadAuthStore`, `saveAuthKey`, `removeAuthKey`, `loadOAuthTokens`, `saveOAuthTokens`, `removeOAuthTokens`
- `oauth/*`: `generatePKCE`, `waitForCallback`, `exchangeCodeForTokens`, `buildOAuthTokens`, `CHATGPT_*` 상수
- `provider-manager.ts`: `ProviderManager`, `PROVIDER_NAMES`

### 3. Web server: rpc-bridge 인라인 auth + notification 발행

**`packages/web/src/server/rpc-bridge.ts`**

생성자 변경:
```typescript
// Before
constructor(..., private readonly authCallbacks?: AuthCallbacks)

// After
constructor(..., private readonly providerManager?: ProviderManager)
```

auth 메서드 직접 구현 (core raw 프리미티브 import):
```typescript
import {
  loadAuthStore, saveAuthKey, removeAuthKey,
  loadOAuthTokens, removeOAuthTokens, saveOAuthTokens,
  generatePKCE, waitForCallback, exchangeCodeForTokens, buildOAuthTokens,
  CHATGPT_AUTH_URL, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT_URI, CHATGPT_SCOPES,
  PROVIDER_NAMES, type ProviderName,
} from "@diligent/core";
```

auth RPC 핸들러 변경:

| 메서드 | 변경 |
|--------|------|
| `auth/list` | `loadAuthStore()` + `providerManager` 조합 → 직접 구현 |
| `auth/set` | `saveAuthKey()` + `providerManager.setApiKey()` + `account/updated` notification broadcast |
| `auth/remove` | `removeAuthKey()` + `providerManager.removeApiKey()` + `account/updated` notification broadcast |
| `auth/oauth/start` | PKCE + `waitForCallback` + token exchange 직접 구현. 즉시 `{ authUrl }` 응답. 비동기로 완료 시 `account/login/completed` + `account/updated` notification broadcast |
| `auth/oauth/status` | **삭제** — notification으로 대체 |

헬퍼 함수 추가:
```typescript
private async buildProviderList(): Promise<ProviderAuthStatus[]> {
  const keys = await loadAuthStore();
  const oauthTokens = await loadOAuthTokens();
  return PROVIDER_NAMES.map(p => ({
    provider: p,
    configured: Boolean(keys[p]),
    maskedKey: keys[p] ? maskKey(keys[p] as string) : undefined,
    oauthConnected: p === "openai" ? Boolean(oauthTokens) : undefined,
  }));
}

private emitAccountUpdated(providers: ProviderAuthStatus[]): void {
  this.broadcast({
    type: "server_notification",
    notification: {
      method: "account/updated",
      params: { providers },
    },
  });
}
```

`maskKey()`도 rpc-bridge로 이동 (표시용 헬퍼 — adapter 레이어에 적합).

### 4. Web server init 간소화

**`packages/web/src/server/index.ts`**

```typescript
// Before
const authCallbacks = createAuthCallbacks(runtimeConfig.providerManager);
const bridge = new RpcBridge(appServer, cwd, runtimeConfig.mode, modelConfig, authCallbacks);

// After
const bridge = new RpcBridge(appServer, cwd, runtimeConfig.mode, modelConfig, runtimeConfig.providerManager);
```

`createAuthCallbacks` import 제거.

### 5. Web client: 폴링 → notification

**`packages/web/src/client/lib/use-provider-manager.ts`**

- `handleOAuthStatus` 콜백 삭제
- `onAccountLoginCompleted(notification)` 콜백 추가: OAuth 결과 처리
- `onAccountUpdated(notification)` 콜백 추가: provider 상태 즉시 반영
- 두 콜백은 App.tsx의 notification dispatch에서 호출

**`packages/web/src/client/components/ProviderSettingsModal.tsx`**

- `onOAuthStatus` prop 삭제
- `onOAuthCompleted` prop 추가 (또는 providers 변경 감지로 자동 반영)
- `setInterval` 폴링 코드 전체 삭제 (85-115줄)
- `pollRef` 삭제
- OAuth 상태는 `account/login/completed` notification에서 수신

**`packages/web/src/client/App.tsx`** (또는 notification dispatch)

notification handler에 account 케이스 추가:
```typescript
case "account/login/completed":
  // OAuth 완료 → providerManager hook 갱신
  break;
case "account/updated":
  // providers 상태 갱신
  break;
```

### 6. 타입 정리

**`packages/web/src/shared/ws-protocol.ts`**
- `ProviderAuthStatus` 타입 삭제 → `@diligent/protocol`에서 import
- `OAuthStatusResult` 타입 삭제 (더 이상 사용 안함)
- `OAuthStartResult` 유지 (RPC 응답 타입)

**`packages/web/src/client/lib/auth-api.ts`**
- `getOAuthStatus()` 함수 삭제
- `ProviderAuthStatus` import를 `@diligent/protocol`로 변경

## 파일 변경 목록

| 파일 | 변경 |
|------|------|
| `packages/protocol/src/data-model.ts` | `ProviderAuthStatusSchema` 추가 |
| `packages/protocol/src/methods.ts` | 2개 notification method 추가 |
| `packages/protocol/src/server-notifications.ts` | 2개 notification 스키마 + union 확장 |
| `packages/core/src/auth/auth-callbacks.ts` | **삭제** |
| `packages/core/src/auth/index.ts` | export 3개 제거 |
| `packages/core/src/index.ts` | export 3개 제거 |
| `packages/web/src/server/rpc-bridge.ts` | AuthCallbacks → ProviderManager + inline auth + notification 발행 |
| `packages/web/src/server/index.ts` | createAuthCallbacks 제거, providerManager 직접 전달 |
| `packages/web/src/shared/ws-protocol.ts` | ProviderAuthStatus, OAuthStatusResult 삭제 |
| `packages/web/src/client/lib/auth-api.ts` | getOAuthStatus 삭제, import 변경 |
| `packages/web/src/client/lib/use-provider-manager.ts` | 폴링 → notification 핸들러 |
| `packages/web/src/client/components/ProviderSettingsModal.tsx` | polling 삭제, notification 기반 |
| `packages/web/src/client/App.tsx` | account notification 라우팅 |

## Verification

1. `bun test` — 762 테스트 통과 확인
2. `bun run typecheck` — 타입 에러 없음
3. Web UI 수동 테스트:
   - API key set → `account/updated` notification → UI 즉시 갱신
   - API key remove → `account/updated` notification → UI 즉시 갱신
   - ChatGPT OAuth start → 브라우저 오픈 → 완료 시 `account/login/completed` + `account/updated` → UI 즉시 갱신
   - 폴링 없음 확인 (Network 탭에서 `auth/oauth/status` 요청 0건)
