# D3 설계 계획 — BG의 RCM 응답 뒤 출력 동기화(유한 대기)

**상태 (2026-10-22 KST):** 계약 범위(호스트 공통)·구조(D + A)·시한 10초·대상 timer·결과 표시·유료 호출 거절 결정, 시제품 없는 측정 완료, 구현 계획 Astra 검수 반영, 테스트 계약 표·전제 출처 작성. 테스트 요청 전 실측 2건(아래 「테스트 요청 전 실측」) 남음, 구현 전. **2026-10-25:** P1 통과·P2(M1 재측정) 완료, 「테스트 요청 전 확정」(인터페이스·결과 모양·주입 지점)을 Astra 2회 검수로 확정, N+1 처리 사용자 결정. 다음은 블라인드 테스트 요청.
정본: [G2.2 실행 계획](BG-G2-2-EXECUTION-PLAN.md) §3(B) D3(결정 2026-10-22: 유한 대기로 지원), [ordered goals](BG-PRESERVE-ORDERED-GOALS.md) §9.3 「공통 경계」 1~4, [G2.2c 실측](BG-G2-2C-RCM-MEASUREMENTS.md) §2·§3. 대상: D2 단위 commit 뒤의 patcher `main`(코드 사실은 `d476d60` 조립 트리 기준).
위험 분류: **risky** (host 수명, commit 순서, 미리보기 lock, 동시 작업).

## 목표

BG 작업에서 RCM 원본이 답변 뒤 실행하는 출력 동기화(두 번째 `/v1/turn/prepare`)가, 정상 채팅에 답변이 저장된 뒤 같은 작업 안에서 유한 시간 안에 실행되게 한다. 원본 JS·backend는 바꾸지 않는다. 시한 안에 끝나지 않으면 정리하고 결과를 불확실로 알린다. 자동 재실행·상주 JS·고정 sleep은 두지 않는다.

## 확인한 사실

RCM은 원본 1.0.21 JS(minified 기호), host는 patcher `d476d60`의 조립 트리 기준이다(`dd5641a` 이후 host 수명·worker 경로의 줄은 D1-a로 일부 이동해 2026-10-22에 다시 확인했다).

1. RCM afterRequest(`UA`): 답변을 그대로 반환하고, `addRisuChatListener`가 없으면 `window.setTimeout(cb, 1500)`을 건다. cb는 대기 중인 chat/request id와 `mainGeneration`을 다시 확인한 뒤 `DA(chatId, requestId)`를 부른다. listener가 있으면 "output" 이벤트에서 다시 읽은 채팅의 마지막 메시지가 이벤트의 메시지·generation과 일치할 때 즉시 `DA`를 부른다(1500ms 없음).
2. RCM `DA`: `ln(e)`(getCurrentCharacterIndex·getCharacter·getCurrentChatIndex·getChatFromIndex·getCurrentLorebookEntries·getDatabase(["personas","selectedPersona","characters"]))로 채팅을 다시 읽고, 읽은 chatId가 대기 chatId와 다르거나 채팅이 비활성이면 건너뛴다. 이어 `Zo`를 기다리지 않고 시작하고 `prepare(..., {deferExtraction:false}, 5000)`을 기다린 뒤, `finally`에서 `vI`(기다리지 않음)와 `gc`(idle timer)를 부른다. prepare를 포함한 오류는 `catch`에서 경고 로그로 흡수한다. 메시지 id를 비교하지 않는다. RCM onUnload는 `postResponseTimer`를 지운다.
3. foreground 관찰: 답변 약 1.5초 뒤 두 번째 prepare(G2.2c §2 a). BG 관찰: 일어나지 않음(§3).
4. worker는 실제 `setTimeout`을 플러그인에 준다(`bgPluginWorker.cjs:726-728`). 그러나 RPC는 hook 호출 scope 안에서만 받는다. scope는 hook 호출이 끝나면 해제되고(`bgPluginSession.cjs:35-51`), 그 뒤의 호출은 `plugin_invocation_expired`로 거절되며 `plugin_late_call` 진단이 남는다(`bgPluginWorker.cjs:575-581,622-628`, `bgPluginHost.cjs:440-446`). hook callback은 peer를 거쳐 session `invoke`로 실행되고 호출이 끝나면 `finally`에서 scope가 해제된다(`bgPluginSession.cjs:41-51,59`). 오래 사는 비-hook scope는 없다. settlement는 진행 중 RPC만 `min(15초, 남은 수명/2)`까지 기다리고 timer는 기다리지 않는다(`bgPluginWorker.cjs:30,126-149`, 상한 계산 `:132`).
5. host 수명과 순서(`bgOrchestrator.cjs`): `_previewLock` 획득(434-438) → host 생성(667-684) → `sendChatWithDirectLifecycle`(971, afterRequest hook과 그 안의 RCM timer 예약이 이 안에서) → 결과 읽기(1004-1026) → finally에서 600초 timer 해제, host `close()`, lock 해제(1034-1038) → 그 뒤 작업 쪽에서 canonical commit(`commitGenerationResult`, 1696) → 결과 영속(1754) → terminal 상태. **host는 commit 전에 닫히고, lock은 host가 닫힌 뒤 풀린다.**
6. host가 읽는 상태: `getDatabase`·`getChatFromIndex`·`readDatabase`는 전역 `dbmod.getDatabase()`를 읽는다(`bgOrchestrator.cjs:668`, host `:143,:625,:641`). 선택(characterIndex/chatIndex)은 작업 closure다. 다른 작업은 lock을 얻은 뒤 `dbmod.setDatabase`(634, 782)로 전역 DB를 바꾼다. 따라서 lock 밖에서 열린 host는 다른 작업의 DB를 읽을 수 있다.
7. commit identity(`serverChatCommitOwner.cjs:771-805,858-868`): 입력 메시지(anchor.inputId), 답변 메시지들의 `chatId`, 저장 revision, before/after revision.
8. 시한·예산: session/sandbox 600초(`bgPluginSession.cjs:12`, sandbox별 별도 집행), 플러그인 `nativeFetch`·`risuFetch`·`runLLMModel` 128회(**host 전체 공유** counter, 검사 `bgPluginHost.cjs:37,115-119`, counter `:217,650`), 작업 600초 timer(`runServerPreview` 안에서 lock 획득 뒤·host 생성 전에 시작, `bgOrchestrator.cjs:448`, host close 전에 해제), unload 1초(`bgPluginHost.cjs:747-751`), settlement `min(15초, 남은 수명/2)`(네트워크·모델 호출과 stream pull은 일반 settlement에서 제외, `bgPluginWorker.cjs:504-505`), pending RPC 64(`bgPluginWorker.cjs:481,611`). 각각 출처가 다른 별도 한도이며 commit 뒤 새 한도가 생기지 않는다.
9. RCM timer 조건(Astra 확인): 일반 `model` beforeRequest가 `Kx`에서 요청마다 `crypto.randomUUID()`로 `mainGeneration.id`를 만들고, 준비 성공 시 `activeModelRequest.requestId`가 된다. afterRequest가 이를 대기 id로 잡고, timer cb는 대기 id가 같고 `mainGeneration`이 없거나 같은 id일 때 진행한다. 따라서 BG에서도 조건은 소스상 통과한다(실행 확인 필요). 이 id는 BG 작업 id나 저장된 답변 id가 아니다.
10. 완료 판정의 함정(Astra 확인): timer cb와 listener 모두 `DA`의 promise를 반환하지 않는다. `DA` 안의 `Zo`·`vI`도 기다리지 않는다. 따라서 callback 반환이나 worker idle은 동기화 완료의 증거가 아니다. `gc`는 500ms 뒤 heartbeat(서버 engine) 또는 15초 뒤 worker 작업(Risu engine)을 예약하고, 초기화는 15초 interval을 건다.
11. commit 결과(Astra 확인): commit owner가 생성 결과를 최신 canonical 채팅에 병합할 수 있어(`serverChatCommitOwner.cjs:905-920`), commit 전 `result.chat`은 최종 저장 snapshot이 아니다. commit 직후 상태 route는 `chat-committed`·취소 시 `already-committed`를 보고하고(`bgOrchestrator.cjs:2054-2070,2308-2319`), commit은 `readyForNextTurn: true`를 기록한다(`serverChatCommitOwner.cjs:902`). 동기화 창을 나타내는 상태는 없다.

## 구조 선택지

어느 안이든 공통으로 필요한 것: (i) commit 뒤까지 host를 닫지 않는다. (ii) 응답 뒤 timer callback이 호출할 수 있는 **유한 post-response scope**를 host가 연다(그 동안만 RPC 허용, 시한 뒤 `plugin_invocation_expired`). (iii) 시한은 원본 근거로 정한다: timer 1500ms + `DA` 앞의 context 읽기 + prepare 5000ms. 읽기 시간은 측정으로 정하고, 최댓값을 계획에 고정한다. (iv) 시한 안에 prepare 응답(2xx)을 관찰하지 못하면 결과를 "기억 동기화 불확실"로 알리고 닫는다(채팅 저장은 되돌리지 않는다).

