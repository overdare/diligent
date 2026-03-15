# StyledText 타입 시스템 도입 — TUI 구조적 안전성 확보

## Context

TUI에서 하나를 고치면 다른 것이 깨지는 문제가 반복된다. 근본 원인: 모든 컴포넌트가 ANSI 이스케이프 코드가 포함된 `string[]`을 반환하고, renderer가 이 문자열을 직접 자르고(`sliceWithAnsi`), 감싸고(`wrapAnsiLine`), 합성한다(`compositeOverlays`). ANSI 파싱이 하나라도 어긋나면 화면이 깨진다.

**해법**: 컴포넌트가 원시 문자열 대신 구조화된 `StyledLine[]`을 반환하게 한다. ANSI 변환은 터미널 출력 직전에 한 번만 수행한다. 슬라이스, 래핑, 합성이 모두 Span 단위로 동작하므로 ANSI 시퀀스 파싱이 사라진다.

## Type Design

### Core Types (`framework/styled-text.ts`)

```typescript
/** Semantic foreground color — theme.ts의 의미론적 색상과 1:1 대응 */
type FgColor = 'accent' | 'success' | 'info' | 'ok' | 'warn' | 'error'
             | 'text' | 'textMuted' | 'muted' | 'modePlan' | 'modeExecute';

/** Background color */
type BgColor = 'user';  // bgUser (BG_SLATE_800)

interface Style {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  fg?: FgColor;
  bg?: BgColor;
  href?: string;  // OSC 8 terminal hyperlink
}

interface Span {
  text: string;     // 순수 텍스트, ANSI 코드 없음
  style?: Style;    // undefined = 스타일 없음
}

/** 커서 위치 마커 — 현재 CURSOR_MARKER APC 시퀀스를 대체 */
interface CursorMarker {
  cursor: true;
}

type LineElement = Span | CursorMarker;
type StyledLine = LineElement[];
```

### Operations

```typescript
/** 라인의 visible width — Span.text의 displayWidth 합계 (ANSI 파싱 불필요) */
function lineWidth(line: StyledLine): number;

/** 컬럼 구간으로 슬라이스 — Span 경계에서 분할, ANSI 파싱 없음 */
function sliceLine(line: StyledLine, start: number, end: number): StyledLine;

/** 폭에 맞춰 래핑 — Span 단위 반복, continuation indent 지원 */
function wrapLine(line: StyledLine, width: number, indent?: StyledLine): StyledLine[];

/** 오버레이 합성 — sliceLine 기반, 안전한 합성 */
function compositeLine(base: StyledLine, overlay: StyledLine, col: number): StyledLine;

/** StyledLine → ANSI 문자열 변환 (터미널 출력 직전에만 호출) */
function toAnsi(line: StyledLine): string;

/** ANSI 문자열 → StyledLine 파싱 (MarkdownView 경계에서 사용) */
function parseAnsiLine(raw: string): StyledLine;
```

### Builders (컴포넌트에서 사용할 빌더)

```typescript
const S = {
  text: (text: string) => Span,
  styled: (text: string, style: Style) => Span,
  bold: (text: string) => Span,
  dim: (text: string) => Span,
  accent: (text: string) => Span,
  error: (text: string) => Span,
  cursor: () => CursorMarker,
  // ... 기타 시맨틱 단축 함수
};
```

### Built-in Invariants

StyledText operations에 검증이 내장된다:
- `lineWidth()`: Span.text에서 직접 계산 → ANSI 오염 불가능
- `sliceLine()`: Span 경계에서만 분할 → ANSI 시퀀스 절단 불가능
- `wrapLine()`: 정확한 폭 계산 보장 → 오버플로 불가능
- `toAnsi()`: 각 Span마다 reset 포함 → 스타일 누출 불가능

## Component Interface 변경

```typescript
// framework/types.ts
interface Component {
  render(width: number): StyledLine[];  // string[] → StyledLine[]
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
  getCommittedLineCount?(width: number): number;
}
```

## Migration Strategy

Renderer에서 양쪽 타입을 수용하는 normalizer를 두어 컴포넌트를 하나씩 전환:

```typescript
// renderer.ts 내부
function normalize(output: unknown[]): StyledLine[] {
  if (output.length === 0) return [];
  if (typeof output[0] === 'string') {
    return (output as string[]).map(parseAnsiLine);
  }
  return output as StyledLine[];
}
```

이 normalizer는 모든 컴포넌트 전환이 완료되면 제거한다.

## Implementation Sequence

### Step 1: StyledText 모듈 생성
- **New**: `packages/cli/src/tui/framework/styled-text.ts`
  - 타입 정의 (Span, Style, StyledLine, CursorMarker 등)
  - 핵심 operations (lineWidth, sliceLine, wrapLine, compositeLine)
  - toAnsi() 변환
  - parseAnsiLine() ANSI→StyledLine 파서
  - S builder 객체
