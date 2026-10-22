# D3 설계 계획 — BG의 RCM 응답 뒤 출력 동기화(유한 대기)

**상태 (2026-10-22 KST):** 계약 범위(호스트 공통)·구조(D + A) 결정, 시제품 없는 측정 완료, 구현 계획 초안. 구현 계획 Astra 검수 전, 구현 전.
정본: [G2.2 실행 계획](BG-G2-2-EXECUTION-PLAN.md) §3(B) D3(결정 2026-10-22: 유한 대기로 지원), [ordered goals](BG-PRESERVE-ORDERED-GOALS.md) §9.3 「공통 경계」 1~4, [G2.2c 실측](BG-G2-2C-RCM-MEASUREMENTS.md) §2·§3. 대상: patcher `dd5641a`.
위험 분류: **risky** (host 수명, commit 순서, 미리보기 lock, 동시 작업).

## 목표

BG 작업에서 RCM 원본이 답변 뒤 실행하는 출력 동기화(두 번째 `/v1/turn/prepare`)가, 정상 채팅에 답변이 저장된 뒤 같은 작업 안에서 유한 시간 안에 실행되게 한다. 원본 JS·backend는 바꾸지 않는다. 시한 안에 끝나지 않으면 정리하고 결과를 불확실로 알린다. 자동 재실행·상주 JS·고정 sleep은 두지 않는다.

## 확인한 사실

RCM은 원본 1.0.21 JS(minified 기호), host는 patcher `dd5641a`의 조립 트리 기준이다.

1. RCM afterRequest(`UA`): 답변을 그대로 반환하고, `addRisuChatListener`가 없으면 `window.setTimeout(cb, 1500)`을 건다. cb는 대기 중인 chat/request id와 `mainGeneration`을 다시 확인한 뒤 `DA(chatId, requestId)`를 부른다. listener가 있으면 "output" 이벤트에서 다시 읽은 채팅의 마지막 메시지가 이벤트의 메시지·generation과 일치할 때 즉시 `DA`를 부른다(1500ms 없음).
2. RCM `DA`: `ln(e)`(getCurrentCharacterIndex·getCharacter·getCurrentChatIndex·getChatFromIndex·getCurrentLorebookEntries·getDatabase(["personas","selectedPersona","characters"]))로 채팅을 다시 읽고, `prepare(..., {deferExtraction:false}, 5000)`을 보낸 뒤 local plugin storage를 쓰고 idle timer를 건다. 실패는 경고 로그로 흡수한다. 메시지 id를 비교하지 않는다. RCM onUnload는 이 timer를 지운다.
3. foreground 관찰: 답변 약 1.5초 뒤 두 번째 prepare(G2.2c §2 a). BG 관찰: 일어나지 않음(§3).
4. worker는 실제 `setTimeout`을 플러그인에 준다(`bgPluginWorker.cjs:726-728`). 그러나 RPC는 hook 호출 scope 안에서만 받는다. scope는 hook 호출이 끝나면 해제되고(`bgPluginSession.cjs:35-51`), 그 뒤의 호출은 `plugin_invocation_expired`로 거절되며 `plugin_late_call` 진단이 남는다(`bgPluginWorker.cjs:575-581,622-628`, `bgPluginHost.cjs:428-434`). 오래 사는 비-hook scope는 없다. settlement는 진행 중 RPC만 최대 15초 기다리고 timer는 기다리지 않는다(`bgPluginWorker.cjs:126-149`).
5. host 수명과 순서(`bgOrchestrator.cjs`): `_previewLock` 획득(434-438) → host 생성(667-684) → `sendChat`(970-974, afterRequest와 timer 예약이 여기서) → 결과 읽기(1004-1026) → finally에서 600초 timer 해제, host `close()`, lock 해제(1034-1038) → 그 뒤 작업 쪽에서 canonical commit(`commitGenerationResult`, 1696) → 결과 영속(1754) → terminal 상태. **host는 commit 전에 닫히고, lock은 host가 닫힌 뒤 풀린다.**
6. host가 읽는 상태: `getDatabase`·`getChatFromIndex`·`readDatabase`는 전역 `dbmod.getDatabase()`를 읽는다(`bgOrchestrator.cjs:668`, host `:143,:603`). 선택(characterIndex/chatIndex)은 작업 closure다. 다른 작업은 lock을 얻은 뒤 `dbmod.setDatabase`(634, 782)로 전역 DB를 바꾼다. 따라서 lock 밖에서 열린 host는 다른 작업의 DB를 읽을 수 있다.
7. commit identity(`serverChatCommitOwner.cjs:771-805,858-868`): 입력 메시지(anchor.inputId), 답변 메시지들의 `chatId`, 저장 revision, before/after revision.
8. 시한·예산: session/sandbox 600초(`bgPluginSession.cjs:12`, sandbox별 별도 집행), host network·model 호출 128회(**host 전체 공유**, `bgPluginHost.cjs:212,612`), 작업 600초 timer(host 생성보다 먼저 시작, `bgOrchestrator.cjs:448`, host close 전에 해제), unload 1초, settlement 15초(네트워크·모델 호출은 일반 settlement에서 제외, `bgPluginWorker.cjs:504`), pending RPC 64. 각각 출처가 다른 별도 한도이며 commit 뒤 새 한도가 생기지 않는다.
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
4. **수명과 lock(`plugin-host-units.cjs`가 넣는 `bgOrchestrator.cjs` 단위):** 지금의 `host-finally`(host close → lock 해제)를 바꿔, full mode S4b에서는 `runServerPreview`가 host와 lock을 닫지 않고 lease로 넘긴다. S4b는 canonical commit이 성공한 뒤 ① 선택 채팅을 commit된 canonical 결과로 전역 DB에 반영하고 ② `openPostResponse`를 시한 안에서 기다린 뒤 ③ host close → lock 해제한다. commit 실패·취소·`BG_ASSEMBLY_CONFLICT`·D1-a 실패·S4a 경로·lease를 받을 수 없는 경로에서는 지금처럼 즉시 close·해제한다. stream preview 표시 해제는 지금 위치(생성 종료 시)를 유지한다.
5. **상태·재시작:** continuation을 열기 전에 commit receipt에 묶인 동기화 intent를 영속하고, 결과(완료·불확실)를 기록한다. 재시작 시 남은 intent는 불확실로 바꾸고 플러그인·생성을 다시 실행하지 않는다. 같은 채팅의 다음 작업은 동기화가 끝나거나 만료될 때까지 busy다. 불확실은 플러그인 알림(새 코드, 예: `plugin_post_response_uncertain`)으로 남긴다.
6. **시한:** 절대 상한을 상수로 둔다. 근거: 원본 timer 1500ms + DA 읽기(측정 M2 최대 약 0.27초, RCM CPU 미측정 — 2000 메시지에서 1~2초 추정) + RCM prepare 자체 timeout 5000ms. 상한 후보 값은 검수 뒤 사용자 결정으로 정한다. 남은 작업 600초·sandbox 수명과 host 공유 128회 예산을 넘지 않는다.
7. **취소:** commit 전 취소는 지금과 같다. continuation 중 사용자 중지는 남은 동기화를 멈추고 불확실로 기록하며, 저장된 채팅을 되돌리지 않는다.

