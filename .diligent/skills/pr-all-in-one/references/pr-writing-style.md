# PR Writing Style

Use this guide while drafting PR bodies and PR comments, then once more as a single check pass.

Goal: a reviewer understands what changed, why, and what to inspect on the first read, without guessing omitted relations. Clear meaning beats elegant prose.

This is not a humanizer. Do not try to make text "sound human", vary rhythm, add colloquial flavor, or hunt "AI tells" for their own sake. Change text only when it breaks a rule below.

Two sources, combined:

- Structure: ASD-STE100 Simplified Technical English at about 80% strength (from `ninajingit/ste-business-writing`). Short sentences, one idea each, conclusion first, nothing lost.
- Korean grammar: `snflkd/fluent-korean` (MIT). Keep particles, endings, and meaningful sentence components. Use plain, precise vocabulary instead of figurative words or noun stacks.

## Scope

Apply to PR body prose and PR comments in Korean or English.

Do not apply to:

- Code blocks, commands, file paths, code identifiers, config keys, model IDs, and quoted logs or error messages.
- Commit messages and PR titles. They follow `type(scope): summary` and stay English unless the user asks otherwise.
- Content preserved from an existing PR: screenshot/recording sections and unchanged user-written text. Restyle preserved text only when its facts must be updated.

## Strength by Section

| Section | Strength | Shape |
|---|---|---|
| Background and intent | 80% | Problem and goal in the first sentence. Then trigger, evidence, and intended outcome. |
| Decision log | 80% | One decision per bullet. Decision first, reason second. Rejected alternatives name what was rejected and why. |
| Changes | 80% | One change per bullet. Start with what changed. Grouping bullets under a file path is fine. |
| Verification Log | strict | `` `command` ``: result. Facts only: exit status, pass/fail counts, scope. Skipped checks state the reason. No commentary. |
| Review Notes | 80% | One risk or request per bullet. Put what the reviewer should check in the first sentence. |
| PR comments, short replies | light | Split long sentences and remove filler. Keep a natural tone. |

## Structure Rules (Korean and English)

1. Conclusion first. The first sentence of each section or bullet must carry the main point alone.
2. One fact or decision per sentence.
   - Korean: if a sentence chains two or more connective endings (`-고`, `-며`, `-는데`, `-지만`, `-어서`, `-므로`), split it with a period. A sentence with one connective is usually fine.
   - English: at most 25 words for descriptions and 20 for instructions. Replace semicolons with periods.
3. Make the actor clear. Use active voice. Korean may drop an obvious subject, but state it when the actor is ambiguous (user, runtime, provider, test, reviewer).
4. Use specific verbs. Prefer the verb for the real action over generic verbs such as "handle", "manage", "처리하다", "진행하다".
5. One term per concept. Do not rotate synonyms (세션 / 대화 / 스레드). When a code identifier names the concept, use that identifier consistently.
6. Remove filler that adds no fact: "참고로", "기본적으로", "~하는 것이 중요합니다", "효과적으로", "원활하게", "다양한", "It's worth noting", "simply", "really".
7. No em dashes in prose. Use a colon, a period, or a connective.
8. Never lose:
   - Numbers, units, counts, dates, durations, versions, commit hashes, identifiers, paths, links, and issue references.
   - Conditions and hedges: "약", "아직", "~일 수 있습니다", "확인하지 못했습니다", "if", "about", "may".
   - Scope limits, skipped work, negative results, and known failures.
   - If a rewrite changes a claim, keep the original sentence.

## Korean Grammar Rules

1. Do not omit meaningful sentence components. The reader must not have to guess what, where, or under which condition. Fill gaps only with information from the working notes, diff, or logs. Never invent context to complete a sentence.
2. End prose sentences with a predicate and a final ending. Do not end prose with a noun phrase (`~예정`, `~완료`, `~처리`, `~필요`), an adverbial phrase, or a connective ending. Headings are exempt. PR bullets are sentences too, except a bare label such as a file path followed by a colon.
3. Keep particles and endings. Avoid chains of `의`: they usually hide the real relation between words.
4. Combine precise Sino-Korean words with particles and endings. Do not stack bare nouns.
5. Do not replace plain nouns or verbs with figurative or slang words. Keep an expression only when it is established in written Korean for this domain and a plain word would sound wrong. Choose the plain word that names the actual change in the diff or logs. If the actual change is unknown, keep the original word instead of guessing from the replacement table.
6. Technical terms: use an established Korean translation or transliteration when one exists (리베이스, 커밋, 테스트). Otherwise keep the original term (`compaction`, `provider`, `best-effort`). Do not invent translations and never translate identifiers.
7. Use 합니다체 consistently for the whole body. Do not switch to 해요체, 한다체, or note-style fragments. Do not mimic the user's tone.
8. Prefer common words over rare dictionary words, even when the rare word is correct.

## Write, Then Check Once

Draft the body with these rules from the start. Then run one check pass:

1. Read sentence by sentence. Change a sentence only when it breaks a named rule above.
2. Leave every passing sentence byte-identical. Do not swap synonyms, reorder for flow, add transitions, soften or strengthen claims, or vary endings for rhythm.
3. Expect few edits. A check pass that rewrites most sentences is a rewrite, not a check. Stop and limit edits to rule violations.
4. Compare the draft and the checked body for fact drift: backtick spans, numbers, URLs, issue references, checkbox count and state, headings, and hedges. Revert any sentence whose facts changed.
5. Run the pass once. Do not call `humanize-korean` or another style skill unless the user explicitly asks.

## Examples

### Leave passing text unchanged

| Draft | Wrong check-pass edit | Correct |
|---|---|---|
| 자식 세션이 시작될 때 사용자 ID를 고정합니다. | 자식 세션이 처음 뜰 때 사용자 ID를 딱 고정해 둡니다. | Unchanged. The draft breaks no rule. The edit adds slang and no fact. |
| 사용자가 취소한 경우에는 기존과 같이 에러를 반환합니다. | 사용자가 직접 취소했다면, 예전처럼 에러를 그대로 올려 줍니다. | Unchanged. |

### Fix rule violations

| Rule | Before | After |
|---|---|---|
| Noun-phrase ending, dropped particles | compaction 실패 시 턴 계속 진행. 동일 run 내 재시도 X. | compaction이 실패해도 턴은 계속 진행합니다. 같은 run에서는 compaction을 다시 시도하지 않습니다. |
| Noun stack | native compaction 미지원 모델 대상 로컬 요약 폴백 처리 | native compaction을 지원하지 않는 모델은 로컬 요약으로 대체합니다. |
| `의` chain | 어댑터의 요청의 타임아웃의 기본값을 유지합니다. | 어댑터가 보내는 요청의 타임아웃 기본값은 유지합니다. |
| One idea per sentence | 타이머가 스트림을 끊고, 재시도 루프는 abort 신호를 보고 종료되며, 예외가 턴을 실패시켜서 다음 메시지에서도 같은 실패가 반복됩니다. | 180초 타이머가 스트림을 끊습니다. 재시도 루프는 abort 신호를 확인하고 종료합니다. 이 예외가 턴 전체를 실패시키므로 다음 메시지에서도 같은 실패가 반복됩니다. |
| Figurative verb | 토큰 계산 로직을 어댑터에 박아 넣었습니다. | 토큰 계산 로직을 어댑터에 추가했습니다. |
| Figurative noun | 이 결정으로 정책이 갈리는 자리입니다. | 이 결정은 이후 정책에 계속 영향을 줍니다. |
| Missing component | 그러면 경고가 붙습니다. | 그러면 이미 열려 있는 세션에도 경고가 표시됩니다. (Only when the working notes support "already open sessions".) |
| Conclusion first | 로컬 요약은 최대 15분까지 걸릴 수 있고 그동안 사용자는 대기 상태를 보게 되므로 상한 값을 검토해 주세요. | 로컬 요약 상한 15분이 적절한지 검토해 주세요. 상한에 도달할 때까지 사용자는 compaction 진행 상태를 계속 보게 됩니다. |
| Filler | 참고로 기본적으로 기존 동의 확인 방식은 그대로 유지하는 것이 중요합니다. | 기존 동의 확인 방식은 유지합니다. |
| Em dash in Verification Log | `bun test` — 2,809개 통과 | `bun test`: 2,809개 통과, 실패 0개 |
| Hedge preserved | Astra의 404가 일시적인지는 확인하지 못했습니다. → Astra는 compact 엔드포인트를 지원하지 않습니다. | Keep the original. The rewrite turned an unverified point into a claim. |

Common figurative or slang words in engineering text and plain replacements:

| Avoid | Prefer |
|---|---|
| 박다, 박아 넣다 | 추가하다, 명시하다, 하드코딩하다 |
| 얹다 | 추가하다, 적용하다 |
| 태우다 | 전달하다, 실행하다, 포함하다 |
| 꽂다 | 연결하다, 등록하다 |
| 풀리다 | 해결되다 |
| 돌다, 돌리다 | 실행되다, 실행하다 |
| 치우다 | 제거하다, 정리하다 |
| 갈리다 | 달라지다, 나뉘다 |
| 흐름 | 순서, 경로, 과정 |

### English

| Before | After |
|---|---|
| The fix goes live behind a flag; rollout sits under the existing gate. | The fix is behind a flag. Rollout uses the existing gate. |
| Handling timeouts better helps, but making the summary finish means trimming old messages. | Better timeout handling helps. The summary finishes only after old messages are trimmed. |
| It's worth noting that we already preserve the screenshot section. | The screenshot section is preserved. |

## Credit

- Structure rules adapt `ninajingit/ste-business-writing`, based on Andrej Karpathy's suggestion to use ASD-STE100 at about 80% strength.
- Korean grammar rules adapt `snflkd/fluent-korean` (MIT License, Copyright (c) 2026 snflkd).
