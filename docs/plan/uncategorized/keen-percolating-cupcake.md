# Plan: Parallel Tool Execution (D015 Fulfillment)

## Context

현재 agent loop에서 LLM이 한 턴에 여러 tool call을 반환해도 **순차 실행** (for loop + await). Claude Code는 같은 edit format이지만 병렬 실행으로 효율적. D015 결정에서 `supportParallel` 플래그를 설계했지만 미구현 상태.

## Approach: All-or-Nothing Parallel

한 턴의 모든 tool call이 `supportParallel: true`이면 `Promise.all`로 병렬 실행. 하나라도 sequential이면 기존 순차 실행 유지.

- LLM이 이미 read를 묶고 write를 따로 보내는 경향 → 80% 케이스 커버
- partition 전략(parallel prefix + sequential tail)은 추후 필요 시 추가

## Changes

### 1. Tool interface에 `supportParallel` 추가
**File:** `packages/core/src/tool/types.ts`

```typescript
export interface Tool<TParams extends z.ZodType = any> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>, ctx: ToolContext) => Promise<ToolResult>;
  supportParallel?: boolean;  // NEW — defaults to false
}
```

### 2. Read-only tool 5개에 플래그 추가

| File | Tool | Change |
|------|------|--------|
| `packages/core/src/tools/read.ts` | read_file | `supportParallel: true` |
| `packages/core/src/tools/glob.ts` | glob | `supportParallel: true` |
| `packages/core/src/tools/grep.ts` | grep | `supportParallel: true` |
| `packages/core/src/tools/ls.ts` | ls | `supportParallel: true` |
| `packages/core/src/tools/plan.ts` | plan | `supportParallel: true` |

Sequential 유지 (변경 없음): bash, write, edit, add_knowledge, request_user_input, collab tools

### 3. Agent loop 병렬 실행 로직
**File:** `packages/core/src/agent/loop.ts` (lines 233-313)

1. `buildToolContext()` 헬퍼 추출 — 중복 제거
2. 분기 로직:
   - `toolCalls.every(tc => registry.get(tc.name)?.supportParallel)` && length > 1 → 병렬 경로
   - 그 외 → 기존 순차 경로

**병렬 경로 핵심:**
- itemId 전부 미리 생성
- tool_start 이벤트 전부 먼저 emit
- `Promise.all(toolCalls.map(tc => executeTool(...)))`
- 완료 후 원래 순서대로 tool_end emit + result 수집
- abort/loopDetector는 결과 수집 시 순서대로 처리

### 4. Tests
**File:** `packages/core/test/agent-loop.test.ts`

- 모든 parallel tool → 병렬 실행 확인 (tool_start 전부 → tool_end 전부)
- mixed tools → 순차 fallback 확인
- single tool → 정상 동작
- flag 없는 tool → sequential default
- abort signal 동작

### 5. (Optional) TUI spinner 개선
**File:** `packages/cli/src/tui/components/chat-view.ts`

`activeToolCount` 트래킹 → "Running 3 tools…" 표시. 없어도 기능 문제 없음.

## Verification

```bash
cd packages/core && bun test           # 기존 + 새 테스트
cd packages/e2e && bun test            # 통합 테스트
```

## Files to Modify

1. `packages/core/src/tool/types.ts` — interface 변경
2. `packages/core/src/agent/loop.ts` — 핵심 로직
3. `packages/core/src/tools/read.ts` — flag 추가
4. `packages/core/src/tools/glob.ts` — flag 추가
5. `packages/core/src/tools/grep.ts` — flag 추가
6. `packages/core/src/tools/ls.ts` — flag 추가
7. `packages/core/src/tools/plan.ts` — flag 추가
8. `packages/core/test/agent-loop.test.ts` — 테스트 추가