| 안 | 내용 | 장점 | 비용·위험 |
|---|---|---|---|
| A. lock 유지 | commit을 lock 안으로 옮기거나 lock을 commit·동기화 끝까지 유지한다. 전역 DB에 commit된 채팅을 반영해 둔 채 post-response scope를 연다. | host가 읽는 상태가 이 작업의 저장 결과로 고정된다. 기존 host 읽기 경로를 바꾸지 않는다. | RCM이 켜진 작업마다 다른 BG 작업이 최대 시한(약 1.5+읽기+5초)만큼 더 기다린다. commit 위치 변경은 S4b·S4a 순서, 취소·충돌·재시작 분류에 닿는다. |
| B. 작업 소유 snapshot | lock은 지금처럼 풀고, commit 뒤 host의 DB 읽기를 전역 대신 **commit된 결과로 만든 작업 소유 snapshot**으로 바꾼 채 post-response scope를 연다. | 다른 작업을 막지 않는다. | host 읽기 경로(getDatabase·getChatFromIndex·hydrate·getCurrentLorebookEntries)를 snapshot으로 전환하는 새 구조가 필요하다. commit 뒤 다른 작업의 변경은 보이지 않는다(의도). 메모리 사용이 작업 수만큼 는다. |
| C. output listener | BG host에 `addRisuChatListener("output")`를 구현해 commit 뒤 저장된 메시지로 이벤트를 보낸다. RCM은 1500ms 없이 즉시 `DA`를 부른다. A 또는 B의 상태 고정이 함께 필요하다. | 저장 identity와 직접 연결된다(공통 경계 3). 대기 시간이 1500ms 줄어든다. | foreground 1.10에는 이 API가 없어 BG만 다른 원본 경로를 탄다(G2.2a capability 정확화와 parity 원칙에 영향). API 의미를 새로 정해야 한다. |

| D. commit 대기 continuation(Astra 제안, 실행 모델) | afterRequest 호출 중 worker의 timer wrapper가 등록한 one-shot timer의 출처(entry·phase·호출)를 기록한다. 그 timer는 원래 예정 시각과 canonical commit 성공이 **둘 다** 충족될 때 작업 소유의 별도 child scope에서 실행한다. commit된 snapshot에 묶고 절대 만료 시각을 둔다. | 원본의 1500ms 지연을 그대로 지키고, 고정 sleep·새 플러그인 API가 없다. commit이 1.5초보다 늦어도 commit 전 읽기·callback 유실이 없다. | timer 출처 추적과 완료 판정이 정밀해야 한다. A 또는 B의 상태 고정과 함께 쓴다. |

**검수 뒤 권고(Astra 1회차):** **D + A**로 첫 후보를 만든다. commit 정책은 S4b에 두고 host·lock 소유를 그 정책으로 넘기며(공유 `runServerPreview` 안으로 commit을 옮기지 않는다; S4a는 검증 결과를 보관하고 클라이언트 생성을 유지하는 다른 경로다), stream preview 표시 해제는 host 수명과 분리한다. 측정에서 다른 작업의 대기가 받아들일 수 없으면 D + B로 바꾼다. C는 capability parity를 따로 결정할 때만 검토한다.

## 계약 초안 (D + A)

1. **원래 hook 호출은 유한하게 둔다.** 그 token을 통째로 연장하지 않고, 해당 timer 작업에만 별도 child continuation을 만든다.
2. **출처 기록:** worker의 신뢰 가능한 timer wrapper가 `setTimeout` 시점의 entry·phase·호출을 기록한다. afterRequest phase의 one-shot만 대상이며, load 시점 timer·interval은 대상이 아니다.
3. **실행 조건:** 원래 예정 시각 이후이면서 canonical commit 성공 뒤에만 실행한다. `clearTimeout`을 존중하고, 일찍 실행하거나 commit 뒤 1.5초를 다시 세지 않는다.
4. **권한 범위:** child scope 안의 호출은 기존 identity·권한·예산 검사를 그대로 거친다. 채팅·context 읽기, 허용된 storage, backend 호출을 허용하고, 새 유료 모델 작업이나 모든 API를 자동으로 열지 않는다.
5. **만료 불연장:** child 안에서 예약된 하위 timer는 실행될 수 있지만 새 lease를 얻거나 만료를 늘리지 않는다. interval·idle 예약(`gc`, 15초 interval)은 작업을 연장하지 않는다.
6. **상태 고정(A):** lock을 commit·동기화 창이 끝날 때까지 유지하고, commit 성공 뒤 선택 채팅과 hydration snapshot을 **commit된 canonical 결과**로 갱신한 뒤 child를 연다(commit 전 `result.chat`을 쓰지 않는다).
7. **시한:** `continuation 시작 = max(원래 예정 시각, canonical snapshot 준비)`. 창의 예산은 `남은 timer 지연 + 읽기·처리 상한 Rmax + prepare 5000ms + 완료·게시 상한 Pmax`이며, 남은 작업·sandbox 수명으로 다시 제한한다. Rmax·Pmax는 측정으로 정하고 계획에 고정한다. commit·snapshot·정리 시간도 사용자에게 보이는 최대값에 포함한다.
8. **만료 시:** 새 continuation 호출 거절, scope와 진행 중 전송·응답 본문 읽기 중단, 대기 작업 거절, "채팅 저장됨, 기억 동기화 불확실"을 영속 기록(더 강한 증거가 없으면), 유한 unload·worker 종료. 채팅 receipt는 유지하고 prepare를 자동 재전송하지 않는다. 중단은 이미 backend가 커밋한 효과를 되돌리지 못하므로 시한 경합·응답 유실은 실패가 아니라 불확실이다.
9. **완료 판정:** callback 반환·worker idle·pending RPC 없음은 증거가 아니다. 해당 prepare 요청의 응답 본문 소비까지 관찰한다.
10. **영속 증거의 단계:** (a) 저장된 답변이 backend 원문 저장소에 들어감 = 실제 요청 본문의 저장 메시지 id·내용 hash 일치 + 검증된 응답(backend instance·revision) + backend 원문 readback, (b) 후속 추출 작업 접수 = 해당 job/batch identity, (c) N+1에서 쓸 수 있는 파생 기억 = backend 완료 상태와 N+1의 실제 주입. prepare 2xx만으로는 (a)도 증명하지 않는다(`deferExtraction:false`도 lineage·관리 상태·묶음 규칙으로 메시지를 보류할 수 있음).
11. **상태·재시작:** commit receipt에 묶인 동기화 intent/상태를 continuation 시작 전에 영속한다. 재시작 시 미해결 intent는 불확실로 바꾸고 플러그인·생성을 다시 실행하지 않는다. 같은 채팅의 다음 작업(N+1)은 동기화가 끝나거나 만료될 때까지 busy로 둔다(`bgOrchestrationRunRegistry.cjs:88-100,138-140`과 receipt 기반 준비 상태 모두).
12. **취소:** commit 전 취소는 지금 의미 그대로다. commit 뒤 취소는 남은 대기·동기화를 멈출 수 있지만 저장된 채팅을 되돌리거나 backend 효과가 없었다고 하지 않는다.
13. **다른 플러그인:** host 종료가 늦어지면 같은 작업의 다른 worker도 그만큼 살아 있다. entry별로 continuation이 없는 플러그인은 commit 뒤 먼저 내리거나, 그렇지 않다면 바뀐 수명과 영향을 측정해 기록한다. MARP·PageFold의 timeout·protocol·정리 timer는 기존 의미를 유지한다.

## 사용자 결정이 필요한 것

1. **continuation 계약의 적용 범위:** (a) 모든 플러그인의 afterRequest one-shot timer에 같은 유한 계약을 적용하는 호스트 공통 계약, 또는 (b) 사용자가 플러그인별로 켜는 설정. 플러그인 이름·1500ms 지연·endpoint 문자열로 RCM을 골라내는 분기는 선택지에서 제외한다. **결정(2026-10-22): (a) 호스트 공통 계약.** MARP·PageFold timer 의미 보존은 측정 8번의 혼합 실행으로 검증한다.
2. **구조(A/B):** 아래 측정 5번의 대기 증가를 본 뒤 결정한다.

## 결정 전 측정

1. timer 등록 → 예정 시각 → canonical commit → callback 진입 → context 읽기 완료 → prepare 응답 본문 완료 → 동기화 결과 영속 → host 종료의 시각.
2. commit을 1.5초보다 늦게 만든 경우: commit 전 읽기 없음, callback 유실 없음.
3. 저장된 메시지 id·본문·revision과 실제 prepare 본문의 일치(anchor 병합, 부분 출력, 편집·삭제, 충돌).
4. 큰 채팅의 hydration·hash 시간, IPC 부하, 네트워크 예산 거의 소진, 600초 수명 거의 소진.
5. A에서 두 채팅 연속 작업의 두 번째 작업 시작 지연, 모든 안에서 같은 채팅 N+1 준비 시점.
6. 접수 뒤 backend readback·재시작, backend commit 전후 연결 끊김, 느린 응답 본문.
7. 각 경계에서 취소·초기화·재시작: 저장된 채팅 보존, 미해결 동기화는 재실행 없이 불확실로 보고.
8. RCM·MARP·PageFold 혼합 실행: 낡은 등록 정리 없음, idle·interval 연장 없음, continuation 때문에 새 유료 작업 없음.

## 결정 전 측정 결과 (2026-10-22, 시제품 없이 잰 항목)

validation-runner, 조립 트리(patcher `d476d60`), 원본 RCM 1.0.21과 실제 backend, 가짜 provider, 합성 데이터. 값은 최소/중앙/최대(ms).

