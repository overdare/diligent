---
id: P046
status: backlog
created: 2026-03-14
---
# Plan: Session Resume Feature

## Context

사용자가 TUI를 종료할 때 세션 ID를 출력하고, 나중에 `diligent --resume <sessionId>` 명령으로 해당 세션을 재개할 수 있어야 한다. 재개 시 이전 대화가 채팅 뷰에 복원되어야 한다.

현재 `--continue` 플래그는 가장 최근 세션을 resume하지만 대화 기록을 화면에 복원하지 않는다. 이번 작업에서는 특정 세션 ID로 resume하는 기능과 대화 복원을 추가한다.

## Files to Modify

1. `packages/cli/src/index.ts` — `--resume <sessionId>` CLI 인자 추가
2. `packages/cli/src/tui/app.ts` — `AppOptions`에 `resumeId` 추가, 종료 시 resume 메시지 출력, 재개 후 대화 복원
3. `packages/cli/src/tui/thread-manager.ts` — `resumeThread(threadId)` 이미 지원하므로 변경 불필요

## Implementation Steps

### Step 1: `packages/cli/src/index.ts`

`parseArgs` options에 `resume` string 옵션 추가:
```typescript
resume: { type: "string", short: "r" },  // --resume <sessionId>
```

`App` 생성 시 `resumeId` 전달:
```typescript
const app = new App(config, paths, {
  resume: values.continue,
  resumeId: values.resume,
});
```

### Step 2: `packages/cli/src/tui/app.ts`

#### AppOptions 인터페이스 확장
```typescript
export interface AppOptions {
  resume?: boolean;
  resumeId?: string;   // 추가
  rpcClientFactory?: ...;
}
```

#### `start()` — resume 분기 수정
```typescript
let resumedId: string | null = null;
if (this.options?.resumeId) {
  // --resume <sessionId>: 특정 세션 ID로 재개
  resumedId = await this.threadManager.resumeThread(this.options.resumeId);
  if (!resumedId) {
    this.chatView.addLines([`  ${t.error}Session not found: ${this.options.resumeId}${t.reset}`]);
    await this.threadManager.startNewThread();
  }
} else if (this.options?.resume) {
  // --continue: 가장 최근 세션으로 재개
  resumedId = await this.threadManager.resumeThread();
  if (!resumedId) {
    await this.threadManager.startNewThread();
  }
} else {
  await this.threadManager.startNewThread();
}

// 재개된 경우 대화 기록 복원
if (resumedId) {
  await this.hydrateThreadHistory();
}
```

#### `hydrateThreadHistory()` 메서드 추가
`THREAD_READ`를 호출해 `transcript`를 가져와 채팅 뷰에 렌더링:

```typescript
private async hydrateThreadHistory(): Promise<void> {
  const thread = await this.threadManager.readThread();
  if (!thread?.transcript?.length) return;

  this.chatView.addLines([`  ${t.dim}─── Resuming session ───${t.reset}`, ""]);

  for (const entry of thread.transcript) {
    if (entry.type === "compaction") {
      this.chatView.addLines([
        `  ${t.dim}[Compacted: ${entry.summary}]${t.reset}`,
        "",
      ]);
    } else if (entry.type === "message") {
      const msg = entry.message;
      if (msg.role === "user") {
        const text = typeof msg.content === "string"
          ? msg.content
          : msg.content.filter(b => b.type === "text").map(b => (b as {text: string}).text).join("");
        if (text.trim()) this.chatView.addUserMessage(text);
      } else if (msg.role === "assistant") {
        // 텍스트 블록만 추출해서 MarkdownView처럼 렌더링
        const textBlocks = msg.content.filter(b => b.type === "text");
        if (textBlocks.length > 0) {
          const fullText = textBlocks.map(b => (b as {text: string}).text).join("");
          const view = new MarkdownView(this.renderer.requestRender.bind(this.renderer));
          view.pushDelta(fullText);
          view.finalize();
          // chatView.items에 직접 push하는 대신 addMarkdown 메서드 필요
        }
      }
    }
  }

  this.chatView.addLines(["", `  ${t.dim}─── Continue ───${t.reset}`, ""]);
}
```

> **Note on assistant message rendering**: `ChatView.items`가 private이므로 `addMarkdown(view: MarkdownView)` 메서드를 ChatView에 추가하거나, 대안으로 assistant 메시지를 단순 텍스트로 `addLines`에 렌더링.
>
> 더 단순한 접근: assistant 텍스트를 `addLines`로 dim 처리해서 표시 (이전 대화임을 시각적으로 구별).

#### `shutdown()` — resume 메시지 출력
```typescript
private shutdown(): void {
  this.stop();
  const sessionId = this.currentThreadId;
  let farewell = `\n${t.dim}Goodbye!${t.reset}\n`;
  if (sessionId) {
    farewell += `\n${t.dim}Resume this session with:${t.reset}\n`;
    farewell += `  diligent --resume ${sessionId}\n\n`;
  }
  this.terminal.write(farewell);
  process.exit(0);
}
```

## History Rendering Strategy

**Full markdown render 방식 채택**.

`ChatView`에 `addAssistantMessage(text: string)` 메서드를 추가:
- `MarkdownView`를 생성해 텍스트를 push + finalize 후 `items`에 추가
- `items`가 private이므로 메서드를 통해 접근 (내부 타입 `ChatItem = string[] | MarkdownView | UserMessageView`에 맞음)

**Files additionally modified**:
4. `packages/cli/src/tui/components/chat-view.ts` — `addAssistantMessage(text: string)` 메서드 추가

## Verification

```bash
# 1. TUI 시작
bun packages/cli/src/index.ts

# 2. 몇 가지 메시지 주고받은 후 Ctrl+D 종료
# → "Resume this session with: diligent --resume <id>" 출력 확인

# 3. 출력된 명령으로 재개
bun packages/cli/src/index.ts --resume <id>
# → "─── Resuming session ───" 구분선 + 이전 대화 표시 확인

# 4. 세션 ID가 없는 경우
bun packages/cli/src/index.ts --resume nonexistent-id
# → "Session not found" 오류 + 새 세션 시작 확인
```
