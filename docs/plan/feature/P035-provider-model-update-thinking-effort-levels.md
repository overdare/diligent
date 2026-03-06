---
id: P035
status: done
created: 2026-03-06
---

# P035: Provider Model Update + Thinking Effort Levels

## Context

현재 모든 모델에 `type: "enabled"` + 고정 10,000 토큰 budget이 적용되어 있음.
문제:
- Claude opus/sonnet 4.6은 `type: "adaptive"` 지원 (모델이 스스로 thinking량 결정) → 미사용
- 모든 모델에 동일한 budget → lite 모델도 10k, 불필요하게 느림
- low/medium/high/max effort 개념 없음 → 같은 pro 모델 안에서도 세분화 불가
- OpenAI 계정 tier별 접근 가능 모델이 다름 → 문서화 없음
- models.ts에 존재하지 않는 모델 일부 포함 (gemini-3.x)

목표: thinking effort 레벨 시스템 추가 + 모델 목록 최신화 + OpenAI accessLevel 태그 + UI effort 드롭다운

---

## 변경 범위

### 수정 파일 목록

1. `packages/protocol/src/data-model.ts` — `ThinkingEffortSchema` 추가
2. `packages/protocol/src/methods.ts` — `EFFORT_SET` 메서드 추가
3. `packages/protocol/src/client-requests.ts` — `EffortSetParams/Response` 스키마 추가
4. `packages/core/src/provider/types.ts` — `ThinkingEffort`, `Model.supportsAdaptiveThinking`, `Model.thinkingBudgets`, `StreamOptions.effort`
5. `packages/core/src/provider/models.ts` — 모델 목록 정리 + thinkingBudgets + accessLevel
6. `packages/core/src/provider/anthropic.ts` — adaptive + budget-based thinking 분기
7. `packages/core/src/provider/openai.ts` — effort → reasoning effort 매핑
8. `packages/core/src/provider/gemini.ts` — effort → thinkingBudget 매핑
9. `packages/core/src/agent/types.ts` — `AgentLoopConfig.effort` 추가
10. `packages/core/src/agent/loop.ts` — `config.effort` → stream options
11. `packages/core/src/app-server/server.ts` — `ThreadRuntime.effort`, `handleEffortSet()`, buildAgentConfig 전달
12. `packages/web/src/server/rpc-bridge.ts` — `session.effort`, EFFORT_SET 처리
13. `packages/web/src/server/index.ts` — buildAgentConfig에 effort 전달
14. `packages/cli/src/tui/app.ts` — buildAgentConfig에 effort 전달
15. `packages/cli/src/tui/runner.ts` — buildAgentConfig에 effort 전달
16. `packages/web/src/client/App.tsx` — effort state + setEffort RPC 호출
17. `packages/web/src/client/components/InputDock.tsx` — effort 드롭다운 UI

### 핵심 결정사항

- **Adaptive thinking**: opus-4-6, sonnet-4-6에 `type: "adaptive"` 자동 적용. budget_tokens는 effort에서 계산한 값을 상한선으로 전달 (SDK 타입 미지원 → 타입 캐스트)
- **gpt-5.3-codex / 5.2 / 5.2-codex / 5.1-codex**: 실존 모델이므로 유지
- **gemini-3.x 모델**: 제거 (존재하지 않음)
- **신규 추가 OpenAI 모델**: gpt-4.1-mini, gpt-4.1-nano, gpt-4o, gpt-4o-mini
- **Effort UI**: 채팅 입력창 옆 드롭다운 (model selector 옆)
- **Effort 기본값**: "high" (하드코딩, config 불필요)
