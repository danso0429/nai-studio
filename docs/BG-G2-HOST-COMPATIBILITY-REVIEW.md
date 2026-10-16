# G2 호스트 호환성 — G1 의존 관계·수정안·격리 검증

2026-10-15. 실행 정본은 [ordered goals §9](BG-PRESERVE-ORDERED-GOALS.md#9-g2--공식-rcm-설치와-서버-완주), 설치 기준선은 [G2.1 검증](BG-G2-1-RCM-INSTALL-VALIDATION.md)이다. 현재 선택 제품은 RCM이며 AC는 DEFERRED 상태를 유지한다.

**확정한 첫 수정안은 foreground iframe과 BG worker가 실제 지원 API만 함수로 노출하도록 바로잡는 것이다.** RCM 원본을 수정하지 않는다. output listener의 단독 추가는 초기 호환성 수정안으로 채택하지 않는다. G2.1 공식 원본 조합은 여전히 초기화 실패 상태이며, 이번 성공은 호스트를 바꾼 격리 진단본의 결과다. 운영 구현·배포·유료 호출은 수행하지 않았다.

기존 G2.2의 하위 실행 단위로 **G2.2a capability 정확화 sub plan**을 추가한다(§6). G2.3/G2.4를 대체하는 새 목표나 승인 단계는 만들지 않는다. 이번 요청은 의존 조사·수정안 확정·격리 실측을 승인한 것이며 G1 미확인 항목 전체 통과나 통합 본 구현의 선행 조건 해제로 해석하지 않는다.

## 1. 기준선과 판단 방법

| 대상 | 이번 판단에 사용한 범위 |
|---|---|
| 현 G1 유지 소스 | `8adb75f`, experimental.48 / adapter 0.7.55. 후속 문서 HEAD `0729f2f`의 작업 트리는 조사 시작 시 clean이었다. |
| G1 최신 상태 | G1.10 qualification validation의 2026-10-15 제한 범위 L6 기록. 초기 10-12 checkpoint와 당시 OFF 상태를 현재 상태로 사용하지 않았다. |
| RCM | 원본 1.0.13 / API 90 / schema 49 / settings 21. 원본 JS SHA-256 `fcdce0fea6e27acf23efb29bda1568d5308dd43607b05cc7eb1cc7d2996bfede`. |
| 공식 PocketRisu | 1.10.0 / source `98e9683`, 공식 ARM64 배포본과 별도 합성 save/browser profile. |
| 상류 listener 조사 | [PocketRisu 1.14.0 API](https://github.com/PocketRisu/PocketRisu/blob/64687d47e4d07de91a79a4053248e4d4eaf99ba2/src/ts/plugins/apiV3/v3.svelte.ts#L924), [RisuAI API](https://github.com/kwaroran/RisuAI/blob/454e5e207747399f43a4788f5f08ecd5aa291550/src/ts/plugins/apiV3/v3.svelte.ts#L737). 조사 대상 고정 commit이며 이번 앱의 업그레이드 기준선이 아니다. |

표의 과거 통과는 해당 소스·환경의 관측이다. 공통 호스트를 변경하면 변경된 호출 경로의 회귀 검증을 다시 수행한다. 기존 통과를 지우거나 최신 소스에서 새로 실행한 결과로 표시하지 않는다. source fact, 실행 결과, 지원 주장과 구현 진입 근거를 구분한다.

## 2. G1 잔여 의존 표

여기서 **구현 의존**은 해당 코드를 바꾸기 전에 정해야 하는 계약이고, **지원/전달 의존**은 제품 지원을 주장하거나 운영 전달할 때 필요한 검증이다. 모든 기기 보류 항목을 capability 수정 전의 새 전수시험 gate로 만들지 않는다. 다만 ordered-goals §1/§9.1의 기존 통합 진입 조건은 별도로 유지한다.

| 항목 | 기존 근거·남은 범위 | RCM과 실제로 맞닿는 경로 | 구현 의존 | 지원/전달 의존 |
|---|---|---|---|---|
| MARP 전체 분석·지연 | 합성 원본 MARP/native 조합 및 제한된 실제 제공자 follow-up 근거가 있다. 실제 iPhone MARP의 transport 3/2xx 1/scopeClosed 2는 전체 분석·주입 성공 증거가 아니며 지연 원인은 미확인이다. | 같은 API Proxy, beforeRequest 실행 순서·설정·호출 수명. RCM의 준비 대기는 MARP의 분석 대기와 별도다. | capability 수정 자체를 막는 미확정 의미는 없다. 기존 MARP timeout을 RCM 때문에 변경하지 않는다. | 공유 Proxy/worker 변경 후 원본 MARP 회귀. MARP+RCM의 실제 분석·주입과 기기는 G2.5에서 따로 검증. |
| 앱 종료·전환·잠금 | 실제 앱 종료 후 canonical 답변 저장/정상 복귀는 관측됐다. 전환·잠금 추가 기기 항목과 RCM 기억 저장은 미검증이다. | 브라우저 부재 중 원본 JS 수명, backend 접수·작업자 제어 lease. | capability 수정과 독립. 저장 후 호스트 종료 순서는 §4의 후속 구현 의존이다. | G2.3에서 구간별 browser 종료·복귀 전 채팅/기억 확인, G2.5에서 실제 기기. 채팅 저장만으로 기억 완료를 계산하지 않음. |
| 편집·대기열 N+1 | 과거 합성 S2/S3에서 N snapshot, 편집 보존, commit 뒤 N+1 조립·정상 후속을 확인했다. 추가 기기 항목은 보류다. | RCM context snapshot·message ID·generation identity, N의 기억 처리와 N+1 prepare. | API/저장 관찰 구현 전에 snapshot 경계와 canonical 결과 읽기를 명시한다. | G2.3에서 RCM 조합의 이전/수정 원문, N+1 실제 payload, 기억 지연/중복을 재검증. |
| 중지·취소·지연된 응답 | 분석/main Stop와 뒤늦은 A DELETE 응답이 B 제어를 지우지 않는 합성 근거가 있다. 기기 추가 확인은 보류다. | pendingPrepare/원본 요청 차단·abort·unload, 이미 접수된 RCM 외부 작업. | G2.2에서 의도적 차단과 일반 오류의 신호를 확정해야 한다. 채팅 Stop가 모든 RCM job 취소라는 의미를 만들지 않는다. | G2.4에서 단계별 입력/답변/기억/job의 잔존·중복·후속 전송. |
| 설정·preset·custom endpoint | 설정 snapshot과 원래 override/제공자 경로의 제한된 근거가 있다. 기기 설정 저장 전파는 미검증이다. | RCM argument/local storage, 조립 시점 DB projection, main/aux 호출과 provider 설정. | 실제 지원 API 목록·상수/alias·허용 DB 경계를 보존한다. RCM 설치를 이유로 허용 DB 키/secret 노출을 넓히지 않는다. | G2.2/G2.5에서 설정 변경 전후·override/custom/local 경로 회귀. 유료 재시험은 이번 범위가 아님. |
| module·lorebook | module-bound v2 helper와 MARP/native 조합의 합성 근거가 있다. Lua/더 넓은 module 경로·기기는 별도다. | 필수 `getCurrentLorebookEntries`, 모듈 선택과 현재 char/chat 정보. | BG getter 구현 전에 native의 character globalLore + chat localLore + 선택 module lore 순서/내용 의미를 맞춘다. raw entries와 활성화된 프롬프트 결과를 혼동하지 않는다. | G2.2에서 별도 module selector와 lore parity. 기존 v2 결과를 Lua 전체 지원으로 계산하지 않음. |
| restart·unknown recovery | 합성 restart에서 입력 보존·알림·자동 replay 0과 unknown fence 유지가 확인됐다. 해당 사례의 same-chat healthy successor는 통과가 아니다. | canonical commit와 RCM 외부 접수의 비원자 경계, settings 소실, 재접속 보충. | 저장 후 통합을 구현하기 전에 접수 불확실·조회/원래 retry·재실행 금지 계약을 정한다. | G2.4에서 채팅/기억/job을 각각 readback. G1 fence를 지우거나 model 재실행으로 복구하지 않음. |
| provider 경고·오류 알림 | 원본 PageFold CAS/settlement 합성 근거가 있다. 모든 플러그인/실제 조건을 의미하지 않는다. | 같은 host disable/notice와 RCM의 초기화 실패·의도적 차단 신호. | 실제 unsupported RPC의 거절·기존 알림은 유지한다. 부재 값에서 발생한 JS 예외와 실제 RPC 실패를 구분한다. | 변경 후 PF/MARP·정상 제공자 회귀, 부분 외부 효과의 알림은 G2.4. |
| 운영 readiness·ON/OFF·L6 | 최신 제한 범위 기록은 host1/commit1과 source pairing을 관측했다. 과거 OFF/옛 pending count를 현재 gate로 재사용하지 않는다. 새 운영 읽기는 이번에 하지 않았다. | 같은 설치·소유권·저장 writer, RCM 서비스와 JS 활성화. | 계획/격리 실험에는 운영 변경 불필요. 본 구현 진입은 §9.1의 기록으로 판단한다. | G2.5에서 현재 active/input/commit owner 확인·안전 전달·독립 readback·L5/L6. |
| 스트리밍·보류된 기기 조합 | 사용자가 streaming 기기 항목을 미기록으로 남겼다. 자동 streaming 근거를 기기 통과로 바꾸지 않는다. | afterRequest 유무·출력 관찰·중지 경로가 stream/nonstream에 따라 다를 수 있다. | 공통 수정이 기존 streaming을 깨뜨리지 않는 자동 회귀는 필요하다. | 실제 기기 지원 범위는 기존 사용자 결정과 G2.5 지원표에 따름. |

이 표는 G1 잔여를 면제하지 않는다. 현재 사용자 요청으로 조사·진단본 검증·계획 작성은 진행했다. 통합 본 구현/운영에 들어갈 때는 §9.1의 기존 완료 조건 충족 기록 또는 남은 항목과 지원 한계를 명시한 진행 결정이 필요하다. 이 문서를 읽었다는 사실이나 의존 표 작성 자체를 그 결정으로 대신하지 않는다. 2026-10-16 사용자 진행 결정은 G2.2a 한 단위에 한해 [ordered-goals §9.1 「진입 근거 기록」](BG-PRESERVE-ORDERED-GOALS.md#91-배경용어현재-진입점)에 남겼다.

## 3. 확정한 수정안과 대안 판단

### 3.1 G2.2a — 실제 capability를 노출

foreground `SandboxHost`는 실제 `apiFactory`에 등록된 callable 이름을 guest 실행 전에 전달한다. guest Proxy는 cached property/alias/helper를 먼저 보존하고, 그 밖에는 실제 등록 함수만 RPC 함수로 돌려준다. 없는 이름은 `undefined`다. plugin별 이름·버전·hash로 분기하거나 RCM의 특정 API 한 개만 숨기지 않는다.

BG worker도 부모 host의 실제 지원 집합을 bootstrap에서 받는다. worker에 별도 손작성 목록을 두지 않고 dispatcher와 노출 집합의 일치를 검증한다. `pluginStorage` 등 기존 nested surface와 constants를 보존한다. 부모의 인자·권한·효과·identity·unsupported RPC 검사는 그대로 권한 정본이다. worker가 보내는 목록을 부모 권한으로 신뢰하지 않는다.

BG의 부재 API 접근은 entry를 끄지 않는 capability 진단으로 부모에 전달하고 plugin 이름·버전·API·phase를 남긴다. 이는 typeof 탐지와 실제 호출을 구분할 수 없으므로 **부재 이름에 접근했다는 관측**이며, 실제 API 호출 실패로 표시하지 않는다. 기존 한도 안에서 중복을 억제하고 `then`/symbol 같은 bridge 자체 탐지는 제외한다. 없는 이름을 조회한 것만으로 플러그인을 제외하지 않되, 플러그인 내부에서 잡힌 TypeError 때문에 MCP 등 미지원 기능이 조용히 사라지는 것을 지원 성공으로 계산하지 않는다. 이 진단 전송은 실행 권한을 주지 않으며 실제 unsupported RPC의 거절/알림과 별도다. 진단 경로와 통지 실패의 기존 보존 계약도 구현 때 검증한다.

이는 **탐지 오류의 수정**이다. 기능 탐지에 성공했다는 이유로 필수 read API, MCP 도구 실행, DOM, 저장 listener의 의미까지 지원된 것으로 계산하지 않는다. 없는 함수의 직접 호출은 이제 로컬 TypeError가 될 수 있어 `missingApi().catch()`와 try/catch의 차이도 회귀 범위에 넣는다. 실제 unsupported RPC가 발생한 경우의 fail/notice 정책은 완화하지 않는다.

### 3.2 output listener 단독 추가는 채택하지 않음

상류 RisuAI와 PocketRisu 1.14.0에는 해당 API가 존재한다. v3 등록은 replacer 권한을 재사용하고 unload 때 제거한다. [원래 caller](https://github.com/kwaroran/RisuAI/blob/454e5e207747399f43a4788f5f08ecd5aa291550/src/ts/process/index.svelte.ts#L57)는 char/chat snapshot과 characterIndex/chatIndex/messageIndex를 전달하고 listener를 순서대로 await한다. 호출 지점은 output 처리 후 DBState 반영 뒤이며, 이를 서버 SQLite durable commit 증거로 바꾸지 않는다.

하지만 이 API만 만들면 다음 문제가 남는다.

- 다른 없는 API의 typeof 오탐은 계속된다. 정확한 capability 노출은 listener 도입 여부와 독립적으로 필요하다.
- 이번에 읽은 생성 candidate `.code-review/workspaces/bg/candidates/request-progress/server/node/bgOrchestrator.cjs`(SHA-256 `56ea8dac27adb69fa69064a134abb0f6bf8d5391764807cc4930730a2afce4f1`)의 full 실행은 `finally` 1030행에서 `pluginHost.close()`를 실행한다. 해당 호출이 반환한 뒤 바깥 detached caller 1624행이 `commitGenerationResult`를 실행한다. 생성 소유 근거는 patcher `patches/lazy-chat-bg-adapter/plugin-host-units.cjs:236`의 host-finally, `stream-preview-units.cjs:58`의 release, `manifest.cjs`의 `server-chat-commit-terminal:1.10` 단위다. 따라서 기존 host에 listener 등록만 추가해도 canonical 저장 뒤 살아 있는 같은 요청 인스턴스는 생기지 않는다.
- 원본 RCM listener는 비동기 동기화를 시작한 뒤 `undefined`를 반환한다. listener 반환만 기다린 상태는 backend 접수·기억 완료가 아니다. 기존 RPC settlement는 이미 발행된 RPC를 join하지만 향후 timer 전체를 기다리지 않는다.

따라서 **첫 수정은 capability 정확화**로 한정한다. 향후 output listener가 필요하면 상류 의미·실제 canonical 저장 identity·같은 요청 host의 종료 순서를 함께 구현해야 한다. 빈 listener, 임시 메모리 상태를 durable 저장으로 취급하는 호출, 새 상주 JS/재실행 큐는 대안으로 사용하지 않는다.

## 4. 별도로 남기는 G2 구현 계약

아래는 G2.2a의 미완성 구현을 숨기는 목록이 아니라, capability 수정만으로 해결되지 않는 기존 G2.2~G2.4의 실행 항목이다.

| 경계 | 확인한 사실 | 후속 구현 전/검증에서 할 일 |
|---|---|---|
| 필수 read API | RCM 1.0.13 `readCurrentContext`는 `getCurrentLorebookEntries`를 무조건 호출한다. 현 BG dispatcher에는 없다. native allowedDbKeys에는 personas/selectedPersona가 이미 있다. | lore getter의 선택 snapshot/module 의미, DB projection 실제 값, 읽기 권한을 맞춘다. 기존 1.0.12 C 실험의 이름 없는 오류 원인으로 이번 단위 시험만을 소급 대입하지 않는다. |
| MCP·channel·DOM | foreground에는 MCP/channel API가 있다. BG 지원은 별개다. RCM MCP 등록은 typeof 검사 없이 호출되고 원본 기본 도구 설정은 ON이다. | 등록뿐 아니라 native 최종 tool caller·정리·권한·도구 실제 사용까지 연결한다. 미지원/원본이 잡은 오류·경고를 기록하며 도구 강제 OFF나 빈 도구로 지원을 꾸미지 않는다. 일반 browser document 사용과 host UI API도 구분한다. |
| 의도적 차단 | 원본 초기화 gate는 ready 전 model 요청을 reject한다. RCM의 별도 차단 Error는 원본의 의미이며 일반 통신 오류와 다르다. | RPC 오류 속성과 최종 Send caller까지 추적해 일반 오류의 기존 omission과 원본의 차단을 구분한다. 오류 문구/플러그인 hash에 맞춘 분기로 결정하지 않는다. 구분 가능한 공통 계약이 없으면 해당 경로 구현 전에 결과 선택을 명시한다. |
| canonical 저장 후 관찰 | 현재 host close가 durable commit보다 먼저다. 원본 listener는 작업을 분리한다. | 같은 operation 안에서 canonical commit→실제 저장된 메시지 ID/revision 관찰→원본 후속 효과의 완료/영속 접수 확인→host close 순서를 설계·검증한다. 저장 실패/취소에는 성공 output event를 내지 않는다. G1의 저장·취소를 기억 실패로 되돌리지 않는다. |
| timer·RPC 수명 | 원본 fallback은 1500ms, server heartbeat 예약은 500ms다. 이미 발행한 RPC와 아직 발행하지 않은 timer는 다르다. | 일반 API 노출 수정 뒤 실제 선택되는 경로를 사용한다. 임의 고정 sleep, timer 즉시 실행, deadline 연장으로 통과시키지 않는다. 현재 요청의 기한 안에서 무엇을 기다리는지와 timeout 시 외부 효과 불확실을 명시한다. |
| backend 제어 lease | RCM 1.0.13 서버는 45초 control lease가 유효해야 새 job을 시작하고 진행 중 job 완료는 별도 조건이다. prepare의 빈 packet 응답도 job 전체 완료는 아니다. | 앱/요청 JS 부재 후 새 후속 job·누적 작업이 계속되는지 원본 backend로 측정한다. 단순 접수와 기억 완료/N+1 반영을 구분한다. lease 연장·무한 heartbeat·상주 JS를 암묵적으로 채택하지 않는다. 기존 API/요청 수명으로 요구 결과가 안 되면 수정 예외/지원 한계의 실제 결정을 먼저 남긴다. |
| 추출 engine·N+1 | 원본 server engine과 Risu engine의 실행 주체·timer가 다르다. 이번 시험은 모델 호출 0이며 어느 쪽의 기억 완주도 입증하지 않았다. | engine별 완료/인계·다음 턴 보충·실패 결과를 G2.2~G2.4에서 확인한다. product 선택을 engine/비용/지연 한계 수용으로 대신하지 않는다. |

## 5. 이번 격리 검증 결과

### 5.1 실제 iframe RPC의 A/B

공식 1.10 factory.ts를 TypeScript 5.9.3으로 단일 파일 transpile해 Chromium의 실제 `SandboxHost`/iframe/message RPC로 실행했다. 원본과 진단 prototype을 비교했다. API 목록은 고정 소스의 실제 object 선언 83개에서 수집했으며, 개별 API의 본문은 fixture다.

| 검증 | 관찰값 |
|---|---|
| 원본 Proxy | 없는 listener가 function, 호출 시 API method not found |
| 동적 목록 prototype | 없는 listener와 then은 undefined, 원래 부재 fallback 분기 선택 |
| 기존 표면 | 83개 이름의 함수 노출, apiVersion 상수, pluginStorage alias, callback 왕복 보존 |
| 동적 추가 | fixture에서 나중에 등록한 함수도 목록을 재작성하지 않고 노출·호출 |

이는 실제 bridge 구조의 노출·RPC 시험이다. 83개 API의 실제 본문·권한·모든 설치 플러그인 의미 보존 시험이 아니다. 현재 유지 후보에 추가된 API의 전수 parity는 G2.2a 구현 검증에 포함한다.

### 5.2 원본 RCM 전체 JS의 실제 브라우저 진단

공식 ARM64 배포본의 별도 복사본에서 guest Proxy의 guard 한 곳만 바꿨다. 이 배포 asset용 진단 guard는 위 83개를 소스에서 추출한 고정 목록이며, §3.1의 최종 동적 구현이나 생성 installer가 아니다. 실제 수정 파일은 한 개이고 원본/candidate asset hash를 보존했다. 서버 코드와 원본 RCM JS는 바꾸지 않았다. 기존 G2.1에서 정상 UI로 설치한 합성 save를 복제하고 새 browser profile을 사용했다.

관찰값:

- 원본 RCM 1.0.13의 설정 메뉴와 대시보드가 열렸다. main Document 권한은 해당 RCM의 정상 확인창에서 허용했다.
- 원본 설정 UI로 격리 backend 주소/token을 저장했고 저장 확인을 관측했다.
- 브라우저를 다시 실행한 뒤 원본 플러그인의 `/v1/worker/heartbeat`, `/v1/admin/chats`, `/v1/update/status`가 200이었다. health만으로 인증 성공을 계산하지 않았다. 요청은 시험 머신 브라우저에서 direct로 관측됐다.
- 재접속에서 RCM initialization failed 오류는 없었다. cross-origin iframe autofocus 경고 1건은 있었으며 UI/인증 성공과 구분해 남겼다.
- 종료 후 SQLite readback에서 주소/token이 argument와 local settings 양쪽에 저장됐고, 원본 JS byte-equal·character 0/plugin 1·memoryToolsEnabled=true를 확인했다. 시험 listener 종료, PocketRisu 합성 save integrity ok와 RCM 원본 22파일 보존도 확인했다. 이 readback에서 RCM DB integrity를 다시 측정한 것은 아니다. 도구 ON 설정 보존은 실제 도구 실행 성공을 뜻하지 않는다.
- Send·모델/임베딩·기억 추출은 실행하지 않았다. 실제 iPhone/HTTPS/proxy 경로·BG 완주·MCP 도구 사용·단독 gate 개방을 확인한 결과가 아니다.

이 진단으로 원본 조합의 초기화 장애에 capability 노출이 기여한다는 것을 실제 전체 JS 경로에서 확인했다. 진단 guard를 운영 asset에 복사하거나 원본 1.10 호환 성공으로 보고하지 않는다.

### 5.3 원본 함수와 실제 BG session 수명

| 시험 | 관찰값과 한계 |
|---|---|
| RCM 원본 installRequestHooks/syncCommittedOutput 함수 본문 | listener는 context/prepare 완료 전 undefined를 반환. context와 backend 의존성은 제어된 fixture다. |
| 원본 fallback 분기 | listener 부재 시 afterRequest가 답변 문자열을 돌려주고 1500ms timer 예약. 수동 clock의 timer를 실행한 뒤에만 prepare가 시작됨. |
| 원본 필수 context getter | lore API 부재 시 `getCurrentLorebookEntries is not a function` 재현. 현재 1.0.13의 함수 단위 결과이며 옛 C 실험의 확정 원인으로 대신하지 않음. |
| 원본 initialization gate 함수 | ready=false에서 reject, ready=true에서 통과. 실제 UI Send 시험은 아님. |
| 현 OS 격리 BG session의 합성 timer callback | 반환 후 1500ms effect는 session close 전후 0회. timer를 await한 대조군은 1회 완료 후 반환. 둘 다 종료 activeScopes 0. |
| 같은 session에서 원본 listener/sync 본문 | 이미 발행한 readContext→prepare RPC가 해결되기 전 callback reply가 오지 않음. prepare 해결 뒤 reply가 왔지만 이후 500ms heartbeat timer는 close 후 실행되지 않음. heartbeat 예약부만 대표 fixture이며 실제 backend 인계 시험이 아님. |

따라서 기존 settlement가 아무것도 기다리지 않는다는 해석도, 임의의 미래 비동기 효과까지 전부 기다린다는 해석도 채택하지 않는다.

## 6. G2.2a 실행 sub plan

**목적:** 원본 플러그인의 기능 탐지가 실제 제공 API와 일치하게 하고, 기존 정상 API/상수/alias/호출·실패 정책을 보존한다. G2 전체 기억 완주를 이 단위의 완료 조건으로 요구하지 않는다.

**위치/소유자:** foreground `src/ts/plugins/apiV3/factory.ts`, BG `bgPluginHost.cjs`/`bgPluginWorker.cjs`/`bgPluginSession.cjs`의 bootstrap·부재 capability 진단 계약과 해당 회귀 테스트. 진단의 표시/영속 경로를 연결하면 해당 알림 owner도 변경 범위에 포함한다. patcher의 실제 owner/collision을 확인해 기존 소유권을 유지하고 새 factory hook의 소유자를 명시한다. 원본 RCM 및 backend/schema 변경은 없다.

1. 현재 유지 후보의 실제 API registry/alias/constants를 전수 수집한다. foreground runtime registry와 BG dispatcher의 실제 지원 집합을 노출 정본으로 삼는다. 이 보고서의 83개 고정 목록이나 옛 35개 switch 목록을 제품 allowlist로 복사하지 않는다.
2. foreground guest 실행 전에 목록을 초기화하고 cache 우선 처리를 보존한다. BG는 부모→worker bootstrap에서 검증된 목록을 넘기며 허용 인자/권한 검사는 부모에 남긴다. bootstrap 이전 탐지나 unknown then 때문에 초기화/Promise가 잘못 동작하지 않게 한다.
3. actual registered method/alias/constants 전수 parity, 미래 등록 method, 없는 optional API의 typeof/in/direct-call 동작, 정상 callback/stream/abort/권한·unsupported RPC를 시험한다. 부재 접근 진단의 귀속·중복 억제·통지 실패와 bridge 탐지 제외도 검증한다. 원본 MARP/PF/현재 플러그인 조합의 실제 사용 API를 정적으로 대조하고 영향 경로의 자동 회귀를 수행한다. `.catch()`만 둔 부재 API 호출처럼 오류 형태가 달라지는 경우를 별도 기록한다.
4. 데이터 없는 실제 브라우저에서 원본 RCM 메뉴→설정 저장→reload→보호 API 연결을 재실행하고, BG에서는 optional 부재 처리와 필수 미지원 API의 실제 결과/알림을 기록한다. RCM 기본 도구 설정을 강제로 끄지 않는다. 이후 변경 범위에 맞는 repository checks/구조·runtime 검수와 installer graph/re-plan/exact revert를 수행한다. 운영 전달은 기존 G2.5 순서를 따른다.

**단위 완료 조건:** 노출 집합과 실제 registry/dispatcher가 일치하고 기존 API 의미의 회귀 검증 결과가 있으며, 원본 RCM 초기화 경계의 개선과 BG 잔여 실패가 구분돼 있다. 부재 API 접근이 조용히 사라지지 않고 정확한 범위의 진단으로 남으며 기존 unsupported RPC 정책을 보존해야 한다. **필수 API·MCP·의도적 차단 계약을 검증하기 전까지 RCM+BG 조합은 지원 미검증/운영 활성화 대상 아님으로 명시**한다. 지원하지 않은 API를 성공한 것처럼 꾸미지 않는다. 완료 뒤 필수 read API·MCP·의도적 차단은 G2.2, 저장 후 수명·lease/N+1은 G2.3, 실패/복구는 G2.4로 이어진다. output listener는 §3.2/§4 계약과 시험으로 근거를 갖춘 뒤 해당 단위에서 구현한다.

별도 sub plan이 필요한 이유는 새 제품 범위를 늘려서가 아니다. 기존 G2.2 표 한 행 안에 foreground/BG 두 실행 면의 공통 결함, 전체 플러그인에 영향을 주는 오류 형태 변화, G2.1 브라우저 재확인까지 연결되는 독립 수정 단위가 생겼기 때문이다. 저장 후 효과·lease·실제 기기 항목은 이미 G2.2~G2.5와 공통 경계에 포함돼 있어 별도 목표를 추가하지 않는다.

## 7. 증거와 완료 범위

ignored 증거: `.code-review/workspaces/bg/g22-host-design/`의 `proof.json`, `timer-proof.json`, `rpc-settlement-proof.json`, `browser-prototype-manifest.json`, `browser-connect.json`, `browser-reconnect.json`, `close-readback.json`과 실행 스크립트/스크린샷. 원본/진단 소스와 실제 주소·token은 공개 문서에 복제하지 않는다.

계획 자문은 A/B가 배타적이지 않으며 capability만으로 BG 의미·lease·차단이 해결되지 않는다는 점을 지적했다. 직접 추가 조사로 상류 listener의 존재를 확인했고, 현재 host close/commit 순서와 RPC/timer의 차이를 실측해 listener 단독안을 제외했다. 모델/유료/provider 실행, 운영 적용, G2 통합 L1~L6·iPhone·stable은 이번 검증 범위가 아니다.