- **M1 답변 뒤 순서**(채팅 10·200·2000 메시지, 각 5회): afterRequest hook 반환 뒤 host close 종료 21/23/36·22/35/43·44/67/104, canonical commit 종료 42/45/57·56/77/94·169/217/261. **15회 중 commit이 afterRequest 뒤 1.5초보다 늦은 경우는 0회**. afterRequest 반환 뒤 API 호출 0회, `plugin_late_call` 0(timer는 소스상 예약되지만 host 종료로 실행되지 않음). BG prepare 왕복 15/16/47·20/32/122·38/53/90.
- **M2 DA 재읽기 RPC 비용**(DA와 같은 호출 순서를 worker 쪽 합성 플러그인으로 실행, 9개 조합×10회): 합계 10 메시지 15~66, 200 메시지 17~71, 2000 메시지 130~268(캐릭터 1·20·100개). `getDatabase`가 캐릭터 수에 비례(2000 메시지·100 캐릭터 92ms, 1.08MB). 한도 오류 0. RCM 자체 worker CPU(메시지별 hash·정규화)는 재지 못했다 — beforeRequest hook 시간(2000 메시지 약 1.5~2.1초)으로 보아 클 수 있다(추론).
- **M3 prepare(`deferExtraction:false`)**: 10 메시지 11.1, 200 메시지 18.6, 2000 메시지 14.3(RCM은 256개 초과 시 끝 약 64개만 보냄; 전체를 보낼 때 상한 69.5). 첫 호출은 63~535.
- **M4 현재 대기 기준**: 첫 작업이 3초 생성하는 동안 보낸 두 번째 작업은 첫 작업 lock 해제까지 약 3.0초 대기, lock 인계 약 48ms.
- **A안 추정**: RCM 턴마다 lock이 지금보다 약 1.51~1.69초 더 잡힌다(대부분 원본 1500ms timer; commit은 그 안에 끝남) + 재지 못한 RCM DA CPU. 다른 BG 작업의 대기가 그만큼 는다(합산 추론).
- **미측정**: commit을 1.5초보다 늦춘 경우(측정 2), RCM DA CPU, 2000 메시지 초과, 측정 3·6·7·8(시제품 필요).

**구조 결정(2026-10-22): A(lock 유지) + D(commit 대기 continuation).** 위 측정의 대기 증가(RCM 턴마다 다른 BG 작업 약 1.5~1.8초 + 미측정 RCM CPU)를 감수한다.

## 구현 계획 (D + A, 검수 전 초안)

단위(한 commit 또는 아래 순서의 작은 commit들, 블라인드 테스트는 한 번에 요청):

| ID | 제목 |
|---|---|
| D3-1 | Post-commit continuation for afterRequest timers |

변경 지점:

1. **worker timer 출처(`bgPluginWorker.cjs`):** 플러그인 context의 `setTimeout`/`clearTimeout`을 신뢰 wrapper로 바꾼다. afterRequest 호출 scope 안에서 만든 one-shot timer만 "continuation 후보"로 기록(entry, 호출 token, 예정 시각)하고, 그 timer의 callback을 바로 실행하지 않고 host가 continuation을 열 때까지 보류한다. load 시점 timer, interval, 다른 phase의 timer는 지금과 같다(만료된 scope로 실행되고 호출은 거절). 후보 timer는 `clearTimeout`을 존중한다.
2. **child scope(`bgPluginSession.cjs`):** host가 여는 유한 continuation scope를 추가한다. 절대 만료 시각을 가지며, 그 안의 호출은 기존 identity·권한·예산 검사를 그대로 거친다. 만료 시 scope를 abort하고 이후 호출은 `plugin_invocation_expired`다. continuation 안에서 만든 하위 timer는 실행될 수 있으나 만료를 늘리지 않는다.
3. **host(`bgPluginHost.cjs`):** `openPostResponse({ deadline })`를 추가한다. 후보 timer가 있는 entry에만 child scope를 열고, 보류된 callback을 `max(원래 예정 시각, 지금)`에 실행한다. 완료 판정은 child scope에서 시작한 RPC(응답 본문 소비 포함)가 모두 정산되고 남은 후보 timer가 없을 때이며, callback 반환이나 worker idle은 증거로 쓰지 않는다. 시한에 끝나지 않으면 진행 중 전송과 본문 읽기를 중단하고 `uncertain` 결과를 돌려준다. continuation이 없는 entry는 commit 뒤 바로 정리한다.
4. **수명과 lock(`patches/lazy-chat-bg-adapter/plugin-host-units.cjs`가 넣는 `bgOrchestrator.cjs` 단위):** 지금의 `host-finally`(host close → lock 해제)를 바꿔, full mode S4b에서는 `runServerPreview`가 host와 lock을 닫지 않고 lease로 넘긴다. S4b는 canonical commit이 성공한 뒤 ① 선택 채팅을 commit된 canonical 결과로 전역 DB에 반영하고 ② `openPostResponse`를 시한 안에서 기다린 뒤 ③ host close → lock 해제한다. commit 실패·취소·`BG_ASSEMBLY_CONFLICT`·D1-a 실패·S4a 경로·lease를 받을 수 없는 경로에서는 지금처럼 즉시 close·해제한다. stream preview 표시 해제는 지금 위치(생성 종료 시)를 유지한다.
5. **상태·재시작:** continuation을 열기 전에 commit receipt에 묶인 동기화 intent를 영속하고, 결과(완료·불확실)를 기록한다. 재시작 시 남은 intent는 불확실로 바꾸고 플러그인·생성을 다시 실행하지 않는다. 같은 채팅의 다음 작업은 동기화가 끝나거나 만료될 때까지 busy다. 불확실은 플러그인 알림(새 코드, 예: `plugin_post_response_uncertain`)으로 남긴다.
6. **시한:** 절대 상한을 상수로 둔다. 근거: 원본 timer 1500ms + DA 읽기(측정 M2 최대 약 0.27초, RCM CPU 미측정 — 2000 메시지에서 1~2초 추정) + RCM prepare 자체 timeout 5000ms. 상한 후보 값은 검수 뒤 사용자 결정으로 정한다. 남은 작업 600초·sandbox 수명과 host 공유 128회 예산을 넘지 않는다.
7. **취소:** commit 전 취소는 지금과 같다. continuation 중 사용자 중지는 남은 동기화를 멈추고 불확실로 기록하며, 저장된 채팅을 되돌리지 않는다.

합격 기준(초안, 아래 「테스트 계약 표」가 기준 단위의 정본): 측정 1~8 항목을 시험으로 바꾼다 — 원본 RCM에서 BG 답변 뒤 두 번째 prepare가 commit 뒤에 실행되고 그 본문의 메시지 id·내용이 저장된 답변과 일치하며 backend 원문 readback으로 확인; commit을 1.5초보다 늦춰도 commit 전 읽기·callback 유실 없음; 시한·취소·재시작에서 불확실 기록·재실행 없음·채팅 보존; 같은 채팅 N+1 busy; 다른 채팅 대기 증가가 측정 범위 안; MARP·PageFold·D1-a·G2.2b·NaN 단위 동작 불변; continuation이 없는 플러그인의 수명 불변.

## 구현 계획 검수 기록과 결정 (2026-10-22)

**Astra(gpt-6-astra, read-only) 2회차(구현 계획):** D + A는 실현 가능하나 수정 필요. 지적을 모두 채택했다. 오케스트레이터가 직접 확인한 근거: commit된 작업은 취소 route가 `already-committed`로 바로 돌려보냄(`bgOrchestrator.cjs:2311-2319`), `runLLMModel`은 일반 scope와 128회만 확인(`bgPluginHost.cjs:117-127`).

1. **timer 출처:** worker는 지금 호출 token만 가진다(`bgPluginWorker.cjs:733-734`). host가 아는 phase를 parent가 인증한 호출 metadata로 worker에 보내고, 한도 있는 timer registry를 둔다. `entry.lastPhase`로 추정하지 않는다. bare 전역과 `window`가 같은 wrapper를 쓰고, worker 내부 RPC timeout·settlement timer는 후보에 넣지 않는다. `clearTimeout`은 예약된 handle과 commit 관문에서 기다리는 callback 모두를 지우고 완료 판정을 깨운다. 인자·지연 정규화·같은 시각 timer의 순서를 보존한다. 후보 자격은 hook 완료 시점에 봉인한다.
2. **child scope:** session `find`는 존재·중지·작업 abort만 보고 마감·scope abort를 보지 않으며(`bgPluginSession.cjs:30`), `release`는 참조 0에서 지운다(`:35`). child에는 소유자 유지, 모든 dispatch·재개에서의 마감 확인, 참조와 무관한 종료 취소가 필요하다.
3. **완료 판정:** 기존 settlement는 network·model RPC와 stream pull을 제외한다(`bgPluginWorker.cjs:504-505`). child 안의 network RPC, 응답 본문 소유(EOF·오류·취소까지), 진행 중 callback과 반환 promise를 추적하고 promise 반응이 다음 호출을 낼 기회를 준 뒤 판정한다. 이는 "전송 정지(drained)" 판정이며 동기화 성공 증명이 아니다(RCM `DA`는 prepare 오류를 잡아 삼키고 `Zo`·`vI`를 기다리지 않음).
4. **lease:** host·lock에 더해 작업 timeout·abort 전달·refresh·정확히 한 번의 정리 소유를 넘긴다. S4b 바깥 `finally`가 정리하고, 정리는 promise로 memoize한다(`host.close()`는 들어갈 때만 `closed`를 확인, `bgPluginHost.cjs:740-756`). 경로별 처리: preview가 넘길 결과 전에 throw → 기존 finally; 결과 반환 뒤 commit 전 취소 → S4b가 이미 소유; 답변 없음·commit 충돌·실패·취소 결과 → 즉시 정리; 부분 출력은 실제로 commit될 때만 continuation; commit 중 취소·초기화 → commit 결과를 기다린 뒤 receipt로 판단, 재실행 없음; commit 뒤 snapshot 실패·continuation·알림 오류 → 채팅 성공 유지, 불확실, 정리(바깥 catch의 generation 실패 게시로 가지 않게 commit 사실을 바깥으로 끌어올림); S4a는 넘기지 않음(`:1912-1916`); 자격은 host 적격·canonical commit 소유·명시적 lease 수락으로 판단(`inputCommandVersion`이 아님); stream preview 해제는 지금 위치를 지키되 실패가 정리를 막지 않게 한다. 정리를 마치지 않은 host를 두고 lock을 먼저 풀지 않는다.
5. **commit된 채팅:** 공개 commit 결과에는 채팅이 없다(`serverChatCommit.cjs:910-918`). commit owner가 storage 작업 안에서 만든 내부 snapshot(앵커 해석 뒤 채팅, receipt의 `storedRevision`으로 검증)을 돌려받아 선택 채팅과 hydration snapshot을 함께 갱신한다. `status: 'committed'`여도 게시가 `pending_recovery`일 수 있으므로(`serverChatCommit.cjs:1208-1227`) 검증된 snapshot이 없으면 불확실로 닫는다.
6. **영속 의무:** 동기화 의무를 commit 거래(`serverChatCommit.cjs:1152-1185`) 안에서 함께 기록한다(작업·storage epoch·receipt·revision·참여 entry). 연결 지점: 작업 저장 필드 목록(`bgOrchestrationOperationStore.cjs:61-108`), 시작 시 복구(`serverChatCommitOwner.recoverAll` 옆), registry `running` 유지(`hasChatRun`), receipt 준비 상태(`readyForNextTurn`), 서버 입력 predecessor 진행, drain은 대기 중 `waiting`(409로 명령을 잃지 않게), 상태·취소 route, 보존·초기화의 epoch fence.
7. **취소:** commit 뒤에는 취소 route가 지금 바로 돌려보내므로, 저장 receipt를 유지하면서 활성 동기화 창을 취소하는 경로를 추가한다.
8. **다른 플러그인 수명:** continuation 후보가 없는 entry는 hand-over(생성 종료) 시점에 닫아 수명을 지금과 같게 한다. entry별 close는 등록 정리도 함께 한다.

