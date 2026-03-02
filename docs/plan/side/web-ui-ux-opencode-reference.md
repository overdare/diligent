# Web UI/UX — OpenCode 참고 분석

OpenCode의 UI/UX를 참고하여 `packages/web`의 디자인 방향을 재정립한다.
현재 UI는 "운영 툴" 느낌이 강하고, 실제 사용자를 위한 제품 느낌이 없다.

---

## 현재 packages/web 문제 진단

### 레이아웃 문제
- 사이드바에 UUID 그대로 노출 (thread id, "abc-def-123...")
- 헤더 Badge에 `thread: <uuid>` / `status: idle` → 개발자 디버그 뷰 느낌
- `ACTIVE THREAD` / `MESSAGES` 같은 운영 대시보드 용어
- 좌측 사이드바 하단에 `connection: connected` 상태 → 상태 표시 방식이 거칠음
- 입력창 하단에 `mode default` 텍스트 잔류 → 사용자가 알 필요 없는 정보

### 색상/타이포 문제
- 현재 디자인 토큰은 충분히 좋음 (`--accent: #5ad9b8`, IBM Plex 폰트)
- 하지만 실제 컴포넌트 사용에서 "운영 도구" 패턴으로 배치됨
- 빈 화면 상태가 너무 밋밋함 (`Start a conversation from the input box below.`)

### 기능 갭
- 빈 화면에서 예시 프롬프트 없음 (onboarding 없음)
- 스트리밍 중 진행 표시 미흡
- 툴콜 표현이 raw 출력 중심, 사용자 맥락 없음
- 파일/이미지 첨부 없음
- 마크다운 렌더링 없음 (pre 태그만 사용)

---

## OpenCode에서 배울 점

### 스크린샷 분석 (screenshot.png)
```
┌─────────────────────────────────────────────────┐
│  OC | Homepage button color change in repo ...  │  ← 작업 제목이 타이틀
├─────────────────────────────────────────────────┤
│                                                 │
│  # Homepage button color change in repo         │
│    workflow                                     │
│                                                 │
│  Find the homepage button and make it blue      │  ← 유저 메시지
│                                                 │
│  I'll search for the homepage button in the     │  ← 어시스턴트 텍스트
│  codebase. Let me search more broadly...        │     (줄글, 읽기 좋음)
│                                                 │
│  • Grep "homepage|home.*button|Home.*button"    │  ← 툴 콜이 bullet으로
│  • Grep "Homepage"                              │     간결하게 표시
│                                                 │
│  I found several "Home" links...                │
│                                                 │
│  • Read packages/console/...                    │
│                                                 │
│  - Asking questions...                          │  ← 상태 표시 인라인
│                                                 │
│  ▶ Build . claude-opus-4-5                     │  ← 현재 진행 상태
├─────────────────────────────────────────────────┤
│  [                                            ] │  ← 입력창
├─────────────────────────────────────────────────┤
│  Build  Claude Opus 4.5  OpenCode Zen           │  ← 상태바
│                      esc interrupt  ctrl+t ... │
└─────────────────────────────────────────────────┘
```

### OpenCode 핵심 UX 패턴

**1. 상태바 (Bottom Status Bar)**
- 화면 맨 아래 한 줄: `Build | Claude Opus 4.5 | OpenCode Zen`
- 현재 모드, 모델, 테마를 가장 작은 공간에 표시
- 키보드 단축키도 동일 줄에 우측 정렬
- 운영 상태 정보가 본문을 침범하지 않음

**2. 툴콜 표현 (Tool Call Display)**
- `• Grep "pattern"` — bullet 한 줄 요약
- 완료된 것은 조용히 보임, 진행 중인 것만 강조
- 출력 결과가 필요할 때만 펼쳐볼 수 있는 구조 (accordion/disclosure)
- "디버그 덤프"가 아닌 "작업 로그"처럼 보임

**3. 어시스턴트 텍스트 (Message Rendering)**
- `<pre>` 태그 없이 일반 줄글로 렌더링
- 코드 블록만 `monospace`
- 마크다운 렌더링 (h1~h3, bold, lists)

**4. 화면 구성 (Layout)**
- 사이드바 없이 단일 컬럼 집중 (TUI 기준)
- 웹 버전은 세션 목록이 좌측, 하지만 UUID 아닌 "첫 번째 메시지" 기반 이름
- 작업 제목이 타이틀바에 바로 표시 → 맥락을 즉시 제공

**5. 빈 화면 (Empty State)**
- 예시 프롬프트 25개 (rotation 방식)
- 바로 시작 가능한 CTA
- "Ask anything" 이상의 구체적 시작점 제공

**6. 세션/프로젝트 구조**
- 프로젝트(디렉토리) → 워크스페이스 → 세션 계층
- 세션 이름은 첫 메시지 기반 자동 생성
- UUID는 절대 사용자에게 노출 안 함

---

## Diligent Web 개선 방향

### 레이아웃 재설계

```
현재:
┌──────────────┬──────────────────────────┐
│ SIDEBAR      │ [Badge thread: uuid]     │
│ ACTIVE THREAD│ [Badge status: idle]     │
│ abc-def-123  │                          │
│ MESSAGES: 42 │  [messages]              │
│              │                          │
│ [thread list]│  [input area]            │
└──────────────┴──────────────────────────┘

개선안:
┌──────────────┬──────────────────────────┐
│              │ ● Diligent               │
│ 프로젝트명   │ /path/to/project    [●]  │
│ /path/to/dir ├──────────────────────────┤
│              │                          │
│ ─ Threads ─  │  [messages]              │
│ > 첫 메시지   │                          │
│   기반 이름  │                          │
│   (시간)     │  [input area]            │
│              ├──────────────────────────┤
│ + New        │  default  claude-opus  ● │
└──────────────┴──────────────────────────┘
```

