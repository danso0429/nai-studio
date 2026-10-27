# E2-7 계획 — BG(bg-preserve, lazy-chat-bg-adapter)를 PocketRisu 1.16.1로

**상태 (2026-10-27 KST):** 초안. 구조·순서·판정까지 적었다. 단위별 수용 기준 표와 전제 확인은 탐색 2차 뒤에 채운다. 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`의 「Ordered plan」 E2-7 행, R3, R4, 「Pack versus native 1.16.1」의 BG 행.
**위험 분류:** risky. 서버 실행·저장·재개·취소와 plugin host를 바꾸고, 다른 pack 여럿이 이 pack의 unit id를 가리킨다.

## 1. 목표

`bg-preserve`와 `lazy-chat-bg-adapter`가 1.16.1 전용 계약(E2-2 계획 「공통 계약」)으로 원본 1.16.1과 E2-3의 `lazy-chat-sync` unit 위에 얹힌다. 기존 BG 계약(result/claim/ACK, 전체 pipeline 취소, no-resurrection, stream completeness, D2/D3 동작)은 그대로 지키고, BG 실행의 plugin API와 요청 식별을 1.16.1 foreground와 맞춘다(R3, R4). E2-2b에서 snapshot core를 떠난 compat 테스트 중 BG가 책임지는 부분을 이 pack의 unit으로 다시 넣는다.

## 2. 확인한 사실

출처의 「집계」는 orchestrator가 catalog 전체 unit을 pristine 1.10.0·1.16.1과 비교한 기록(로컬 `e2/anchors2.tsv`)이다. 「탐색」은 haiku-explorer 보고(로컬 `e2/e27/findings.md`)다.

| # | 사실 | 출처 |
|---|---|---|
| B1 | `bg-preserve`는 unit 187개다(`patches/bg-preserve.json`의 179개 base에서 5개를 빼고 15개를 `:1.9` 변형으로 바꾸고 13개를 더함). 1.16.1에서 anchor가 그대로 맞는 것 105, owned 66, anchor가 바뀐 것 15, 없는 것 1이다. 바뀐 anchor 16개는 모두 원본 1.10 글귀이고 파일은 `server.cjs` 4, `Chat.svelte` 4, `globalApi.svelte.ts` 2, `index.svelte.ts` 2, `DefaultChatScreen.svelte`·`translator.ts`·`modules.ts`·`geminiCacheWiring.ts` 각 1이다. | 집계, 탐색(로더 구조) |
| B2 | `bg-preserve` drift의 예: `persistTrackedChanges(toSave, options)`가 `(toSave, timing, options)`로 바뀜, `generationState` import 줄 변경, `let isDoing = get(doingChat)` 없어짐, 서버 `await pipeline(originalResponse.body, res);` 없어짐(pipeline hook 4개), `job.abortController.abort();`가 두 번 나옴(1.16.1 `server.cjs:3849`, `:9403`). 요청 정책 anchor `targ.aiModel = ... (model === 'model' ? db.aiModel : db.subModel)`는 binding과 `classicModelIdFor`로 바뀜(`request.ts:399-425`). | 탐색 |
| B3 | `lazy-chat-bg-adapter`는 unit 854개다. 원본 파일 anchor가 그대로 맞는 것 176, owned 136, `bg-preserve`의 owned 파일(`bgOrchestrate.ts` 208, `bgOrchestrator.cjs` 184 등)을 고치는 것 430, 1.16.1에서 anchor가 맞지 않는 것 112다. 맞지 않는 112개 중 약 34개는 `lazy-chat-sync` 1.10 통째 교체 파일의 글귀(`server.cjs` 13, `nodeStorage.ts` 11, `globalApi.svelte.ts` 8, `chatStorage.ts` 2), 약 20개는 원본 1.10 글귀, 나머지는 다른 pack이 더한 글귀(`DefaultChatScreen.svelte` 23 등)다. | 집계 |
| B4 | `lazy-chat-bg-adapter`는 E2-3에서 retire한 `lazy-chat-sync` 1.10 unit id를 `requires`로 가리킨다(`manifest.cjs:580`, `:990`, `:2382`, `:2488`). retire한 `pagefold-model-preset`(E2-5b)의 unit도 `requires`로 가리킨다(`request-policy-units.cjs:31`, `:92`, `plugin-host-units.cjs:396`). 지금 이 pack은 1.10만 선언하고 1.16.1만 선언하는 `lazy-chat-sync`를 요구하므로 어느 target에서도 조립되지 않는다. | 확인함(E2-3b·E2-5 2회차 검수) |
| B5 | `lazy-chat-bg-adapter`의 unit builder는 load 시 다른 pack manifest를 읽고 같은 파일을 고치는 unit id를 `after`로 계산한다(`notification-units.cjs:7-12`, `recovery-read/-ownership-units.cjs:5-8`, `post-response`·`plugin-host`, `client-input-recovery-units.cjs:8`, `chat-fmindex-units.cjs:12-14`, `manifest.cjs:4235-4238`). E2-3b부터 기준선 test는 이 pack의 unit hash 비교를 건너뛰고 unit id와 version만 본다. | 확인함(E2-3b), 탐색 |
| B6 | R3: BG plugin host(`files-1.10/server/node/bgPluginHost.cjs` `ROOT_HANDLERS`)에는 1.11-1.16의 v3 API 약 30개가 없다(`parseRisuChat`, `add/removeRisuChatListener`, `setChatToIndex`, `setDatabaseLite` 등). 원본 동작: `setDatabaseLite`는 `plugins`를 뺀다(`v3.svelte.ts:814-825`), `setChatToIndex`는 앞선 `getChatFromIndex`를 요구한다(`:1038-1043`), plugin storage `getItem`은 `?? null`이다(`:1404`). | 탐색, audit R3 |
| B7 | R4: 1.14의 binding과 `classicModelIdFor`, 1.11의 요청 모드별 `logSource`(`logSource.ts:5`, `request.ts:106`), stop grace `STOP_GRACE_MS=8000`(`generationState.ts:117`)와 `abortGeneration`(`:203`), job 재연결과 복구 메시지 metadata가 바뀌었다. 복구 job의 사용량 기록 중복 가능성(E2-5 M8)은 이 pack의 `job-recovery-identity-units.cjs:99-105`가 닿는 자리다. | 탐색, audit R4, E2-5 계획 M8 |
| B8 | 원본 1.16.1에 이미 있는 것: `decodeDatabaseWithPersistentChatIds`(`server.cjs:552`), `queueStorageOperation`, `restoringSnapshotKey`, `importInProgress`, `stripChatsFromDb`, `ensureChatStore`, `persistDbCacheWithChats`, model-jobs route(`model-jobs.cjs:672-767`), `nodeOnlyServerSideRequests` 기본 true(`database.svelte.ts:442`; BG는 서버 DB 사본에서 false로 둠). | 탐색 |
| B9 | E2-3이 BG에 주는 계약: `chatWriteJournal.cjs`·`serverChatCommit.cjs` owned id 유지, storage epoch와 이전 epoch commit 거부(c6), reset 성공 뒤 publish hook(BG 실행 취소 자리, E2-3c 구현), 1.10 BG unit이 붙는 표지 줄(`// Owners of other recovery namespaces extend this cleanup.`, `cancel-persistence-timers` trace) 유지. | 확인함(E2-3 계획 §5, E2-3c 구현 보고) |