**사용자 결정(2026-10-22):**
- 시한 상한: **continuation은 commit된 채팅 반영 시점부터 10초**(`deadline = min(snapshotReady + 10s, 작업 마감, entry sandbox 마감)`, timer·RPC·entry마다 다시 세지 않음). 임시 정책 상한이며 실측으로 다시 조정한다. commit 전 준비와 뒤의 정리 시간은 별도다.
- 대상 timer: **afterRequest 안에서 걸렸고 hook이 끝날 때 아직 대기 중인 1회성 timer만** commit 뒤로 넘긴다. hook 안에서 기다리는 timer는 지금처럼 바로 실행된다. 동기화 중 새로 걸린 하위 timer는 같은 시한 안에서 실행될 수 있으나 창을 늘리지 않는다.
- 결과 표시: **불확실일 때만 알림.** 정상 종료는 상태에 "전송 정지"로만 기록하고 "기억 저장됨"을 주장하지 않는다. 시한·취소·오류로 끝나면 "답변 뒤 플러그인 동기화가 확인되지 않음" 알림을 남긴다.
- 유료 호출: **동기화 창 안에서는 host 모델 API(`runLLMModel`)를 거절**한다. 플러그인 자기 backend로 가는 HTTP는 기존 검사대로 허용한다.

**측정이 더 필요한 것(구현 전 또는 시제품과 함께):** DA의 RCM CPU(비동기 틈 포함), 2000 메시지 초과·cold hydration·혼합 플러그인·CPU 경합, commit·snapshot이 1.5초를 넘는 경우, 느린·분할·읽지 않은 본문과 abort 응답, 알림 영속·worker 종료 시간, 예산이 거의 바닥난 경우.

**구현 순서(검수 권고):** ① timer 자격·하위 timer·완료 용어(위 결정) ② 영속 의무·준비 상태·복구 ③ 정확히 한 번의 lease 이전·정리 ④ commit snapshot 획득·갱신 ⑤ timer 출처·child scope·본문 인식 settlement ⑥ 취소·상태·알림·상한 ⑦ 저장소 조립 시험, worker/session/host/settlement·combination probe, 원본 RCM·backend 수용 측정.

## 테스트 요청 전 확정 (2026-10-25)

테스트가 고정할 인터페이스와 결과 모양을 정한다. 코드 사실은 patcher `18d5113`(D2 포함) 조립 트리 기준이며, 2026-10-22 인용(`d476d60`)과 줄 번호가 다르다. 이 절과 테스트 계약 표가 다르면 이 절을 따른다.

### 현재 코드 사실

| 사실 | 출처 |
|---|---|
| 플러그인 context의 `setTimeout`·`clearTimeout`은 host realm 함수 그대로이고, `window`·`self`는 `globalThis`라 bare 전역과 `window.setTimeout`이 같은 함수다 | `bgPluginWorker.cjs:737,739` |
| worker의 호출 token은 frame의 `context`이며 AsyncLocalStorage로 전파된다. phase 정보는 없다 | `bgPluginWorker.cjs:633,646,698,744-745` |
| settlement 상한 15초, callback 시작부터 센 남은 callback 시한의 절반 이하(sandbox 절대 수명이 아님). `nativeFetch`·`risuFetch`·`runLLMModel`·`_pull`·`_cancel`은 settlement에서 제외된다 | `bgPluginWorker.cjs:30,130-132,515-516,540` |
| worker→parent 호출 frame은 `{kind,id,method,args,context}`이고 phase 필드가 없다. parent는 자기 scope 기록으로 token을 검증한다 | `bgPluginWorker.cjs:522`, `bgPluginSession.cjs:32` |
| `after_request` kind는 afterRequest replacer뿐 아니라 input이 아닌 script handler(`editoutput` 등)에도 붙는다 | `bgPluginHost.cjs:680-683` |
| session API의 `runtimeMs`는 설정 가능(기본 600000)하지만 host는 값을 넘기지 않아 실제로는 600초다. 시계는 `performance.now()`뿐이다. `find`는 scope 부재·중지·작업 abort만 보고 scope abort나 경과 시한을 보지 않는다. scope는 참조 0·abort·수명 마감·session 명시 close·치명 실패로 끝난다. sandbox `runtimeMs`와 session `runtimeDeadline`은 따로 계산된다 | `bgPluginSession.cjs:12,21,24-30,32-42,116,118-124`, `bgPluginHost.cjs:774-778` |
| host 공유 network counter는 host당 128회 | `bgPluginHost.cjs:37,125,234,638,772` |
| `host.close()`는 unload 1초 경합 → absent 수집 → entry abort → `closed` → session close → 요약 게시 순서다. `closed`를 끝에서 세우므로 순차 재호출만 막고 동시 호출은 정리를 중복할 수 있다 | `bgPluginHost.cjs:862-884` |
| afterRequest는 `replacerafterRequest`에 `after_request` kind로 등록되고 `request.ts:351-352`가 호출한다 | `bgPluginHost.cjs:681-685` |
| 작업 lock은 `_previewLock`이고 host-finally에서 `pluginHost.close()` 뒤 `release()`한다. 작업 시한은 lock을 얻은 뒤 건 600초 `llmTimer`뿐이며 deadline 필드는 없다 | `bgOrchestrator.cjs:427,434-438,445-448,1036-1043` |
| S4b의 `commitGenerationResult` 성공 결과는 `{status, reason, receipt, reused, publication?, publicationErrors?}`이고 채팅이 없다. 앵커 병합된 채팅은 `normalized.chat`에 있고 journal 준비와 `publishCanonicalState`에 전달된다. replay는 그 전에 반환한다. S4b는 이 결과 객체를 그대로 결과 저장에 넘기고, 저장된 값은 결과 route로 나간다 | `bgOrchestrator.cjs:128,164,1699-1719,1775`, `serverChatCommit.cjs:910-919,1023,1034,1055,1064,1216`, `serverChatCommitOwner.cjs:931` |
| 작업 상태 행(`bg-orch-state-op:`)은 commit 거래 밖에서도 다시 쓰인다(결과 ACK는 메모리 run 정보로 행 전체를 다시 씀). 저장소 초기화는 이 prefix와 결과 prefix를 지운다 | `bgOrchestrator.cjs:2570-2586`, `bgOrchestrationOperationStore.cjs:7,61-108`, `server.cjs:709-713` |
| 저장된 canonical 채팅은 다시 읽어 `calculateRevision(chat)`(owner의 `chatRevision`)으로 `storedRevision`과 비교할 수 있다. 복구 경로가 같은 방식으로 검증한다 | `serverChatCommit.cjs:1035,1280-1298`, `serverChatCommitOwner.cjs:474,1188-1189` |
| 서버 입력 commit은 같은 거래에서 입력을 `completed`로 정산하므로, 그 뒤 같은 채팅 N+1 입력은 선행 대기(`waiting`) 없이 접수되고 실행만 작업 lock을 기다린다 | `serverChatCommitOwner.cjs:496-502`, `serverChatInputOwner.cjs:801-806`, `server.cjs:8320-8321` |
| commit 거래는 `writeCommittedOperationState`로 작업 상태(`state:'chat-committed'`, `commitReceiptId`, `storedRevision`)를 같은 SQLite 거래에서 쓴다 | `serverChatCommit.cjs:1078-1194,1152`, `serverChatCommitOwner.cjs:467,525-528` |
| 시작 시 복구는 `reconcileServerChatRecovery` → `serverChatCommitOwner.recoverAll()`이다. 작업 상태의 orphan 분류(`orphanedOperationState`)는 시작 시 일괄 처리가 아니라 상태·목록 route에서 읽을 때 적용된다 | `server.cjs:8574`, `serverChatCommitOwner.cjs:346-393`, `bgOrchestrationOperationStore.cjs:121-131`, `bgOrchestrator.cjs:2206,2489` |
| 작업 run의 `finish()`는 S4b `finally`에서 호출되고, 같은 채팅 busy(activity route)는 `hasChatRun`(run `running`), `hasPendingGeneration`, 실행 중 main job으로 판정한다 | `bgOrchestrator.cjs:1890-1896,2224-2225`, `bgOrchestrationRunRegistry.cjs:138-141` |
| `readyForNextTurn`은 서버 commit record의 필드이며 client 코드(`src/ts`, 시험 제외)는 읽지 않는다 | `serverChatCommit.cjs:797,1122`, `serverChatCommitOwner.cjs:902` |
| 알림 코드는 `CODES` 허용 목록, plugin 알림은 `pluginName`·`pluginVersion`·허용된 `phase`가 필요하다. `reason`은 지정된 코드에서만 보존된다. 중복은 `[operationId, eventKey]`로 막고, 같은 키에 내용이 다르면 `conflict`다. client도 같은 코드·phase·reason 목록으로 검증하고 코드별 문구를 표시한다 | `bgNotifications.cjs:14-16,33-34,37-75,143-144`, `src/ts/bgNotifications.ts:3,20-28,50-60,108` |
| worker의 `_callback`은 plugin callback을 await한 뒤 `settleContext`(최대 settlement 예산)를 기다리고 나서 반환한다 | `bgPluginWorker.cjs:537-546` |
| S4b는 `deps.runServerPreview`가 있으면 그것을 쓰고(시험 주입 지점), `runServerPreview`의 `finally`가 stream preview 해제 → host close → lock 해제를 한다. hydration snapshot(`pluginChatSnapshot`)과 시한 timer는 이 함수의 지역 변수다 | `bgOrchestrator.cjs:640-647,1028-1043,1088-1090` |
| 알림은 코드·phase별 버전(1~4)을 가지며 그보다 낮은 claim 버전의 client는 받지 않는다. `publish`는 `stored`·`duplicate`·`conflict`·`expired`(48시간 TTL)·`capacity`를 돌려준다 | `bgNotifications.cjs:23-28,136-150` |
| host 시험은 `bgPluginHost.cjs` 원문을 `Module._compile`로 다시 컴파일해 `__test`를 노출하고 `bgPluginSession.cjs` require를 harness로 바꾼다. 실제 worker 시험은 `scripts/probe-bg-plugin-host.cjs`다(시간은 sandbox `runtimeMs`만 줄일 수 있고, 들어오는 frame을 바꾸거나 붙잡을 수 있음) | `bgCurrentLorebookEntries.test.ts:48-57,97-107,288-314`, `scripts/probe-bg-plugin-host.cjs:9-23,66` |