- **New**: `packages/cli/test/tui/framework/styled-text.test.ts`
  - Property-based invariant 테스트 (lineWidth 정확성, sliceLine 무결성, wrapLine 오버플로 없음)

### Step 2: Renderer 전환
- **Modify**: `packages/cli/src/tui/framework/renderer.ts`
  - `doRender()` 내부를 StyledLine[] 기반으로 전환
  - `sliceWithAnsi()` → `sliceLine()` 호출로 교체
  - `compositeOverlays()` → `compositeLine()` 사용
  - `serializeLinesForTerminal()` → `toAnsi()` 호출 추가
  - normalizer 함수로 string[] | StyledLine[] 수용
  - 기존 `stripAnsi()`, `sliceWithAnsi()` 함수는 모든 전환 완료 후 제거
- **Modify**: `packages/cli/src/tui/framework/container.ts`
  - render() 반환 타입을 StyledLine[]으로

### Step 3: 단순 컴포넌트 전환
- **Modify**: `packages/cli/src/tui/components/status-bar.ts`
  - `render()` → S builder로 StyledLine[] 반환
  - visibleLength() 헬퍼 제거 (lineWidth로 대체)
- **Modify**: `packages/cli/src/tui/components/spinner.ts`
  - `render()` → S builder로 StyledLine[] 반환

### Step 4: InputEditor 전환
- **Modify**: `packages/cli/src/tui/components/input-editor.ts`
  - `render()` → StyledLine[] 반환
  - CURSOR_MARKER 임베딩 → S.cursor() 사용
  - renderSteeringLines(), renderCompletionPopup() 전환

### Step 5: Dialog 컴포넌트 전환
- **Modify**: `packages/cli/src/tui/components/approval-dialog.ts`
- **Modify**: `packages/cli/src/tui/components/confirm-dialog.ts`
- **Modify**: `packages/cli/src/tui/components/question-input.ts`
- **Modify**: `packages/cli/src/tui/components/text-input.ts`
- **Modify**: `packages/cli/src/tui/components/list-picker.ts`
- **Modify**: `packages/cli/src/tui/components/compacting-dialog.ts`

### Step 6: render-blocks 전환
- **Modify**: `packages/cli/src/tui/render-blocks.ts`
  - 각 block renderer가 StyledLine[] 반환
  - toneAnsi() → FgColor 매핑으로 교체

### Step 7: ChatView + MarkdownView 전환
- **Modify**: `packages/cli/src/tui/components/chat-view.ts`
  - render()에서 StyledLine[] 반환
  - MarkdownView가 반환한 string[]은 parseAnsiLine()으로 변환
  - UserMessageView → S builder 사용
- **Modify**: `packages/cli/src/tui/components/markdown-view.ts`
  - render()에서 renderMarkdown() 결과를 parseAnsiLine()으로 변환하여 StyledLine[] 반환
  - **markdown.ts 자체는 수정 없음**

### Step 8: Normalizer 제거 + 정리
- renderer.ts에서 normalize 함수 제거
- 미사용 stripAnsi(), sliceWithAnsi() 제거
- Component 인터페이스 JSDoc 업데이트

## 수정하지 않는 파일

- `packages/cli/src/tui/markdown.ts` — renderMarkdown()은 계속 ANSI string 반환
- `packages/cli/src/tui/theme.ts` — ANSI 상수는 유지 (toAnsi에서 참조, markdown에서 계속 사용)

## Verification

```bash
# Step 1 후: StyledText 모듈 자체 테스트
bun test packages/cli/test/tui/framework/styled-text.test.ts

# 각 Step 후: 기존 테스트 전체 통과 확인
bun test packages/cli/

# 최종: TUI 실행하여 시각적 확인
bun run dev
```

## 위험 요소 & 대응

| 위험 | 대응 |
|------|------|
| parseAnsiLine이 모든 ANSI 시퀀스를 정확히 파싱 못함 | CSI, OSC, APC 3가지만 처리하면 됨. 기존 코드의 readEscapeSequence 패턴 참고 |
| 대량 컴포넌트 동시 변경 시 리그레션 | normalizer로 점진적 전환, 매 Step마다 전체 테스트 |
| toAnsi() 출력이 기존과 미세하게 달라짐 | 각 Span에 reset 포함하므로 스타일 범위가 명시적. 차이는 있을 수 있으나 더 정확함 |
| Overlay 합성이 StyledLine에서 복잡해짐 | sliceLine이 Span 단위로 동작하므로 오히려 단순해짐 |