## 3. 판정

| 대상 | 판정 | 근거 |
|---|---|---|
| `bg-preserve` | 남긴다(결정됨). 맞지 않는 16개 unit을 1.16.1 글귀에 맞게 같은 id로 고친다(`rewritten`). 두 번 나오는 anchor는 앞뒤 글귀를 넓혀 한 번만 맞게 한다. 요청 정책 hook은 binding 결과 뒤(`classicModelIdFor` 자리)에 붙인다 | B1, B2 |
| `lazy-chat-bg-adapter`의 `bg-preserve` owned 파일 unit 430개 | 그대로 둔다. `bg-preserve` owned 파일 내용이 바뀌는 unit에서만 함께 고친다 | B3 |
| `lazy-chat-sync` 1.10 글귀에 붙은 약 34개 | E2-3 unit이 만든 글귀나 원본 1.16.1 글귀로 다시 쓴다. 기능이 E2-3 unit에 이미 들어갔으면 `retired`(이유: 해당 E2-3 unit id) | B3, B9 |
| retire한 pack id를 가리키는 `requires` | `lazy-chat-sync` 1.10 id는 E2-3 unit id로 바꾸고, PageFold id는 지운다(PageFold 기능이 없으므로 그 unit의 PageFold 부분도 지운다) | B4 |
| 계산된 `after` | 유지한다. 이 단계가 끝나면 기준선 test의 `lazy-chat-bg-adapter` hash 예외를 없애고, 이 pack도 coverage 비교로 돌린다 | B5, E2-3 계획 §7 |
| R3 plugin API parity | **권고: 1.16.1 foreground v3 API를 기준으로 BG host에 빠진 이름을 더한다.** 원본 동작(`setDatabaseLite`의 `plugins` 제외, `setChatToIndex`의 선행 조건, `?? null`)을 그대로 따른다. BG에서 의미가 없는 UI 전용 API(`createMutationObserver`, TTS 등)는 원본과 같은 오류로 거절하고 목록을 계획에 적는다 | B6 |
| R4 요청 식별 | 원본 binding 결과를 쓰고 BG 요청에 원본 `logSource`를 붙인다. stop grace는 원본 값을 따른다. 복구 job 사용량 중복은 claim 성공 뒤에만 기록하도록 고칠지 탐색 2차 뒤 판정한다 | B7, E2-5 M8 |
| snapshot core에서 옮길 BG compat 테스트 | BG가 책임지는 사례(reset 뒤 BG 실행 취소·정리, reset-orphans B3, B1b-2·B2의 BG 부분)를 이 pack의 owned test unit으로 다시 넣는다 | E2-2b, E2-3 c9 결정 |