### 고정하는 인터페이스

(Astra 3회차 검수 반영, 아래 「검수 기록」 3회차 참조.)

1. **자격의 출처(parent 소유):** 자격은 host가 정한다. host의 `invoke` wrapper는 `contract === 'replacer' && kind === 'after_request'`(afterRequest replacer)인 호출에만 자격을 준다. 같은 kind를 쓰는 script handler(`editoutput` 등)와 다른 모든 호출은 자격이 없다. 이 판정은 BG 작업에서만 하며 foreground에는 이 경로가 없다.
2. **session 프로토콜:** session(entry당 하나)에 다음을 추가한다.
   - `session.runPostResponseEligible(task)`: `task` 안에서 시작되는 worker callback 호출의 parent 호출 scope 기록에 `postResponse: true`를 남기고, 그 호출의 `call` frame에 `postResponse: true` 필드를 붙인다. worker가 보낸 값으로 자격을 정하지 않는다.
   - worker는 `postResponse: true` frame의 `_callback` 호출 context에서 wrapper로 만든 one-shot timer를 추적한다. **plugin callback의 반환값(또는 반환 promise)이 정해진 직후, `settleContext`보다 먼저** 아직 대기 중인 timer를 봉인한다(`bgPluginWorker.cjs:542-543` 사이). callback이 거부(throw)되면 봉인하지 않는다(그 timer는 지금처럼 만료 scope로 실행). 봉인된 timer는 원래 예정 시각에 울려도 callback을 실행하지 않고 보류한다. 봉인 상한은 entry당 `POST_RESPONSE_TIMER_LIMIT = 16`(export해 시험에서 읽음)이며 초과분은 봉인하지 않는다. `clearTimeout`은 봉인 여부와 무관하게 timer와 보류 callback을 지운다.
   - `session.postResponseCandidates()` → `Promise<number>`: parent가 worker에 예약 method(`_postResponseCount`, `ABSENT_API_PULL`과 같은 parent 개시 호출)로 물어 지금 봉인되어 남은 수를 받는다. 봉인 뒤 다른 callback이 지운 것은 이 시점의 값에 반영된다.
   - `session.openPostResponse({ deadline, signal })` → `Promise<PostResponseResult>`: parent가 child scope token을 만들고(소유 entry, 절대 시한 `min(deadline, 이 session의 runtimeDeadline)`. `find`·dispatch·재개마다 시한과 child abort를 확인), worker에 새 frame `{kind:'post_response_open', context:<child token>}`를 보낸다. worker는 보류 callback을 `max(원래 예정 시각, 지금)`에 그 context로 실행한다. 창 안에서 새로 건 timer도 같은 context를 받는다. 남은 timer, child context의 미정산 RPC(network RPC는 응답 본문 EOF·오류·취소까지), 실행 중 callback이 모두 없고 microtask·macrotask 한 바퀴 뒤에도 그대로이면 worker가 `{kind:'post_response_drained', context, ran:<실행한 보류 callback 수>}`를 보낸다. `ran === 0`(열 때 이미 모두 지워짐)이면 결과는 `none`, 아니면 `drained`. 시한이나 `signal`에 닿으면 parent가 child scope를 abort하고(진행 중 전송·본문 읽기 중단) `{kind:'post_response_close', context}`를 보낸다. session이 열기 전이나 창 중에 실패·종료하면 `uncertain/error`. 이미 abort된 `signal`은 즉시 `uncertain/aborted`.
   - **읽지 않은 응답 본문 (사용자 결정, 2026-10-26):** 창 context의 응답 본문은 plugin이 읽지 않아도 EOF·오류·취소까지 창을 붙잡는다. 끝내 읽지 않은 본문은 시한까지 남아 `uncertain/deadline`이 되고, 그 본문은 시한에서 중단된다. 읽지 않은 본문을 버려진 것으로 보고 `drained`로 끝내는 해석은 택하지 않는다.
   - `PostResponseResult` = `{status:'none'}` | `{status:'drained'}` | `{status:'uncertain', reason:'deadline'|'aborted'|'error'}`. 이 promise는 거부하지 않는다. 시한과 abort가 같은 검사에서 함께 보이면 `aborted`다.
3. **host:** 다음을 추가한다.
   - `host.handOver()` → `Promise<{ participants: [{ index, pluginName, pluginVersion }] }>`(memoize, 두 번째 호출은 같은 promise). 생성 종료 시점(commit 전)에 호출한다. 실패하지 않은 entry마다 `session.postResponseCandidates()`가 1 이상이면 참여자다. 참여자가 아닌 entry를 닫고 등록을 해제한 뒤(C12, 결정 8) 그 정리가 끝나야 resolve한다. 조회 실패한 entry는 참여자가 아니며 닫는다.
   - `host.openPostResponse({ deadline, signal })` → `Promise<PostResponseResult>`: `handOver()`가 끝난 뒤에만 유효하다(그 전 호출은 `uncertain/error`). 참여자가 없으면 `signal`과 무관하게 즉시 `none`. 아니면 참여자 session의 `openPostResponse`를 같은 `deadline`으로 병렬 실행하고 합친다: 하나라도 uncertain이면 uncertain(reason은 처음 관측된 것), 아니면 하나라도 drained이면 drained, 모두 none이면 none. 처음 호출이 결과를 정하고 그 뒤 호출은 close 여부와 무관하게 같은 promise를 돌려준다. 한 번도 열지 않은 채 close된 뒤의 첫 호출은 참여자가 있으면 `uncertain/aborted`.
   - `host.close()`: 정리를 promise로 memoize해 동시 호출이 같은 정리를 기다린다. 열린 창이 있으면 그 창을 `uncertain/aborted`로 끝낸 뒤 기존 순서를 따른다.
4. **lease 이전(`runServerPreview` ↔ S4b):**
   - S4b는 `control.acceptPostResponseLease = true`를 넘긴다(S4a·llm·assemble 호출은 넘기지 않음).
   - full mode에서 생성이 끝나면 `runServerPreview`가 `await pluginHost.handOver()`를 부른다. 참여자가 있고 결과를 정상 반환하는 경로이면 `finally`에서 host close·lock 해제를 하지 않고, 반환 결과에 `postResponseLease`를 붙인다. stream preview 해제와 `llmTimer` 해제는 지금 위치(`finally`)에서 한다. 참여자가 없거나 lease 전에 throw하면 지금처럼 `finally`가 정리한다.
   - `postResponseLease` = `{ participants, lockAcquiredAt, reflectCommittedChat(chat), open({ deadline, signal }), release() }`.
     - `lockAcquiredAt`: lock을 얻은 직후의 `performance.now()`(지금 `llmTimer`를 거는 시점).
     - `reflectCommittedChat(chat)`: 넘긴 채팅을 작업 DB의 선택 채팅과 `pluginChatSnapshot`에 반영하고 그 시각(`snapshotReady`)을 돌려준다.
     - `open`: `pluginHost.openPostResponse`를 그대로 부른다.
     - `release()` → `Promise<void>`(memoize): host close 뒤 lock 해제. 한 번만 실제로 실행된다.
   - 결과 저장·결과 route로 가는 값에는 `postResponseLease`를 넣지 않는다(S4b가 결과 객체에서 떼어 낸 뒤 저장).
