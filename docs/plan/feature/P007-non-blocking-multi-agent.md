---
id: P007
status: done
created: 2026-03-02
---

status: done
---

# Collab Tools: codex-rs Style Non-Blocking Multi-Agent

## Context

현재 `task` 도구는 블로킹 — 서브에이전트 하나를 끝까지 실행 후 반환. codex-rs 스타일로 전환:
- `spawn_agent` (논블로킹, 즉시 반환) + `wait` (병렬 대기) + `close_agent` + `send_input`
- 메인 에이전트가 여러 서브에이전트를 동시 생성, 병렬 실행, 결과 수집을 오케스트레이션
- TUI에 인라인으로 `• Spawned Elm [general]` / `• Finished waiting` 같은 collab 이벤트 표시

기존 `task` 도구와 `agent-types.ts`는 유지하되, `task` 도구는 deprecated.

---

## Architecture

```
Parent Agent Loop (loop.ts — sequential await per tool)
  |— spawn_agent → registry.spawn() → 즉시 반환 {agent_id, nickname}
  |— spawn_agent → registry.spawn() → 즉시 반환 {agent_id, nickname}
  |— wait([id1, id2]) → registry.wait() → Promise.race + timeout → 결과
  |— close_agent → registry.close() → 종료

AgentRegistry (공유 싱글턴)
  ├─ Map<id, AgentEntry>  (각 entry = SessionManager + background Promise)
  ├─ NicknamePool          (87 plant/tree names)
  └─ maxAgents guard       (기본 8)
```

핵심: `spawn_agent`는 도구 execute() 안에서 background Promise를 시작하고 즉시 반환. agent loop의 sequential 실행 모델 변경 불필요.

---

## New Files

### 1. `packages/core/src/collab/types.ts`

```typescript
export type AgentStatus =
  | { kind: "pending" }
  | { kind: "running" }
  | { kind: "completed"; output: string | null }
  | { kind: "errored"; error: string }
  | { kind: "shutdown" };

export function isFinal(s: AgentStatus): boolean {
  return s.kind !== "pending" && s.kind !== "running";
}

export interface AgentEntry {
  id: string;
  nickname: string;
  agentType: string;
  description: string;
  sessionManager: SessionManager;
  promise: Promise<AgentStatus>;  // always resolves, never rejects
  status: AgentStatus;
  abortController: AbortController;
  createdAt: number;
}

export interface CollabToolDeps {
  cwd: string;
  paths: DiligentPaths;
  model: Model;
  systemPrompt: string;
  streamFunction: StreamFunction;
  parentTools: Tool[];
  maxAgents?: number;  // default 8
}
```

### 2. `packages/core/src/collab/nicknames.ts`

codex-rs에서 가져온 87개 식물/나무 이름 풀. `NicknamePool` 클래스: `reserve()` → random pick, 소진 시 전체 리셋.

### 3. `packages/core/src/collab/registry.ts` — 핵심

```typescript
export class AgentRegistry {
  private agents = new Map<string, AgentEntry>();
  private pool = new NicknamePool();

  constructor(private deps: CollabToolDeps) {}

  // 동기 — 즉시 반환. background Promise 시작.
  spawn(params: { prompt: string; description: string; agentType: string; resumeId?: string }):
    { agentId: string; nickname: string }

  // 비동기 — stored promises await.
  async wait(ids: string[], timeoutMs: number, onUpdate?: (s: string) => void):
    Promise<{ status: Record<string, AgentStatus>; timedOut: boolean }>

  // steering via SessionManager.steer()
  async sendInput(agentId: string, message: string): Promise<void>

  // abort + wait
  async close(agentId: string): Promise<AgentStatus>

  getStatus(agentId: string): AgentStatus
  async shutdownAll(): Promise<void>
}
```

**spawn 내부 — background Promise 패턴:**
```typescript
const promise = (async () => {
  entry.status = { kind: "running" };
  const stream = childManager.run(userMessage);
  let output = "";
  for await (const event of stream) {
    if (event.type === "message_end") output = extractText(event.message);
    if (event.type === "error" && event.fatal) throw event.error;
  }
  await childManager.waitForWrites();
  entry.status = { kind: "completed", output };
  return entry.status;
})().catch(err => {
  entry.status = { kind: "errored", error: String(err) };
  return entry.status;
});
```

**wait 내부:**
```typescript
// 이미 final인 것 먼저 수집
// 나머지는 Promise.race([...remaining, timeout])
// onUpdate로 진행 상태 전파: "Elm ✓ | Oak running"
```

**Tool filtering (spawn 시):**
- `general`: parentTools에서 collab 4개 도구 제외 (`COLLAB_TOOL_NAMES`)
- `explore`: `PLAN_MODE_ALLOWED_TOOLS`만 허용

### 4. `packages/core/src/collab/spawn-agent.ts`

```typescript
const SpawnAgentParams = z.object({
  message: z.string(),
  agent_type: z.enum(["general", "explore"]).default("general"),
  resume_id: z.string().optional(),
});

// execute: registry.spawn() → return JSON { agent_id, nickname }
```

### 5. `packages/core/src/collab/wait.ts`

```typescript
const WaitParams = z.object({
  ids: z.array(z.string()).min(1),
  timeout_ms: z.number().optional(),  // default 30s, min 10s, max 1h
});

// execute: registry.wait(ids, timeout, ctx.onUpdate) → return JSON { status, timed_out }
```

