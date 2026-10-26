# E2-5 계획 — 모델 프리셋과 요청 사용량을 PocketRisu 1.16.1로

**상태 (2026-10-27 KST):** 초안. 탐색 2건(haiku-explorer)과 orchestrator 확인을 마쳤고, 계획 검수 전이다. 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`의 「Ordered plan」 E2-5 행, R4, 「Pack versus native 1.16.1」의 두 행.
**위험 분류:** risky. 모든 모델 요청의 모델 결정, 요청 본문(PDF), 사용량 기록을 바꾼다.

## 1. 목표

`usage-cost-estimate`와 `pagefold-model-preset`이 1.16.1 전용 계약(E2-2 계획 「공통 계약」)으로 1.14 이후의 모델 binding 위에 얹힌다. 원본에 없는 기능(가격·비용 추정, PDF 페이지 접기, 작업별 모델 override)은 남기고, 원본이 같은 일을 하는 unit은 뺀다.

## 2. 확인한 사실

출처 표기는 E2-4 계획과 같다. 탐색 기록은 로컬 `e2/e25/findings.md`.

| # | 사실 | 출처 |
|---|---|---|
| M1 | 1.16.1 요청의 모델 결정: `requestChatDataMain`(`request.ts:395`)은 `staticModel`이 없을 때만 `resolveChatModelBinding(currentChat, model, moduleId)`(`modelPresetBinding.ts:49`)를 부르고, 결과가 model preset이면 `requestModelPreset`, block이면 실패, classic이면 `classicModelIdFor`(`:137-149`)로 모델 id를 정한다(`request.ts:402-426`). fallback 재시도는 `staticModel`로 binding을 건너뛴다. | 확인함 |
| M2 | 요청 종류(`ModelModeExtended`): main `model`, `submodel`, `translate`, `memory`, `emotion`, `otherAx`. 호출 자리(`requestChatData`·`requestChatDataMain`)는 `index.svelte.ts:1589`·`:1957`·`:2182`, `stableDiff.ts:48`, `translator.ts:587`, `hypav3.ts:1707`, `scriptings.ts:592`·`:639`·`:962`, `triggers.ts:1479`·`:1908`, `mcp/aiaccess.ts:62`, `ChatScreens/Suggestion.svelte:85`, `Playground/PlaygroundSubtitle.svelte:80`·`:299`, `Playground/PlaygroundImageTrans.svelte:162`, plugin v3(`v3.svelte.ts:1480`, `requestChatDataMain` 직접 호출)이고, `request.ts:206`은 fallback 재시도(`staticModel`)다. preset 편집기의 시험 요청(`request.ts:1054-1064`)과 job 전송(`:1099`)은 binding을 거치지 않는다. | 확인함 |
| M3 | 1.16.1 tokenizer는 이미 모델 id를 받는다(`ChatTokenizer` 생성자 `modelId`, `tokenizer.ts:385-404`). pack의 `encodeText` 주입과 같은 자리다. | 확인함 |
| M4 | 원본 1.16.1에는 문서(PDF) 입력 part가 없다(adapter part는 image만). PDF는 클라이언트에서 글자를 뽑아 HypaMemory 검색에 쓴다(`process/files/multisend.ts:110-126`). 서버에 PDF 코드는 없다. | 탐색 |
| M5 | `pagefold-model-preset`은 unit 160개(owned 48, insert 68, replace 44)다. anchor 112개 중 94개가 1.16.1에 한 번씩 있고 18개가 없다: `request.ts` 8개(실패·성공 결과에 `modelLabel`이 더해짐, import 줄 변경), `index.svelte.ts` 4개(binding import 한 줄, tokenizer 생성 `:370-371`, generation info `:1610-1611`), `tokenizer.ts` 4개(M3), `ModelBind.svelte` 2개(import, `{#if inBinding && currentChat?.modelBinding}` `:190`). | 탐색(audit의 18개와 일치) |
| M6 | 다른 pack이 `pagefold-model-preset` unit id나 manifest를 쓴다: `lazy-chat-bg-adapter/request-policy-units.cjs`(32곳, 바뀐 import unit 포함)와 `manifest.cjs`(2곳), `plugin-host-units.cjs:396`(`request-outer-route-state` `requires`), `haejeok-persistence-safety-adapter/chat-save-publication-units.cjs`(3곳), `personal-settings/settings/appearance/editor-units.cjs:111-112`(`server-binary-body-limit`, `server-render-route-registration`), `personal-settings/settings/external-headers/units.cjs:67`(`after`), `pagefold-bg-adapter/manifest.cjs`(2곳), `usage-cost-estimate/manifest.cjs:15`(M9). | 확인함 |
| M9 | `usage-cost-estimate/manifest.cjs:15-22`는 load 시 `bg-preserve`, `lazy-chat-bg-adapter`, `pagefold-model-preset`, `log-load-performance`의 manifest를 `require`하고, 자기 unit마다 같은 파일을 고치는 그 네 pack의 unit id 전부를 `after`로 계산해 넣는다. coverage hash(`scripts/lib/target-coverage.cjs:34-37`)는 `targetVersions`만 빼고 `after`를 포함한다. 따라서 네 pack이 같은 파일의 unit id를 더하거나 빼면 `usage-cost-estimate`의 unit hash가 바뀐다. | 확인함 |
| M7 | `usage-cost-estimate`는 unit 44개이고 43개 anchor가 1.16.1에 한 번씩 있다. `job-model-route`(`server-units.cjs:5-11`)는 anchor가 없고, 원본이 같은 일을 한다(`model: req.body?.model`, `model-jobs.cjs:682`). 그 시험 unit 2개는 원본 테스트 값과 다른 모델 이름을 기대한다. `usage-no-store`와 `entries-route`는 같은 줄(`request-logs.cjs:586`)에 붙어 순서가 결과를 정한다. | 확인함(`model-jobs.cjs:682`), 탐색(나머지) |
| M8 | 원본 사용량 기록: 클라이언트가 요청마다 `/api/request-logs`로 보내고 서버가 `requests`와 `usage` 행을 쓴다. `usage` 행에는 요청 id가 없고 `requests.generation_id`는 UNIQUE가 아니다. 복구된 job은 `recordJobRecoveryLog`를 저장(`persistRecoveredChat`)과 claim보다 먼저 부르므로(`jobRecovery.ts:503`, `:532-533`), 저장이나 claim이 실패하면 같은 job이 다시 기록될 수 있다. BG 실행도 같은 insert 경로를 쓴다. | 확인함(호출 순서), 탐색(나머지) |

## 3. 판정

| 대상 | 판정 | 근거 |
|---|---|---|
| `usage-cost-estimate` | 남긴다(결정됨). `job-model-route`와 그 시험 unit 2개는 `retired`(원본 `model-jobs.cjs:682`가 같은 값을 기록). 나머지는 범위만 없애고 `retained`. 같은 줄에 붙는 두 unit은 `after`로 순서를 고정한다. **권고: 계산된 `after`(M9)는 유지하고, E2-5b를 E2-5a보다 먼저 한다.** 그러면 E2-5a의 hash가 rebase한 `pagefold-model-preset` id 위에서 정해진다. 이후 `bg-preserve`·`lazy-chat-bg-adapter`(E2-7)가 같은 파일의 unit id를 바꾸는 commit은 `usage-cost-estimate` coverage도 함께 고친다(`rewritten`, 이유: 계산된 `after`) | M7, M9. `after`를 고정 목록으로 바꾸면 순서 보장을 손으로 맞춰야 하고, 빼면 같은 파일의 적용 순서가 바뀐다 |
| 복구 job의 중복 사용량 기록 | E2-5에서 고치지 않는다. 원본 동작이고, 같은 호출 자리를 BG adapter(`job-recovery-identity-units.cjs:99-105`)가 고치므로 E2-7에서 판단한다. 비용 추정은 기록된 행을 그대로 더한다(원본과 같은 수) | M8 |
| `pagefold-model-preset` | 남긴다(결정됨). 18개 unit을 1.16.1 글귀에 맞게 같은 id로 고친다(`rewritten`). **권고: tokenizer는 원본의 `modelId` 경로를 쓰고 pack의 `encodeText` 주입은 같은 효과가 나는 한 빼거나 줄인다.** 작업별 override는 `resolveChatModelBinding`을 감싸서 M2의 모든 binding 요청에 적용한다. binding을 거치지 않는 자리(fallback 재시도, 시험 요청, job 전송)는 원본처럼 둔다 | M1-M5 |
| PDF 페이지 접기 | 남긴다. 원본에 문서 part가 없다 | M4 |

## 4. 단위

| ID | 제목 |
|---|---|
| E2-5a | Rebase usage-cost-estimate onto PocketRisu 1.16.1 |
| E2-5b | Rebase pagefold-model-preset onto the 1.16.1 model binding |

- 순서: E2-5b, 그다음 E2-5a(M9).
- E2-5a: 공통 계약, 위 판정. `requires` 의존 pack은 없지만 load 시 네 pack manifest를 읽는다(M9).
- E2-5b: 공통 계약, 18개 unit 재작성, 다른 pack의 `after`가 가리키는 id는 바꾸지 않는다(M6). `lazy-chat-bg-adapter`가 `requires`하는 바뀐 import unit(`request-detailed-binding-import`)은 같은 id로 고쳐 E2-7이 그대로 이어 붙게 한다.
- `pagefold-bg-adapter`는 E2-8이다.

## 5. 바뀌면 안 되는 것

- 원본 1.16.1의 모델 결정(M1): preset·block·classic, `classicModelIdFor`의 slot과 작업별 classic 모델, fallback 재시도, 실패·성공 결과의 `modelLabel`, generation info의 모델 표시.
- 원본 사용량 기록(`requests`·`usage` 행, 토큰 필드, BG bridge 경로)과 job의 모델 기록.
- 원본 PDF 처리(`multisend.ts`의 글자 추출과 검색).
- 1.10 데이터: 저장된 override 설정, pagefold 설정, 가격표·비용 설정을 그대로 읽는다.
- 이미 rebase한 pack과 아직 rebase하지 않은 pack(기준선과 같음). 일반 installer는 `reviewing`만 선언된 target을 거부한다.

## 6. 수용 기준과 테스트 계약

공통 C0-C2는 E2-4 계획과 같다.

| # | 단위 | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|---|
| a1 | E2-5a | 가격이 있는 모델로 요청 뒤 사용량 화면 | 요청 기록 있음 | 모델별 비용 추정이 보인다 | 가격표 정확도 |
| a2 | E2-5a | 기간에 기록 없음 | - | 빈 기간 표시 | - |
| a3 | E2-5a | model job 생성 | - | job의 모델 기록은 원본과 같다(pack unit 없이) | - |
| a4 | E2-5a | 원본 사용량 기록(일반, 복구, BG bridge) | - | 행 수와 토큰 필드가 원본과 같고, 비용은 그 행에서 계산된다 | 중복 기록 수정(E2-7) |
| b1 | E2-5b | 작업별 override가 있는 상태로 각 요청 종류(M2) | override 설정 | 해당 작업이 override 모델로 요청된다 | binding을 거치지 않는 자리 |
| b2 | E2-5b | override 없는 요청 | - | 원본 binding 결과(preset·block·classic)와 같다 | - |
| b3 | E2-5b | PDF를 붙인 요청(지원 provider) | PDF 첨부 | 페이지 접기 규칙대로 본문이 만들어지고 요청이 간다 | provider 응답 품질 |
| b4 | E2-5b | PDF 렌더 route에 큰 본문 | - | pack의 body 한도(2 MiB) 안은 처리, 넘으면 거부 | - |
| b5 | E2-5b | 토큰 수 계산(main 요청, 문맥 예산) | - | 원본 `modelId` 기준 tokenizer와 같은 수(PDF 없는 경우) | - |
| b6 | E2-5b | 실패·성공 결과와 generation info | - | 원본의 `modelLabel` 표시가 남는다 | - |
| b7 | E2-5b | 요청 기록의 PDF 내용 | PDF 요청 | 기록에서 PDF 내용이 가려진다(pack 기존 동작) | - |

## 7. 전제 출처

- 확인함: M1, M2, M3, M6, M9, M7의 `model-jobs.cjs:682`, M8의 호출 순서. M4는 `multisend.ts:110-126`·`:248-251`(PDF 글자 추출)과 서버 PDF 코드 0을 확인했다.
- 탐색: M5의 unit별 anchor, M7·M8의 나머지. M5는 구현 단위의 compose가 직접 잰다.

## 8. 다음

계획 검수(Astra), 전제 확인, Argon 시나리오, 테스트, 구현 순서. E2-5는 E2-3·E2-4와 독립이다.