5. **orchestrator(S4b) 순서:**
   1. `runDetachedServerPreview(..., control)` 반환. lease가 있으면 run 기록에 `postResponseAbort`(AbortController)를 둔다.
   2. canonical commit(6의 의무 포함).
   3. commit이 `status:'committed'`이면 `readCommittedChat(receipt)`(7)로 채팅을 읽어 `lease.reflectCommittedChat`. 읽기 결과가 `null`이면 창을 열지 않고 `uncertain/error`.
   4. `lease.open({ deadline: min(snapshotReady + POST_RESPONSE_WINDOW_MS, lockAcquiredAt + 600000), signal: postResponseAbort.signal })`. `POST_RESPONSE_WINDOW_MS = 10000`.
   5. 결과를 6의 의무 기록과 8의 알림으로 남긴다.
   6. `await lease.release()` → run `finish()`.
   - **작업 결과 공개 시점 (사용자 결정, 2026-10-25):** commit된 작업 결과(`terminal-success` 등 결과 route가 돌려주는 최종 결과)는 동기화 창을 열기 **전에** 지금과 같은 시점에 저장·공개한다. 답변 확정은 창 때문에 늦어지지 않는다. 창 동안에는 run `finish()` 전이므로 activity route가 busy이고, 같은 채팅 N+1은 11대로 lock에서 기다린다. 창이 열려 있는 동안의 결과 ACK도 지금처럼 동작해야 한다.
   commit이 committed가 아니면(실패·충돌·취소·답변 없음) 창 없이 `lease.release()`. commit 뒤 단계(3~5)의 예외는 채팅 성공을 유지하고 `uncertain/error`로 닫으며 generation 실패를 게시하지 않는다. 어떤 경로든 `lease.release()`는 S4b의 바깥 `finally`에서 반드시 기다린다.
6. **동기화 의무 기록:** 작업 상태 행과 분리된 새 KV 키 `bg-post-response-sync:<operationId>`를 쓴다(작업 상태 행은 ACK 등이 commit 거래 밖에서 통째로 다시 쓰므로 사용하지 않음).
   - 전달: S4b가 `commitGenerationResult({ ..., postResponseSync: { entries } })`로 넘기고, owner가 commit 요청에 그대로 실어 `serverChatCommit`의 거래 안에서 `writeCommittedOperationState` 다음에 owner의 새 callback `writePostResponseSync(record)`를 부른다. 같은 SQLite 거래다.
   - 기록: `{ version:1, operationId, charId, chatId, receiptId: receipt.commitReceiptId, storedRevision, storageEpoch, createdAt, entries, state:'pending' }`. `createdAt`은 이때 한 번 정한다.
   - replay(`reused`)는 기록을 새로 만들거나 되돌리지 않는다. 이미 있는 기록을 그대로 둔다.
   - 결과 확정은 동기 조건부 갱신이다: 현재 값을 읽어 `state === 'pending'`이고 `receiptId`·`storageEpoch`가 같을 때만 쓴다. 조건이 맞지 않으면 쓰지 않는다(초기화·보존 정리 뒤 되살리지 않음).
     - `drained`·`none`: `state`를 그 값으로.
     - `uncertain`: `state:'uncertain'`, `reason`, `notices: { [index]: 'pending' }`(참여 entry마다)를 **알림 게시 전에** 한 번에 쓴다. 이후 entry별로 8의 알림을 게시하고 결과에 따라 `notices[index]`를 `'published'`(`stored`·`duplicate`) 또는 `'failed'`(`conflict`·`expired`·`capacity`, 재시도하지 않음)로 조건부 갱신한다.
   - 저장소 초기화는 이 prefix도 지우고(`server.cjs:709-713`과 같은 위치), 작업 상태 보존 정리도 같은 작업의 이 키를 함께 지운다.
7. **commit 채팅 읽기:** commit owner에 동기 함수 `readCommittedChat(receipt)`를 추가한다. 저장된 canonical 채팅을 읽어 그 revision이 `receipt.storedRevision`과 같을 때만 분리된 사본(`structuredClone`)을 돌려주고, 아니면 `null`. `commitGenerationResult`의 반환 객체에는 채팅을 넣지 않는다(결과 저장·결과 route로 새지 않게, `bgOrchestrator.cjs:128,164,1775`). replay(`reused`)와 `pending_recovery`도 같은 읽기로 판단한다.
8. **알림:** 새 코드 `plugin_post_response_uncertain`, phase `post_response`.
   - 서버 `bgNotifications.cjs`와 client `src/ts/bgNotifications.ts`의 코드·phase 목록에 추가하고, 이 코드의 `reason`을 `'deadline' | 'aborted' | 'error' | 'restart'`로 검증·보존한다.
   - 버전: 이 코드는 알림 버전 5다. client의 claim 버전을 5로 올린다. 버전 4 이하로 claim하는 client는 이 알림을 받지 않는다(기존 버전 규칙 그대로).
   - 필드: `eventKey: plugin:${index}:post-response-uncertain`, `effectsMayHaveOccurred: true`, `reason`과 `createdAt`은 6의 기록값. 재게시는 같은 내용이라 `duplicate`가 된다.
   - `uncertain`일 때 참여 entry마다 한 번. `drained`·`none`은 알림이 없다.
   - client 문구(코드별 문구 위치 `src/ts/bgNotifications.ts:108` 계열): `${plugin}: 답변 뒤 플러그인 동기화가 확인되지 않았어요. 저장된 답변은 그대로예요.`
   - 한계: `conflict`·`expired`·`capacity`이면 알림이 남지 않을 수 있다(최선 노력). 기록의 `notices[index] = 'failed'`로 구분한다.
9. **재시작:** `server.cjs`의 시작 경로에서 `reconcileServerChatRecovery`를 기다린 뒤, 서버가 listen하기 전에 별도 sweep을 await한다. 순서는 6과 같다(상태 먼저, 알림 나중).
   - `state === 'pending'`: `state:'uncertain'`, `reason:'restart'`, `notices`를 모두 `'pending'`으로 조건부 기록한 뒤 entry별로 게시한다.
   - `state === 'uncertain'`이고 `notices`에 `'pending'`이 남은 기록(게시 전 중단): 기록된 `reason`·`createdAt`으로 그 entry만 다시 게시한다.
   - 플러그인·생성·prepare를 다시 실행하지 않는다.
10. **취소:** commit 뒤 취소 route의 응답은 지금과 같다(`cancelled:false, finished:true, state:'chat-committed', reason:'already-committed'`). run 기록에 `postResponseAbort`가 있으면 abort한다(`run.cancelled`는 바꾸지 않아 결과 폐기 경로를 타지 않음). 창을 열기 전에 abort되면 창을 열지 않고 `uncertain/aborted`로 기록·알림한다.
11. **상태·N+1:** 상태 route는 지금처럼 `chat-committed`를 돌려준다. run `finish()`가 창 뒤에 오므로 activity route는 창이 끝날 때까지 busy다. **사용자 결정(2026-10-25): 같은 채팅 N+1 서버 입력은 지금처럼 접수되고, 실행만 작업 lock에서 창이 끝날 때까지 기다린다.** 입력 owner의 선행 판정·drain·`readyForNextTurn`은 바꾸지 않는다. N+1의 조립은 lock 뒤에 시작하므로 commit된 답변을 본다.

### 시험 주입 지점

- host 단위 시험은 기존 원문 재컴파일·session harness 방식이다. fake session은 2의 `runPostResponseEligible`·`postResponseCandidates()`·`openPostResponse`를 구현하고(session 자체 수명 마감은 fake가 결과로 표현), host 시험은 짧은 절대 `deadline`을 인자로 준다.
- S4b 순서·lease 정리·commit 뒤 예외는 `deps.runServerPreview` 주입(가짜 `postResponseLease` 반환)으로 시험할 수 있다.
- 실제 worker의 자격·봉인·상한·`clearTimeout`·본문 EOF·drained 판정은 `scripts/probe-bg-plugin-host.cjs` 계열 probe로 시험한다(작성자 sandbox에서는 worker를 띄울 수 없음, 환경 사실 §6).
- orchestrator·commit·재시작·취소·N+1은 server causal probe로 시험한다. 10초 창은 상수 그대로 쓴다(시험용 설정 옵션을 추가하지 않는다). commit·snapshot 지연과 실패는 probe의 module wrapping으로 만든다. 재시작은 `bg-post-response-sync:` 기록을 남긴 KV로 서버를 다시 띄워 확인한다.

## 테스트 계약 표

단위는 D3-1 하나다. "후보 timer"는 afterRequest hook 안에서 걸렸고 hook이 끝날 때 아직 대기 중인 1회성 timer를 뜻한다. "창"은 commit된 채팅 반영 시점부터 시한까지의 continuation 구간이다.