합격 기준(초안): 측정 1~8 항목을 시험으로 바꾼다 — 원본 RCM에서 BG 답변 뒤 두 번째 prepare가 commit 뒤에 실행되고 그 본문의 메시지 id·내용이 저장된 답변과 일치하며 backend 원문 readback으로 확인; commit을 1.5초보다 늦춰도 commit 전 읽기·callback 유실 없음; 시한·취소·재시작에서 불확실 기록·재실행 없음·채팅 보존; 같은 채팅 N+1 busy; 다른 채팅 대기 증가가 측정 범위 안; MARP·PageFold·D1-a·G2.2b·NaN 단위 동작 불변; continuation이 없는 플러그인의 수명 불변.

## D4와의 연결

Risu engine(새 설치 기본값)의 추출은 플러그인이 lease를 잡고 모델 작업을 하는 경로라, host를 닫으면 그 job의 무인 완료를 보장할 수 없다(RCM JS의 `gc`·Risu worker 경로). D3는 출력이 backend 원문에 들어가는 것까지만 다루고, 추출 완료는 D4에서 다룬다.

## 검수 기록

- **Astra(gpt-6-astra, read-only) 1회차:** 사실 1~7은 확인(일부 한정), 8은 정정(128회는 host 전체 공유). 설계 공백 4건(commit 대기 timer, callback 반환≠동기화 완료, commit 뒤 상태 부재, 다른 플러그인 수명)과 D(commit 대기 continuation) 제안, D + A 권고, 측정 8항목을 채택했다. 오케스트레이터가 직접 확인한 근거: `bgOrchestrator.cjs:1034-1038`(close → lock 해제), `bgPluginSession.cjs:28-52`(scope 해제·만료), `bgPluginHost.cjs:212,612`(공유 counter), RCM `Kx`의 `crypto.randomUUID()`.

## 바꾸지 않을 동작

RCM 원본, foreground 코드, D1-a 계약, 다른 플러그인의 host 수명(동기화 창은 timer 호출이 있는 동안만), 채팅 저장 결과(동기화 실패가 저장을 되돌리지 않음), 기존 예산(128회·600초)을 조용히 늘리지 않음.