### 개선 항목 우선순위

#### P0 — 운영툴 느낌 제거 (즉시)
1. **UUID 숨기기**: 사이드바와 헤더에서 thread UUID 제거
   - 사이드바: 첫 번째 메시지 텍스트 + 상대 시간 표시
   - 헤더 Badge 제거 → 타이포그래피로 대체
2. **헤더 정리**: `thread: <uuid>` / `status: idle` Badge 삭제
   - 대신 현재 작업 요약 텍스트 (첫 메시지나 스트리밍 중 마지막 어시스턴트 요약)
3. **빈 상태 개선**: 예시 프롬프트 카드 3~5개
4. **하단 상태바**: `mode | model | connection` 한 줄로 footer 처리

#### P1 — 메시지 렌더링 개선
1. **마크다운 렌더링**: `<pre>` → 적절한 마크다운 파서 (marked.js 또는 react-markdown)
   - 헤딩, 리스트, 코드블록, 인라인코드 구분
2. **툴콜 컴팩트 뷰**:
   - 완료: 한 줄 요약 `✓ Grep "pattern" → 18 matches`
   - 실행 중: 진행 표시 `⟳ Running bash...`
   - 오류: 붉은 한 줄 `✗ Command failed`
   - 클릭/호버로 상세 내용 토글

#### P2 — 상호작용 개선
1. **입력창 개선**: 멀티라인 지원 (Shift+Enter), 파일 드래그앤드롭
2. **스트리밍 중 진행 표시**: 하단에 `● Thinking...` 또는 현재 실행 중 툴 이름
3. **모드 표시 개선**: 드롭다운 → 좌측 하단 뱃지/토글 (화면 상단 헤더 공간 절약)

#### P3 — 브랜딩/아이덴티티
1. **앱 이름**: "Diligent Web CLI" → "Diligent" (심플하게)
2. **로고/아이콘**: 텍스트 로고라도 적절한 타이포그래피 처리
3. **첫 화면**: 프로젝트 경로와 함께 짧은 온보딩 텍스트

---

## 구체적인 컴포넌트 변경

### StreamBlock.tsx 개선
```
현재: <pre className="whitespace-pre-wrap">
개선: 마크다운 파서 적용
  - h1~h3: 크기/굵기 차이
  - code inline: 작은 모노 배경박스
  - code block: 별도 배경 블록
  - list: 들여쓰기 bullet
```

### ToolCallRow.tsx 개선
```
현재: 툴 이름 + 상태 badge + input 전체 + output 전체 (항상 펼쳐짐)
개선:
  완료 시: [✓] grep "pattern"  →  18 matches  (한 줄)
  실행 중: [⟳] bash ./run.sh  (애니메이션 spinner)
  오류 시: [✗] command failed  (붉은 텍스트)
  확장 시: 클릭하면 input/output 상세 표시
```

### App.tsx 헤더 개선
```
현재: Badge("thread: uuid") + Badge("status: idle") + mode dropdown
개선:
  - thread UUID 완전 제거
  - 타이틀 영역: 첫 메시지 텍스트 (최대 40자, 없으면 "New conversation")
  - 상태 표시: 우측 작은 점 (● idle / ⟳ busy)
  - mode: 좌측 하단 상태바로 이동
```

### 사이드바 스레드 목록
```
현재:
  [thread name or "Untitled thread"]
  [UUID in monospace]

개선:
  [첫 메시지 40자 요약]
  [2 hours ago]  (상대 시간)
```

---

## OpenCode UI 라이브러리에서 참고할 패턴

### 테마 시스템
- OKLCH 기반 16개 테마 (light/dark)
- CSS 변수 80개 이상 → 토큰 기반
- 우리 `tokens.css`의 토큰 수 확장 필요

### 컴포넌트 패턴
- `DockSurface` — 하단 상태바/입력창 고정 레이아웃
- `SessionTurn` — 대화 턴 단위 컴포넌트 (사용자/어시스턴트 구분)
- `ScrollView` — 스크롤 + 하단 고정 자동 처리
- `Toast` — 알림 스택 (현재는 단일 toast만 지원)

### 접근성
- `data-component` / `data-state` attribute 패턴
- Kobalte 기반 accessible primitives
- ARIA 속성 전반적 강화

---

## 작업 범위 요약

| 변경 | 파일 | 우선도 |
|------|------|--------|
| UUID 제거, 첫 메시지 기반 표시 | App.tsx | P0 |
| 헤더 Badge → 타이포 + 상태 dot | App.tsx | P0 |
| 하단 상태바 (mode/model/connection) | App.tsx | P0 |
| 빈 화면 예시 프롬프트 카드 | App.tsx | P0 |
| 툴콜 컴팩트 뷰 (접힘/펼침) | ToolCallRow.tsx | P1 |
| 마크다운 렌더링 (react-markdown) | StreamBlock.tsx | P1 |
| 멀티라인 입력창 (textarea) | App.tsx / Input.tsx | P1 |
| 스트리밍 진행 표시 (spinner) | App.tsx | P1 |
| 앱 이름/브랜딩 | App.tsx | P2 |
| 테마 토큰 확장 | tokens.css | P2 |

---

_참고: OpenCode 스크린샷 — `docs/references/opencode/packages/web/src/assets/lander/screenshot.png`_