| 기준 | 입력 | 기존 상태 | 기대 결과·오류 | 범위 밖 |
|---|---|---|---|---|
| C1 timer 자격 | afterRequest 안의 `setTimeout`(bare 전역과 `window` 모두), hook 안에서 끝나는 timer, load 시점 timer, `setInterval`, 다른 phase의 timer(같은 `after_request` kind를 쓰는 script handler 포함), worker 내부 RPC timeout·settlement timer, 봉인 상한 초과 | BG 작업, full mode S4b | 후보 timer만 commit 뒤로 보류된다. hook 안에서 끝나는 timer는 지금처럼 바로 실행된다. 나머지는 지금과 같다(만료된 scope로 실행되고 RPC는 `plugin_invocation_expired`). 자격은 hook 완료 시점에 정해진다. 인자 전달·지연 정규화·같은 시각 timer의 순서가 유지된다 | 플러그인 이름·지연 값·endpoint로 고르는 분기 |
| C2 `clearTimeout` | 후보 timer를 hook 뒤, 창 열기 전, 창 안에서 해제 | C1 상태 | 해제된 callback은 실행되지 않고, 남은 후보가 없으면 창이 그만큼 일찍 끝난다 | — |
| C3 실행 시점 | commit이 원래 예정 시각보다 빠름; commit이 원래 예정 시각보다 늦음(1.5초 초과) | C1 상태 | callback은 canonical commit 성공 뒤, `max(원래 예정 시각, commit된 snapshot 준비)`에 한 번 실행된다. commit 전 실행·유실·commit 뒤 지연 재계산이 없다 | — |
| C4 읽는 상태 | callback 안의 `getDatabase`·`getChatFromIndex`·`getCurrentLorebookEntries`·`readDatabase` 등 | commit owner가 앵커 병합한 canonical 채팅 | 읽은 채팅은 commit된 canonical 결과(receipt의 `storedRevision`과 일치)이고 commit 전 `result.chat`이 아니다. 창이 끝날 때까지 lock이 유지되어 다른 BG 작업의 DB가 보이지 않는다 | — |
| C5 권한·예산 | 창 안의 플러그인 `nativeFetch`·`risuFetch`, storage, `runLLMModel`, 하위 timer, `setInterval` | C3 상태 | 호출은 기존 identity·권한·예산 검사를 거친다. `runLLMModel`은 거절된다. HTTP는 128회 공유 counter 안에서 허용된다. 창 안에서 걸린 하위 timer는 같은 시한 안에서 실행될 수 있으나 창을 늘리지 않는다. interval·idle 예약은 작업을 연장하지 않는다 | 플러그인 backend 쪽 동작 |
| C6 시한 | 창 안의 callback·HTTP가 시한을 넘김; 작업 마감·sandbox 마감이 10초보다 먼저 옴 | C3 상태 | 시한은 `min(snapshot 준비 + 10초, 작업 마감, entry sandbox 마감)`이고 timer·RPC·entry마다 다시 세지 않는다. 도달 시 새 호출은 `plugin_invocation_expired`, 진행 중 전송·응답 본문 읽기가 중단되고, `plugin_post_response_uncertain` 알림이 남으며, prepare를 다시 보내지 않고, 채팅 receipt는 유지된다 | — |
| C7 완료 판정 | callback이 HTTP를 시작하고 바로 반환; 응답 본문을 늦게 읽음; 본문을 읽지 않음 | C3 상태 | 창은 child scope에서 시작한 RPC(응답 본문 EOF·오류·취소까지)가 정산되고 남은 후보 timer가 없을 때 끝난다. callback 반환·worker idle만으로 끝나지 않는다. 정상 종료는 상태에 "전송 정지"로만 기록되고 알림이 없으며 "기억 저장됨"을 주장하지 않는다 | backend의 동기화 성공 증명 |
| C8 경로별 정리 | 답변 없음, commit 충돌·실패, commit 전 취소, `BG_ASSEMBLY_CONFLICT`, D1-a 실패, S4a 경로, 후보 timer 없음, 부분 출력(commit됨/안 됨), commit 뒤 snapshot·continuation·알림 오류 | 각 경로 | 창이 없는 경로는 지금처럼 즉시 host close → lock 해제. 부분 출력은 실제로 commit된 경우에만 창이 열린다. commit 뒤 오류는 채팅 성공을 유지하고 불확실로 닫으며 생성 실패를 게시하지 않는다. 정리는 정확히 한 번이고, 정리를 마치지 않은 host를 두고 lock을 먼저 풀지 않는다. stream preview 해제 위치는 지금과 같다 | — |
| C9 영속·재시작 | 창 진행 중 서버 재시작; 창 종료 뒤 재시작 | 동기화 의무가 commit 거래 안에서 기록됨 | 재시작 시 미해결 의무는 불확실로 바뀌고 플러그인·생성은 다시 실행되지 않는다. 저장된 채팅은 보존된다 | — |
| C10 N+1과 대기 | 창 진행 중 같은 채팅의 다음 입력; 다른 채팅의 BG 작업; drain | 창 진행 중 | activity route는 창이 끝나거나 만료될 때까지 busy다. 같은 채팅 N+1 입력은 지금처럼 접수되고(명령을 잃지 않음), 실행은 lock 해제 뒤 시작해 commit된 답변을 본다(2026-10-25 사용자 결정, 입력 owner의 `waiting` 판정은 바꾸지 않음). 다른 채팅 작업도 lock 해제 뒤 시작한다 | 대기 시간 개선, N+1 접수 응답의 변경 |
| C11 취소 | commit 전 사용자 중지; 창 진행 중 사용자 중지 | — | commit 전 취소는 지금과 같다. 창 중 취소는 남은 동기화를 멈추고 불확실로 기록하며 저장된 채팅과 receipt를 유지한다(취소 결과는 commit됨을 보고) | — |
| C12 다른 플러그인 | 후보 timer가 없는 entry, MARP·PageFold timer | 같은 작업 | 후보가 없는 entry는 생성 종료 시점에 닫혀 수명이 지금과 같다. MARP·PageFold의 timeout·protocol·정리 timer 의미는 유지된다 | — |
| C13 기존 동작 | 기존 시험 | — | RCM 원본 무수정, foreground, D1-a·G2.2b·NaN·D2 결과, 채팅 저장 결과, 128회·600초 유지, 기존 테스트 수 유지 | — |

## 전제 출처

| 사실 | 기준 | 출처 |
|---|---|---|
| RCM afterRequest의 1500ms timer·listener 분기·timer cb 조건 | C1, C3 | 코드(원본 RCM 1.0.21 JS `UA`의 `postResponseTimer`, `addRisuChatListener("output")`) |
| `DA`의 읽기·skip·prepare·오류 흡수·`Zo`·`vI` 비대기 | C4, C7 | 코드(원본 RCM `DA` 본문) |
| `mainGeneration.id`가 요청마다 새 UUID, `activeModelRequest.requestId` | C1 | 코드(원본 RCM `Kx`, beforeRequest 준비 성공 대입) |
| BG에서 afterRequest 안의 timer 예약이 실제로 일어남 | C1, C3 | **미확인 → 테스트 요청 전 실측 P1** |
| BG 답변 뒤 두 번째 prepare 없음 | 목표 | 실측 G2.2c §3 (`dd5641a`) |
| 실제 `setTimeout` 제공, hook scope 해제, 만료 호출 처리, `plugin_late_call` | C1, C6 | 코드 `bgPluginWorker.cjs:575-581,622-628,726`, `bgPluginSession.cjs:30-51,59`, `bgPluginHost.cjs:440-446` |
| worker는 호출 token만 가짐 | C1 | 코드 `bgPluginWorker.cjs:733-734` |
| session `find`·`release` 조건 | C6 | 코드 `bgPluginSession.cjs:30-40` |
| settlement 제외 대상·상한 계산 | C7 | 코드 `bgPluginWorker.cjs:30,132,504-505` |
| host 수명·lock·commit 순서 | C3, C8 | 코드 `bgOrchestrator.cjs:434-438,448,667-684,971,1004-1026,1034-1038,1696,1754` |
| host 읽기가 전역 DB를 봄, 다른 작업의 `setDatabase` | C4 | 코드 `bgOrchestrator.cjs:634,668,782`, `bgPluginHost.cjs:143,625,641` |
| commit identity·병합·`readyForNextTurn` | C4, C10 | 코드 `serverChatCommitOwner.cjs:771-805,858-868,902,905-920` |
| 공개 commit 결과에 채팅 없음, `pending_recovery` | C4, C8 | 코드 `serverChatCommit.cjs:910-918,1208-1227` |
| commit 거래의 기록 범위, 작업 저장 필드 | C9 | 코드 `serverChatCommit.cjs:1152-1185`, `bgOrchestrationOperationStore.cjs:61-108` |
| 상태 route `chat-committed`, 취소 `already-committed` | C11 | 코드 `bgOrchestrator.cjs:2054-2070,2308-2319` |
| `runLLMModel` 검사 | C5 | 코드 `bgPluginHost.cjs:117-127` |
| 128회 공유 counter, session 600초, unload 1초, pending 64 | C5, C6 | 코드 `bgPluginHost.cjs:37,115-119,217,650,747-751`, `bgPluginSession.cjs:12`, `bgPluginWorker.cjs:481,611` |
| host close의 진입 확인 | C8 | 코드 `bgPluginHost.cjs:740-756` |
| S4a는 lease를 넘기지 않음 | C8 | 코드 `bgOrchestrator.cjs:1907-1916` |
| 답변 뒤 순서·DA 읽기 비용·prepare 시간·현재 대기 | C6, C10 | 실측 M1~M4 (`d476d60`) — **경로 변경 시 재측정 P2** |

## 테스트 요청 전 실측

- **P1:** D2 commit 뒤 HEAD의 조립 트리에서 원본 RCM 1.0.21로 BG 작업을 실행해, afterRequest hook 호출 안에서 1500ms one-shot timer가 실제로 예약되는지(그리고 지금은 host 종료로 실행되지 않는지) worker 쪽 계측으로 확인한다. 예약되지 않으면 테스트를 요청하지 않고 원인을 확인한다.
- **P2:** 같은 HEAD에서 `git --no-pager diff --name-only d476d60..HEAD -- patches/lazy-chat-bg-adapter patches/lazy-chat-sync`를 실행하고, host·worker·session·orchestrator가 바뀌었으면 M1을 다시 잰다.

**결과 (2026-10-25, patcher `18d5113`, validation-runner):** 조립 트리 후보 gate `RESULT: PASS`(19단계, 저장소 시험 351 중 348 통과·3 skip). 원본 RCM 1.0.21(ZIP·JS hash 일치, backend 1.0.21·apiRevision 98, 의존성은 격리 폴더에 `npm install --omit=dev`로 설치), 가짜 provider, 합성 데이터, loopback 전용. 측정은 instrumentation을 넣은 조립 트리 사본에서만 했다.

