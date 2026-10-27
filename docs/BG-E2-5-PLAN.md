# E2-5 계획 — 모델 프리셋과 요청 사용량을 PocketRisu 1.16.1로

**상태 (2026-10-27 KST):** 초안. 탐색 2건(haiku-explorer)과 orchestrator 확인을 마쳤고, 계획 검수 전이다. 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`의 「Ordered plan」 E2-5 행, R4, 「Pack versus native 1.16.1」의 두 행.
**위험 분류:** risky. 모든 모델 요청의 모델 결정, 요청 본문(PDF), 사용량 기록을 바꾼다.

## 1. 목표

`usage-cost-estimate`가 1.16.1 전용 계약(E2-2 계획 「공통 계약」)으로 얹힌다. 원본에 없는 기능(가격·비용 추정)은 남기고, 원본이 같은 일을 하는 unit은 뺀다. PageFold 통합(`pagefold-model-preset`, `pagefold-bg-adapter`)은 사용자 결정(2026-10-27 KST: 더 쓰지 않으므로 없앤다)으로 retire한다.

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
| M10 | catalog는 두 PageFold manifest를 `src/catalog.cjs:74-75`에서 읽는다. `pagefold-model-preset` manifest는 load 시 `files` 아래 파일을 읽는다(`manifest.cjs:7`). 이 manifest를 load 시 `require`하는 다른 pack은 `usage-cost-estimate`(`manifest.cjs:15`, 이름 목록으로 만든 경로)와 `lazy-chat-bg-adapter`(`plugin-host-units.cjs:396`의 `requires` 등 unit id 참조)다. `pagefold-bg-adapter` manifest를 `require`하는 pack은 없고, `lazy-chat-bg-adapter/manifest.cjs:2827`·`:2855`가 그 unit id를 `after` 문자열로만 쓴다. `personal-settings`(`editor-units.cjs:111-112`, `external-headers/units.cjs:67`)와 `haejeok-persistence-safety-adapter`(`chat-save-publication-units.cjs:9`, `:38`, `:201`)도 PageFold unit id를 `after` 목록으로만 쓴다(compose는 없는 `after` id를 무시한다, E2-4 G5). 전용 테스트는 `test/pagefold-model-preset.test.cjs`, `test/pagefold-bg-adapter.test.cjs`이고, catalog·resolver 테스트와 1.10 기준선 fixture가 pack 목록을 고정한다. `research/pagefold-verbatim`과 `test/pagefold-verbatim.test.cjs`는 pack이 아닌 연구 도구다. | 확인함(2026-10-27) |
| M8 | 원본 사용량 기록: 클라이언트가 요청마다 `/api/request-logs`로 보내고 서버가 `requests`와 `usage` 행을 쓴다. `usage` 행에는 요청 id가 없고 `requests.generation_id`는 UNIQUE가 아니다. 복구된 job은 `recordJobRecoveryLog`를 저장(`persistRecoveredChat`)과 claim보다 먼저 부르므로(`jobRecovery.ts:503`, `:532-533`), 저장이나 claim이 실패하면 같은 job이 다시 기록될 수 있다. BG 실행도 같은 insert 경로를 쓴다. | 확인함(호출 순서), 탐색(나머지) |

## 3. 판정

| 대상 | 판정 | 근거 |
|---|---|---|
| `usage-cost-estimate` | 남긴다(결정됨). `job-model-route`와 그 시험 unit 2개는 `retired`(원본 `model-jobs.cjs:682`가 같은 값을 기록). 나머지는 범위만 없애고 `retained`. 계산된 `after`(M9)는 유지하되 대상 목록에서 retire한 `pagefold-model-preset`을 뺀다. 이 변경과 남은 대상의 id로 바뀐 hash는 같은 commit의 coverage에 `rewritten`(이유: 계산된 `after`)으로 적는다. 이후 `bg-preserve`·`lazy-chat-bg-adapter`(E2-7)가 같은 파일의 unit id·파일·순서를 바꾸는 commit도 `usage-cost-estimate` coverage를 함께 고친다. `usage-no-store`와 `entries-route`는 같은 줄에 붙지만 서로의 anchor를 남겨 두 적용 순서의 결과가 같으므로(계획 검수의 읽기 전용 probe) 순서를 더하지 않는다. 순서가 필요해지면 manifest가 unit의 `after`를 계산값으로 덮어쓰므로(`manifest.cjs:22`) 합치거나 `before`를 쓴다 | M7, M9, M10. `after`를 고정 목록으로 바꾸면 순서 보장을 손으로 맞춰야 하고, 빼면 같은 파일의 적용 순서가 바뀐다 |
| 복구 job의 중복 사용량 기록 | E2-5에서 고치지 않는다. 원본 동작이고, 같은 호출 자리를 BG adapter(`job-recovery-identity-units.cjs:99-105`)가 고치므로 E2-7에서 판단한다. 비용 추정은 기록된 행을 그대로 더한다(원본과 같은 수) | M8 |
| `pagefold-model-preset`, `pagefold-bg-adapter` | retire(사용자 결정, 2026-10-27). 두 id를 `RETIRED_OWNER_IDS`에 넣고 catalog에서 뺀다. `pagefold-bg-adapter` 디렉터리와 전용 테스트는 지운다. `pagefold-model-preset`의 manifest와 그것이 읽는 파일은 `usage-cost-estimate`(E2-5a에서 대상 목록에서 뺌)와 `lazy-chat-bg-adapter`(E2-7)가 load 시 읽으므로 E2-7까지 남기고, 그 뒤 지운다. 다른 pack의 PageFold `after` 문자열은 손대지 않는다(무시되고, 손대면 기준선 hash가 바뀐다). 저장된 PageFold 설정(preset·binding의 `pageFold` 값)은 지우지 않는다. 원본은 그 필드를 읽지 않는다 | M10. 원본 1.16.1의 모델 결정(M1)과 PDF 글자 추출(M4)이 그대로 남는다 |

## 4. 단위

| ID | 제목 |
|---|---|
| E2-5a | Rebase usage-cost-estimate onto PocketRisu 1.16.1 |
| E2-5b | Retire the PageFold packs |

- 순서: E2-5b, 그다음 E2-5a.
- E2-5b: 위 판정. catalog·resolver·cli 테스트의 pack 목록, README, CHANGELOG를 고친다. 1.10 기준선 fixture는 기준선이므로 고치지 않고, 기준선 비교 test는 retire한 pack을 E2-4a처럼 다룬다. `research/pagefold-verbatim`은 pack이 아니므로 이 단위에서 다루지 않는다.
- E2-5a: 공통 계약, 위 판정. `requires` 의존 pack은 없지만 load 시 manifest를 읽는 pack 목록(M9)에서 `pagefold-model-preset`을 뺀다.
- 각 commit은 자기 변경이 일으키는 manifest의 실제 변화(계산된 `after` 포함)를 그 commit에서 처리한다(E2-4 계획 §4의 규칙).

## 5. 바뀌면 안 되는 것

- 원본 1.16.1의 모델 결정(M1): preset·block·classic, `classicModelIdFor`의 slot과 작업별 classic 모델, fallback 재시도, 실패·성공 결과의 `modelLabel`, generation info의 모델 표시.
- 원본 사용량 기록(`requests`·`usage` 행, 토큰 필드, BG bridge 경로)과 job의 모델 기록.
- 원본 PDF 처리(`multisend.ts`의 글자 추출과 검색).
- 1.10 데이터: 가격표·비용 설정을 그대로 읽는다. 저장된 PageFold 설정이 있어도 load·저장이 실패하지 않는다.
- 이미 rebase한 pack과 아직 rebase하지 않은 pack(기준선과 같음). 일반 installer는 `reviewing`만 선언된 target을 거부한다.

## 6. 수용 기준과 테스트 계약

공통 C0-C2는 E2-4 계획과 같다.

| # | 단위 | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|---|
| a1 | E2-5a | 알려진 토큰 수·가격의 모델로 요청 뒤 사용량 조회(기간 지정과 누적) | 요청 기록 있음 | 모델별 비용이 토큰 수 × 가격과 같고, 기간 결과와 누적 결과가 각자 맞다(`server-units.cjs:90-91`) | 가격표 정확도 |
| a2 | E2-5a | 기간에 기록 없음 | - | 빈 기간 표시 | - |
| a3 | E2-5a | model job 생성 | - | job의 모델 기록은 원본과 같다(pack unit 없이) | - |
| a4 | E2-5a | 원본 사용량 기록(일반, 복구, BG bridge) | - | 행 수와 토큰 필드가 원본과 같고, 비용은 그 행에서 계산된다 | 중복 기록 수정(E2-7) |
| b1 | E2-5b | catalog load, `all` profile | - | 두 PageFold pack이 catalog와 `all`에 없다 | - |
| b2 | E2-5b | 두 pack id가 든 custom state에서 `all`로 전환 | custom state | 거부되지 않고 채택된다(`RETIRED_OWNER_IDS`) | - |
| b3 | E2-5b | catalog load | `pagefold-model-preset` manifest를 읽는 pack이 남음 | load가 실패하지 않는다 | `lazy-chat-bg-adapter` 재작성(E2-7) |
| b4 | E2-5b | PageFold 설정이 저장된 DB로 요청 | 1.10 DB | 원본 1.16.1의 binding 결과(preset·block·classic)대로 요청이 가고 load·저장이 실패하지 않는다 | - |

## 7. 전제 출처

- 확인함: M1, M2, M3, M6, M9, M7의 `model-jobs.cjs:682`, M8의 호출 순서. M4는 `multisend.ts:110-126`·`:248-251`(PDF 글자 추출)과 서버 PDF 코드 0을 확인했다.
- 탐색: M5의 unit별 anchor, M7·M8의 나머지. M5는 구현 단위의 compose가 직접 잰다.

## 8. 다음

계획 검수 1회차(2026-10-27, 근거 묶음 방식)의 지적 5건 중 계산된 `after`의 commit 처리와 M7 순서 주장 정정은 반영했다. PageFold override 의미·tokenizer·PDF 경로·b1-b5 보강 지적은 코드로 맞음을 확인했지만(`resolve.ts:48-69`, `budget.ts:38-47`, `prepare.ts:57-85`), 같은 날 사용자가 PageFold 통합을 없애기로 해 E2-5b를 retire로 바꾸면서 대상이 사라졌다. 계획이 크게 바뀌었으므로 2회차 검수(바뀐 부분만) 뒤 Argon 시나리오, 테스트, 구현 순서다. E2-5는 E2-3·E2-4와 독립이다.