### 6. `packages/core/src/collab/send-input.ts`

```typescript
const SendInputParams = z.object({
  id: z.string(),
  message: z.string(),
});

// execute: registry.sendInput() via SessionManager.steer()
// interrupt:true는 MVP에서 미지원 (steer만)
```

### 7. `packages/core/src/collab/close-agent.ts`

```typescript
const CloseAgentParams = z.object({
  id: z.string(),
});

// execute: registry.close() → abort + return final status
```

### 8. `packages/core/src/collab/factory.ts`

```typescript
export function createCollabTools(deps: CollabToolDeps): {
  tools: Tool[];
  registry: AgentRegistry;
}
```

하나의 `AgentRegistry`를 공유하는 4개 도구 생성.

### 9. `packages/core/src/collab/index.ts`

All re-exports.

### 10. `packages/core/test/collab/` — 테스트

Mock SessionManager (factory injection):
- `CollabToolDeps`에 optional `sessionManagerFactory` 추가
- 테스트에서 controllable EventStream 반환하는 mock 주입

테스트 케이스:
- **NicknamePool**: reserve uniqueness, exhaustion reset
- **AgentRegistry**: spawn 즉시 반환, maxAgents 초과 거부, status tracking, shutdownAll
- **spawn_agent**: JSON output 형식, agent_type 전달, resume_id passthrough
- **wait**: timeout clamping, 완료 시 상태 반환, timedOut flag, onUpdate 호출
- **send_input**: steer 호출 확인, unknown ID 에러
- **close_agent**: abort 호출, final status 반환
- **Integration**: spawn 2개 → wait → 병렬 완료 확인

---

## Modified Files

### 11. `packages/core/src/agent/agent-types.ts`

```diff
+export const COLLAB_TOOL_NAMES = new Set(["spawn_agent", "wait", "send_input", "close_agent"]);
```

### 12. `packages/core/src/tools/index.ts`

```diff
+export { createCollabTools } from "../collab";
+export type { CollabToolDeps } from "../collab";
+export { AgentRegistry } from "../collab";
```

기존 `createTaskTool` / `TaskToolDeps` export 유지 (deprecated).

### 13. `packages/core/src/index.ts`

Collab exports 추가:
- `createCollabTools`, `CollabToolDeps`, `AgentRegistry`, `AgentStatus`

### 14. `packages/cli/src/tui/tools.ts`

```typescript
import { createCollabTools, type CollabToolDeps, type AgentRegistry } from "@diligent/core";

export function buildTools(
  cwd: string,
  paths?: DiligentPaths,
  collabDeps?: Omit<CollabToolDeps, "cwd" | "paths" | "parentTools">,
): { tools: Tool[]; registry?: AgentRegistry } {
  const tools: Tool[] = [/* 기존 7개 도구 */];
  if (paths) tools.push(createAddKnowledgeTool(paths.knowledge));
  if (paths && collabDeps) {
    const { tools: collabTools, registry } = createCollabTools({
      ...collabDeps, cwd, paths, parentTools: tools,
    });
    tools.push(...collabTools);
    return { tools, registry };
  }
  return { tools };
}
```

### 15. `packages/cli/src/tui/app.ts`

- `buildTools` 반환값에서 `registry` 보관
- `stop()`에서 `registry?.shutdownAll()` 호출

### 16. `packages/cli/src/tui/runner.ts`

- `buildTools` 호출부 업데이트 (collabDeps 전달, registry 무시 — NonInteractive는 자동 정리)

### 17. `packages/cli/src/tui/components/chat-view.ts`

기존 `taskState` 로직을 collab 도구 전체로 확장.

**`tool_start`:**
```
spawn_agent → "Spawning [general] agent..."
wait        → "Waiting for Elm, Oak..."
send_input  → "Sending to Elm..."
close_agent → "Closing Elm..."
```

**`tool_end`** (committed items — codex-rs 스타일):
```
spawn_agent: ⏺ Spawned Elm [general] · 0.1s
               └ Analyze the code structure

wait:        ⏺ Finished waiting · 45.2s
               └ Elm [general]: Completed — First line of result...
                 Oak [explore]: Error — Provider unavailable

send_input:  ⏺ Sent input → Elm [general]

close_agent: ⏺ Closed Elm [general]
```

JSON output 파싱하여 nickname, status 추출. `extractTaskPreview` → `parseCollabOutput` 교체.

---

## Key Decisions

| 결정 | 이유 |
|------|------|
| spawn은 동기 반환, wait이 await 지점 | loop.ts sequential 모델 변경 불필요 |
| AgentRegistry — collab/ 별도 디렉토리 | agent/(loop), tools/(개별 도구)와 분리. 크로스커팅 |
| send_input은 steer() 사용, interrupt 미지원 | MVP 범위. abort+재시작은 복잡 |
| Nickname pool 87개 (codex-rs 동일) | 검증된 목록, 기억하기 쉬움 |
| task 도구 유지 (deprecated) | 점진적 마이그레이션. 공존 가능 |
| sessionManagerFactory 주입 | 테스트에서 mock 가능 |
| tool_end JSON 파싱으로 TUI 렌더링 | 새 AgentEvent 타입 추가 불필요 |

---

## Verification

```bash
# 1. 새 테스트
bun test packages/core/test/collab/

# 2. 기존 테스트 (task.test.ts 포함)
bun test

# 3. 타입 체크
bun run typecheck

# 4. 린트
bun run lint
```
