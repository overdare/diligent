---
id: P021
status: done
created: 2026-03-03
---

# Steering Queue Panel

## Context

Steering 메시지를 보내면 즉시 채팅 UI에 일반 메시지처럼 표시되는데, 실제로는 아직 agent loop에 inject되지 않은 대기 상태. 사용자에게 "대기 중"과 "inject 완료" 상태를 시각적으로 구분해서 보여줘야 함.

**목표**: Steer 메시지는 InputDock 위에 얇은 패널에 chip으로 stack → `steering_injected` 이벤트 도착 시 chip 사라지고 채팅에 일반 user message로 표시.

## Implementation

### 1. Protocol — `steering/injected` notification 추가

**`packages/protocol/src/methods.ts`** — `DILIGENT_SERVER_NOTIFICATION_METHODS`에 추가:
```typescript
STEERING_INJECTED: "steering/injected",
```

**`packages/protocol/src/server-notifications.ts`** — schema 추가 + union에 포함:
```typescript
export const SteeringInjectedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.STEERING_INJECTED),
  params: z.object({ threadId: z.string(), messageCount: z.number().int() }),
});
```

### 2. Server — AgentEvent → Notification 포워딩

**`packages/core/src/app-server/server.ts`** — `emitFromAgentEvent()` switch에 case 추가:
```typescript
case "steering_injected":
  await this.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.STEERING_INJECTED,
    params: { threadId, messageCount: event.messageCount },
  });
  return;
```

### 3. Client state — `pendingSteers` 필드

**`packages/web/src/client/lib/thread-store.ts`**:
- `ThreadState`에 `pendingSteers: string[]` 추가 (초기값 `[]`)
- `reduceServerNotification`에 `"steering/injected"` case 추가:
  - `pendingSteers`에서 앞에서 `messageCount`개 제거
  - 제거된 메시지들을 `items`에 일반 user RenderItem으로 추가
- `hydrateFromThreadRead`에서 `pendingSteers: []`로 초기화

### 4. App reducer — `local_steer` action

**`packages/web/src/client/App.tsx`**:
- `AppAction`에 `{ type: "local_steer"; payload: string }` 추가
- `appReducer`에서 `local_steer` → `pendingSteers` 배열에 push
- `steerMessage()`에서 기존 `dispatch({ type: "local_user", ... })` → `dispatch({ type: "local_steer", payload: content })`

### 5. SteeringQueuePanel 컴포넌트

**`packages/web/src/client/components/SteeringQueuePanel.tsx`** (신규):
- `pendingSteers: string[]` prop
- 비어있으면 `null` 반환 (공간 차지 안 함)
- InputDock 바로 위에 얇은 패널로 chip 목록 표시
- chip 스타일: `rounded-full border-accent/25 bg-accent/10 text-accent text-xs truncate`

### 6. Layout 배치

**`packages/web/src/client/App.tsx`** render:
```jsx
<MessageList ... />
{showPlan && <PlanPanel ... />}
<SteeringQueuePanel pendingSteers={state.pendingSteers} />  {/* NEW */}
<InputDock ... />
```

### 7. Cleanup

- `UserMessage.tsx`에서 `steering` prop/label 제거 (더 이상 필요 없음)
- `RenderItem` user kind에서 `steering?` 필드 제거
- `MessageList.tsx`에서 steering prop 전달 제거

## Files

| File | Change |
|------|--------|
| `packages/protocol/src/methods.ts` | `STEERING_INJECTED` 상수 |
| `packages/protocol/src/server-notifications.ts` | schema + union |
| `packages/core/src/app-server/server.ts` | event → notification case |
| `packages/web/src/client/lib/thread-store.ts` | `pendingSteers`, reducer case |
| `packages/web/src/client/App.tsx` | `local_steer` action, steerMessage(), layout |
| `packages/web/src/client/components/SteeringQueuePanel.tsx` | 신규 컴포넌트 |
| `packages/web/src/client/components/UserMessage.tsx` | steering prop 제거 |
| `packages/web/src/client/components/MessageList.tsx` | steering prop 전달 제거 |

## Verification

1. `bun test packages/core/` — 기존 테스트 패스 확인
2. Web UI에서 agent 실행 중 steer 전송 → InputDock 위 패널에 chip 표시
3. Agent가 steering을 drain하면 → chip 사라지고 채팅에 일반 메시지로 표시
4. 새로고침 → steering 메시지가 일반 user message로 보임 (이미 `drainSteeringQueue`에서 persist 됨)