## 4. 단위 (초안)

| ID | 제목 |
|---|---|
| E2-7a | Rebase bg-preserve onto PocketRisu 1.16.1 |
| E2-7b | Re-anchor lazy-chat-bg-adapter on the 1.16.1 lazy-chat-sync units |
| E2-7c | Align BG request identity and recovery with PocketRisu 1.16.1 |
| E2-7d | Bring the BG plugin host to 1.16.1 plugin API parity |
| E2-7e | Re-add the BG-owned reset and session compat tests |

- 순서: E2-7a → E2-7b → E2-7c → E2-7d → E2-7e. E2-7a는 `lazy-chat-bg-adapter`가 `bg-preserve`를 `requires`하므로 먼저다. E2-7b가 끝나야 `lazy-chat-bg-adapter`가 1.16.1에서 조립된다. E2-7b까지는 `lazy-chat-bg-adapter`가 조립되지 않으므로 E2-7a의 subset harness는 `bg-preserve` closure로 한다.
- 선행: E2-3 전체(E2-3c의 publish hook, E2-3d revision, E2-3e client), E2-4d(`personal-settings` unit id, B5), E2-5b(PageFold retire), E2-6b·E2-6c(snapshot lazy adapter, Kei restore safety; BG compat 테스트가 함께 조립될 때).
- 각 단위는 E2-2 「공통 계약」과 E2-4 계획 §4의 계산된 `after` 규칙을 따른다.

## 5. 바뀌면 안 되는 것

- BG 계약: operation-keyed result·claim·ACK, 전체 pipeline 취소와 no-resurrection, stream completeness, D2/D3 동작, BG conflict 사본을 만들지 않는 복구, 사용자 데이터인 기존 `BG conflict` 사본.
- 원본 1.16.1의 foreground 생성·저장·job·request-logs·plugin API 동작.
- 이미 rebase한 pack. 일반 installer는 `reviewing`만 선언된 target을 거부한다.
- 1.10 live data의 BG 저장 형식(operation store, delivered state)을 1.16.1에서 그대로 읽는다.

## 6. 수용 기준과 테스트 계약

탐색 2차 뒤에 단위별 표를 채운다. 지금 정한 공통 기준: C0-C2(E2-4 계획과 같음). E2-7b 끝에서 `lazy-chat-bg-adapter`가 1.16.1 closure로 조립되고 기준선 test의 hash 예외가 사라진다. 1.10에서 통과한 BG 검증(D2/D3 실제 memory plugin 포함)은 E2-9에서 1.16.1로 다시 돈다.

## 7. 전제 출처와 남은 탐색

- 확인함: B4, B5의 E2-3b 처리, B9.
- 집계: B1, B3의 수.
- 탐색: B2, B6, B7, B8. 계획 검수 전에 orchestrator가 줄을 확인한다.
- 탐색 2차(계획 검수 전): (1) B3의 112개를 unit별로 대응 자리(E2-3 unit 글귀, 원본 1.16.1 줄)와 함께 표로 만든다. (2) R3의 빠진 API 목록을 1.16.1 `v3.svelte.ts` 기준으로 확정하고 BG에서 거절할 것을 나눈다. (3) R4의 복구 job 사용량 기록 순서를 실제 호출로 확인한다. (4) E2-2b에서 옮길 BG compat 사례 목록을 E2-3 c9 매핑과 맞춘다.

## 8. 다음

탐색 2차, 수용 기준 표, 계획 검수(Astra), Argon 시나리오, 테스트, 구현 순서. E2-7은 E2-3·E2-4d·E2-5b 뒤다.