- **P1 통과:** 15회 모두 afterRequest 호출 token으로 `setTimeout(…, 1500)`이 hook 시작 약 1ms 뒤 예약되고, hook 반환 시점의 대기 목록에 남아 있었다. 1500ms timer의 실행 기록은 0회다(실행 시 기록하는 wrapper 기준). afterRequest 반환 뒤 API 호출 0회, afterRequest phase의 `plugin_late_call` 0. afterRequest hook 자체는 context 읽기 4회(`getCurrentCharacterIndex`, `getCharacter`, `getCurrentChatIndex`, `getChatFromIndex`)를 한다. 실행당 `/v1/turn/prepare`는 beforeRequest의 1회뿐이다. 한계: `clearTimeout` 기록은 호출 context만 남겨 어느 timer를 지웠는지는 구분하지 못한다.
- **P2:** `d476d60..HEAD`에서 `bgPluginHost.cjs`·`bgPluginSession.cjs`·`bgPluginWorker.cjs`·`plugin-host-units.cjs` 등 23개 경로가 바뀌어 M1을 다시 쟀다.
- **M1 재측정**(ms, 최소/중앙/최대, 크기별 5회, 크기마다 새 서버): host close − afterRequest 반환 23/24/25·20/26/69·39/49/51(10·200·2000 메시지), commit 종료 − afterRequest 반환 45/45/53·53/55/170·134/151/158, prepare 왕복 18/21/54·59/60/100·49/52/92. **15회 중 commit이 1.5초보다 늦은 경우 0회**로 `d476d60`과 같다.
- **관측(이 단위 범위 밖):** 2000 메시지 5회 모두 phase `before_request`의 `plugin_late_call`이 남았다. RCM이 load 때 건 4000ms timer가 약 3초 걸리는 beforeRequest 도중 load scope 해제 뒤 울려 그 RPC가 거절된 것으로 보인다(현재 코드의 기존 동작). 크기를 섞은 15채팅 한 번의 실행에서는 plugin host가 시작되지 않아 중단했고 원인은 확인하지 않았다(크기별 단독 실행은 정상).

## 구현 뒤 원본 RCM 실측 (2026-10-26 KST)

대상: patcher `68b7426`(0.2.4-experimental.87) 조립 트리, RCM 1.0.21 원본 JS(SHA-256 `08705f3b…7edc`)와 원본 backend(apiRevision 98), 가짜 모델, 합성 채팅 10·200 메시지, 크기별 3회 이상. validation-runner가 실행했고, 오케스트레이터가 요약 기록(sync record 시각·busy·N+1)을 열어 대조했다. 외부 전송 0건(backend 차단 log 0줄). 시각은 commit(`bg-post-response-sync` 생성) 기준 ms, min/median/max.

- **창 안의 출력 동기화:** RCM afterRequest timer가 창 안에서 실행되어 두 번째 `/v1/turn/prepare`를 보낸다(10: 1510/1513/1514, 200: 1518/1562/1587). 요청 채팅은 commit된 답변을 마지막 메시지로 가진다(6/6). 이어 500ms 뒤 `POST /v1/worker/heartbeat`(10: 2027/2027/2030, 200: 2038/2079/2108). sync record는 `pending` → `drained`(약 +2.06~2.12초), 관측한 약 35턴에서 `uncertain`·`plugin_post_response_uncertain` 0건. 결과 route는 창 전(+12~66ms)에 `terminal-success`, activity는 `drained`까지 busy.
- **D4 확인(server engine):** backend `server` engine을 가짜 서버 LLM에 연결하면, 창 안 heartbeat 뒤 15~25ms에 추출 모델 호출이 시작되고 창이 닫힌 뒤에도 backend가 job을 끝낸다(10: 추출 1~2개, 200: 추출 16·story_consolidation 6개, 전부 `done`, 실패 0). 브라우저 없이 lease는 commit 뒤 약 47초까지 유지된다. 호출당 6초인 느린 모델(200 메시지)에서는 약 45초 시작 창 안의 job 4개만 실행되고, 나머지(추출 12·통합 1)는 다음 heartbeat(다음 턴 또는 브라우저 접속)까지 대기했다. D4 결정의 한계와 일치한다.
- **N+1:** 창 중 보낸 같은 채팅 입력은 즉시 접수(200, 409 없음)되고, provider 호출은 창 종료 뒤(10: +825~921ms, 200: +1125~1156ms)이며 본문에 첫 답변이 있다(6/6). N+1의 창도 `drained`.
- **새로 생긴 알림 (D3 영향):** 일부 턴에 `plugin_late_call`(phase `after_request`)이 저장된다(Q1 2/6 등, 이후 operation은 중복 제거). 계측 사본에서 8/8턴이 창 안 heartbeat보다 먼저(+444~468ms) 만료 context의 `nativeFetch` heartbeat 호출을 기록했다. 추정(실행으로 확인하지 않음): RCM beforeRequest 경로 끝의 `gc`가 건 500ms timer가, D3 이전에는 host가 afterRequest 뒤 약 25ms에 닫혀 실행되지 않았으나 지금은 host가 열려 있어 실행되고 만료 scope로 거절된다. 창 안 heartbeat는 모든 run에서 200이었다. D3 이전 같은 크기에서 after_request phase의 late call은 0이었다(위 「테스트 요청 전 실측」 P1).
- **측정하지 않은 것:** 실제 모델 지연·추출 품질, embedding(끔), 200 메시지 초과, backfill 승인이 없는 새 채팅, 15초 heartbeat 주기.

## D4와의 연결

Risu engine(새 설치 기본값)의 추출은 플러그인이 lease를 잡고 모델 작업을 하는 경로라, host를 닫으면 그 job의 무인 완료를 보장할 수 없다(RCM JS의 `gc`·Risu worker 경로). D3는 출력이 backend 원문에 들어가는 것까지만 다루고, 추출 완료는 D4에서 다룬다.

## 검수 기록

- **Astra(gpt-6-astra, read-only) 1회차:** 사실 1~7은 확인(일부 한정), 8은 정정(128회는 host 전체 공유). 설계 공백 4건(commit 대기 timer, callback 반환≠동기화 완료, commit 뒤 상태 부재, 다른 플러그인 수명)과 D(commit 대기 continuation) 제안, D + A 권고, 측정 8항목을 채택했다. 오케스트레이터가 직접 확인한 근거: `bgOrchestrator.cjs:1034-1038`(close → lock 해제), `bgPluginSession.cjs:28-52`(scope 해제·만료), 공유 counter(당시 인용 `bgPluginHost.cjs:212,612`는 잘못된 줄이었고 2026-10-22 재확인으로 `:37,115-119,217,650`으로 정정), RCM `Kx`의 `crypto.randomUUID()`.

- **Astra(gpt-6-astra, read-only) 3회차(2026-10-25, 「테스트 요청 전 확정」 초안):** 인터페이스는 실현 가능하나 관측 계약이 비어 있고 C12와 충돌한다는 지적 9건과 사실 한정 5건. 오케스트레이터가 코드로 확인한 근거: script handler도 `after_request` kind(`bgPluginHost.cjs:680-683`), `close()`의 늦은 `closed`(`:862-878`), S4b가 commit 결과 객체를 결과 저장에 넘김(`bgOrchestrator.cjs:1775`, `:164`, `:128`), ACK가 작업 상태 행을 다시 씀(`:2570-2586`), 입력 commit이 같은 거래에서 입력을 `completed`로 정산(`serverChatCommitOwner.cjs:496-502`), 알림 `reason`이 지정 코드에서만 보존되고 client가 같은 목록으로 검증(`bgNotifications.cjs:50-75`, `src/ts/bgNotifications.ts:20-28,50-60`). 채택: ① parent 소유 자격(afterRequest replacer만) ② session 프로토콜·참여자·상한 고정 ③ `handOver()`에서 비참여 entry 정리 ④ close·open memoize, 결과 판별 union, 경계 규칙 ⑤ 채팅을 반환 객체에 넣지 않고 `readCommittedChat(receipt)`로 읽음 ⑥ 별도 KV 키와 조건부 갱신, `none`·snapshot 실패의 종결 상태 ⑦ 서버·client 알림 정규화, 고정 `createdAt`, 게시 순서와 재시도 ⑧ N+1은 사용자 결정으로 "접수 뒤 lock 대기" ⑨ commit 전에 두는 `postResponseAbort`, `run.cancelled` 불변. 사실 한정(session `runtimeMs` 설정 가능, settlement 기준은 callback 시한, 작업 시한 기준은 lock 획득 뒤, commit 결과는 성공 모양, 병합 채팅은 journal 준비에도 전달)은 사실 표에 반영했다.

- **Astra 4회차(2026-10-25, 3회차 반영본):** 1회차 9건 중 1·5·6·8·9 해결, 2·3·4·7 부분 해결. 남은 지적 7건을 모두 채택했다. 오케스트레이터가 확인한 근거: `_callback`이 callback await 뒤 `settleContext`를 기다리고 반환(`bgPluginWorker.cjs:537-546`), S4b의 `deps.runServerPreview` 주입 지점과 `finally`의 지역 정리(`bgOrchestrator.cjs:640-647,1028-1043,1088-1090`), 알림 버전·`expired` 결과(`bgNotifications.cjs:23-28,136-150`). 반영: ① 봉인은 callback 반환 직후·`settleContext` 전, 거부된 hook은 봉인 없음 ② 후보 수는 parent 개시 조회 `postResponseCandidates()`, `drained`의 `ran`으로 `none` 구분, 집계 규칙 ③ `handOver()` promise와 `postResponseLease` 계약 ④ 상태 먼저(entry별 `notices`), 알림 나중으로 실행·재시작 순서 통일 ⑤ 알림 버전 5, `expired` 처리, 최선 노력 한계 명시 ⑥ open 전·session 실패·재호출·abort 우선순위 규칙, session 자체 시한 ⑦ commit 전달 경로·`commitReceiptId` 대응·replay 규칙. 사실 한정 4건은 사실 표에 반영했다.

## 바꾸지 않을 동작

RCM 원본, foreground 코드, D1-a 계약, 다른 플러그인의 host 수명(동기화 창은 timer 호출이 있는 동안만), 채팅 저장 결과(동기화 실패가 저장을 되돌리지 않음), 기존 예산(128회·600초)을 조용히 늘리지 않음.
