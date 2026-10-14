---
name: session-issue-report
description: Use when Studio behavior contradicts checked valid input or a documented contract, the agent's own mistaken approach wastes meaningful work, or a missing capability or concrete improvement would materially help the current task. Includes useful feature requests even when the task ultimately succeeds, and supported bug suspicions whose root cause is not yet proven.
---

# Session Issue Report

You judge whether a finding is useful and write the report. Call `agent_report` to
submit it; the tool supplies authentication, the executing session/project, time,
working directory, and actual recent record excerpts. The Gateway stores a masked
report and may queue a Slack alert. There is no automatic detector or threshold.

## When to report

Report mid-task when you have checked evidence and a concrete change a teammate
could investigate or implement. Do not wait for a request, three errors, a rollback,
a system reminder, or completion of the original task.

Choose one dominant kind:

| Kind | Meaning | Check before reporting |
|---|---|---|
| `agent_failure` | Your wrong approach, tool misuse, unnecessary repetition, or discarded incorrect work | Explain the mistaken behavior and why the waste was avoidable |
| `studio_bug` | Observed Studio behavior contradicts valid input, a checked contract, or an expected result | Check the input schema and verify the actual outcome, such as read-back after a successful write |
| `feature_request` | An absent capability or improvement would materially help this concrete task | Check existing tools/docs, describe the current workaround and actual benefit |

A task that succeeds through a costly workaround can still justify a feature
request. Absence of a capability is not proof of a bug. A bug report can express a
supported suspicion: distinguish observed facts from the suspected cause.

Do not report:
- One transient failure that succeeds on a reasonable retry.
- An ordinary mistake corrected immediately.
- A user changing requirements or their mind.
- An unverified outcome or a cosmetic idea unrelated to the actual task.
- The same issue twice in a session, including a paraphrased title.

If facts are insufficient, continue checking. If you cannot name a concrete
investigation or improvement, continue the task instead of reporting that it felt hard.

## What to write

Write titles and explanatory prose in Korean. Preserve exact tool names, property
names, error codes, and short diagnostic excerpts. Never paste full user prompts,
invent evidence, or claim a suspected cause has been proven.

Call `agent_report` with `kind` and `payload` only:
- `title`: one line, 1-200 characters.
- `task_context`: what you were doing and your vantage point, 1-1000 characters.
- `problem`: observed problem or current limitation, 1-2000 characters.
- `report_reason`: why this deserves a teammate's attention, 1-1000 characters.
- `suggestion`: concrete improvement or investigation, 1-1000 characters.
- `cause`: optional suspected cause, 1-1000 characters or null. Omit if unknown.
- `evidence`: optional `tool` (1-128 characters) and `details` (1-2000 characters).

The reason to report and the root cause are different. Do not add metadata fields:
`user_id`, `project_id`, `session_id`, `seq`, `event_ts`, `client_report_id`, `cwd`,
`version`, and `recent_records` are supplied by the tool. Do not search session files.
The recent-record tail supports your reasoning; keep your own evidence concise.

## Examples

A mistaken approach worth improving:

```json
{
  "kind": "agent_failure",
  "payload": {
    "title": "입력형을 확인하지 않고 잘못된 호출을 반복",
    "task_context": "에이전트 내부에서 HUD 프레임에 UIStroke를 추가하는 작업",
    "problem": "숫자형 속성에 문자열을 넣고 오류 원인 확인 없이 같은 실수를 반복",
    "report_reason": "입력 계약을 먼저 확인했다면 피할 수 있는 작업 낭비",
    "suggestion": "오류 뒤 입력형을 먼저 확인하고 숫자 예시를 참고",
    "cause": "도구 입력 계약을 제대로 확인하지 못함",
    "evidence": {"tool": "studiorpc_instance_upsert", "details": "숫자형 오류를 확인한 뒤에도 문자열을 재전달"}
  }
}
```

A checked Studio bug suspicion:

```json
{
  "kind": "studio_bug",
  "payload": {
    "title": "속성 변경 성공 응답 후 실제 값이 유지됨",
    "task_context": "에이전트 내부에서 HUD 프레임의 속성을 수정하는 작업",
    "problem": "입력 스키마에 맞게 호출했지만 성공 응답 뒤 재조회 결과가 그대로였음",
    "report_reason": "성공 응답과 검증 결과가 서로 달라 확인이 필요함",
    "suggestion": "실제 적용 여부를 검증하고 실패하면 오류를 반환",
    "cause": "Studio 속성 적용 경로 문제로 추정",
    "evidence": {"tool": "studiorpc_instance_upsert", "details": "동일 객체를 재조회해 변경되지 않았음을 확인"}
  }
}
```

A feature request after successful work:

```json
{
  "kind": "feature_request",
  "payload": {
    "title": "여러 객체의 속성을 일괄 변경하는 기능 필요",
    "task_context": "에이전트 내부에서 여러 HUD 객체에 같은 속성을 적용하는 작업",
    "problem": "현재 제공된 도구로는 객체마다 호출해야 함",
    "report_reason": "기능 목록을 확인했고 실제 반복 작업 비용이 발생",
    "suggestion": "선택 객체에 같은 속성을 일괄 적용하는 기능 제공",
    "cause": null,
    "evidence": {"details": "기존 기능으로 완료했지만 개별 호출을 반복"}
  }
}
```

## Result and availability

After a call, state one accurate status line, then continue the original task.
- Saved means stored in the Gateway DB.
- Slack queued means queued, not delivered.
- Duplicate means already submitted; do not reword it and submit again.
- No consent means not transmitted/stored.
- Missing context, authentication, tool, or network failure means reporting unavailable
  or failed. Do not repeatedly retry or stop the original task.

This skill and tool share the `issue-report` experiment: off by default in every
release channel, enabled only through an explicit override. If `agent_report` is absent,
state the finding without transmitting. Never fall back to Python, curl, Slack
webhooks, direct token retrieval, or the newest transcript.

Inside the bound OVERDARE agent, invoke the tool directly. If you are driving another
agent through MCP, ask that bound agent to file when available. A standalone driver
or generic CLI without a bound report tool must not report its own session as the
agent's. No credentials are shipped in this skill.
