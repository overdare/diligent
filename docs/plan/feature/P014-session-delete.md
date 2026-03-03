---
id: P014
status: done
created: 2026-03-03
---

status: done
---

# Session Delete Feature

## Context

세션이 쌓이면 사이드바가 지저분해지지만 삭제 수단이 없다. 세션은 로컬 JSONL 파일이므로 hard delete(`unlink`)가 적절하다. ARCHITECTURE.md "Frontend Protocol Philosophy"에 따라 Web과 TUI 모두 구현한다.

## Approach

**Hard delete** (파일 삭제) + **protocol method** (`thread/delete`) + **양쪽 UI에 확인 다이얼로그**

## Changes (11 files, bottom-up)

### 1. Protocol — `packages/protocol/src/methods.ts`

`DILIGENT_CLIENT_REQUEST_METHODS`에 추가:
```
THREAD_DELETE: "thread/delete",
```

### 2. Protocol — `packages/protocol/src/client-requests.ts`

- `ThreadDeleteParamsSchema`: `{ threadId: z.string() }` (필수 — 실수 방지)
- `ThreadDeleteResponseSchema`: `{ deleted: z.boolean() }`
- `DiligentClientRequestSchema`, `DiligentClientResponseSchema` 유니언에 등록

### 3. Persistence — `packages/core/src/session/persistence.ts`

`deleteSession(sessionsDir, sessionId)` 함수 추가. `Bun.file(path).exists()` 체크 후 `fs.unlink`.

### 4. Core re-export — `packages/core/src/session/index.ts`

`deleteSession`을 persistence re-exports에 추가.

### 5. App server — `packages/core/src/app-server/server.ts`

`dispatchClientRequest` switch에 `THREAD_DELETE` case:
- running 상태면 에러 throw
- `knownCwds` 순회 → `deleteSession()` 호출
- `threads` Map 제거, `activeThreadId` 정리
- `{ deleted: boolean }` 반환

### 6. Test — `packages/core/test/session-persistence.test.ts`

`describe("deleteSession")`: 기존 세션 삭제 `true` + `listSessions` 빈 배열, 미존재 세션 `false`.

### 7. Web RPC bridge — `packages/web/src/server/rpc-bridge.ts`

`thread/delete` 성공 후처리 (기존 `thread/start`/`thread/resume` 패턴):
- `threadOwners`에서 제거
- `session.currentThreadId`가 삭제된 것이면 null

### 8. Web Sidebar — `packages/web/src/client/components/Sidebar.tsx`

- `onDeleteThread?: (threadId: string) => void` prop
- 이미 있는 `group` 클래스 활용: hover 시 × 버튼 (`opacity-0 group-hover:opacity-100`)
- `e.stopPropagation()`으로 thread open 방지

### 9. Web App — `packages/web/src/client/App.tsx`

- `pendingDeleteThreadId` state
- `deleteThread(threadId)`: RPC → 활성이면 전환(`thread/resume mostRecent` or `thread/start`) → `refreshThreadList()`
- 기존 `Modal` + `Button(danger/ghost)` 조합으로 확인 다이얼로그

### 10. TUI — `packages/cli/src/tui/app.ts` + `commands/types.ts`

- `deleteThread(threadId)` private 메서드: RPC 호출 → 활성이면 전환
- `CommandContext`에 `deleteThread` 추가

### 11. TUI Command — `packages/cli/src/tui/commands/builtin/session.ts` + `index.ts`

- `deleteCommand`: `/delete [threadId]` — 인자 없으면 ListPicker, `ctx.app.confirm()` 후 삭제
- `registerBuiltinCommands`에 등록

## File Summary

| # | File | Action |
|---|------|--------|
| 1 | `packages/protocol/src/methods.ts` | add constant |
| 2 | `packages/protocol/src/client-requests.ts` | add schemas + union entries |
| 3 | `packages/core/src/session/persistence.ts` | add `deleteSession` |
| 4 | `packages/core/src/session/index.ts` | add re-export |
| 5 | `packages/core/src/app-server/server.ts` | add handler + import |
| 6 | `packages/core/test/session-persistence.test.ts` | add tests |
| 7 | `packages/web/src/server/rpc-bridge.ts` | add post-processing |
| 8 | `packages/web/src/client/components/Sidebar.tsx` | add delete button |
| 9 | `packages/web/src/client/App.tsx` | add delete logic + confirm modal |
| 10 | `packages/cli/src/tui/app.ts` + `commands/types.ts` | add `deleteThread` method |
| 11 | `packages/cli/src/tui/commands/builtin/session.ts` + `index.ts` | add `/delete` command |

## Verification

1. `bun test packages/core/test/session-persistence.test.ts`
2. `bun run typecheck`
3. Web: sidebar hover → × → confirm modal → delete + list refresh
4. TUI: `/delete` → ListPicker → ConfirmDialog → delete + session switch
