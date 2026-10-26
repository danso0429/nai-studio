# BG Preserve 순차 목표 계획

현재 선택과 다음 작업 (2026-10-15): 사용자가 **RCM 설치·BG 연동을 현재 G2 방향으로 선택**했고, AC는 **미래 후보(DEFERRED)**로 남기기로 했다. G2.1 backend 격리 설치 뒤 원본 PocketRisu 1.10의 API 노출 오류를 확인했다.
**현재 상태 (2026-10-26):** G2.2 계획 단위를 모두 마쳤다(아래 「G2.2 완료 기록」). E2 선행 통합을 마쳤다: patcher `68b7426`을 `origin/main` `84014e0` 위로 rebase해 `28e4ef1`로, D3 세션 기록을 `6737534`로 push했다(이 문서와 기록의 `68b7426`은 `28e4ef1`을 뜻한다. 트리 차이는 `84014e0`의 기록 파일 하나). 이 저장소의 계획 commit도 함께 push했다. live에는 적용하지 않았다. 다음 G2 단계(G2.3~)는 열지 않았다.

**G2.2 완료 기록 (2026-10-26 KST):**

- **D3 답변 뒤 출력 동기화:** patcher `68b7426`(0.2.4-experimental.87, adapter 0.7.82, [계획](BG-G2-2-D3-OUTPUT-SYNC-PLAN.md)). 블라인드 시험·구현·Codex 코드 검수 2회·후보 gate 19/19·probe 통과. 사용자 결정 2건(결과 공개는 창 전, 읽지 않은 응답 본문은 EOF·오류·취소까지 창 유지). 원본 RCM 실측에서 창 안 출력 동기화·`drained`·N+1 대기를 확인했다(계획 「구현 뒤 원본 RCM 실측」). 세션 기록 patcher `docs/records/2026-10-26-g22-d3-session.md`(미commit).
- **D2 원본 RCM 실측:** 도구가 첫 BG 요청에 실리고 비스트림 도구 호출이 recall 결과를 다음 요청에 넣으며 작업 뒤 등록이 비는 것을 확인했다([D2 계획](BG-G2-2-D2-MCP-PLAN.md) 「검증 결과」).
- **D4 추출 engine·lease:** 결정(server engine 필수·턴별 창)대로 창 안 heartbeat가 server engine 추출을 시작하고, 약 45초 시작 창 밖의 job은 다음 heartbeat까지 대기함을 확인했다. 별도 구현은 없다.
- **G2.5 지원표로 넘길 한계:**
  - Chat Completions 스트림에서 RCM 도구 호출은 RCM 자체의 `chat_changed` 응답을 돌려주고 recall하지 않는다. foreground 스트림도 같으므로 BG 결함이 아니다.
  - D3 이후 RCM 사용 턴 일부에 `plugin_late_call`(phase `after_request`) 알림이 보인다. RCM beforeRequest의 500ms timer가 열린 host에서 만료 scope로 거절되는 것으로 추정하며, 창 안 heartbeat는 정상이다. 사용자 결정(2026-10-26)으로 수정하지 않고 한계로 둔다.
  - `risu` engine(새 설치 기본값)은 BG 미지원, 새 채팅은 초기 보정 처리 전 추출 없음, 느린 모델에서 시작 창 밖 job은 다음 턴·브라우저 접속까지 대기.
- **남은 것:** patcher `68b7426`과 계획 commit들의 push, §9.1 예비 조사 표의 module selector(로어 parity는 G2.2b로 닫음) 배정, live 적용.

**G2.2 뒤 다음 순서 (사용자 결정, 2026-10-26 KST):** RCM 운영 설치 전에 실행 기반을 먼저 옮긴다. 각 단계의 상세 계획은 그 단계를 시작할 때 작성해 보고한다.

**순서 근거:** G2.3(경쟁과 수명)·G2.4(실패·복구)는 실제 RCM을 PocketRisu host 위에서 재는 단계라, target을 바꾸면 근거를 다시 재야 한다(G2.1 행 「버전이 바뀌면 소스와 동작을 다시 대조한다」). 공식 릴리스 노트상 1.10.0 뒤 RCM이 쓰는 플러그인 API가 바뀌었다(1.13 `parseRisuChat` 추가, 1.14 `getChatFromIndex`·`setChatToIndex` 수정, 1.16 `pluginStorage.getItem` 수정). BG host는 이 API를 foreground와 같게 맞추므로 parity 기준도 1.16.1로 바뀐다. 따라서 E2는 G2.3 진입 조건이다. E1은 G2 단계와 독립이다. 공식 PocketRisu Dockerfile은 1.10.0·1.16.1 모두 `node:24-slim`이고 `engines`는 `>=22.12.0`이다. E1을 E2보다 먼저 해 Node 변경과 rebase 변경의 회귀를 분리하고, E2 검증을 목표 런타임에서 한 번에 돌린다.

1. **E1 Node 24 LTS 전환 (G2 단계와 독립, 바로 진행 가능).** live PocketRisu와 PM2 프로세스는 Node 25.9.0으로 실행 중이다(2026-10-26 확인). Node 공식 배포 목록(`nodejs.org/dist/index.json`, 2026-10-26 조회)에서 25 계열의 마지막 배포는 25.9.0(2026-03-31)이고 그 뒤 보안 배포가 없다. 24(Krypton LTS)는 24.22.1(2026-10-20, 보안 배포)까지 이어진다. 26은 아직 LTS가 아니다. 전환 대상은 live 서비스와 검증 환경(후보 gate·probe·RCM backend) 모두이며, native 모듈(better-sqlite3 등) 재빌드와 사용자 데이터 보존이 핵심 위험이다. 데이터 위험은 Node 버전이 아니라 재설치 절차에서 생기므로, 시작 전에 검증된 최근 백업 세트를 확인한다(2026-10-26 확인: 2026-10-25의 save tar와 bin 백업이 원격에 크기 일치로 존재. 10-25 13:54 UTC 첫 bin 시도의 HTTP 426과 13:59 로그인 시간 초과는 재시도에서 해소됐고 원인은 확인하지 않았다).
   - **2026-10-26 사용자 결정:** 목표는 Node 24, 전환은 짧은 계획 재시작(10-21의 무중단 병렬 방식 대체), 범위는 live 프로세스·PM2 daemon·systemd unit·`.profile`/nvm default이고 Node 25는 rollback용으로 남긴다. 의존성 audit과 MCP 인증정보 회전은 별도 과제다.
   - **26 대신 24인 이유:** patcher 플러그인 sandbox는 Node 25 이상만 허용한다(`bgPluginSandbox.cjs:32`). 24의 권한 모델은 네트워크를 막지 않지만, sandbox 명령행의 bwrap 네트워크 namespace가 막는 것을 실측했다. 26에서는 현 worker가 fd 3 socket을 열지 못해 시작하지 못하고, better-sqlite3 12.9.0(1.16.1 lockfile도 동일)이 26을 지원하지 않으며, 업스트림은 Node 24만 시험·배포한다. 따라서 E1은 sandbox의 Node 24 허용(patcher 변경 단위)을 포함한다. 재검토 트리거: 업스트림의 Node 26 전환, 24 지원 종료(2028-04-30) 접근, namespace 격리 우회 사례.
   - 상세 계획: [E1 계획](BG-E1-NODE24-PLAN.md).
   - **2026-10-26 완료:** patcher 0.2.4-experimental.88(`7c84a00`, push·CI success)이 sandbox를 Node 24에서 허용한다. live는 patcher를 바꾸지 않고(adapter 0.7.62, 플러그인 host OFF) 앱·PM2 daemon·logrotate·systemd unit을 Node 24.22.1로 옮겼다. 새 로그인 셸의 기본값도 24다. 결과와 한계는 계획 §10. 플러그인 host를 켜기 전에 adapter 0.7.83 이상을 live에 적용해야 한다. 다음은 E2.
2. **E2 선행: 1.10.0 기준 작업 통합.** patcher `68b7426`(D2·D3)을 push해 `origin/main`에 통합하고(현재 `origin/main`의 `84014e0`과 갈라져 있음), 계획 commit도 push한다. 1.10.0 기준 작업을 한 줄로 모은 뒤 rebase 기준점으로 삼는다. push는 사용자 확인 뒤 진행한다.
3. **E2 PocketRisu 1.16.1 rebase (G2.3 진입 조건).** 공식 PocketRisu는 `v1.16.1`(2026-10-24)까지 배포됐고, `v1.10.0...v1.16.1`은 392 commit·300개 이상 파일 변경이다(GitHub compare, 파일 목록 상한 300). BG만이 아니라 patcher 전체 pack의 target 이전이다. 1.9 → 1.10 때처럼 별도 rebase audit 문서를 정본으로 두고, 이 계획은 그 결과를 선행 조건으로 참조한다. 같은 target을 쓰는 Kei 통합 트랙의 순서와도 함께 정한다. D2·D3를 포함한 BG 검증은 1.10.0 기준 관찰값이라 1.16.1에서 다시 검증한다.
4. **그 뒤** G2.3 이후 단계와 RCM 운영 설치를 진행한다.
   - **플러그인 host를 live에서 켜기 전 확인 (E1 결과):** ① live의 lazy-chat-bg-adapter가 0.7.83 이상인지 확인한다(E1-1 sandbox Node 24 허용 포함, `bgPluginSandbox.cjs:32`). 0.7.62 이하는 Node 24에서 sandbox를 `plugin_sandbox_environment_unsupported`로 거절해 플러그인이 실행되지 않는다. E2 결과물을 live에 적용하면 충족된다. ② Node 24에서 플러그인 네트워크 차단은 커널 network namespace 한 겹이라는 한계(E1 계획 §4)를 받아들인 상태인지, 재검토 트리거(업스트림 Node 26 전환, Node 24 지원 종료 접근, namespace 격리 우회 사례)가 생기지 않았는지 확인한다.

이전 상태 (2026-10-23): G2.2 진행 중. 완료한 하위 단위는 다음과 같다.

- G2.2a capability 정확화.
- G2.2b BG `getCurrentLorebookEntries`(patcher `dd5641a`).
- G2.2c RCM 1.0.21 실측([기록](BG-G2-2C-RCM-MEASUREMENTS.md)).
- D1-a beforeRequest 실패 시 요청 실패(patcher `5e3ed85`, [계획](BG-G2-2-D1A-BEFORE-REQUEST-FAILURE-PLAN.md)).
- NF-1 BG plugin RPC의 비유한 숫자 전달(patcher `605c49c`, experimental.85, [계획](BG-G2-2-NONFINITE-RPC-VALUES-PLAN.md)). 답변 뒤 `reloadKeys`가 `NaN`이 되어 `getCharacter()`가 실패하던 한계를 닫았다.
- D2 BG 플러그인 MCP 도구(patcher `5ab963b`, experimental.86, adapter 0.7.81, [계획](BG-G2-2-D2-MCP-PLAN.md)). 블라인드 시험·구현·Codex 코드 검수 3회·후보 게이트 19/19·probe 4종 통과까지 마쳤다. 원본 RCM 실측(계획의 검증 단계)과 push·live 적용은 하지 않았다. 세션 기록은 patcher `docs/records/2026-10-23-g22-d2-session.md`(`8a18c1a`).

남은 G2.2 작업은 아래 순서로 진행한다. D3·D4 결정은 [G2.2 실행 계획](BG-G2-2-EXECUTION-PLAN.md) §3(B)를 따른다.

1. **D3 답변 뒤 출력 동기화**([계획](BG-G2-2-D3-OUTPUT-SYNC-PLAN.md)). 구조 A+D·시한 10초 등 결정과 계약 표를 마쳤다. 테스트 전에 실측 P1·P2를 D2 commit 뒤 HEAD에서 수행한다.
2. **D2 원본 RCM 실측**(D2 계획 「검증 단계」).
3. **G2.2 완료 기록.**

아래 이 문단 이전·이후의 날짜별 문단은 당시 상태의 기록이다.
[호스트 호환성 검토](BG-G2-HOST-COMPATIBILITY-REVIEW.md)에 G1 잔여 의존 표와 확정한 capability 수정안·격리 검증을 기록했고, 당시 다음 구현 단위는 §9.3의 G2.2a sub plan이었다. 2026-10-16 사용자 진행 결정으로 §9.1의 진입 근거를 **G2.2a 한 단위에 한해** 기록했다(§9.1 「진입 근거 기록」). 진단본에서 원본 RCM 설정/보호 API 연결을 확인했으나 정식 호스트/운영 적용과 BG 기억 완주는 미완료다. G2.2~G2.5는 G2.2a 결과를 본 뒤 별도 진행 결정이 필요하다. 2026-10-17 G2.2a 후보(experimental.56/adapter 0.7.60)를 patcher branch에 구현·자동 검증했고, 수정하지 않은 원본 RCM의 브라우저 초기화·설정 저장·보호 API 200과 BG 부재 API 진단을 확인했다([G2.2a 검증](BG-G2-2A-CAPABILITY-VALIDATION.md)). push·운영 적용·실기기 확인은 하지 않았다.
자체 점수표나 유료 AC·RCM 품질 비교를 선택/설치의 선행 조건으로 두지 않는다. 아래 ‘G2.0 조사 checkpoint’·‘최신 계획 개정’·‘최신 제한 범위 L6 정리’ 문단의 당시 선택 대기·G2.0 시작점·G2 공식 AC 표현은 역사 기록이다. 이 문단들과 그 안의 이전 우선순위 선언보다 **현재 이 문단과 §9**를 우선한다. 제품 선택과 격리 시험은 운영 활성화·BG 완주·G1 잔여 면제·stable 완료를 뜻하지 않는다.

G2.0 기능 노출 검증 (2026-10-15): 사용자 검증 요청에 따라 원래 호스트 A와 시험 복사본 B(listener 한 개 비노출)·C(미구현 최상위 이름 비노출)를 동일 새 fixture로 2회씩 비교했다. 각 run 10개 사례·총60개에서 반복 signature와 정리를 확인했다. B에서 AC는 input/before/after 설치와 fixture 503 요청까지 진행했고 RCM은 registerMCP 미지원으로 이동했다. C에서 RCM도 훅을 설치했으나 before_request의 API 이름 없는 hook 오류가 남았다. 첫 기능 탐지 장벽의 기여는 확인했지만 RCM의 1500ms fallback 실행이나 어느 제품의 기억 완주도 입증하지 않았다. 수정은 격리 worker 복사본의 guard 한 줄에 한정했고 원본/운영에는 적용하지 않았다. 상세는 [후보 비교 보고서 §7](BG-G2-0-CANDIDATE-COMPARISON.md#7-기능-노출을-바꾼-격리-인과-검증)이다.

G2.0 조사 checkpoint (2026-10-15): [후보 비교 보고서](BG-G2-0-CANDIDATE-COMPARISON.md)에 공식 AC 4.9.0·RCM 1.0.12의 배포 무결성, 실행 배치와 초기 격리 실험을 기록했다. 현재 정본과 같은 호스트의 대조군 5개·후보별 초기화 중단 4회 재현를 실행했고, 제품 양쪽의 listener 부재 fallback은 현재 Proxy의 함수 노출 때문에 선택되지 못했고 load 중 `addRisuChatListener` 미지원으로 비활성화돼 요청 훅·backend 호출에는 도달하지 못했다. 호스트/원본을 확장하지 않았고 운영 변경·실제 모델/임베딩 호출은 없다. 0-B는 초기화 경계 확인까지이며 기억 저장/다음 턴 반영은 미실행이다. 공통 품질 사례 6개는 사전 작성만 했고 0-C 실측·0-D 사용자 선택·G2 본 구현은 미완료다. 보고서의 관측 범위와 선택 후 의존 조건을 따른다.

최신 계획 개정 (2026-10-15): G2는 AC 채택을 전제로 한 구현에서 **AC·RCM 비교 → 사용자 선택 → 선택한 공식 기억 플러그인의 서버 완주**로 변경한다. 현재 다음 계획 단위는 §9의 G2.0이다. 두 제품 동시 지원, RCM 채택, 유료 비교 시험, 운영 설치·설정 변경을 확정한 것이 아니다. G1.10의 아래 제한 범위 종결과 미확인 항목은 유지한다. 날짜별 checkpoint의 당시 다음 작업·host OFF 상태·AC 확정 표현보다 이 개정과 §9를 우선한다.

최신 제한 범위 L6 정리 (2026-10-15): 사용자가 MARP 전체 분석 미확인·지연 원인과 남은 실제 기기 시나리오를 별도 한계로 기록한 뒤 현재 checkpoint를 정리하도록 결정했다. 격리 실제 제공자 분석/main·실패 뒤 정상 후속·복귀 전 canonical 저장과 실제 iPhone 앱 종료 뒤 저장/정상 복귀를 각각의 관측 범위로 남긴다. 앱 전환·잠금·설정 저장·편집/대기열·중지/복구·실패·모듈 선택의 추가 기기 확인은 보류/미기록이며 스트리밍도 기존 결정대로 미기록이다. 코드8adb75f/experimental.48/adapter0.7.55·host1/commit1을 유지하고 문서/기록만 정리한다. 전체 시나리오 통과나 stable 발행을 뜻하지 않으며 G2 공식 AC는 후속 별도 목표다. 이전 OFF/기기 대기 문단은 당시 checkpoint의 기록이다.

최신 UI 후속 상태 (2026-10-14): 사용자 비스트리밍 L5에서 기존 `요청 중` 카드가 대기용 표시보다 우선하는 경로를 확인했다. `2aa7ba2`/experimental.44/adapter0.7.51은 서버 중계 connecting 카드도 주문구를 `서버 처리 중`으로 표시하고, 입력창 위 일시적인 상태 조회 실패 문구를 제거했다. 서버/native/status-store는 변경하지 않고 busy unknown·기존 충돌/복구 입력을 보존했다. 준비 전송의 실제 서버 상태 중계·조회503·원형 중지·재진입/후속저장과 scoped L1~L4·source-only push·hostOFF client 전달/독립 readback을 완료했다. 이전 비스트리밍 제목 L5는 통과가 아니며 새 후보 재확인이 대기다. 사용자가 쓰지 않는 스트리밍 기기 항목은 명시적으로 미기록으로 남겼고, 자동 stream 증거를 기기 통과로 바꾸지 않는다. Whole G1.10/provider/hostON/stable은 별도다.

최신 UI 전달 상태 (2026-10-13): `49522f6`/experimental.43/adapter0.7.50은 상단 `서버 처리 중`을 실제 주문구로 표시하고 중복 모델 상세를 제거했다. 준비/nonstream 카드·별도 text Stop 제거, 일반 원형 중지, 실제 streaming preview의 text Stop과 상단 대기 표시 takeover를 유지한다. L1~L4·Opus 자문·세 가지 실제 브라우저 합성 경로·graph/re-plan/exact revert·source-only push·hostOFF live build/restart와 독립 readback을 완료했다. 앞선 로컬 `73beb80` 미전달 상태는 해소됐으며 새 UI iPhone L5와 scoped L6는 대기다. Actual-provider/MARP·hostON·G1.10 aggregate/stable은 이 UI 전달로 종료하지 않는다. 상세 검증은 local private UI validation에 보존한다.

작성일: 2026-09-20 KST
개정일: 2026-09-21 KST — 별도 연결 패치와 기존 패치의 좁은 수정을 기본 접근으로 명시
진행 기록: 2026-09-24 KST — G1 root 효과 경합 재현과 구현 순서를 반영
진행 기록: 2026-09-27 KST — G1 격리 후보, 최신 patcher 본체 조합, live 후보 적용, iPhone 비적격 호출과 MARP 전처리 경로 조사를 반영
개정일: 2026-09-27 KST — 서버 요청 터널(서버 플러그인 호스트) 방향, 사용자 결정, 실측 결과를 반영해 목표·순서·완료 조건을 재구성
개정일: 2026-09-28 KST — 끝난 서버 작업을 앱이 닫지 못하는 문제의 조사 결과와 수정 계획(G1.12)을 추가
진행 기록: 2026-09-29 KST — G1.12 수정 계획 1번과 3번의 앱 쪽 핫픽스를 전달하고 기기 확인을 기록
진행 기록: 2026-09-30 KST — G1.12를 보존한 G1.1 anchor 저장 후보를 검증·검수·live 전달하고 안내된 iPhone 시나리오의 정상 확인을 기록
개정일: 2026-09-30 KST — 요청별 판정의 자체 모델 경로를 대기열보다 앞에 두고, 플러그인 허용은 호스트 검증 뒤로 분리

개정일: 2026-10-03 KST — G1.5a 구현·자동 검증·라이브 전달 및 수동 앱 입력 복구 결과 반영, 다음 구현은 G1.4
진행 기록: 2026-10-03 KST — G1.4 대기열·생성 버튼과 G1.12 종료 취소 응답을 검증·라이브 전달, 다음 구현은 G1.8 최소 알림 기반
진행 기록: 2026-10-07 KST — G1.12a 선행 계측 후보를 라이브 전달, iPhone 측정 및 종료 결과 판정 수정은 진행 중
진행 기록: 2026-10-08 KST — G1.12a 종료 결과 수정은 experimental.22로 전달. 사용자 지시로 BG 구현을 일시 중지하고 capability 반환 회귀와 접수 전 대기를 실측 조사한 뒤 아래 보완 계획을 추가. 구현·배포 재개 승인은 아님
진행 기록: 2026-10-09 KST — 후속 사용자 요청으로 세부 계획 검토 뒤 CAP 전체를 구현·자동 검증·검수·push·live 전달했다. 전용 CAP 브랜치의 experimental.23/adapter0.7.30이며 G1.12b WIP는 분리·보존했다. 이후 일반 사용 기기 확인의 정상 보고로 해당 CAP gate를 종료했다. 준비 Stop/raw 등 route별 기기·aggregate/stable gate는 유지한다.

개정일: 2026-10-09 KST — Opus 자문과 원본 MARP Lite 검토를 반영해 G1.7/G1.11/G1.5b의 동등성·수명·설정 저장 검증, 실패 관찰 범위와 진단 결정 시점을 보강했다. 아래 신규 실험은 계획이며 통과 기록이 아니다.

진행 기록: 2026-10-11 KST — M7의 이전 종결을 확장 감사로 재검토하고 lifecycle·영수증·동시 공유 자원 결함을 수정했다. Experimental.34/adapter0.7.41 자동검증과 독립 hostOFF 전달/readback을 종결했다. 실제provider·기기·failure/stream·전체G1·hostON/stable은 후속목표의 gate로 유지하며 startup 복구 분류·journal수명은 G1.8 ACTIVE에 연결했다. 현재 결론은 §8의 M7 후속 종결 문단을 따른다.

상태: 목표·세부 과제·완료 조건의 정본 계획이다. §6의 실측은 격리 재현과 읽기 전용 조사이며 G1 완료나 stable release를 뜻하지 않는다.

최신 실행 상태 (2026-10-12): G1.9의 구현·자동 검증·hostOFF 전달과 안내한 네 가지 합성 iPhone L5를 종결했다. 사용자 정상 보고와 normal-chat API200/중복행ID 없음·terminal input/operation·inactive preview를 별도 연결하고 scoped L6 기록·문서·push·완료L3 정리를 닫았다. 현재 다음 목표는 G1.10 실제 공급자/MARP·최종 조합 검증이며 hostON/stable은 미실행이다. 앞선 G1.9 자동 checkpoint의 L5 대기는 이 최신 상태로 대체한다.

2026-10-13 UI 계약 개정: 사용자 요청으로 준비/nonstream의 입력창 위 이름·서버 처리 중·별도 생성 중지 표시를 제거했다. 대기 상태는 기존 상단 요청 표시를 사용하고 일반 중지는 원형 버튼을 사용한다. 명시적 텍스트 Stop은 실제 streaming 미리보기에만 남긴다. Queue 입력 초안의 Send와 원 Stop을 함께 보존하고, 기존 native/orchestrating 경로와 설정 override를 유지한다. Experimental.42/adapter0.7.49/00e5f8a 자동검증·소스 후보 전달을 완료했으며 hostOFF 라이브 build/restart/readback은 private UI 전달 기록으로 연결한다. 상단 placeholder는 native 진행 표시로 교체되고 고유 presentation id·관측 시계·작업별 중지 guard·cleanup을 사용한다. 이전 S2/S3의 별도 분석/nonstream Stop UI는 이 사용자 지침으로 대체되며 취소·원문·결과 보존 계약을 폐기하지 않는다. 실제 공급자·ON·새 UI iPhone·전체 G1.10·stable은 별도 gate다.

G1.10 S2/S3 checkpoint (2026-10-12): 실제 UI와 원본 MARP를 연결한 편집/N+1, 분석·stream/nonstream 중지, A의 중지 응답을 B main 이후까지 지연한 경합을 검증했다. 준비 단계 중지 버튼 누락을 experimental.41/adapter0.7.48로 수정하고 hostOFF live apply/build/restart·독립 readback까지 전달했다. Source505/servedJS175/DB5·online/unstable0/active0/newerror0·기존operation132보존, 인증host0/commit1을 확인했다. 원격에는 내부 계획·원시 기록을 제외한 소스 전용 후보 branch만 발행했다. ModuleId가 연결된 v2 input helper→독립preset→MARP/main·canonical scriptstate와 부재/복귀/후속 전송을 연결했고, 격리 분석/main restart는 원문·before_result 알림/ACK·재실행0과 unknown fence 유지/같은채팅재전송 차단을 확인했다. 원본 PageFold CAS·settlement는 별도 사례에서 경쟁 통계2/정확답변·부재 중 경고·복귀 표시/ACK·재표시0·후속 통계3과 PDF의 모든 분석 tuple을 검증했다. 초기 fixture/결합oracle/PDF공백 실패는 제외해 보존하며 최종 증명 단언 보강과 자문을 해당 validation에 연결한다. 실제provider·운영ready·hostON·iPhone aggregate·stable은 미완료다. 최신 실행 정본은 로컬 patcher G1.10 PLAN/VALIDATION의 S2/S3이며 내부 문서는 공개하지 않는다.

G1.10 착수 기록 (2026-10-12): G1.9 `3740c66`과 원격 일치를 확인하고 별도 `codex/pocketrisu-g110-qualification` worktree를 분리했다. Runtime/installer는 앞선 자동 gate `afc5346`과 같고 문서4경로만 달라 기존수치는 같은소스의 이전관찰로 연결한다. 현재 패처52/0, candidate/live504파일 byte/mode 일치, 원본플러그인 합성 조합10프로필·종료tasks0, fullgraph42packs/1636units/8collisions/506paths·replan0·1022파일 byte/mode/link/path exactrevert를 확인했다. Opus 계획자문과 현재owner 판독으로 M7의 옛pendingbaseline을 G1.8 이후 applied-target-absent 분류로 대체해야 함을 확인했다. Read-only commit진단은 durable쓰기0이나 inputowner대체·현재hydration한계가 있어 ON 준비완료로 계산하지 않는다. 다음실행은 원본MARP+nativepreset stream의 실제Send→browser종료→복귀전normalAPI저장 통합사례이며 module/queue/edit/Stop·원본provider경고·실제공급자조건·단계적ON·D1~D8/L6은 미검증이다. 정본은 patcher `docs/POCKETRISU-G1-10-QUALIFICATION-PLAN.md`·`...-VALIDATION.md`다.

G1.10 S1 종결 (2026-10-12): 원본MARP+nativepreset stream의 실제UI Send를 격리합성 환경에서 실행했다. 분석보류·main미리보기 중 ownedChromium SIGKILL을 각각확인하고 복귀전 normal-chat API의 입력1/정확답변1·행ID/revision, 복귀뒤 값/행/revision·호출수보존과 다음Send를 연결했다. 저장된설정의 모델multiset과 operation별분석ID가 main주입까지 일치하며 다음Send뒤 기존두행도정확히같다. 두종료사례는각6analysis/2main, agent하나OFF4/2·MARP OFF0/2, classic closed1main/healthy-next2main·pageerror0/취소0, 패처52/0·syntax/diffcheck·최종slice task0을확인했다. Opus 계획/최종/delta자문과 L3/L4를 닫고 진단코드 `8b072b5`를로컬commit했다. Product/installer/version/live/actual-provider/ON은변경하지않았고 raw기록은local private에보존한다. 앞선public문서push거절은재시도하지않는다. 다음은step3 edit/queue·분석/main Stop·module·격리restart·원본provider경고통합이며 실제공급자/운영ready/iPhone/전체G1.10/stable은미검증이다. 정본은같은G1.10 PLAN/VALIDATION의최신S1절이다.

G1.9 구현·자동 검증·hostOFF 전달 checkpoint (2026-10-12): experimental.40/adapter0.7.47에서 현재 서버 답변의 읽기 전용 서식 미리보기와 명시적 현재 작업 중지를 구현했다. 미리보기에는 공통 Markdown/HTML/생각 접기만 적용하고 editdisplay regex/Lua/plugin은 실행하지 않기로 사용자 결정했다. Native frame/OpenAI·Google stream promise, 첫 다음 전송의 확정 저장 retry, 취소 입력의 canonical proof 정산을 별도 수정했다. Frontend2396/기존skip4·server643/기존skip12·patcher52·Svelte0/0, native Gemini/Vertex 합성 실패/중지/다음전송, replan0/1022파일 byte·mode exact revert와 HTTPS 진행/종료복귀 전 저장을 확인했다. Source504/served JS175/DB5/auth200/host0·online/unstable0/active0/newerror0, 기존journal203·operation103 보존으로 실제 전달·독립 readback을 종결했다. G1.9 iPhone L5는 대기이며 실제provider/MARP·G1.10 aggregate·hostON/stable은 별도다. 상세 정본: patcher `docs/POCKETRISU-G1-9-STREAM-RELAY-PLAN.md`, `docs/POCKETRISU-G1-9-STREAM-RELAY-VALIDATION.md`.

## 1. 목표

사용자가 PocketRisu에서 요청을 한 번 보내면, 서버가 **전처리 → ax·main 등 필요한 모델 요청을 정해진 순서대로 → 후처리 → 해당 채팅에 결과 저장**까지 브라우저 없이 수행한다. 앱이 열려 있든, 백그라운드에 있든, 종료됐든 같은 경로로 실행한다.

동기: 응답을 기다리는 동안 앱이 백그라운드로 가면 요청 시간 초과 같은 오류로 이미 받았어야 할 응답을 다시 요청하고 다시 기다려야 했다. 서버가 요청의 전 과정을 소유하면 이 재요청이 사라진다.

목표 순서는 다음과 같다. 각 목표는 독립적인 검증·전달 단위다.

1. **G1.0 — 기존 전체 위임 회귀 복구:** G1 후보 적용 뒤 거절되기 시작한 기존 서버 전체 위임 경로를 복구한다. 다른 목표보다 먼저 수행한다.
2. **G1 — 서버 요청 터널과 첫 사례(MARP):** 서버 플러그인 호스트로 BG preserve가 받을 수 있는 요청의 종류를 넓힌다. preset, module binding, 브라우저 플러그인 훅(MARP)이 있는 요청을 서버가 끝까지 처리한다. 채팅 저장 방식을 anchor 추가 저장으로 바꿔 대기 중 편집과 공존한다.
3. **G2 — 공식 RCM 설치와 서버 완주:** 사용자가 선택한 Risu Cognitive Memory(RCM)의 공식 backend와 JS를 도입하고, 원본 수정 없이 BG 서버에서 기억 준비·주입·출력 처리·기억 저장·다음 턴 반영까지 이어지게 한다. 설치 확인과 BG 지원 검증은 별도 결과다. Archive Center(AC)는 §9.6의 미래 후보로 보존하며 현재 G2의 동시 구현·설치 대상은 아니다.

다음 목표의 본 구현은 앞 목표의 완료 조건을 충족한 뒤 시작한다. 현재 목표의 설계 판단에 필요한 후속 목표의 읽기 전용 조사와 격리 실측은 금지하지 않는다. 후속 목표의 실패나 보류가 이미 완료된 앞 목표를 미완료로 되돌리지 않는다. 단, 후속 검증에서 앞 목표의 실제 결함이 발견되면 해당 결함과 영향 범위를 별도로 수정·재검증한다.

G1.10은 전체 기기 시나리오 통과가 아닌 제한 범위 checkpoint 종결이다. RCM 선택 뒤에는 §9.1의 예비 조사로 G2.1의 데이터 없는 격리 설치·기동 확인과 실행 계획 작성을 진행할 수 있다. 이는 G1 잔여의 완료나 통합 본 구현의 선행 조건 해제를 뜻하지 않는다. G2.2 이후 통합 본 구현 진입 전에 G1 잔여와 RCM 경로의 의존 관계를 표로 남기고, 기존 완료 조건 충족 또는 남은 항목을 명시한 사용자의 진행 결정으로 진입 근거를 기록한다. 예비 조사를 위해 보류 항목 전부를 먼저 재시험하지 않으며, 보류를 통과로 바꾸지도 않는다.

## 2. 확정된 사용자 결정

| 주제 | 결정 |
|---|---|
| 실행 위치 | 앱 상태와 무관하게 항상 서버가 실행한다. |
| 확장 방식 | 플러그인을 수정하거나 재구현하지 않는다. 서버 플러그인 호스트가 제공하는 API와 요청 종류를 늘리는 방식으로 터널을 넓히고, 그 절차를 §4에 기록해 재사용한다. |
| 플러그인 수명 | 2026-10-03 결정: 플러그인마다 요청별 프로세스를 사용한다. 한 작업의 입력·ax·main·후처리 동안 유지하고 끝나면 종료한다. 메모리 상태는 다음 작업으로 넘기지 않는다. Vertex나 opencode에 한정하지 않고 공통 플러그인 API를 확장한다. |
| 첫 사례 | 현재 설치본과 같은 MARP Lite를 기준으로 한다. MARP Full(별도 서버)로 바꾸지 않는다. |
| 플러그인 버전 | 스크립트 hash로 실행을 막지 않는다. 서버 호스트에 없는 API 호출이나 실행 실패가 생기면 그 플러그인의 효과 없이 진행하고, 플러그인 이름·버전·이유를 알림으로 남긴다. |
| 확인창 | 서버가 사용자 대신 예/아니오를 답하지 않는다. 앱에서 이미 저장된 권한 답만 사용하고, 답이 없으면 그 플러그인 없이 진행하고 알림을 남긴다. |
| 최신값 반영 | 프롬프트 조립을 시작하는 시점의 최신 채팅과 설정(캐릭터, 로어북, preset, 모듈)을 사용한다. |
| 조립 뒤 수정 | 조립 이후에 앞쪽 내용이 수정되면 결과를 그대로 저장하고, 수정 내용이 반영되지 않았다는 알림만 남긴다. 자동 재생성하지 않는다. |
| 채팅 저장 | anchor 추가 저장을 사용한다. 채팅 전체 지문 비교와 conflict 사본 생성을 대체한다. |
| 대기열과 버튼 | 처리 중 새 메시지는 N+1 대기열로 받는다. reroll과 이어쓰기는 처리 중 비활성화한다. |
| 재시도 | PocketRisu의 `requestRetrys`와 기존 fallback 설정을 따른다. 플러그인 자체 재시도 정책은 플러그인에 맡긴다. |
| 서버 재시작 | 처리 중 서버가 재시작되면 해당 요청을 실패로 표시하고 알린다. 자동 유료 재실행을 하지 않는다. |
| 알림 | 기존 상단바 규칙(누적, 사용자 삭제 또는 시간 경과 후 사라짐)을 사용한다. 앱이 없는 동안 생긴 호스트가 관찰한 실패·권한 부재·반영되지 않은 수정·저장 conflict 등은 서버에 보관했다가 복귀 시 표시한다. 플러그인 내부에서 흡수한 분석 실패·빈 결과·품질은 일반 호스트가 모두 판정할 수 없으며, §8의 실측 뒤 관찰 정보와 진단 기능의 필요성을 결정한다. |
| 스트리밍 | 스트리밍을 사용하는 설정이면 서버가 받는 스트림을 앱이 실시간으로 볼 수 있게 한다. 스트리밍을 쓰지 않으면 완료 후 표시한다. |
| 외부 요청 헤더 규칙 | 플러그인을 수정하지 않고, 사용자가 명시적으로 켠 목적지별 헤더 규칙을 PocketRisu 서버의 외부 요청 경로에 둔다(G1.11). 첫 용도는 MARP 분석 공급자가 요구하는 대화별 세션 헤더다. 공급자 이용 조건 적합성은 사용자가 판단해 이 방식을 선택했다. |
| 제외 범위 | TTS, 감정 이미지, 이미지 생성은 이번 범위에서 제외하고 필요할 때 설계한다. |
| 기억 플러그인 선택 | 2026-10-15 현재 결정: RCM 설치·BG 연동을 진행 방향으로 선택했다. 1:1 또는 1:2~3 소규모 세계관 대화의 기능·운영 적합성을 근거로 선택하며 인원수에 따른 정확도 우위나 미검증 경로의 수용을 선언하지 않는다. 재선택을 요구하지 않고 G2.1로 이어간다. AC는 §9.6의 미래 후보로 보존한다. |

## 3. 요청 터널 모델

### 정의

서버 실행은 PocketRisu의 `sendChat`을 서버 번들로 실행한다. 브라우저가 부팅 시 등록한 `beforeRequest`/`afterRequest` 훅, 입력 처리 훅, body 가로채기, plugin provider는 서버 번들에 자동으로 전달되지 않는다. 기존 경로는 이 차이를 검사하지 않아 플러그인 효과가 조용히 빠질 수 있었다. G1.6은 이를 담당할 공통 서버 호스트 기반을 구현·전달했다. 최초 전달은 기본 OFF였으며, 2026-10-15 G1.10 종결 기록에서는 host ON·server chat commit ON이다. 이 운영 관찰을 임의 플러그인 지원이나 G1 전체 검증 통과로 해석하지 않는다.

**터널**은 서버가 브라우저와 같은 의미로 처리할 수 있는 요청의 범위다. 터널의 폭은 다음 두 가지로 정해진다.

1. PocketRisu 자체 기능 중 서버 번들에서 동등하게 실행되는 것: classic 모델, model preset 어댑터, module binding, 트리거·Lua, 메모리 계열.
2. 서버 플러그인 호스트가 제공하는 플러그인 API의 범위: 원본 플러그인 스크립트를 격리 프로세스에서 실행하고, 브라우저의 v3 호스트와 같은 의미의 API를 제공한다.

### 플러그인이 요청에 참여하는 방식

| 참여 방식 | 예 | 서버 호스트에 필요한 것 |
|---|---|---|
| 요청 변환 훅 | `beforeRequest`, `afterRequest`, 입력 처리 훅, body 가로채기 | 등록 순서와 호출 시점, 인자·반환 의미를 브라우저와 같게 제공 |
| 플러그인 자체 호출 | 플러그인이 `nativeFetch`로 별도 endpoint 호출 | 호스트 경유 네트워크, 인증 전달, 시간 제한, 취소 |
| 모델 공급자 | `addProvider`로 main·ax 모델 자체를 제공 | provider 함수 호출과 스트림·오류 의미 |

플러그인이 `runLLMModel`로 호스트 모델을 호출하면 그 호출은 다시 PocketRisu의 preset·module binding 해석을 거친다.

### 서버 플러그인 호스트의 구조

- 플러그인마다 권한을 제한한 별도 node 프로세스에서 원본 스크립트를 실행한다. node 권한 모델로 파일 읽기(자기 실행 디렉터리 외), 파일 쓰기, 자식 프로세스, 네트워크를 차단하고, 모든 외부 효과는 부모 호스트와의 메시지(RPC)로만 수행한다.
- 부모 호스트는 PocketRisu 서버 안에서 API 의미를 소유한다: 저장소 읽기·쓰기, 권한 기록 조회, `nativeFetch` 수행, 알림 기록.
- 브라우저 인스턴스와 서버 인스턴스가 동시에 존재할 수 있다. 보내기 요청의 훅은 서버 인스턴스만 실행한다. 두 인스턴스가 같은 외부 상태를 쓰는 플러그인은 사례별로 경쟁을 검증한다(§9).
- 서버 호스트는 사용자 확인이 필요한 UI를 표시하지 않는다. UI 계열 API는 서버에서 아무 효과가 없는 값으로 처리한다.
- 원본 MARP Lite의 설정 화면은 브라우저에 유지하고, 전송에 참여하는 훅은 서버가 실행한다. 요청별 프로세스의 private history/lastRun은 종료 때 사라지므로 기존 브라우저 MARP 진단 화면에 서버 실행 이력이 자동 반영된다고 약속하지 않는다. 원본 수정 없이 보존할 수 있는 일반 RPC 관찰 정보와 플러그인 자체 분석 이력은 구분한다.

## 4. 터널을 넓히는 절차

새 플러그인이나 새 요청 종류를 터널에 추가할 때 다음 순서를 따른다. 플러그인 원본은 수정하지 않는다.

1. **식별:** 플러그인 이름·버전·스크립트 hash와 참여 방식(§3 표)을 기록한다. hash는 기록과 알림용 식별자이며 실행 차단 조건이 아니다.
2. **API 목록:** 정적 조사로 별칭·동적 등록을 포함한 실제 호출 경로를 나열하고, 서버 호스트에서 실행해 unsupported 호출과 누락된 전역 객체에 따른 오류를 구분한다. 브라우저와 서버가 모두 Proxy로 미등록 속성을 함수처럼 제공하므로 `typeof API.foo`만으로 지원을 판정하지 않는다. UI에만 닿는 DOM이나 Worker 부재 시 사용하는 원본 fallback을 요청 훅의 필수 API로 잘못 분류하지 않는다.
3. **API 의미 정의:** 필요한 API마다 서버에서의 의미를 다음 분류로 정한다.

   | 분류 | 서버 의미 |
   |---|---|
   | 요청 처리 (`addRisuReplacer`, `addRisuScriptHandler`, `registerBodyIntercepter`, `addProvider`) | 브라우저와 같은 등록 순서와 호출 의미로 실행 |
   | 네트워크 (`nativeFetch`, `risuFetch`) | 부모 호스트가 PocketRisu의 서버 외부 요청 경로로 수행한다. 출발지가 서버가 되므로 endpoint 도달성과 인증을 확인한다. 요청은 플러그인이 만든 그대로 보내며, 사용자가 켠 외부 요청 헤더 규칙(G1.11)만 적용된다 |
   | 저장소 (`pluginStorage`, `getLocalPluginStorage`, `getArgument`/`setArgument`) | PocketRisu 서버 저장소의 같은 키를 사용 |
   | DB 접근 (`getDatabase`, `getCharacter`, `getChatFromIndex` 등) | 서버의 조립 시점 상태를 제공. 쓰기 API는 브라우저 저장과의 경쟁과 전체 배열 교체 위험을 별도 검증 |
   | 권한 (`requestPluginPermission`, 훅 등록 권한) | 저장된 답만 사용. 답이 없거나 재확인 기한이 지났으면 거부로 처리하고 알림 |
   | 알림 (`alert`, `alertError`, `log`) | 서버 알림으로 기록해 복귀 시 상단바에 표시 |
   | UI (`showContainer`, `registerButton`, `registerSetting`, `getRootDocument` 등) | 서버에서 효과 없음 |

4. **결과 영향 판정:** 결과는 ① 모델에 보내는 요청 내용, ② 채팅에 저장되는 본문·metadata·변수, ③ 플러그인이나 외부가 보관하는 상태다. 같은 입력을 브라우저와 서버 호스트에서 실행해 훅 출력과 ③의 변화를 비교한다. 차이가 있으면 원인 API의 의미를 고치거나, 그 조합을 알림 대상 실패로 분류한다.
5. **실패 규칙 적용:** 호스트가 확인한 로드·권한·API·자원·훅 실패는 알림으로 남기고 기존 변환 체인의 값을 보존한다. 모델 자체를 제공하는 provider 실패는 모델 요청 실패와 native 재시도/fallback 경로로 처리하며 모델 효과만 빼고 성공을 꾸미지 않는다. 이미 수행한 외부 요청·저장소 변경은 rollback됐다고 간주하지 않고 client 재실행으로 중복하지 않는다. 플러그인 내부에서 흡수한 의미적 실패와 관찰 가능한 transport 오류는 분리해 지원표에 한계를 적는다. 기억 플러그인의 의도적인 요청 차단은 일반 훅 고장과 구분해 G2.2에서 신호·호출자 처리를 정의한다. 구분하지 못하는 경우 알림 후 진행이나 전체 차단을 임의로 고르지 않고, G2.4의 사용자 결과 결정 전까지 해당 조합을 미지원으로 기록한다. 이 문장은 현재 runtime 동작을 변경했다는 뜻이 아니다.
6. **보안 검토:** 격리 권한, 비밀값의 전달 범위, 로그에 남는 내용을 확인한다. 비밀값과 프롬프트 본문은 공개 검증 자료에 싣지 않는다.
7. **기록:** 지원표에 플러그인·버전·참여 방식·사용 API·결과 영향 판정·실패 규칙·검증 증거를 추가한다.

## 5. 공통 경계

- BG의 작업·입력·채팅·효과 저장 소유자는 PocketRisu다. 플러그인의 내부 정책과 외부 저장소 소유자는 각 플러그인이다.
- 공식 MARP 및 G2 비교·선택 대상인 AC·RCM 원본은 수정하지 않는다. 실행 시 스크립트 재작성, 이름을 바꾼 수정본, 검사 우회를 원본 호환으로 계산하지 않는다.
- 임의 플러그인을 서버에서 실행하는 것은 격리 프로세스와 §4 절차를 통과한 범위에서만 허용한다. 격리 없는 동일 프로세스 실행이나 일반 권한 우회로 대체하지 않는다.
- 실제 요청의 ax·main·후처리마다 최종 binding·provider·플러그인 훅과 실행 위치를 판정한다. DB에 저장된 전역 모델 ID나 기능 토글만으로 판정하지 않는다.
- 서버에서 처리할 수 없는 요청의 확인된 제약은 유료 실행 전에 알린다. 플러그인 로드 중에도 외부 효과가 생길 수 있으므로 로드가 main보다 앞이라는 사실만으로 무과금 preflight라고 간주하지 않는다. 서버가 인수한 뒤 조용한 client fallback·후처리 생략·호스트가 추가한 중복 실행을 허용하지 않는다. 호스트가 확인한 플러그인 비활성화·실패는 알림으로 드러내며, 내부에서 흡수한 분석 실패·빈 결과를 모두 감지한다는 보장은 하지 않는다. MARP의 실제 누락 관찰과 진단 결정은 §8, 기억 플러그인은 §9의 G2.2·G2.4에 따른다.
- native `requestRetrys`와 fallback이 원래 호출하는 플러그인 분석은 보존한다. 재시도 때 원본 MARP가 분석을 다시 수행하거나 이전 주입을 제거하는 동작을 호스트 추가 중복과 구분하고, 분석 모델·main 모델·OAuth 등의 네트워크 호출을 별도로 센다.
- 호스트는 플러그인이 만든 요청의 URL·본문·헤더를 바꾸지 않는다. 예외는 사용자가 목적지를 지정해 명시적으로 켠 외부 요청 헤더 규칙(G1.11)뿐이며, 이미 있는 같은 이름의 헤더는 덮어쓰지 않는다.
- 기존 정상 기능·사용자 설정·custom endpoint·로컬 모델 경로를 보존한다.
- PocketRisu·플러그인 버전이 바뀌면 patcher anchor 재적용 성공과 호출 경로의 의미적 동등성을 구분한다.
- 이전 테스트 결과는 같은 소스·환경·계약에 한해 재사용한다. 문서, 단위 테스트, 합성 프로세스, 실제 브라우저, 운영 확인의 증거 수준을 구분한다.
- 이 계획은 기존 변경 폐기·live 적용·외부 기여·stable release를 수행하라는 지시가 아니다.

## 6. 실측 결과 (2026-09-27 KST)

격리 재현과 읽기 전용 조사로 확인한 사실이다. live PocketRisu, 사용자 데이터, 유료 provider, AC runtime은 변경하지 않았다.

| 항목 | 결과 | 근거 |
|---|---|---|
| G1 적용 전후 기존 위임 | 적용 전 로그에는 서버 전체 위임 완료가 반복 기록돼 있다. 적용 뒤 3회 전송은 모두 시작 단계에서 거절되고 client fallback으로 전환됐다. 거절 사유는 클라이언트 로그에 기록되지 않았다. | PM2 로그, 클라이언트 로그의 `detached start rejected`→`delegate-not-started` 3쌍 |
| 회귀 원인 | G1 적용으로 capability가 `serverChatCommitVersion=1`을 광고하자 기존 경로도 이를 협상해 `captureBase`를 거친다. 서버는 저장된 채팅과 앱이 보낸 채팅을 `encodeRisuSaveLegacy`(msgpack) 인코딩의 SHA-256으로 비교한다. 저장된 채팅에 값이 `undefined`인 키가 있으면 JSON 전송에서 그 키가 사라져 지문이 항상 불일치한다(`server-chat-commit-input-stale`). live DB 사본 계산에서 전체 채팅 64개 중 거절된 채팅 1개만 불일치했고, 원인 키는 `activeStreamingDisplayOptimizationMode`와 복구된 답변의 `generationInfo.model`이었다. | 서버 코덱 격리 복사본으로 계산. `undefined` 기록 위치: `index.svelte.ts`, `chatStorage.ts`, `jobRecovery.ts` |
| 회귀의 지속성 | 거절 → 앱 생성 또는 model-job 복귀 → `undefined` 키 재기록의 순환이라, 한 번 걸린 채팅은 계속 client fallback으로 간다. | 위 코드 경로 |
| preset 재시도 | preset 어댑터 실패는 PageFold 경로가 아니면 `noRetry`가 비어 있어 외부 루프가 `requestRetrys`만큼 재시도한다. | 코드 추적. 실행 검증은 G1 자동 테스트에서 수행 |
| 격리 수단 | node 25 권한 모델로 자식 프로세스의 타 경로 파일 읽기·파일 쓰기·자식 프로세스·네트워크 접속이 모두 `ERR_ACCESS_DENIED`였다. stdin/stdout 메시지로 호스트 RPC가 동작했다. | 격리 시제품 |
| MARP 서버 실행 | 설치본과 같은 MARP Lite v0.9.2 원본을 수정 없이 격리 프로세스에서 실행했다. `beforeRequest` 훅 1개가 등록됐고, 가짜 OpenAI 호환 공급자로 세계관 분석 1건 뒤 플롯·등장인물 분석 2건이 병렬로 호출됐다. 세 결과가 system 메시지 1개로 주입됐다. 요청 경로에서 호스트에 없는 API 호출은 0건이었고 사용 RPC는 `pluginStorage.getItem`, `getArgument`, `nativeFetch`였다. | 격리 시제품. 브라우저 비교는 아래 동등성 항목 |
| MARP 분석 endpoint 인증 | 사용 중인 분석 공급자는 공개 클라우드 endpoint다. 존재하지 않는 모델 이름으로 생성 없는 요청을 보내 비교했다: 틀린 키는 HTTP 401, 실제 키는 401이 아닌 400이었다. 서버 출발지에서도 키 인증은 통과한다. | 서버에서 과금 없는 요청 2회. 키와 응답 본문은 기록하지 않음 |
| MARP 현재 설정의 실패 | 실제 키 요청의 400 사유는 공급자가 요구하는 세션 헤더(`x-opencode-session`) 누락이다. MARP는 이 헤더를 보내지 않는다. MARP가 저장한 마지막 브라우저 실행 기록(2026-09-18)도 같은 400으로 실패해 주입되지 않았다. 따라서 현재 설정의 MARP는 브라우저와 서버 모두에서 같은 이유로 실패하며, 서버 실행이 원인이 아니다. | MARP `last_run` 기록, 공급자 오류 응답, 공급자 공식 문서 |
| 세션 ID 전달 수단 | 생성 없는 요청으로 비교했다. 세션 ID를 본문 필드 6종(`session_id`, `sessionId`, `user`, `metadata.session_id`, 헤더 이름과 같은 본문 키, provider 옵션)으로 보내면 모두 `MissingSessionID`였고, `x-opencode-session` 헤더로 보내면 세션 오류가 사라지고 모델 없음 오류로 바뀌었다. MARP는 헤더 추가 설정이 없고 본문 추가(`extra_body_json`)만 지원한다(v0.9.2, v0.9.7 동일). 같은 키의 종량 과금 endpoint는 헤더 없이 통과했지만 사용자는 구독 endpoint 유지를 선택했다. | 서버에서 과금 없는 요청. 키·세션 값·응답 본문은 기록하지 않음 |
| 브라우저 플러그인 요청 경로 | 브라우저의 `fetchNative`는 `usePlainFetch`가 꺼져 있으면 목적지로 직접 요청을 먼저 시도하고 실패하면 서버 `/proxy2`로 넘긴다. 이 공급자는 CORS 사전 요청에 HTTP 404를 돌려주고 CORS 헤더가 없어 직접 요청이 실패하므로, 브라우저의 MARP 요청도 서버 `/proxy2`를 거친다. | `globalApi.svelte.ts` `fetchNative`, OPTIONS 요청 1회 |
| MARP 브라우저·서버 동등성 | PocketRisu의 실제 v3 `SandboxHost`(iframe, 메시지 직렬화, 콜백 중계)를 headless Chromium에서 실행한 결과와 격리 프로세스 서버 호스트의 결과를 같은 입력·같은 설정(주소와 키만 가짜로 교체)으로 비교했다. main 요청: 최종 메시지 JSON 동일, 공급자 호출 3건과 요청 본문 3개 동일, 주입 1건. sub 요청: 양쪽 모두 호출 0건으로 우회(`mainModelOnly`), 출력 동일. | 비교 실행기. 브라우저 쪽 호스트 API 객체는 MARP가 쓰는 API만 같은 의미로 구성했고, 실제 앱의 `fetchNative` 프록시 경로는 포함하지 않음 |
| AC 서버 로드 | 공식 AC 4.3.1 원본이 격리 프로세스에서 로드 오류·콘솔 오류 0으로 초기화됐고 `beforeRequest`, `afterRequest`, 입력 처리 훅, body 가로채기, 채팅 listener를 모두 등록했다. 초기화 중 호스트에 없는 API 호출은 0건이었다. | 격리 시제품. AC 백엔드는 실행하지 않음 |
| AC 설정 저장 위치 | `getLocalPluginStorage`는 PocketRisu에서 서버 저장소로 구현돼 기기 간 설정을 공유한다. | `v3.svelte.ts`, `pluginSafeClass.ts` |
| AC 중복 원문 저장 | `chat_logs`에 `(chat_session_id, turn_index, role)` 유일 인덱스가 있어 같은 턴 원문의 이중 저장은 덮어쓰기가 된다. 파생 기억 처리(LLM 호출)의 중복 여부는 미확인이다. | 공식 AC Go 스키마 |
| AC 자체 복구 | AC는 다음 요청의 `beforeRequest`에서 완료된 user/assistant 쌍 중 ledger에 없는 턴을 저장한다. | 공식 AC `ensureActiveChatCompletedTurnsBackfilled` |
| 채팅 conflict 원인 | 채팅 지문은 모든 메시지와 채팅 필드로 계산되고, 기존 결과 적용은 채팅 전체를 서버 사본으로 교체한다. 그래서 대기 중 앞쪽 한 글자 수정도 conflict 사본 생성으로 이어졌다. 캐릭터 카드와 캐릭터 로어북은 채팅 지문에 포함되지 않는다. | `bgOrchestrationMerge.ts`, `serverChatCommit.cjs` |
| 앱 저장과 충돌 | 앱의 채팅 저장은 기준 지문을 가진 JSON patch이며, 서버가 먼저 바꾸면 409/412로 거절된다. 최신 채팅 위에 변경분을 다시 적용하는 처리부는 확인되지 않았다. | `nodeStorage.ts` |

## 7. G1.0 — 기존 전체 위임 회귀 복구

### 사용자 결과

G1 후보 적용 전처럼 기존 서버 전체 위임 경로가 preset 설정의 요청을 서버에서 처리한다. 한 번 거절된 채팅도 다음 전송부터 정상으로 돌아온다.

### 과제

| ID | 과제 | 검증 기준 |
|---|---|---|
| G1.0.1 | 거절 사유 관측 | 서버의 시작 거절 응답 사유를 서버 로그와 클라이언트 로그에 남긴다. 본문·ID·비밀값은 남기지 않는다. |
| G1.0.2 | 지문 비교의 인코딩 차이 제거 | `captureBase`와 같은 경계에서 저장본과 전송본을 JSON 전송과 같은 정규형(`undefined` 키 제거)으로 비교한다. 이 비교는 G1.1의 anchor 추가 저장으로 대체될 때까지의 복구 수단이다. |
| G1.0.3 | 회귀 테스트 | `undefined` 키가 있는 채팅, 일반 채팅, 실제 변경이 있는 채팅에서 각각 수락·수락·거절을 확인한다. |
| G1.0.4 | 복귀 metadata | model-job 복귀 경로가 답변 metadata에 `model: undefined`를 기록하지 않고, 가능한 model·토큰 정보를 보존하도록 수정한다. |

### 완료 조건

1. 격리 환경에서 거절됐던 채팅 형태가 수락되고, 실제 변경이 있는 채팅은 여전히 거절된다.
2. live 적용 뒤 preset 설정의 전송이 서버 전체 위임으로 완료되고 거절 0건이 관측된다. live 적용과 재시작은 사용자 확인 뒤 수행한다.

> G1.0 진행 기록 (2026-09-27 KST): patcher 후보 `0.2.4-experimental.6`, adapter `0.7.13`, 구현 commit `d405404`로 JSON 접수 비교·거절 사유 관측·신규 복귀 metadata 수정을 구현하고 live에 적용했다. Patcher 51/51, 서버 358 pass/12 skip, 프런트엔드 1,920 pass/2 skip, 호환성 74 pass/5 skip, 타입 0/0, frontend/BG build, 42-pack 조합 re-plan 0 및 exact revert를 확인했다. Live HTTP·제공 JS hash·416 managed files·5개 DB 무결성을 확인했다. 실제 preset 전송의 서버 완주와 iPhone 확인은 대기이며, §7 완료 조건을 충족한 것으로 계산하지 않는다. 상세는 patcher `docs/POCKETRISU-G1-0-ADMISSION-RECOVERY-2026-09-27.md`다.

> G1.0 완료 기록 (2026-09-27 KST): 위 대기 상태 이후 실제 전송에서 terminal-success·원래 채팅 commit과 durable journal 본문/receipt revision 일치를 사용자 복귀 전에 확인했다. 새 native model job·pending send·관측 구간 시작 거절/fallback anchor는 0건이며, 사용자가 복귀 후 답변 정상 도착을 확인했다. G1.0 복구 단위를 종료하고 다음 구현은 G1.11이다. 직접 normal-chat HTTP 조회, 브라우저 process 종료 계측, 별도 중복 개수 확인은 미실행으로 유지하며 G1 전체 qualification을 통과 처리하지 않는다. 별도 홈 화면 채팅 진입 실패는 patcher `docs/POCKETRISU-HOME-CHAT-NAVIGATION-BUG.md`에 기록했다.

## 8. G1 — 서버 요청 터널과 첫 사례(MARP)

### 사용자 결과

preset, module binding, MARP가 켜진 요청을 보내면 서버가 조립 시점의 최신 채팅·설정으로 전처리·ax·main·후처리를 순서대로 수행하고 채팅에 답을 저장한다. 앱을 닫아도 되고, 기다리는 동안 앞쪽 메시지·캐릭터·로어북을 수정해도 conflict 사본이 생기지 않는다. 호스트가 확인한 플러그인 실패·비활성화나 수정 미반영은 복귀 시 알림으로 알 수 있다. 원본 플러그인 내부에서 흡수한 분석 실패·빈 결과와 브라우저 진단 이력의 차이는 qualification에서 별도 확인하고 지원 범위에 명시한다.

### 세부 목표

| ID | 세부 목표 | 산출물·검증 기준 |
|---|---|---|
| G1.1 | anchor 추가 저장 | 서버는 저장 시점의 최신 채팅을 읽어 이번 입력 메시지(메시지 ID) 바로 뒤에 결과를 삽입한다. 채팅 전체 지문 비교와 conflict 사본 생성을 제거한다. conflict는 입력 메시지 삭제, 채팅 삭제, 입력 뒤에 서버가 모르는 메시지가 생긴 경우로 한정하고 알림으로 알린다. 변수·통계는 기존 효과 ID 병합을 유지한다. |
| G1.2 | 앱 저장 rebase | 앱의 채팅 patch가 서버 선행 변경으로 409/412를 받으면 최신 채팅을 다시 읽고 변경분을 다시 적용한다. 서버가 추가한 메시지를 앱의 오래된 사본이 지우지 않는다. |
| G1.3 | 조립 시점 최신값 | 입력 인수 시점이 아니라 조립 시작 시점의 채팅·캐릭터·로어북·preset·모듈을 사용한다. 조립 이후 채팅에서 프롬프트 범위의 내용이 바뀌면 결과를 저장하고 "반영되지 않음" 알림을 남긴다. 기존 입력 시점 설정 고정(settings snapshot)의 역할을 재검토하고, 비밀값 처리 경계는 유지한다. |
| G1.4 | 대기열과 버튼 | N 처리 중 N+1을 접수하고 N 저장 뒤 조립한다. 처리 중 reroll·이어쓰기를 비활성화한다. 두 탭·빈 로컬 상태·구형 번들에서 같은 규칙을 확인한다. |
| G1.5 | 요청별 실행 판정 | 전역 토글 가드(`requiresClientOwnedInputPreparation`)와 기존 경로 적격 판정을 하나의 요청별 판정으로 대체한다. 판정 입력은 main·sub·aux의 해석된 binding 종류, provider 종류, 등록된 플러그인 참여 목록이다. 서버에서 처리할 수 없는 조합은 보내기 전에 알린다. |
| G1.6 | 서버 플러그인 호스트 | §3 구조의 격리 프로세스, RPC, §4 API 의미표의 최소 구현, 권한 기록 조회, 알림 기록, 플러그인 로드 순서 재현, 수명 관리(로드·재로드·종료)를 구현한다. 서버 번들의 훅 실행 지점을 호스트에 연결한다. |
| G1.7 | MARP 터널 | 원본 MARP Lite를 현재 공통 호스트와 실제 네트워크 어댑터에서 검증한다. 부족한 API뿐 아니라 이미 구현된 API의 등록·인자·수명·실패 의미를 브라우저와 비교한다. 정상/main·sub·재시도·fallback·헤더/본문 timeout·설정 저장·알림·진단 이력을 아래 qualification 순서로 확인하고 지원표에 기록한다. |
| G1.8 | 실패·재시도·알림 | 재시도는 `requestRetrys`를 따른다. 서버 재시작 중단, 호스트가 확인한 플러그인 실패·권한 부재·수정 미반영·conflict·최종 실패를 서버 알림으로 보관한다. transport 사실과 private 의미적 실패는 구분하며 상태 조회 장애를 입력 수용으로 표시하지 않는다. 일반 RPC 진단 기능은 실패 실측 뒤 필요성과 범위를 결정한다. |
| G1.9 | 스트리밍 중계 | 스트리밍 설정일 때 서버가 받는 스트림을 앱에 중계한다. 앱 종료·재접속 시 완료 결과 조회로 이어진다. |
| G1.10 | qualification과 전달 | 자동검증, 구조 검수, runtime audit, patcher 조합 검증을 수행한다. 실제 브라우저 종료 뒤 재접속 전 일반 채팅 API로 저장 본문을 확인하고, iPhone에서 preset·module binding·MARP 요청의 앱 종료·대기 중 편집·복귀·알림 시나리오를 확인한다. |
| G1.11 | 외부 요청 헤더 규칙 | 아래 상세 명세대로 사용자가 켜는 목적지별 헤더 규칙을 PocketRisu 서버의 외부 요청 경로에 구현한다. 서버 플러그인 호스트와 독립적으로 먼저 전달할 수 있으며, 먼저 전달하면 현재 브라우저 실행의 MARP도 동작한다. |
| G1.12 | 끝난 서버 작업의 앱 정리 | 아래 상세대로, 서버에서 이미 끝난 작업(저장 완료 또는 오류 종료)을 앱이 끝없이 붙잡아 진행 표시·반복 경고·취소 실패가 남는 문제를 고친다. G1.1과 독립적으로 먼저 전달할 수 있다. |

> G1.2 선행 전달 (2026-09-27 KST): 서버의 anchor 추가 저장 전에 앱의 오래된 사본이 새 답변을 지우지 않도록 client save rebase를 `0.2.4-experimental.8` (`99bb589`)로 구현·push·live 적용했다. 서버 답변 저장 후 앱 편집 저장의 순서를 실제 NodeStorage/codec/HTTP/SQLite로 검증했다. 단순 조회와 실제 화면 채택을 분리하고, 화면 채택·DB 교체 시 기존 대기 저장을 무효화하며 불명확한 충돌은 덮어쓰지 않는다. 집중 77/77, frontend 1,943/3 conditional skip, server 388/12 skip, compatibility 74/5 skip, patcher 51/51, 타입 0/0, build/BG load, full graph re-plan 0·exact revert와 live 423파일·DB 5개 무결성을 확인했다. 실제 iPhone 관측은 미완료이며, 편집이 먼저 저장되는 반대 순서는 여전히 G1.1 서버 anchor commit이 필요하다. 상세는 patcher `docs/POCKETRISU-G1-2-CHAT-SAVE-REBASE-VALIDATION.md`다.

> G1.2 가용성 후속 전달 (2026-09-28 KST): Opus 자문과 직접 재현으로 확인한 두 사본 캐시의 영구 저장 차단을 `0.2.4-experimental.9` (`aa2f1c4`)에서 수선·push·live 적용했다. 재시도 전 실제 화면에 병합 결과를 반영하고, 늦은 편집·중간 script 저장·삭제 확인 대상·실패한 생성 owner·미리보기와 첫 저장 전 대화의 식별자 경계를 보강했다. 기존 변수/CBS 즉시 실행 계약은 유지하며, 입력 충돌로 이미 실행된 script 효과가 되돌려지거나 재전송 때 중복 실행되지 않는다고 주장하지 않는다. 최종 집중 133/133, 전체 frontend 1,990/3 skip(마지막 ID 호환 분기 전), server 388/12 skip, compatibility 74/5 skip, patcher 51/51, 타입 0/0, build/BG load, 42-pack·1,175-unit 조합·re-plan 0·1,021파일 exact revert, live 428파일 일치·DB 5개 무결성·헤더 규칙 보존을 확인했다. 2026-09-28 사용자가 안내된 대화 왕복 후 재저장·전송 준비 중 초안 유지·삭제 확인을 정상으로 보고해 이번 복구의 L5를 종료했다. 개별 시간·화면 증거는 받지 않았고 G1.1 이후 목표와 전체 qualification은 남아 있다. 상세는 patcher `docs/POCKETRISU-G1-2-SAVE-AVAILABILITY-REPAIR.md`다.

> G1.1 전달 기록 (2026-09-30 KST): 최신 G1.12 `c9c4c9c` 위에서 기존 WIP와 홈 진입 작업을 보존하고, 유지 소스의 적용 충돌이 없음을 확인한 뒤 `0.2.4-experimental.12` / `852da4a`를 구현·push·live 적용했다. 저장 큐 안에서 최신 채팅의 입력 ID 뒤에 답변을 넣고, 사용자 선택대로 겹친 사용자 편집은 보존하며 미반영 서버 변경을 알린다. 과거 메시지 ID 보충과 ID 없는 스크립트 추가 메시지, 서버/화면 지문 차이, G1.12 종료 판정을 함께 보강했다. 전체 frontend 2,044/4 conditional skip, server 415/12 skip(마지막 결과 ID 보충 전), 최종 영향 범위 95/95·client 64/64·추가 route 15/15, 타입 0/0·frontend/BG build/load·42-pack/1,180-unit graph·re-plan 0·1,022파일 exact revert를 확인했다. Opus 최종 검수 뒤 앱 코드는 바꾸지 않았고, live 433파일 일치·DB 5개 무결성·제공 asset 일치·헤더 설정 보존을 확인했다. 2026-09-30 사용자가 생성 중 앞쪽 메시지 수정·저장, 앱 종료·복귀 후 편집과 답변 보존 및 재저장을 정상으로 보고해 이번 단위의 L5를 종료했다. 개별 측정·화면 증거는 받지 않았으며 G1.3 이후 및 전체 qualification은 남아 있다. G1.12의 일반 메시지 ID 병합 채택 전체를 완료한 것으로 계산하지 않는다. 상세는 patcher `docs/POCKETRISU-G1-1-ANCHOR-COMMIT-VALIDATION.md`다.

> G1.3 전달 기록 (2026-09-30 KST): `0.2.4-experimental.13` / `c3fc075`를 독립 브랜치에 구현·push했다. 실행 차례의 최신 저장 채팅·설정을 두 입력 경로에 적용하고, 입력 효과는 재실행 없이 병합하며, 조립 뒤 채팅 수정은 답변 저장과 함께 알린다. 입력 저장 뒤 준비 거절로 작업이 남는 경로도 최종 검수에서 보강했다. 전체 frontend 2,050/4 skip, server 444/12 skip(구버전 판독기 4건 포함), 최종 영향 client 76/76·server 73/73·process 28/28, compatibility 74/5 skip, patcher 51/51, 타입 0/0·build/BG load·42-pack/1,191-unit·re-plan 0·1,022파일 exact revert를 확인했다. Opus 최종 검수와 후속 확인을 마쳤다. 사용자가 공간을 확보한 뒤 진행 중인 생성 0을 확인하고, 새 백업 1,601파일·DB 5개의 무결성과 바이트 일치를 검증해 live 적용했다. 관리 파일 437개·제공 asset 일치·헤더 설정 보존·PM2 online/unstable restart 0을 확인했다. 기존 백업은 에이전트가 삭제하지 않았다. 긍정/부정 iPhone 확인은 남아 있으며 G1.3 제품 완료로 계산하지 않는다. 상세는 patcher `docs/POCKETRISU-G1-3-ASSEMBLY-CONTEXT-VALIDATION.md`다.

> G1.4 전달 기록 (2026-10-03 KST): `0.2.4-experimental.18` / `152aec3`를 구현·push·live 적용했다. 실제 Chromium 기준선에서 기존 raw N+1 접수·N 저장 뒤 실행·N+1 중 N 답변 표시가 이미 성립함을 확인해, 대기열을 재구현하거나 G1.12 메시지 ID 병합을 가설만으로 확대하지 않았다. 서버 상태 기반 reroll·이어쓰기·빈 재전송 제한, raw 입력과 legacy/native main 접수의 양방향 배제, 종료 작업 취소 응답을 연결했다. 최종 자문 후 authoritative busy 거절의 client fallback을 차단하고 완료 입력의 활동 판정을 기존 canonical predecessor 규칙과 맞췄다. 전체 frontend 2,109/4 skip·server 470/12 skip·compat 74/5 skip, 후속 집중 client 46/server 73, patcher 51·타입 0/0·build/BG load·42 packs/1,287 units·re-plan 0·1,022파일 exact revert를 확인했다. 두 browser context의 기존 활성 탭 확인·reload·재진입을 포함해 버튼 제한, 세 번째 초안 보존, 구형 native main 409와 앱 종료 후 두 답변 저장을 확인했다. 중지 상태 백업 1,618파일 전수 대조 뒤 live 450파일·JS17개·DB5·헤더 보존·PM2 online/unstable0을 확인했다. 현재·구형 앱의 직접 전송/tools preset 및 main 이전 aux 경합은 범용 배제 대상이 아니며, publication marker 쓰기 실패 뒤 revision이 바뀌면 기동 복구 전까지 보수적 busy가 재발할 수 있다. 상세는 patcher `docs/POCKETRISU-G1-4-QUEUE-VALIDATION.md`다. 기기/aggregate gate와 G1 전체 완료는 별도다.

### 남은 구현 순서 (2026-10-09 KST)

M7 후속 종결 (2026-10-11): 이전 experimental.33/f64d0ec 종결 뒤 사용자 요청의 확장 감사에서 phase/domain 충돌, 거절 descriptor·RPC 포화·CPU polling과 legacy 영수증, 해석 전 거절 handle누적, teardown결과수락, 동시 공유 export 회수 경합을 발견·수정했다. Experimental.34/adapter0.7.41의 runtime0265ddf와 matching installer에서 host121/peer65/server525·기존skip12/client8/patcher331(52entries), 원본provider12/mix10/HTTP14, owner8bytepair·graph42packs/7collisions/replan0·1022byte/mode exact revert를 확인했다. 앞선 .34 type/build/process17/notification24와 최종 live build/load·독립 source/served asset/DB·auth capability 확인을 구분해 기록했다. Hardcoding/rewardhacking/magic-number·호출자/소유권 L3/L4와 Opus 후속 자문 뒤 safe OFF 후보 전달을 종결했다. M7.1~M7.6은 문서의 지원 원본 조합·접수·효과/실패·운영/전달 범위이며 실제 provider·기기·전체G1·stable/hostON으로 확대하지 않는다. 기존 startup pending의 identity·receipt/journal·absent-target 분류가 읽기 전용 재현에서 동일한 것을 확인했다. 다음 실행은 G1.8 실패·재시도·알림과 아래 복구 수명 경계, 이후 G1.9→G1.10→G2다.

배포 후 startup 경고는 별도 분류했다. 현재139commit은 형식/journal본문/적용ledger receipt가 모두 맞고,13건은 metadata와 hydrated store 양쪽에서 없는4채팅을 가리킨다. 실제 owner/committer의 읽기 전용 DB+메모리 재현은2pass/13pending, 정확한 `server chat execution projection chat is unavailable`26회, 영속쓰기0/모델실행0이며 결과key0·상태key13을 보존한다. 복구source는 배포 직전backup과 동일하다. 채팅 부활 방지 동작을 유지하되 이 분류의 영구pending·retire불가와 journal누적은 bounded/정상완료로 주장하지 않고 G1.8에서 terminal분류·receipt/journal수명·진단분리를 검토한다. 실제 누적량은 private receipt에 보존한다. 새/변경 pending·metadata는 있는데 hydration만 없음·receipt/본문 불일치는 같은 예외로 취급하지 않으며 활성화를 막는다. 상세: patcher `docs/POCKETRISU-G1-7-M7-QUALIFICATION-VALIDATION.md`, private `.code-review/bg-m7-resume-investigation-2026-10-10.md`와 `workspaces/bg/records/m7-resume-*`.

M7 첫 실행 단위 (2026-10-10): 현재 원본 순서/API/source identity를 읽기 전용으로 확인하고, 유지 원본 조합10조건과 실제 raw/prepared HTTP8조건을 구현·검증했다. ON 분석3/main1, OFF 분석0/main1·미실행알림6, 만료권한 main1, 원본 조합+healthy synthetic 선택provider1의 정상 채팅/journal 저장을 확인했다. 독립 source 기대값·정확한 알림 집합·분석/provider별 카운터·반복 실패 receipt와 OS 정리 표본을 보호한다. 제품/installer/version은 experimental.32 그대로이며 live 변경은 없다. M7.1과 scoped M7.2의 실행기 단위이며 실제 설치 provider 실행·설정/권한 형태·운영 OFF복귀/구형bundle/capacity·후속failure/stream/provider/device/aggregate를 완료로 확대하지 않는다. 상세는 patcher `docs/POCKETRISU-G1-7-INSTALLED-COMBINATION-VALIDATION.md`다. 아래 이전 next 문구는 각 checkpoint 당시 범위다.

Latest handle/caller checkpoint (2026-10-10): experimental.32/adapter0.7.39 corrects rejected unread handle reuse without changing caps, protocol, permissions or process lifetime. Pure encoding precedes native acquisition; known prewrite failure restores only new handles while published handles and fatal cancellation remain. Wire30/actual worker11/session9/host96, original protocol35/resource13, actual v2/Lua role/injection/store4, full server/patcher and graph/exact-revert gates pass. Current native caller mapping is recorded separately from source-only feature qualification. Next is final M7/G1.5b installed-combination qualification, request-specific admission and activation conditions. Actual providers, remaining G1.8/G1.9/combined stream and G1.10 physical/aggregate remain separate; official unchanged AC G2 follows G1. Final source consultation and safe hostOFF delivery are complete: verified31 app/state rollback91,654,770bytes/1642files/12namespace rows, planned2paths, livefrontend8022/BGload, managed484/served175/DB5/header preservation/op103→103/removed0/input0/active-model-pending0/online/unstable0/newerror0 and authenticated capabilitiesHTTP200/hostVersion0. New31 rollback, prior normal reference sets and full-data anchor remain; no cancellation or data/backup/tmp/worktree deletion. See patcher `docs/POCKETRISU-G1-7-HANDLE-CALLER-VALIDATION.md`.

Latest raw-provider checkpoint (2026-10-10): experimental.31/adapter0.7.38 closes the demonstrated raw selected-plugin preparation/context refusal within actual synthetic HTTP scope. The eligible host must register healthy, unambiguous selected providers before raw input effects; missing/colliding/load-failed registrations stop with retained raw text and notices, without implicit default-model success or automatic effect replay. Actual raw12/host94/session9, preserved caller6 and automatic/graph/exact-revert gates pass. Final source consultation and safe hostOFF delivery are complete: verified91,650,215byte/1,642file application-state rollback, planned7paths, managed484/servedJS175/DB5, unchanged headers, operations103→103/removed0, active/model/pending0, online/unstable0/newerror0 and actual authenticated capabilitiesHTTP200/hostVersion0. The .30 app/state rollback, previous .29 normal rollback and full-data anchor remain; no cancellation or data/backup/tmp/worktree deletion. Next: remaining auxiliary caller mapping and oversized handle reuse, then final M7/G1.5b admission/activation. Actual provider, combined Lua-stream, G1.8/G1.9 remainder and G1.10 physical/aggregate gates remain separate. Official unchanged Archive Center G2 follows G1. See patcher `docs/POCKETRISU-G1-7-RAW-PROVIDER-VALIDATION.md`.

Previous scoped implementation (2026-10-10): the user confirmed non-provider omission plus an awaited notice, with answer completion/storage and no automatic replay. Experimental.30/adapter0.7.37 implements early duplicate suppression and canonical identity checks across attached/prepared boundaries, preserving unaffected relative order, live arguments, loaded-code grants and committed writes. Normal cache eviction recovers; genuine read failures retain the measured error/unknown-input contracts. Host90/session8/context12, browser selection/queue/retry, protocol35/M3 13, full automatic gates and exact graph/revert pass. Candidate commits `7b2854e` / `807c5f9` / `fff10fd` are pushed; safe live OFF delivery is complete: verified app/state rollback91,646,644bytes/1642files/12namespace rows, planned8paths, managed484/servedJS175/DB5/header preservation/op103→103/removed0/input0/active-model-pending0/online/unstable0/newerror0. The superseded .28 app/state intermediate was removed under the standing retention rule after full validation; .29 rollback/full-data anchor remain. Next: trace raw selected-provider/model context capture and remaining caller/handle qualification before final M7/G1.5b admission/activation. G1.8/G1.9, G1.10 and G2 remain separate. Detail: patcher `docs/POCKETRISU-G1-7-CONTEXT-OMISSION-VALIDATION.md`.

Previous scoped checkpoint (2026-10-10): original native-v3/server roles18, separate canonical-root/operation-DB host71, default PDF24 and actual Send/queue/retry refresh/store pass. This changes probes/docs only; experimental.29 runtime remains hostOFF and its scoped ordinary-use L5 is already closed. Index cascades, duplicate-name refusal, fixed registration epochs and post-boundary effects are characterized rather than accepted as universal native equivalence. Next, resolve duplicate-name handling and identity authority on non-attached paths, then validate the selected context-transition/effect/replay contract and remaining caller mappings before M7/G1.5b activation. Do not replace those required design decisions with indefinite support exclusions. Detail: patcher `docs/POCKETRISU-G1-7-ROLE-IDENTITY-EPOCH-VALIDATION.md`. G1.8/G1.9, G1.10 device/aggregate and G2 remain separate.

Earlier checkpoint delivery: `a203ee9` / `43f2c30` / `657a6e8` / `78a16c1` are pushed on the existing candidate branch, with clean local/remote alignment and unchanged installer bytes. Opus planning/mid/final source consultation is complete. The subsequent user choice confirms notice-plus-omission and answer completion/storage after non-provider identity invalidation; prior effects are not automatically replayed and selected model-provider failure still rejects. The later implementation and live readback are recorded above.

현재는 G1.12a/CAP/G1.12b와 experimental.27 OFF 경계, .28 protocol/API 한도 보완, M4 설정 검증에 이어 .29의 M2 PDF 비교·M3 큰 입력/거절/취소 단위를 검증한 상태다. Actual v3/OS 4families×24 + 관측대조24·독립 PDF 원문/bytes/주입, 별도 original Worker 양성 대조, 실제 preset PDFmax Send/Chrome종료/원래채팅·journal/coldreturn과 원본M3 13건을 확인했다. Proxy form 유실과 local RPC 거절의 가시성/후속 호출을 공통 경로에서 수리했다. .29/personal0.5.14/adapter0.7.36을 검증된 앱/상태 backup 뒤 live에 전달했고 managed484/servedJS175/DB5·header보존·op99→99/removed0·online/unstable0/error0과 실제loopback form 전달을 확인했다. 2026-10-10 사용자가 .29 scoped ordinary-use iPhone L5 정상으로 보고해 해당 보존 확인과 L6 기록을 종료했다. MARP D1~D8·loaded bundle·서버 실행·G1 종합 통과로 확대하지 않는다. 원본·한도·권한·CSP는 그대로이고 hostOFF를 유지한다. 다음 단위는 남은 role/identity/argument epoch/최종 caller 및 M7/G1.5b 활성화 조건이다. Handle-bearing oversize 재사용과 native/device 큰 입력·실제 provider·G1.8/G1.9/G1.10·G2는 별도 미완료 범위다. 상세는 patcher docs/POCKETRISU-G1-7-PDF-PROXY-VALIDATION.md이며 아래 과거 기록의 게이트 범위를 확대하지 않는다.

> G1.8 최소 기반 전달 기록 (2026-10-03 KST): `0.2.4-experimental.19` / `fcbed6a`를 구현·push·live 적용했다. 새 raw 입력의 `server_host_unsupported` 중단을 기존 원문·수동 복구와 별개인 서버 알림으로 보관하고 홈/다른 채팅 복귀 시 기존 상단 토스트로 전달한다. 원래 중단 기록이 먼저 보존되며, 알림 발행·source receipt는 별도 transaction으로 묶고 실패 시 기존 시작/10분 sweep에서 재시도한다. 48시간 만료·최대 1,024행·8개 단위/30초 lease·정확한 token ACK·local receipt로 일반 중복을 억제한다. 손상된 알림은 삭제하지 않고 건너뛰되 용량에는 포함한다. ACK는 읽음이 아닌 화면 enqueue이며, crash/lease 경합·렌더 실패·이미 발행된 과거 알림·수동 손상 복구의 한계는 문서에 남겼다. 권한/훅/provider 알림은 G1.6용 내부 계약만 있고 live plugin writer는 없다. 전체 frontend 2,116/4 skip·server 482/12 skip·compat 74/5 skip, 최종 집중 server62/client6·patcher51·타입0/0·build/BG load, 42 packs/1,298 units·re-plan0·원본1,022파일 exact revert를 확인했다. 실제 Chromium에서 앱 종료 후 중단·서버 재시작·새 context 홈 수신·첫 ACK 유실에도 log1회/ACK2회·후속 새 창 재표시0, native UUID 부재 조건을 검증했다. 기존 full backup1,618파일을 재검증하고 새 앱/상태1,610파일·빈 알림 영역 백업 후 live455파일·JS17개·DB5·헤더 보존·PM2online/unstable0을 확인했다. 상세는 patcher `docs/POCKETRISU-G1-8-NOTIFICATION-FOUNDATION-VALIDATION.md`다. iPhone/aggregate와 나머지 G1.8은 별도다.

> G1.6 기반 전달 기록 (2026-10-07 KST): `0.2.4-experimental.20` / `76bf8a2`를 구현·push·live 적용했다. 플러그인별 요청 수명의 격리 프로세스, invocation 문맥 RPC, native 훅/provider/fetch, per-key 저장소와 저장 권한, v2 알림을 연결했다. 서버 환경 opt-in은 기본 OFF이며 원본 MARP 자격 검증·G1.5b 접수 확대는 하지 않았다. 입력 저장 뒤 실행 문맥 상실·실패 기록 저장 오류·재시작에서도 초기화 외부 작업을 재실행하지 않는 합성 검증을 추가했다. Opus 지적을 직접 재현해 알림 receipt 손상 격리·식별자 충돌·복구 대기 안내를 보강했다. 동일 실패의 48시간 대표 알림, 손상 receipt 수동 복구, 브라우저 저장소 캐시, 미소비 스트림·자원 한도는 별도 한계다. 최신 main의 폰트 기능을 통합·보존했고 frontend2,128/4skip·server490/12skip·compat74/5skip·patcher51·타입0/0·build/BG load, 42packs/1,332units·replan0·1,022파일 exact revert를 확인했다. Chromium v1/v2 알림4·log4·첫 ACK 유실 후 ACK2·새 창 재표시0·pageError0, 실제 provider0을 확인했다. 검증된 기존 full backup과 새 앱/상태1,615파일 백업 후 live462파일·JS17개·DB5·헤더 보존·PM2online/unstable0·hostOFF를 확인했다. 상세는 patcher `docs/POCKETRISU-G1-6-PLUGIN-HOST-WIP.md`다. 실제 MARP/provider·iPhone/aggregate·stable gate는 남으며 다음 구현은 2026-10-06 결정에 따른 G1.12a다.

> G1.12a 선행 계측 전달 (2026-10-07 KST): 폰트 포함 rebased BG `0ce1086`에서 `0.2.4-experimental.21` / `67cdfe1` 측정 후보를 구현·push·live 적용했다. 원본 응답을 복제하지 않고 headers/본문 소비·BG snapshot·숨김/복귀·기존 timer 발동 여부를 제한된 로그에 기록한다. 계측은 ON, G1.6 호스트는 OFF다. 기존 판정·3회 대기·15분 안내·ACK·busy는 이 후보에서 바꾸지 않았으며 G1.12a 완료가 아니다. Opus 검수와 직접 재현으로 로거10KiB 절단, 긴 생성의 마지막 요청 누락, 작업별 ACK 주소와 readiness 계측 수명 문제를 보강했다. 최종 focused84·frontend2177/4skip·server490/12skip·compat74/5skip·patcher51·타입0/0·build/BG load,42packs/1366units·replan0·1022파일 exact revert를 확인했다. 실제 Chromium boot 복구는 log1/요청11/전송구간10/provider replay0/pageError0이었다. 검증된 앱/상태1622파일 백업 후 live464파일·JS17·DB5·헤더 보존·PM2online/unstable0을 확인했다. 실제 iPhone watch/숨김·복귀 관측과 그에 따른 본문 읽기 한도·R1/R2 구현이 남는다. 기존 시간 초과 안내가 떠도 측정을 위해 재전송하지 않고 채팅을 먼저 확인한다. 상세·제거 목록·로그 유실 한계는 patcher `docs/POCKETRISU-G1-12A-TERMINAL-RESULTS-PLAN.md`에 기록했다.

과제 ID는 추적을 위해 유지하고 실행 순서는 다음과 같이 정한다. G1.3은 구현·자동검증·live 전달 상태이며, 저장 안내 알림의 기기 확인을 G1.3 전체 긍정/부정 시나리오 확인으로 확대하지 않는다. 남은 기기 확인은 추적하되 뒤 과제의 조사·구현을 막는 새 승인 게이트로 만들지 않는다.

2026-10-07 현재 G1.5a·G1.4·G1.8 최소 알림과 G1.6 기본 OFF 호스트 기반의 구현·자동 검증·라이브 전달을 마쳤다. 2026-10-06 사용자 결정에 따라 다음 구현은 G1.12a 종료 결과 판정, 이어 G1.12b 복구와 생성 상태 분리다. G1.6 전달을 원본 MARP 실행 허용이나 G1 전체 qualification으로 계산하지 않는다. 기기/aggregate와 각 전달 기록의 보존·동시 실행·알림 한계는 별도로 유지한다.

1. **G1.5a — 자체 모델 경로의 요청별 판정 (구현·자동 검증·전달 완료):** main·sub·aux의 실제 binding·provider와 최종 endpoint를 기존 해석기로 확인한다. preset·module binding·custom endpoint의 검증된 경로를 서버 입력 접수에 연결한다. 전역 가드를 단순 제거하거나 아직 없는 서버 플러그인 호스트를 지원하는 것으로 광고하지 않는다. 이 작업을 G1.4보다 먼저 수행해 대기열이 classic 경로에만 머무르지 않게 한다.
2. **G1.4 — 대기열과 버튼 (구현·자동 검증·전달 완료, 기기/aggregate 잔여):** N 처리 중 N+1을 접수하고 N 저장 이후 최신 상태로 조립한다. 두 탭·빈 로컬 상태·구형 번들에서도 reroll·이어쓰기 제한이 유지되도록 화면과 서버 접수 경계를 함께 검증한다. 브라우저에서 N+1 입력 효과를 미리 실행하는 별도 prepared 대기열로 대체하지 않는다. 실제 검증 범위와 직접 전송의 한계는 위 전달 기록에 따른다.
3. **G1.12 연계:** G1.4 첫 검증에서 N 처리 중 N+1 접수 뒤 N의 화면 채택을 측정한다. 로컬 지문 충돌이 재현되면 2번 메시지 ID 병합 채택을 선행 수정으로 올린다. 4번 끝난 작업 취소는 실행·대기·종료 상태를 구분하는 같은 영향 범위에서 다룬다. 기존 잔류 결과의 기기 확인이나 전체 G1.12 종료를 무조건 선행 조건으로 삼지 않는다.
4. **G1.8 최소 기반 → G1.6 (기반 구현·전달 완료, 기본 OFF):** 앱 부재 중 실패·권한 부재 알림의 보관·복귀 전달·중복 억제 계약을 바탕으로 서버 플러그인 호스트와 실제 plugin writer를 구현한다. 실패한 훅의 출력, 이미 수행된 외부 요청·저장소 쓰기, 모델 자체를 제공하는 provider 실패를 구분한다. 이미 발생한 외부 효과가 취소됐다고 간주하지 않는다. 스트림과 후처리 훅의 순서도 이 단계에서 정의한다. 최소 기반의 실제 producer는 새 native 입력 중단 한 경로이며 나머지 G1.8을 완료로 계산하지 않는다. 2026-10-06 사용자 결정에 따라 G1.6 뒤 5번보다 먼저 G1.12a·G1.12b를 진행한다(아래 "G1.12 후속" 절).
5. **G1.7 + G1.11 연결 → G1.5b:** 원본 MARP Lite를 현재 호스트·최종 `nativeFetch`/헤더 경로에서 검증하고 입증된 의미 차이만 보완한다. 브라우저 `/proxy2`의 기존 규칙 적용과 서버의 대화별 HMAC 문맥을 구분하며, 헤더 오류 해소를 실제 분석 성공으로 승격하지 않는다. 검증된 API·권한·실행 역할과 효과 수명을 요청별 판정에 반영하고, 새 script hash나 오래된 브라우저 관찰 값만으로 거절하지 않는다. 신규 실험과 진단 결정은 아래 qualification 순서에 따른다.
6. **G1.8 나머지 + G1.9 → G1.10:** 재시도·재시작 실패·알림과 스트리밍 중계를 검증한다. G1.9는 호스트의 훅/스트림 계약이 정해지면 진행할 수 있으며 G1.8 전체 종료를 불필요한 선행 조건으로 삼지 않는다. 실제 브라우저 종료 후 재접속 전 일반 채팅 API 저장 확인과 iPhone 조합 검증으로 G1을 종료한다.
7. **G2:** G1 완료 뒤 공식 AC 원본을 같은 서버 호스트에서 검증한다. 과거 수정 AC 후보나 H3→C6 순서를 실행 정본으로 되돌리지 않는다.

G1.5a/b는 G1.5의 실행 구분이며 별도 제품 목표가 아니다. 플러그인 참여 판정은 기능 토글만으로 추측하지 않는다. 호스트 구현 전 참여 여부를 확정할 수 없는 조합의 처리와, 실패 후 제외할 수 없는 효과의 처리는 §2·§5의 사용자 결정을 보존하는 구체 계약으로 정리한다. 해결되지 않은 사용자 결과의 차이는 구현 전에 확인한다.

G1.5a의 첫 구현 단위는 실제 dispatcher와 사전 판정의 명시 DB 기반 모델 선택을 공유하고, 기존 준비 경로를 유지한 채 fallback 판정과 입력 저장 후 최신 설정 재검사를 연결했다. 이후 endpoint·입력 단계 호출·동적 호출 실패와 기존 결과 보존을 검증하고 qualified preset/module/custom 경로의 서버 입력 허용을 확대했다. 첫 기반 단위의 통과와 후속 qualification·전달 증거를 구분한다.

> G1.5a 구현 전달 (2026-10-03 KST): `0.2.4-experimental.17` / `8f6627b`를 구현·push·live 적용했다. qualified native preset/module/custom 경로를 허용하며, 미지원 입력 동작은 원문·이유를 보존한다. 사용자 결정에 따라 수동 복구는 앱에서 입력 처리를 마치고 기존 서버 입력 owner가 저장·main 생성을 이어받는다. 플러그인/MCP 미검증 조합과 브라우저 로컬 주소로 해석될 수 있는 classic 경로는 기존 준비 방식을 유지한다. 화면 의미 지문과 저장 SHA-256의 혼동, marker/adoption, 반복 복구의 연쇄 차단, metadata 기준, 비동기 중단 문맥을 보강했다. 실제 Chromium에서 앱 종료 후 서버 완주, 입력창 변수의 모델 전달, 입력 저장 앞뒤의 브라우저 저장 경합, 이름 변경 직후 전송을 검증했다. 전체 frontend 2,106/4 skip·server 467/12 skip·compatibility 74/5 skip·patcher 51 통과 후 변경별 집중 검증과 타입 0/0·build/BG load를 확인했다. 42-pack/1,256-unit·re-plan 0·1,022파일 exact revert, stopped 앱/상태/DB5 백업 1,614파일 전수 대조, live 관리447파일·JS17개·DB5 무결성·헤더 보존·PM2 online/unstable0을 확인했다. Opus 최종 검수에서 검토 범위 내 추가 출고 차단 결함은 없었다. 기기/aggregate gate와 G1.5b는 별도이며 이번 요청으로 G1.4·r3을 착수하지 않았다. 상세는 patcher `docs/POCKETRISU-G1-NATIVE-ADMISSION-VALIDATION.md`다.

> G1.5a 기반 전달 (2026-09-30 KST): `0.2.4-experimental.15` / `2848750`을 구현·push·live 적용했다. 기존 모델 해석을 명시 DB 기반의 공용 함수로 추출해 실제 dispatcher와 사전 판정에 연결하고, custom/plugin/reverse-proxy fallback 누락 및 입력 저장 뒤·재개 시 최신 설정 재검사를 보강했다. 기존 preset/module/custom 준비 경로는 유지한다. 최종 집중 70/70, 전체 frontend 2,090/4 skip, server 444/12 skip, compatibility 74/5 skip, patcher 51/51, 타입 0/0, frontend/BG build/load, 42-pack·1,200-unit 조합·re-plan 0·1,022파일 byte/mode exact revert를 확인했다. 최종 자문의 테스트 비교 지적을 명시 기대값 검증으로 보강했고 runtime 소스는 이후 바꾸지 않았다. 새 stopped 백업 1,605파일을 전수 대조한 뒤 live 관리440파일·제공 JS17개·DB5 무결성·헤더 설정 보존·PM2 online/unstable0을 확인했다. 기기 확인, endpoint/입력 단계 qualification, 동적 호출 실패의 결과 보존 및 raw-input 허용 확대는 남아 있다. 상세는 patcher `docs/POCKETRISU-G1-5-REQUEST-POLICY-VALIDATION.md`다.

> G1.5a 입력 실행 기반 보강 (2026-09-30 KST): `0.2.4-experimental.16` / `7581aee`를 구현·push·live 적용했다. 입력 trigger/editinput도 main과 같은 작업 취소 신호·대화별 외부 헤더 문맥·Node 실행 환경을 사용하며, 취소를 스크립트가 정상 반환으로 처리해도 새 입력을 attach하지 않는다. 기존 600초 작업 예산을 입력과 main이 공유한다. 이전 코드에서 신호 누락·취소/시간 초과 미상속을 재현했고, cold Lua의 `Invalid URL`과 환경 교정 후 변수 반영도 별도 합성 실행으로 확인했다. 최종 server 451/12 skip, compatibility 74/5 skip, patcher 51/51, 타입 0/0·frontend/BG build/load·42-pack/1,204-unit·re-plan 0·1,022파일 exact revert를 확인했다. frontend 유지 소스353경로는 .15와 같아 기존 검증을 재사용했다. live441파일·JS17개·DB5 무결성·헤더 보존·PM2 online/unstable0을 확인했다. 이 단위는 raw-input 허용 확대나 r3 수정이 아니며, UI 대기 등 취소 신호에 협조하지 않는 script의 종료까지 보장하지 않는다. 상세는 patcher `docs/POCKETRISU-G1-NATIVE-INPUT-CONTEXT-VALIDATION.md`다.

### G1.7/G1.11 qualification과 G1.5b 허용 확대 — 2026-10-09 자문 반영

**방향:** 원본 MARP Lite를 공통 격리 호스트에서 요청별로 실행한다. 전용 MARP backend 재구현이나 Full 교체로 바꾸지 않는다. 다음 단계는 부족한 API 추가뿐 아니라 현재 구현된 API·최종 caller·상태 수명·실패 처리의 동등성을 검증하는 작업이다. 기존 개별 모델/HTTP 요청과 prepared main의 보존을 무효화하거나 MARP 사용자는 BG가 전혀 없었다고 주장하지 않는다. 추가 목표는 입력→분석→main→후처리→저장 전체의 서버 소유다.

**근거의 수준:** 이번 자문은 보존된 Lite0.9.2 원본과 현재 호스트/native 소스를 읽은 평가다. 그 snapshot이 현재 설치본과 같다는 확인, 현재 실제 호스트의 동등성, provider 성공이나 기기 통과는 아직 없다. §6의 이전 시제품 비교는 재사용 출발점이며 새로운 caller를 qualification한 것으로 계산하지 않는다.

| 순서 | 격리 검증 과제 | 관찰·통과 기준 |
|---|---|---|
| M0 | 현재 설치 원본·버전·API 경로 확인 | hash는 식별·원본 보존용이다. 별칭과 동적 등록, 요청 훅과 UI 경로, 지원되는 원본 fallback을 구분한다. 과거 snapshot과 다른 hash라는 이유만으로 실행을 거절하지 않는다. |
| M1 | 원본 bootstrap과 요청별 수명 | byte-original을 현재 호스트에서 로드해 훅/unload 등록, 비동기 초기화의 종료와 late-call 여부를 관찰한다. 설정·UI는 브라우저에 남고 서버의 private 진단 이력은 자동 전달되지 않음을 확인한다. |
| M2 | 현재 브라우저 호스트와 실제 서버 어댑터의 동등성 | 가짜 공급자로 main/sub·retry·fallback을 실행하고 최종 요청·주입·분석 호출 수를 비교한다. 세 분석 agent가 모두 켜진 fixture의 정상 분석3회·재시도 시 native와 같은 횟수·단일 주입을 확인하되 설정별 호출 수를 하드코딩하지 않는다. main/OAuth/분석 호출은 별도로 센다. |
| M3 | 헤더·본문 timeout, 취소와 다음 attempt | 지연 헤더와 지연 본문/stream을 나눠 native 어댑터의 error shape·알림·entry 비활성화·다음 retry/fallback을 관찰한다. 반환 stream은 scope를 유지할 수 있으므로 훅 반환 즉시 모든 요청이 취소된다고 가정하지 않는다. 새 attempt의 정상 기능이 줄면 G1.5b 전에 원인을 수정한다. transport abort를 공급자 중단·과금 취소로 해석하지 않는다. |
| M4 | 설정 저장 직후 전송과 대기 중 갱신 | MARP의 실제 v3 alias에서 pluginStorage는 root pluginCustomStorage를, setArgument는 같은 root의 plugins[].realArg를 수정한다. 별도 KV인 getLocalPluginStorage와 구분한다. UI 완료→두 root 수정→실제 send/strict root flush→capture→실행을 추적하고, fresh read만으로 최신값·두 값의 일치를 단정하지 않는다. cache와 queued 설정 변경도 비교한다. |
| M5 | 실패·빈 결과·부분 성공과 진단 이력 | HTTP400·연결 실패·HTTP200의 빈/부분 결과를 재현해 host 알림, transport 사실, 원본 내부에서 흡수한 실패와 private history 소실을 구분한다. 결과가 바뀌었는지나 모든 HTTP가 실패했는지만으로 의미적 성공을 판정하지 않는다. |
| M6 | 권한·혼합 플러그인·초기화 효과와 자원 비용 | 저장 권한 만료, UI-only 플러그인과 여러 enabled 플러그인, 초기화 중 외부 효과, 작업 취소를 검증한다. 로드+초기화와 응답 시작 지연을 실제 측정하고, 추정만으로 프로세스 수명·cache·필터를 바꾸지 않는다. |
| M7 | G1.5b 판정·안전 전달 | 검증한 API·권한·binding/provider·실행 역할과 효과 수명으로 요청별 허용을 확대한다. 실제 공급자와 iPhone/G1.10은 별도 gate로 유지하며 원본 플러그인/API 추가의 정상 경로 보존을 확인한다. |

**허용 판정:** 작업 시작의 서버 로드가 실제 스크립트와 등록 역할을 확인하고, 이후 단계의 문맥/identity 변화도 기존 수명·효과 소유권 아래 처리한다. 브라우저 참여 요약은 필요가 입증되면 안내용 힌트로 검토할 수 있으나, stale/unknown hash 일치를 접수 gate나 allowlist로 만들지 않는다. 별도 사전 로드 후 다시 로드해 초기화 효과를 두 번 실행하지 않는다. 임의 스크립트는 로드 중에도 `nativeFetch`·저장 호출을 할 수 있으므로 unsupported 판정·접수 실패·client 전환이 이미 발생한 효과를 반복하지 않는지 검증한다. 실제 admission 구현 전까지 모든 초기화가 무과금이라는 주장은 하지 않는다.

**격리 qualification 진행 (2026-10-09):** 현재 Lite0.9.2 byte-original과 공통 host 기반 d2459fc 위에 experimental.26/adapter0.7.33 admission 후보를 구현했다. 실제 preset Send/ACK→Chrome 종료→분석/main/원래 채팅 저장→새 browser 복귀를 합성 공급자로 확인했다. 설정 UI Save→Send·queued 갱신·N+1 앞 답변 조립·world/main 취소·서버 재시작·constructor 예외·OpenCode/strict/대화별 헤더/main SSE를 조건별 검증했다. 실제 공급자·iPhone·전체 A/D 통과는 아니다. 정본은 패처의 `docs/POCKETRISU-G1-7-MARP-QUALIFICATION-VALIDATION.md`와 `docs/POCKETRISU-MARP-BG-POST-IMPLEMENTATION-REVIEW.md`다.

**OFF 경계 결정 (2026-10-09):** 사용자가 BG 생성 유지+플러그인 미실행 알림을 선택했다. 호스트 OFF 또는 실제 시작 불가에서는 서버 플러그인 효과를 생략하고 이름·버전·이유를 알린다. 정상 ON의 원본 실행은 유지하며, 모델 공급자 실패를 일반 플러그인 효과처럼 조용히 생략하지 않는다. Classic·preset·module·custom·명시적 입력 복구의 최종 호출 경로, 기존 알림 dedup/보관/조회, 알림 저장 실패와 효과 전후 경계를 검증한다. Snapshot hash는 식별이며 gate가 아니다. 직전 .24와 .26의 preset 분석0/main1/주입0은 기존 누락의 근거다. 이후 G1.8/G1.9→G1.10→G2 순서는 유지한다.

**M6 원본 혼합 체크포인트 (2026-10-09):** 원본 6개의 역할을 실제 Chromium/v3와 OS 격리 호스트에서 대조하고, 합성 classic/preset Send→Chrome 종료→분석3/main1/주입1→원래 채팅 저장, 저장 권한 만료, 다른 채팅의 lock-source 직렬화와 유한 관찰, 표시/process 저장 경계와 초기화 효과 재실행 방지를 확인했다. 새 요청5회의 혼합 로드910.35–943.31ms와 종료 후 TasksCurrent0을 측정했다. UI 관리자의 load 실패와 번역 감시의 scope 밖 호출은 지원 한계로 남겼고 이름/hash 필터를 추가하지 않았다. 실제 설정·임의 플러그인·PageFold provider 실행이나 기기 종합 통과가 아니다. 정본은 패처 `docs/POCKETRISU-G1-7-M6-MIXED-INITIALIZATION-VALIDATION.md`다.

**Protocol·API 제한 알림 보완 전달 (2026-10-09):** experimental.28/adapter0.7.35를 검증·검수·push·live 전달했다. 원본 MARP의 protocol35행에서 PDF 유무/독립 parser 입력 복원, provider body/헤더, direct 실패 뒤 proxy bytes 보존, 합성 OAuth 실제 서명과 재사용, PDF unsupported 재시도·음성 대조·잘못된 응답과 다음 정상 호출을 확인했다. 별도 재현한4MiB API 거절의 알림 누락을 generic host에서 수정했으며 작은 후속 호출과 기존 cap을 보존한다. 같은 resource code/phase/effects의 실제 중단이 경고 receipt에 묻히던 경로도 재현·보완하고 두 문구를 구분했다. Host40·server515/12기존skip·client2296/4기존skip·compat74/5기존skip·patcher52·types0/0·build/BGload·42packs1526units7collisions/replan0·1022파일 exact revert를 확인했다. Backup91,642,361bytes/1642파일 검증 후 live484경로/175JS/DB5·헤더/font 보존·작업99→99/삭제0·PM2online/unstable0·새오류0을 확인했다. HostOFF·원본·실제 공급자는 유지했고 stable tag는 없다. 실제 browser Worker PDF 동등성·큰 입력/취소·설정/최종 caller 잔여·M7 활성화·iPhone/A-D/G1 종합은 남는다. 정본은 패처 `docs/POCKETRISU-G1-7-PROTOCOL-BUDGET-VALIDATION.md`다.

**진단의 현재 상태:** M5 뒤 일반 parent-owned transport 요약과 Settings → System → Request Logs의 서버 플러그인 진단 패널을 구현했다. 호출 횟수·HTTP 헤더 상태·reject/duration 같은 관찰 사실을 유한하게 보관하며 URL·본문·인자값·인증정보·대화 키는 기록하지 않는다. 본문 완료나 원본 private history/lastRun, 분석의 의미적 성공을 복원하는 기능은 아니다. M7은 현재 설치 조합에서 실제 요약·알림의 관찰 범위와 지원 한계를 확인한다. 새로운 진단 확장은 사용자 가치와 직접 관찰된 공백으로 판단한다. 상세는 patcher qualification ledger의 Source and changes다.

**기존 구현 재사용:** G1.6의 일반 호스트/RPC/native adapter와 G1.11 헤더 처리부는 이미 구현돼 있다. 브라우저 `/proxy2`는 문맥이 없으면 규칙별 fallback 세션, 서버 훅은 대화별 HMAC 세션을 사용한다. 현재 서버 host caller와 최종 shim을 검증하는 것이며 과거 G1.11 기록의 caller 부재를 현재 상태로 취급하지 않는다. 기존 custom/local endpoint·provider·agent 선택·native retry는 보존한다. AC listener 등 추가 요구는 G2에서 검증한다.

**실행 경계:** M0~M6은 production host OFF를 유지한 격리 합성 검증으로 시작한다. 현재 공급자 호출, production activation, 유료 MARP 분석1회, 기기/aggregate·stable gate를 이 계획 갱신이나 자문 일치만으로 통과 처리하지 않는다. source/installer/runtime 변경은 이번 문서 갱신에 포함하지 않는다. 세부 기록 정본은 patcher `docs/POCKETRISU-G1-7-MARP-HOST-QUALIFICATION-PLAN.md`다.

직전 experimental.28 확인 기록(2026-10-09): 사용자가 일반 요청 정상·MARP 연결 검사 성공을 보고하고 기록 마무리를 확인해 이번 일반 요청 보존 범위를 종료했다. 서버 실행기는 OFF이며 실제 채팅의 MARP 전처리와 브라우저 호출 이력은 확인된 것으로 확대하지 않는다. 다음 실행 단위는 M4의 agent/prompt/deadline 설정 저장→strict root flush→접수/조립→실제 분석 일관성과 대기열·재시도 갱신 검증을 먼저 다루는 안이다. 이미 통과한 기본 모델 변경 증거는 재사용한다. 이후 실제 browser Worker PDF/큰 입력·취소·최종 caller 잔여를 닫고 M7로 이어가며, 이 기록은 구현 착수·활성화·실제 공급자 호출을 수행하지 않는다.

### 목표별 검증 하위 계획과 L1~L6 연결 (2026-10-10)

**호칭:** L테스트는 L1~L6 전체 절차를 뜻하며, 사용자가 직접 수행하는 기기 테스트는 L5다. 사용자 안내는 UI 기능 / 이번 변경 / 확인 방법 표로 작성하고, 가능한 자동 실측과 시험 준비를 먼저 완료한다.

아래 항목은 각 단계에서 우선 연결할 검증이며 검증 범위의 상한이나 통과를 위한 전용 체크리스트가 아니다. 실제 변경·최종 caller·의존 경로·발견된 문제와 보존 계약에서 추가 검증을 도출한다. 기존 증거는 source·환경·계약이 같은 범위에서 재사용하고, 변경·새 조합·모순이 있는 지점은 다시 확인한다. 예전 기록에 적힌 다음 작업은 당시 순서이며 현재 시작점은 experimental.32 뒤 M7/G1.5b다.

| 하위 계획 | L1~L4에서 연결할 검증 | L5~L6에서 닫을 결과 |
|---|---|---|
| M7/G1.5b 설치 조합·접수·활성화 조건 | 현재 원본/순서/권한과 실제 등록 역할, UI-only와 초기화 효과, 브라우저·서버 중복 참여, raw/prepared/명시적 입력 복구, main/sub/aux/fallback의 실제 선택, identity 변경·provider 누락/충돌·재실행 방지·원문 보존·알림을 격리 ON과 OFF에서 확인한다. 구형 bundle, 재시작을 통한 OFF 복귀와 대기 작업, 여러 채팅의 동시 자원/정리도 지원할 조합에 연결한다. | 안전 전달 뒤 실제 기기에서 바뀐 접수·누락 안내·입력 보존을 확인한다. 이미 확인된 일반 사용을 MARP 서버 실행으로 확대하지 않는다. 활성화 조건과 실제 ON·공급자 확인은 구분해 기록하며 stable은 해당 L5 뒤 L6에서만 판단한다. 세부 실행은 patcher MARP qualification plan의 M7 하위 계획을 따른다. |
| G1.8 실패·재시도·알림 | experimental.39/adapter0.7.46, 구현 `1df5fe1`·전달 `572606d` 기준으로 실패/재시도/v3 알림·복구·R1통계/R2exactACK/R3수정안내/R4publication보존과 완료답변 뒤 uncertain 표식 정산을 검증·push·OFF 전달했다. Fullclient2365/기존skip4·type0/0·patcher332·build/BGload·graph/replan/exactrevert, 서버108파일동일에 한정한 기존630/12skip 재사용, live493/JS175/DB5·작업70보존/제거0·hostOFF/새error0을 확인했다. 정본은 patcher lifecycle validation과 verification record §§13–18이다. | 2026-10-12 scoped 잔여 기기 확인을 종결했다. 알림 실제 표시·차단편집 유지/복구·다른채팅 정상저장·다음Send를 확인했고, 자연접수 R7에서 홈 보고 뒤 provider0/commit0→해제→복귀 전 normalAPI 입력1/답변1/기존편집/provider1→사용자 정상복귀·completed/delivered/ACK를 연결했다. 새bg-input오류0이며 Hub오류는 격리외부차단으로 분류했다. 인위접수지연/초기fixture/표시미확인 등 옛제한은 해당관찰에 유지한다. 별도stage1·서버도달전전송·내부OS suspension·noncommitted unknown·실제provider/MARP·G1.9 stream·G1.10 aggregate/ON/stable은 이 scope의 통과로 확대하지 않는다. |
| G1.9 스트리밍 | experimental.40/adapter0.7.47에서 read-only 서식 미리보기·명시적 현재 작업 중지·canonical 저장/복귀 소유권을 구현·검증·hostOFF 전달했다. Native frame/OpenAI·Google promise, 확정 저장 retry와 cancelled-input proof를 보강했다. Frontend2396/기존skip4·server643/기존skip12·patcher52·Svelte0/0, Lua 늦은 stream/input latch·Gemini/Vertex 합성 실패/중지/다음전송, 비스트리밍 보존·1022 exact revert·live504/JS175/DB5/auth200/newerror0이 정본 validation에 연결된다. | 2026-10-12 안내한 공통 서식/생각 접기·중지 후 한번 전송·합성 실패 후 한번 전송·부재/복귀 네 항목의 iPhone 정상 보고로 scoped L5를 닫았다. Normal-chat API200/행ID중복0·terminal operation/input·inactive preview를 읽기 전용 대조했다. Aggregate 행수는 이전 자동시험 포함이며 조작별 시간이나 내부OS suspension으로 확대하지 않는다. L6 문서·JOURNAL·sweep·push와 완료L3 정리를 닫으며 실제provider/MARP·G1.10 최종조합/hostON/stable은 별도다. |
| G1.10 실제 공급자·기기·종합 | 앞 단계의 자동 증거와 미검증 항목을 최종 source/installer 조합에 연결한다. 합성 검증 뒤 승인된 조건·횟수의 실제 공급자 분석과 주입·저장을 확인한다. 실제 브라우저 종료 뒤 복귀 전 normal-chat API의 본문/revision을 확인한다. | MARP D1~D8, preset/module, 편집·대기열·취소·cold return·알림의 실제 기기 결과를 연결한다. 단계적 ON의 적용/복귀 상태와 한계를 기록한다. 기능별 L5 결과가 남아 있으면 aggregate/stable 완료로 계산하지 않는다. L6에서 문서·버전·sweep·발행 뒤 readback을 닫는다. |

**G1.8 현재 재검증 gate (2026-10-11):** 위 G1.8 행의 종결은 기존 자동/전달 및 시험용 알림의 표시 범위다. 사용자 요청에 따라 실제 실패 lifecycle의 기기 재검증은 이번 G1.8 L5에서 미완료 gate로 관리한다. 정본은 patcher `docs/POCKETRISU-G1-8-FAILURE-LIFECYCLE-PLAN.md`의 「G1.8 재검증 계획」이다. 자동으로 실제 UI Send 실패→부재→복귀 알림→같은 채팅 UI Send 정상 답변을 먼저 연결한 뒤, iPhone 전면·홈 이동/잠금 복귀·앱 종료/재실행을 각각 확인한다. 실제 설치 접수 판정·server 인수 화면 신호·fallback 목적지·예상 알림 목록을 준비하며 아직 실행/통과/기기 준비 완료를 뜻하지 않는다. 생성 중 수정 미반영 알림은 별도 D/G1.3 결과로 연결한다. G1.10에는 이 결과와 남은 실제 공급자/최종 조합 항목을 명시적으로 연결하고 재확인한다. 이번 기기 미실행 항목을 G1.10으로 단순 이월하거나 시험용 알림으로 통과 처리하지 않는다. 내부 OS suspension은 관찰 채널 없이 단정하지 않는다.

구현·자동 검증·commit/push·안전한 후보 전달은 각 단위에서 수행한다. L5는 stable release gate이며 일반적인 다음 작업이나 safe delivery의 재승인 지점이 아니다. 실행기 활성화는 guest 초기화와 실제 공급자 호출을 바꾸므로 현재 작업 권한·기존 사용자 결정·비용 조건·런타임 제한을 확인하고, 허용 범위 안에서 진행한다. 확인된 실패가 요청 결과를 막으면 관련 수정과 영향 검증을 수행하며, 회귀는 기존 회귀 절차를 따른다.

**G1.8 재검증 실행 결과 (2026-10-11):** 실제 UI에서 발견한 실패 후 다음 Send 차단을 사용자 승인으로 수정했다. Experimental.36/adapter0.7.43은 현재 입력 proof와 exact 실패 ACK 기록으로 retained-input 무답변 최종 실패를 정산한다. 전면·종료 복귀·ACK 응답 유실·대기 N+1의 실제 UI 시험, 서버570pass/기존skip12·frontend2317pass/기존skip4·패처52entries·graph/replan/exact revert와 Opus source/delta 검수를 마쳤다. OFF 전달/readback과 사용자 A/B/C 기기 결과는 각각 별도 확인한다. 의도적으로 삭제한 입력, 부분/불확정/receipt 없는 만료 결과는 보존 fence를 유지하며 모든 실패 복구나 hostON/stable 통과로 확대하지 않는다. 상세는 patcher `docs/POCKETRISU-G1-8-VERIFICATION-RECORD-2026-10-11.md` §10이다. §9는 수정 전 실패 관찰이다.

**G1.8 최신 잔여 구현 상태 (2026-10-11):** 위 문단은 .36 당시 기록이다. 이후 A/B/C 기기 관찰을 verification record §§11–12에 연결했다. B/C의 실패 입력 정산·다음 정상 답변/통계 저장과 C 초록 단계 종료·복귀·추가 재접속의 동일 알림 재표시 부재를 확인했다. A의 초기 통계 fixture와 C 추가 요청 출처 제한은 유지한다. 사용자 지시로 .37/adapter0.7.44에서 통계 precondition·client model fallback 차단, exact 실패 ACK의 V4/V5 보존과 의도적 원문 삭제 뒤 다음 입력, anchored 수정 미반영 알림 producer를 구현했다. 서버612pass/기존skip12·frontend2325pass/기존skip4·type0/0·패처52entries, 실제 UI 편집/무편집·재접속·다음 Send와 ACK 유실/원문 삭제, graph42packs/1569units/490paths/8collisions/replan0/1022byte-mode revert를 확인했다. 즉시 수정 안내와 서버 보관 안내는 전면에서 각각1회, 재접속에서 둘 다0회로 별도 계수한다. OFF 전달/readback과 D/G1.3 기기 결과는 별도 경계다. committed publication 대기 중 target-chat 쓰기 보호는 설계 대안 승인 대기이며 아직 구현하지 않았다. 전체 G1.8·파란/초록 단계 정상 부재 완주·실제 provider/MARP·stream·hostON/stable은 미완료다. 상세 정본은 verification record §13과 lifecycle PLAN의 remaining implementation units다. 다음 목표 순서는 G1.8 잔여·G1.9 → G1.10 → G2를 유지한다.

**G1.8 D 종결·복구 잔여 갱신 (2026-10-11):** scoped iPhone D/G1.3은 조립 후 편집·두 수정 안내·재접속 재표시 없음·편집/답변 보존·다음 Send와 무편집 안내 부재까지 사용자 관찰·서버 기록을 연결했다. 결과/README/CHANGELOG·문서 push와 해당 L3 정리로 scoped L6을 닫았다. 이후 남은 publication 질문은 실제 생성 서버의 유효 build header·HTTP 저장·DB 영속·재시작으로 검증했다. 이미 기록된 답변의 canonical 반영이 실패한 동안 정상200 저장한 늦은 편집이 재시작 후 덮였고, 같은 상태에서 정상200 삭제한 합성 채팅도 재시작 후 복원됐다. 이미 반영한 대조는 편집/삭제를 보존했다. 답변1·통계11·영수증 byte·합성provider1은 동일하므로 모델 재실행 문제가 아니다. 실제 운영 고장 빈도와 stalled-startup은 미측정이며, 일반 crash는 listen 전에 복구하므로 같은 노출로 주장하지 않는다. 수정안은 영향을 받는 저장 접수 전에 기존 답변 publication·input 정산을 먼저 복구하고, 성공하면 기존 CAS/rebase로 편집을 보존하며, 실패하면 기기 미저장 편집을 유지하는 명확한 저장 차단 상태를 반환하는 방식이다. Target/parent 삭제·metadata·root CAS·관련 effects와 다른 채팅/무관 설정/유효 통계 복구 보존을 함께 검증한다. 앞선 비교 guard 실패 뒤의 구조 대안이므로 사용자 승인 전 구현하지 않는다. 전체 G1.8은 이 잔여가 열려 있고, G1.9→G1.10→G2 순서는 유지한다. 정본: patcher verification record §§14–15; 별도 저장소 main의 문서 게시 승인도 대기다.

**G1.8 R4 전달·기기 결과 갱신 (2026-10-11):** 사용자의 1번 선택으로 앞 절의 recover-before-write 대안을 승인받아 experimental.38/adapter0.7.45/lazy-sync0.5.8에 구현하고 후보 브랜치에 push·OFF 전달했다. 실제 HTTP/restart22개와 lookup 장애4route, 같은 캐릭터의 차단 채팅 편집·다른 채팅 생성/ACK·복구 후 저장, hydration 중 편집 누락과 현재 배열 교체를 재현·수정했다. 최종 frontend2341/기존skip4·focused82/기존skip4·type0/0·server630/기존skip12의 source 동일성·patcher332·graph/re-plan/exact revert와 live493/JS175/DB5·journal167보존·hostOFF를 기록했다. iPhone에서는 저장 차단 중 수정이 화면 전환 뒤 유지되고, 다른 채팅 답변이 저장되며, 차단 해제 후 수정3과 각 답변1개가 서버 저장·새로고침 뒤 보존되는 것을 사용자 보고와 서버 기록으로 연결했다. 차단 안내 호출 기록은1회지만 실제 화면 표시를 사용자가 놓쳤을 수 있어 물리적 표시 항목은 미확인으로 남긴다. scoped R4 유지/복구 L5와 L6을 닫되 정상 생성의 파란/초록 단계 부재 기기 경로, 실제 provider/MARP·G1.9 stream·전체G1·hostON/stable은 통과로 확대하지 않는다. 앞 절의 설계 승인 대기·미구현 상태는 이 기록으로 대체하며 정본은 patcher 검증 과정·결과 §16이다. 이 별도 저장소 main의 문서 게시 승인 경계는 유지한다.

**G1.8 접수 미확인 후 정산 수정 (2026-10-11):** 후속 iPhone에서 저장 차단 알림 실제 표시·복구 저장·새로고침을 확인했다. 홈 이동 뒤에도 provider0/commit0으로 대기한 실제 요청을 그다음 해제하고 복귀 전 normal-chat API에서 입력1/답변1/기존편집/provider1을 확인했다. 고의 접수 응답 지연은60s 재조정/10s attempt 조건에서 제출69s 뒤 unknown 안내를 만들었으며 오류 없는 자연 응답 대조로 계산하지 않는다. 이후 다음 Send가 거절돼, 이미 저장된 답변의 uncertain 표식이 기존 accepted-only 정산에서 빠진 결함을 source/실제UI/실패 회귀2개로 재현했다. `1df5fe1` / experimental.39 / adapter0.7.46에서 exact chat-committed receipt·좌표·60+10s grace/current/idle/재독으로 상태만accepted에 넘기고 기존 채팅 확인·ACK가 정산하도록 수정·push했다. Full client2365/기존skip4·type0/0·frontend/BG build/load·patcher332·graph/replan/exactrevert, 실제 새 Send와 ACK 뒤 same-input409/추가provider0을 확인했다. 최종 Opus 검수 뒤 safe OFF 전달과 자연 응답 기기 확인을 이어간다. Unknown/진행중 요청의 무조건 삭제·모델 재실행·새 tombstone은 추가하지 않았고 broader stage1/pre-admission/OS suspension·provider/MARP/stream/ON/stable은 별도다. 상세 정본은 patcher 검증 과정·결과 §18이다.

**G1.8 잔여 기기 종결 (2026-10-12):** 수정된 시험 앱에서 사용자가 R7 정상 입력을 한 번 접수하고 입력창이 비워진 뒤 홈 이동을 보고했다. 그 보고 후 exact operation provider0/commit0·접수응답보류0을 확인하고 그다음 공급자를 해제했다. 복귀 전 정상 채팅 API200으로 입력1/답변1/기존편집/provider1을 확인했다. 사용자는 복귀정상을 보고했고 inputcompleted·operationdelivered·resultACK완료, 새bg-input오류0을 대조했다. 표시된 Hub Proxy 기록은 명시적 synthetic outbound denial이며 원문/로그를 지우지 않고 부수 시험오류로 분류했다. Scoped G1.8 잔여의 L5·L6을 닫고 기존 성공/실패/단계 한계는 각각 보존한다. 다음 계획 항목은 G1.9 스트리밍이며 G1.10 실제 공급자/MARP·종합 조합·ON/stable은 별도다. 상세 정본은 patcher 검증 과정·결과 §18 및 lifecycle validation의 최신종결이다.

### G1.11 외부 요청 헤더 규칙 상세

**목적:** 플러그인이 헤더 설정을 제공하지 않고 공급자가 헤더를 요구할 때, 플러그인을 수정하지 않고 PocketRisu가 사용자 규칙으로 헤더를 붙인다. 첫 용도는 MARP 분석 요청의 `x-opencode-session`이다.

**규칙 모델**

| 필드 | 내용 |
|---|---|
| 식별자·이름 | 규칙 ID와 사용자 표시 이름 |
| 활성 | 기본값 꺼짐. 규칙이 없거나 꺼져 있으면 기존 동작과 바이트 단위로 같다. |
| 목적지 | `https` scheme, host 정확 일치, path prefix. 와일드카드와 정규식은 두지 않는다. |
| 헤더 이름 | 규칙이 붙일 헤더 이름. `authorization`, `cookie`, `host`, hop-by-hop 헤더와 PocketRisu 내부 프록시 헤더는 거부한다. |
| 값 종류 | 첫 구현은 "대화별 세션 ID" 하나만 둔다. 고정 문자열 값은 필요가 확인될 때 추가한다. |

**세션 ID 값**

- 값은 서버 비밀에서 파생한 HMAC(규칙 ID, 대화 키)로 만든다. 채팅 ID 원문이나 사용자 식별자를 외부로 보내지 않는다.
- 서버 실행(서버 번들 요청과 서버 플러그인 호스트)에서는 해당 요청의 채팅을 대화 키로 쓴다. 같은 채팅은 같은 값, 다른 채팅은 다른 값이 된다.
- 대화 정보가 없는 경로(브라우저 `/proxy2`로 오는 요청, MARP 연결 검사·진단)는 규칙별 고정 키를 쓴다. 항상 서버 실행으로 보내는 결정에 따라 보내기 요청은 서버 실행 경로를 탄다.

**적용 지점** — 하나의 함수로 구현하고 다음 경로가 모두 이 함수를 거친다.

1. 서버 `/proxy2` 전달과 proxy job WebSocket 전달(브라우저에서 넘어온 요청)
2. 서버 번들 실행기의 `/proxy2` 대체 경로(서버 전체 위임 중 요청)
3. 서버 플러그인 호스트의 `nativeFetch`(G1.6)

브라우저가 목적지로 직접 보내는 요청은 서버를 거치지 않으므로 규칙이 적용되지 않는다. 목적지가 CORS를 허용하면 브라우저 직접 요청이 성공할 수 있으므로, 규칙 설정 화면에 "서버를 거치는 요청에만 적용"을 표시한다.

**동작 규칙**

- 요청에 같은 이름의 헤더가 이미 있으면 덮어쓰지 않는다.
- 본문, URL, 다른 헤더는 바꾸지 않는다.
- 로그에는 규칙 ID와 적용 여부만 남기고 헤더 값과 대화 키는 남기지 않는다.
- 규칙 설정은 PocketRisu 서버 저장소에 두어 기기 간에 공유한다. 설정 화면과 소유 patcher pack은 구현 착수 시 catalog authority에 맞춰 정하고 manifest에 소유권을 명시한다.

**검증**

1. 자동 테스트: 목적지 일치·불일치, 경로 prefix 경계, 금지 헤더 거부, 기존 헤더 보존, 같은 대화 값 동일·다른 대화 값 상이, 규칙 꺼짐 시 요청 바이트 동일, 로그에 값 미기록.
2. 기존 경로 회귀: 규칙이 없을 때 `/proxy2`, proxy job WebSocket, 서버 번들 `/proxy2` 대체 경로의 요청이 변경 전과 같다.
3. 과금 없는 실측: 존재하지 않는 모델 이름으로 세 적용 지점 각각을 통해 요청해, 규칙을 끄면 `MissingSessionID`, 켜면 모델 없음 오류가 나는 것을 확인한다.
4. 실사용: 사용자 확인 뒤 MARP 분석 1회를 실제로 실행해 세 분석 성공과 주입을 확인한다. 이 호출은 과금된다.

**위험:** 공급자는 이 endpoint를 코딩 에이전트용으로 안내한다. 헤더 요구를 충족해도 용도 조건은 별개이며, 사용자가 이 위험을 판단해 선택했다.

**G1.11 진행 기록 (2026-09-27 KST):** 후보 `0.2.4-experimental.7` (`cf4eaea`)에서 Personal settings의 외부 요청 규칙 UI/API와 공용 HMAC 처리부, `/proxy2`·기존 로컬 HTTPS/WebSocket·BG 프록시 연결을 구현·push·live 적용했다. 규칙은 자동 생성/활성화하지 않았다. Patcher 51/51, 서버 387/12 skip, 프런트엔드 1,920/2 skip, 호환성 74/5 skip, 타입 0/0, frontend/BG build, 42-pack 조합 re-plan 0·exact revert를 확인했다. Live HTTP/asset/420 managed files/DB 5개 무결성도 확인했다. 실제 공급자에 저장된 자격증명으로 보내는 검증 요청은 자동 승인 검토의 명시 승인 요구로 보류했으며 기기 UI 확인도 대기다. G1.6 nativeFetch caller는 아직 없고 공용 처리부 연결은 그 단계에서 수행한다. 상세는 patcher `docs/POCKETRISU-G1-11-EXTERNAL-HEADERS-VALIDATION.md`다.

**후속 확인:** 사용자가 설정 화면 진입과 사용을 승인한 뒤, 저장된 공급자에 없는 모델·빈 메시지로 격리 처리부 OFF/ON 요청 두 건을 실행했다. OFF는 HTTP 400/MissingSessionID, ON은 HTTP 400/해당 오류 없음이었다. ON 잔여 오류의 정확한 원인이나 과금 여부는 확인하지 않았다. live 규칙 영구 저장·활성화와 배포 프록시 검증 1건은 자동 승인 검토가 별도의 구체 승인을 요구해 거절했으며 실행하지 않았다. 해당 승인 질문이 대기 중이고 live 설정 row는 여전히 0이다. 실제 MARP 분석·G1.6 연결은 미검증이다.

**규칙 활성화:** 이후 사용자가 영구 저장·활성화와 검증을 구체 승인해, 정상 로그인/설정 API로 저장된 MARP 목적지의 `x-opencode-session` 규칙 1개를 활성화했다. Revision 0→1과 GET/DB readback 일치를 확인했고 배포 프록시 검증은 HTTP 400/세션 누락 오류 없음이었다. 잔여 400의 정확한 원인과 실제 분석 성공은 아직 확인하지 않았으며 G1.6 서버 호스트 연결도 미구현이다. 앞선 승인 대기는 이 구성 작업에 한해 해소됐다.

### G1.12 끝난 서버 작업의 앱 정리 상세

**관측 (2026-09-28 KST, live 읽기 전용 조사):** iPhone에서 진행 표시(보라색 원)가 계속 돌고, 누를 때마다 "서버가 취소 대상을 아직 확인하지 못했어요"가 표시됐다. 앱을 다시 열 때마다 "서버 소유 답변의 채팅 저장을 확인하지 못했어요"가 반복됐다. 조사 시점에 서버의 실행 중·대기 작업은 0건이었다. 서버가 무언가를 실행하고 있던 것이 아니라, 앱이 이미 끝난 작업 두 건을 닫지 못한 상태였다. 사용자 데이터 손실은 없었다.

| 사례 | 서버 상태 | 앱 동작 | 원인 |
|---|---|---|---|
| A. 저장 완료 결과의 채택 실패 | 답변을 생성해 정상 채팅에 저장했다(`chat-committed`, 저장 영수증 있음). | 결과 채택을 `local-revision-conflict`로 약 2.5초마다 미루는 것을 반복했고, 진행 표시가 유지됐다. 취소 요청은 이미 끝난 작업이라 서버가 취소로 응답하지 않았다. | 앱은 로컬 채팅 사본의 지문이 전송 기준 지문과 정확히 같을 때만 서버 저장 결과를 채택한다(`adoptServerCommittedChat`). 전송 뒤 로컬 사본이 바뀌면 조건을 영구히 충족하지 못한다. 반복에 상한이나 종료 조건이 없다. |
| B. 오류 종료 결과의 오분류 | main 호출이 600초 시간 제한으로 중단된 오류 종료 결과다(답변 없음). 작업 상태가 `result-ready`에서 전달 완료로 넘어가지 못했다. | 앱을 열 때마다 이 결과를 "서버 저장 미확인"으로 분류해 경고하고, 작업 표식을 보존해 다음 실행에서 다시 확인했다. 취소 요청도 거절됐다. | 앱은 저장 영수증이 없고 서버 저장 방식(`serverChatCommitVersion=1`)으로 시작한 결과를 모두 `server-owned-uncommitted`로 분류한다(`serverChatDeliveryDisposition`). 답변 없이 오류로 끝난 결과도 이 분류에 들어가 정리되지 않는다. |

**수정 계획**

1. **오류 종료 결과의 종결 (B):** 결과가 최종(`final`)이고 오류 종료이며 저장할 답변이 없으면 "저장 미확인"이 아니라 "실패"로 분류한다. 오류 내용(예: 시간 제한)을 알림으로 한 번 보여 주고, 서버에 결과 수신을 확인(ACK)해 작업을 전달 완료로 닫고, 휴대폰의 작업 표식을 지운다. 같은 작업에 대해 반복 경고하지 않는다. 답변이 있거나 결과가 최종이 아니면 기존 보존 규칙을 유지한다.
2. **저장 완료 결과의 채택 (A):** 서버가 이미 저장한 결과는 로컬 지문 일치를 조건으로 삼지 않는다. 서버 채팅에 추가된 메시지를 메시지 ID 기준으로 로컬 사본에 합치고, 로컬의 다른 변경은 G1.2 rebase 규칙으로 보존한다. 합칠 수 없는 경우(입력 메시지가 로컬에서 삭제됨 등)에는 서버 채팅을 기준으로 다시 불러오도록 안내하는 알림을 남기고 반복을 멈춘다. 이 처리는 G1.1 anchor 추가 저장의 앱 쪽 짝이다.
3. **반복 상한:** 채택·확인 재시도는 상한과 간격 증가를 둔다. 상한에 도달하면 진행 표시를 내리고 알림을 남기며, 결과와 작업 기록은 보존해 다음 채팅 열기 때 다시 시도한다. 진행 표시가 서버의 실제 실행 상태와 무관하게 무한히 남지 않게 한다.
4. **끝난 작업의 취소:** 서버가 이미 끝난 작업(저장 완료, 오류 종료, 전달 완료)에 대한 취소 요청을 받으면 "이미 종료됨"과 종료 종류를 응답한다. 앱은 이를 취소 실패로 표시하지 않고, 종료 종류에 맞게 1·2번 정리로 넘어간다.
5. **이미 남아 있는 기록:** 수정 적용 뒤 첫 실행에서 기존에 남아 있던 오류 종료 결과와 저장 완료 결과도 같은 규칙으로 정리되는지 확인한다. 서버의 작업 기록이나 사용자 채팅을 수동으로 지우거나 고치지 않는다.

**진행 (2026-09-29 KST):** 1번과 3번의 앱 쪽 핫픽스를 patcher 후보 `0.2.4-experimental.10`·`.11`(lazy-chat-bg-adapter `0.7.18`)로 전달했다. 답변 없는 최종 오류는 오류 요약 알림 1회·ACK·작업 표식 삭제로 닫는다. 저장 완료 결과는 영구 사유(`local-revision-conflict`, `projection-invalid`, `commit-receipt-invalid`)로 3회 연속 채택에 실패하면 반복을 멈추고 결과 행이 있으면 ACK한 뒤 "서버 채팅에 저장돼 있다"는 알림을 남긴다. 3번은 상한 도달 시 표식을 지우는 방식으로 구현했으며 간격 증가와 다음 채팅 열기 재시도는 넣지 않았다. 2번 메시지 ID 병합 채택과 4번 끝난 작업 취소 응답은 남아 있다. 5번은 남아 있던 저장 완료 결과(`7293828b…`)의 표식이 기기에 없어 새 경로가 실행되지 않았고, 서버의 결과 행은 조회하는 클라이언트 없이 남아 있다. 사용자가 앱 재실행·백그라운드/포그라운드 전송 확인을 정상으로 보고했다. 상세는 patcher `docs/POCKETRISU-G1-12-FINISHED-OPERATION-VALIDATION.md`다.

**검증**

1. 자동 테스트: 오류 종료·답변 없음 결과의 1회 알림·ACK·표식 삭제, 답변 있는 미확인 결과의 기존 보존 유지, 로컬 사본이 바뀐 상태의 저장 완료 결과 채택, 합칠 수 없는 경우의 반복 중단, 재시도 상한, 끝난 작업 취소 응답.
2. 기존 경로 회귀: 정상 완료·정상 채택, 실행 중 취소, legacy 결과 전달이 변경 전과 같다.
3. 실제 기기: 앱을 다시 열었을 때 반복 경고와 멈추지 않는 진행 표시가 사라지는지, 저장 완료 결과가 채팅에 보이는지 확인한다.

### G1.12 후속 — 종료 결과 복구와 탐색 차단 수정 (r 계획)

**배경:** 2026-09-30 진단에서 앱 기동 시 끝난 서버 작업의 결과를 복구하는 동안 전역 생성 중 상태가 유지되어 캐릭터·채팅 이동이 무시되는 결함을 재현했고, 상세 수정안 r3을 작성해 BG 구현 뒤로 보류했다. 2026-10-06 조사로 다음 사실을 추가했다.

- 앱이 15분 넘게 정지됐다가 복귀하면, 감시 기한 검사가 서버 조회보다 먼저 실행되어 이미 저장된 답변에 대해 "백그라운드 생성이 시간 초과됐어요. 다시 보내주세요."를 표시한다. 이 안내는 중복 유료 생성을 유도할 수 있다. 15분 기한은 서버가 작업 상태를 영속하지 않던 S4·S6 시기의 "생성 최대 시간" 추정이었고, M7에서 poll 잠김 해제용 독립 타이머로 재사용됐다. 실측: 클라이언트 로그 보존 범위(2026-09-28 이후)의 이 안내 4건은 모두 답변 저장 17~28분 뒤에 표시됐고, 2026-10-01~06 서버 작업 464건의 최장 실행은 340초였다. 이 감시는 기존 위임 경로에만 있으며 G1.4 대기열 입력 경로에는 감시·기한이 없다.
- 위 상태로 남은 작업 표식의 대상 채팅을 사용자가 삭제하면, 서버 projection 조회가 `404`·`currentRevision: null`을 반환하고 앱은 이를 일시 오류(`projection-unavailable`)로 분류해 기동할 때마다 재시도한다. 이 동안 위의 탐색 차단이 계속된다. 서버는 결과 ACK·보관 처리 뒤에도 저장 영수증을 근거로 계속 `chat-committed`를 응답하므로, 정상 서버 경로로는 반복을 끝낼 수 없고 표식의 49시간 만료만이 끝낸다.
- 관측된 한 건은 2026-10-06 사용자 승인으로 해당 작업의 서버 기록 3행(작업 상태, 결과, 저장 영수증)을 백업·바이트 검증한 뒤 한 트랜잭션으로 삭제했다. DB `quick_check`는 `ok`였고 결과 조회는 `finished`·`stage 0`을 응답한다. 이 수동 삭제는 수정 전달 전까지의 일회성 조치이며, 수정 뒤에는 서버 기록을 지우지 않고 앱이 종료한다.
- 결과 처리 중 시간 한도가 없는 대기가 있다. 서버 채팅 스냅샷 읽기 전체, 그리고 제어 요청의 15초 한도가 응답 헤더까지만 적용되어 결과·ACK·projection 응답 본문 읽기가 무제한이다. 이 대기가 멈추면 poll 잠금이 풀리지 않는다. 요청 소요 시간 기록은 현재 어디에도 없다.
- 저장 완료 결과의 채택 지점은 다섯 곳이다(감시 2, 기동 복구 2, 대기열 입력 복구 1). 대기열 입력 복구 지점은 실패를 기록 없이 건너뛴다.

**사용자 결정 (2026-10-06 KST):** r3과 위 조사를 하나의 계획(r4)으로 통합한다. 삭제된 채팅의 결과는 서버와 앱 양쪽에서 채팅 부재가 확인될 때만 알림·ACK 없이 표식을 정리한다. 거짓 시간 초과 수정을 같은 계획에서 처리한다. 상세 계획은 구현 착수 시 patcher 문서로 옮긴다.

**구현 단위**

| 단위 | 내용 | 범위 |
|---|---|---|
| G1.12a 종료 결과 판정 | 착수 첫 단계로 결과·스냅샷 본문 읽기 시간과 iOS 복귀 시 요청 중단 여부를 임시 계측. 회귀 테스트 선행(R0, 보존된 실제 store 재현 포함). 이미 반영된 로컬 채팅 인식(R1). 실행·저장 증거와 로컬 상태별 결과표, ACK 규칙, 횟수 기반 대기 제거(R2). 다섯 채택 지점 모두에서 삭제된 대상 채팅의 즉시 정리. 감시 기한이 서버 조회를 앞지르지 않게 하고 재전송 안내 제거. G1.6이 추가하는 서버 종료 상태 반영. 응답 본문·스냅샷 읽기의 시간 한도(값은 계측 분포로 정함). | 결과 복구·감시 경로와 채택 판정. 전역 생성 상태의 소유 구조는 바꾸지 않는다. 메타데이터 저장 전에 삭제된 새 채팅(저널 잔존)은 범위 밖의 알려진 잔여 위험이다. |
| G1.12b 복구와 생성 상태 분리 | 확인된 종료 결과의 복구가 탐색을 막지 않도록 복구 소유권을 생성 소유권에서 분리(R3). 진행 중 생성의 보호, Suggestion 준비 신호, 생성 상태 전환을 읽는 기존 소비자(플러그인 `sendChat`, 초안 복원, 단축키, 번역 등)의 회귀 확인(R4). | 생성 상태 소비자 전반 |

G1.12a와 G1.12b를 합치면 r 계획 전체이며, 계획 내용을 두 번에 나눠 전달하는 실행 구분이다(G1.5a/b와 같은 방식). 각 단위는 저장소 게이트(R5)와 안전한 live 전달(R6)을 별도로 거치고, 실제 기기 확인(R7)은 단위별로 수행한 뒤 G1.10 종합 확인에 다시 포함한다. R0~R7은 상세 계획의 구현 단계 번호이고, r3·r4는 상세 계획의 개정 번호다.

**실행 순서 (2026-10-09 실행 상태 반영):** G1.6 → **G1.12a** → **capability·접수 경로 보완(CAP)** → **G1.12b** → G1.7 + G1.11 → G1.5b → G1.8 나머지 + G1.9 → G1.10 → G2. CAP 전달과 일반 사용 확인을 마쳤고, 후속 사용자 지시로 G1.12b도 별도 후보에서 구현·자동 검증·push·live 전달했다. 원래 미완료 WIP는 보존한다. 실제 기기 경로와 G1 종합·stable은 아직 통과로 계산하지 않는다.

- G1.6 도중에는 착수하지 않는다. 진행 중인 G1.6 작업과 같은 adapter manifest·종료 판정 파일을 수정하게 된다.
- G1.12a를 G1.9보다 먼저 둔다. G1.9 스트리밍 중계는 같은 감시·복귀 경로를 다시 설계하므로, 15분 기한의 잘못된 해석이 남은 상태 위에 쌓지 않는다.
- G1.12b는 G1.6 뒤에 둔다. 2026-10-06 전수 조사에서 G1.6 작업은 생성 상태를 읽거나 쓰는 지점을 바꾸지 않았으므로, 이 순서의 근거는 같은 adapter manifest·종료 판정 파일의 동시 수정을 피하는 것뿐이다. G1.7 이후 새 소비자가 생기면 해당 단계에서 G1.12b 회귀 확인을 함께 수행한다.
- G1.12a와 G1.12b는 회귀 격리를 위해 별도 단위로 전달한다. G1.12a는 결과 판정에 한정되고 G1.12b는 넓은 소비자 범위를 바꾸기 때문이다.
- G1.10 종합 확인을 G1.12a·G1.12b 이후에 둔다. 알려진 복구 결함이 남은 상태에서 qualification을 하면 수정 뒤 재확인이 필요해진다.

### G1.12a 보완 — capability 반환과 접수 전 응답 대기

**작업 자료 보관 위치 (2026-10-08):** 운영 저장소의 gitignored `.code-review/workspaces/bg/` 아래 `candidates/`, `dependencies/`, `investigations/`, `runtimes/`로 관련 자료를 이동했다. CAP 비교 환경은 `investigations/capability-audit`, 생성된 통합 검증 환경은 `candidates/g112a-candidate`다. 정확한 절대 경로·이동 목록은 비공개 인계 기록에 둔다. 옛 `/tmp` 경로는 기존 스크립트 호환용 링크만 남겼으며 새 실행은 고정 경로를 사용한다. 완료된 roundtrip 사본15개만 원본 대조 후 삭제하고 다른 intent 기록13개와 검증 로그는 보존했다. 자료 정리는 구현 재개나 배포가 아니다.

**정본:** patcher `docs/POCKETRISU-BG-CAPABILITY-ADMISSION-REPAIR-PLAN.md`. 아래 계획은 검증되지 않은 G1.12b 구현을 함께 배포하라는 뜻이 아니다.

**세부 실행 계획 검토 (2026-10-08):** CAP 정본 §8에 소유 unit·회귀 시나리오·commit 경계·.22 적용 상태에서의 upgrade/re-plan/revert gate를 추가했다. 기존 marker 상태 조회가 capability보다 먼저 자체 header 제한 없이 기다리는 코드 경계도 확인했으며, 실제 caller 재현 뒤 prior-marker 관찰 지점만 제한하는 조건부 CAP-2c로 분리했다. POST 이후 기존 10초 attempt/60초 raw 재조정은 그대로 보존한다. 서버는 저장 큐·SQLite transaction 안에서 두 건 한도를 검사하므로 동시 client 진입만으로 초과 접수가 발생한다고 단정하거나 새 전역 lock을 추가하지 않는다. 이번 요청은 방향 검토와 세부 계획이며 런타임 구현·배포 재개가 아니다.

**CAP 전달 (2026-10-09):** 후속 사용자 승인으로 전용 `codex/pocketrisu-cap-admission`에서 전체 반환문·raw import/body/decode·prepared Stop·재현된 prior-marker 관찰 제한을 구현했다. experimental.23/adapter0.7.30, 구현/검증 commit6개와 packaging `dff28c5`를 push·live 전달했다. 전체 client2251/4skip·server490/12skip·compat74/5skip·patcher331, 마지막 보강3 및 타입0/0·build/load/help,42packs1395units7collisions/replan0·1022파일 exact revert·.22 upgrade466경로 fresh 일치를 확인했다. 실제 Chromium의 본문 timeout/Stop, 대기열, claim/attach 저장 경합은 합성 공급자로 검증했다. 앱/패처 상태1625파일 백업 뒤 live466경로·JS175개·DB5·헤더 보존·operation16→16/removed0·PM2online/unstable0·새 오류0을 확인했다. plugin hostOFF와 font0.5.13을 유지했고 원래 WIP11개 hash도 같았다. 유료 호출·생성 취소·사용자 데이터 삭제·stable tag는 없으며 iPhone/CAP·기존 G1.12a 기기 gate는 통과로 계산하지 않는다. 정본은 patcher `docs/POCKETRISU-BG-CAP-ADMISSION-VALIDATION.md`다.

**확인된 근거:** 실제 배포 백업의 capability 함수를 같은 조건으로 실행했을 때 계측 전 버전은 본문을 1회 읽었으나 계측 후보 .21과 현재 .22는 읽지 않고 `undefined`를 반환했다. 패처가 `return` 뒤 await 표현식만 여러 줄 주석으로 감싸 자동 세미콜론 삽입이 발생했다. 소스는 문법적으로 유효하므로 빌드 통과만으로 발견되지 않는다. 현재 소스와 반환문만 가상 교정한 비교본에서 각각 14개 격리 시험을 실행해 정상 접수·대기열 제한·접수 응답 유실 복구와 실패 분류를 확인했다. 실제 저장 계층의 동시 채택 3개 및 서버 선행 작업/접수 3개 시험도 확인했다. 이는 기기 qualification이나 전체 경합 검증이 아니다.

**CAP 기기 후속 확인:** 준비 단계 Stop을 화면만으로 식별하도록 요구했던 안내는 철회하고 일반 전송·답변·잔류 진행 표시·다음 전송으로 구체화했다. 사용자가 전체적으로 정상으로 보인다고 보고해 비계측 일반 사용 보존 확인을 종료했다. 실제 loaded build·준비 Stop·raw·cold/background/삭제 route의 증거는 받지 않았으므로 해당 항목이나 G1 종합/stable을 통과로 계산하지 않는다. 이번 CAP의 문서·commit/push와 L3 report 정리는 L6에서 닫는다.

**G1.12b 전달 (2026-10-09):** CAP7047115를 기준으로 별도 후보에서 terminal 복구와 생성 busy·operation 정리·현재 채팅 확인·Suggestion 수명을 분리했다. 최종 자문 뒤 ACK의 준비 확인 우회, 미반영 legacy 결과, 초안 검사 중 신호 유실을 실측·보완했고 추천 확인 요청을 복구 실행 신호와 분리했다. Runtime4d7bec8·correction1c59ba1·gate73af78a, experimental.24/adapter0.7.31을 push·live 전달했다. 최종 client2288/4skip, server490/12skip, compat74/5skip, focused164, patcher331, types0/0, production/BG build/load,42packs1486units7collisions/replan0·1022파일 exact revert·upgrade474경로 fresh 일치를 확인했다. Live474관리경로·served JS175개·DB5, 헤더/font0.5.13·hostOFF·작업22→22/removed0·PM2online/unstable0·새 오류0을 확인했다. 원래 WIP11hash는 같고 backup1626파일/91519326bytes와 기존 전체 복구 hash를 검증했다. 일시적인 저장 확인 문구는 정상 관측이며 재진입·저장 뒤 지속 또는 새로고침 필요 사례를 기기 확인에서 구분한다. paid call·생성 취소·사용자 데이터/백업 삭제·stable tag는 없고 기기 확인의 후속 결과는 아래 기록을 따른다. 정본은 patcher `docs/POCKETRISU-G1-12B-RECOVERY-OWNERSHIP-VALIDATION.md`다.

**G1.12b 기기 후속 확인 (2026-10-09):** 사용자가 테스트 진행 뒤 G1.12b 정상을 보고해 이번 일반 사용 기기 gate를 종료했다. 시나리오별 trace·loaded build·자동 제안 사용 여부는 별도 확인되지 않았으므로 cold/장기 정지/삭제/추천 교차 응답 등의 개별 경로와 G1 종합·stable을 통과로 확대하지 않는다. L6 문서·commit/push·scoped L3 정리를 수행하며 runtime/workspace/원래 WIP는 보존한다. 다음 구현은 G1.7 + G1.11 연결이다.

**별도로 재현된 대기 경계:** raw 입력 기준 채팅의 본문과 strict save를 멈추면 가상 시간 120초 뒤에도 접수 함수가 끝나지 않았다. 준비 후 위임 경로의 capability 본문도 기존 중단 신호를 관찰하지 않아, 실제 native 중단 신호 뒤 같은 시간 동안 생성 소유권을 유지하다 본문 도착 뒤에야 해제했다. 사용자 과거 증상의 발생 원인·빈도를 이 실험만으로 확정하지 않는다. raw 접수 중에는 이미 disabled spinner가 있으므로 무표시가 아니라 무기한 대기가 문제다.

| 단계 | 계획 | 보존·검증 경계 |
|---|---|---|
| CAP-0 근거 고정 | 전달된 .22와 G1.12b WIP를 분리하고 백업·가상 비교·현재 저장 설정의 정책 판정을 보존 | 저장 설정을 실제 열린 브라우저 상태로 간주하지 않음 |
| CAP-1 반환문·생성 검증 | 반환문 전체를 anchor로 교정하고 composer 조합 결과의 AST/도달 불가 코드·주석 경계 회귀 검사 추가 | 실제 생성 함수로 검증. 실패를 `unsupported`로 숨기거나 capability를 하드코딩하지 않음 |
| CAP-2 본문 대기·중단 | 기존 읽기 제한을 raw binary body와 prepared capability JSON에 연결하고 기존 사용자 중단 신호를 전달 | raw 읽기 실패는 기존 blocked, prepared capability 부재/실패는 기존 legacy fallback을 보존하되 중단 뒤 POST 금지. 늦은 응답은 새 접수·초안·소유권을 변경하지 않음 |
| CAP-3 보존·전달 gate | 접수 전후 구분, 초안/첨부, 두 건 대기열, 동일 입력, 응답 유실, raw/boot/attach 경합과 저장소 전체 검증 | 반복 ACK 자체가 아니라 중복 답변·비용·효과를 검사. 실제 실패가 재현된 공유 보호만 포함 |

기존 헤더 15초·본문 30초를 보존하며 binary body의 30초는 검증 후보이지 기기 분포 보장이 아니다. 공통 hydration/strict-save에 새 timeout을 부여하는 변경은 조건부 후속으로 분리한다. 관찰을 중단하는 것과 실제 저장을 취소하는 것은 다르며, 측정 없이 전역 저장 정책을 바꾸지 않는다.

CAP-2의 raw binary와 prepared capability/중단 연결은 별도 commit으로 회귀를 격리한다. prepared 본문 timeout은 기존 협상 실패와 같은 legacy ownership으로 진행하므로, 현재의 무기한 대기/늦은 v1 협상과 달라지는 점을 명시하고 정상 v1·HTTP 오류 fallback·중단 후 POST0을 비교한다. 기존 중단 신호는 헤더 전과 본문 대기 중 모두 검사한다.

**기대 효과와 한계:** 지원 기능의 정확한 판정, 자격을 충족하는 서버 입력 접수 및 명시적 입력 복구의 복원이다. 기존 provider/plugin 자격 판정은 바꾸지 않는다. 현재 조사한 저장 설정에서는 일반 raw 입력이 제외됐으므로 이 수정만으로 해당 플러그인의 전처리 중 앱 종료 문제를 해결했다고 주장하지 않는다. G1.7/G1.11/G1.5b의 원본 플러그인 qualification은 그대로 남는다.

실제 생성 소스·격리 HTTP/저장 검증과 L1~L4, Opus 검토, graph/re-plan/exact revert를 거친 뒤에만 추후 전달을 판단한다. 기기 확인은 실행한 경로를 구분하고, 이를 위해 모델 설정 변경이나 유료 생성을 임의로 요구하지 않는다. 현재 기기에서 닿지 않는 raw 경로는 미검증으로 남기며, 별도 실행이 필요하면 그 범위와 비용을 먼저 정한다. 기존 G1.12a 미확인 기기 항목도 통과로 바꾸지 않는다.

### 완료 조건

1. 실제 브라우저 프로세스 종료 뒤, 다시 열기 전에 서버 일반 채팅 API에서 저장 본문과 revision을 확인한다.
2. preset 주 모델, 적용된 module binding, MARP가 켜진 조합에서 서버가 순서대로 완료한다. classic 모델의 격리 통과만으로 완료하지 않는다.
3. 대기 중 앞쪽 메시지·캐릭터·로어북 수정이 conflict 사본을 만들지 않고, 조립 전 수정은 결과에 반영되며 조립 후 수정은 알림으로 드러난다.
4. 서버에서 처리할 수 없는 확인된 조합, 호스트가 관찰한 플러그인 실패·비활성화와 최종 실패가 알림으로 드러나고, 호스트가 추가한 조용한 누락·중복 유료 실행이 없다. 플러그인 내부의 의미적 실패와 진단 이력 차이는 M5에서 관찰·지원 범위 및 필요한 결정을 기록한다. native retry/fallback의 원래 분석 호출을 중복 결함으로 잘못 제거하지 않는다.
5. 기존 지원 기능의 회귀 검증과 실제 기기 확인을 마치고, G2의 기억 플러그인 없이 독립적으로 전달할 수 있다.

H1과 이전 G1 격리 후보는 재사용 증거다. 이들의 통과나 capability 값 변경만으로 G1 완료를 선언하지 않는다.

## 9. G2 — 공식 RCM 설치와 서버 완주

### 9.1 배경·용어·현재 진입점

**2026-10-15 G2.1 실행 상태:** 공식 RCM 1.0.13 backend를 ARM64/Node 25.9.0에 격리 설치해 native SQLite/vec·인증/API revision·재시작·빈 DB 백업/복원을 확인했다. 공식 PocketRisu 1.10.0의 정상 UI로 원본 JS를 설치했으나 `addRisuChatListener`의 기능 탐지와 실제 API 지원 불일치로 초기화가 중단됐다. G2.1은 부분 완료이며 브라우저 연결·G2 통합은 미완료다. 기준선, 재현 원인, 증거, 남은 순서는 [G2.1 검증 기록](BG-G2-1-RCM-INSTALL-VALIDATION.md)을 따른다. 앞선 1.0.12 비교 결과는 당시 버전의 기록으로 보존한다.

**2026-10-22 G2.2c 관측(1.0.21):** 공식 v1.0.21(commit `50c76fe`)의 ZIP·JS hash, ARM64 native 모듈 로드, health·API revision 98·인증·재시작을 확인했다. 다만 1.0.21 의존성의 `npm install`은 실행 환경의 권한 검사로 막혀 관측하지 못했고(같은 버전의 G2.1 설치본 의존성을 재사용), 새 설치 절차는 G2.5에서 확인한다. G2.2a 패치 조립본의 브라우저에서는 원본 RCM의 메뉴 표시 → 주소·token 저장 → backend 연결이 실제로 이루어졌다. 이는 수정하지 않은 공식 PocketRisu 조합의 결과가 아니므로 위 G2.1 잔여(공식판 브라우저 연결)를 해소한 것으로 계산하지 않는다. 상세: [G2.2c 실측](BG-G2-2C-RCM-MEASUREMENTS.md).

G2.1의 남은 브라우저 연결 확인은 G2.2급 호스트 호환성 해결에 의존한다. 그 변경에는 아래 G1 선행 조건이 적용되며 원본을 다시 설치하는 것으로 대체하지 않는다. 초기화 실패 뒤 model 요청 gate가 닫힌 채 남을 가능성도 소스로 확인했으나 Send 실측은 하지 않았다. G2.2에서 실패 시 일반 전송 보존까지 검증한다.

**호스트 수정 계획 checkpoint:** [G1 잔여 의존 표와 호스트 검토](BG-G2-HOST-COMPATIBILITY-REVIEW.md)에 기존 자동/실제 기기 근거, 구현 의존과 지원/전달 의존을 구분했다. 첫 수정은 foreground/BG의 실제 capability 노출 정확화(G2.2a)로 확정했다. 격리 진단본의 원본 RCM 메뉴·설정 저장·재접속 보호 API 200은 공식 원본 조합의 성공이나 G2 완료가 아니다. output listener 단독 추가는 현재 host close→canonical commit 순서와 detached 효과를 풀지 못하므로 첫 수정으로 채택하지 않는다. 저장 후 수명·lease·의도적 차단·필수 API/MCP 의미는 기존 G2.2~G2.4에서 확인한다.

기존 G2는 Archive Center(이하 AC)를 가정했다가 AC·Risu Cognitive Memory(이하 RCM) 비교 단계로 바뀌었다. 2026-10-15 사용자는 기능·운영 조건 설명을 바탕으로 RCM 설치를 선택하고 AC는 미래 후보로 남기기로 했다. 현재 G2 대상은 공식 RCM 하나다. RCM의 외부 backend가 있다는 사실만으로 PocketRisu BG와 호환되는 것은 아니므로, 브라우저가 맡던 훅·채팅 저장 관찰·후속 기억 작업이 앱 없이 실행되는지 별도로 확인한다.

이 절에서 **공식 기준선**은 상류가 공개한 release의 버전·commit·배포 파일 hash·backend/schema 조합이다. **정상 채팅**은 PocketRisu가 저장한 대화이며, **기억 저장**은 선택 제품의 backend가 원문과 파생 기억을 저장한 상태다. 채팅 저장 성공과 기억 저장 성공은 별도 결과다. **요청별 호스트**는 한 BG 작업에만 존재하는 JS 실행 프로세스이고, 제품 자체의 외부 backend와 다르다. **다음 턴 반영**은 저장된 기억을 다음 요청의 실제 모델 payload에서 확인하는 것이며, UI 카드나 검색 API 성공만으로 대체하지 않는다.

현재 시작점은 **G2.1의 RCM 기준선·격리 설치 확인**이다. G1.10의 제한 범위 L6는 정리됐지만 MARP 전체 분석·지연 원인과 추가 기기 항목은 미확인/보류다. G2.1에서 데이터 없는 별도 backend를 설치·기동하고 기본 API/DB·공식 브라우저 경로를 가짜 모델 응답으로 조사하는 것은 선택 제품의 예비 조사다. 운영 PocketRisu에 JS를 활성화하거나 기존 BG 코드를 바꾸는 통합 본 구현과 구분한다. G2.0의 실험/비교표는 재사용 근거로 남기며, AC까지 통합하거나 자체 품질 평가를 마쳐야 RCM으로 진행할 수 있다는 조건은 두지 않는다.

G2.1 예비 조사는 아래 실행 계획을 구체화하는 단계이며 2·3번을 대신하지 않는다. G2.2~G2.5의 통합 본 구현은 다음 자료가 갖춰진 뒤 RCM에 대해서만 진행한다.

1. **제품 선택은 충족:** 사용자가 RCM 설치를 선택했다. G2.0 비교·인과 검증 기록은 보존하고, 실제 품질/비용 비교 미실행은 그대로 남긴다. 지원할 프로필·선택 기능·실제 모델 설정과 감수할 기능 한계는 제품 선택만으로 확정하지 않는다. 기존 지침·현재 사용 맥락으로 해소되지 않는 사용자 결과의 차이만 구체화해 결정한다.
2. G1 잔여별 **의존 표**: 항목, 기존 관측/미확인 범위, 선택 제품의 최종 호출 경로와의 교차 여부, 필요한 재검증, 구현/전달을 막는 이유 또는 영향 없음의 근거. 편집·대기열·중지·모듈·설정 저장의 교차를 이름만 보고 제외하지 않는다.
3. §1의 선행 완료 조건 충족 기록. 미충족 항목을 남긴 채 진행하려면 사용자가 해당 항목과 지원 한계를 명시한 진행 범위를 결정해야 한다. 후보 비교 승인이나 G1 checkpoint 정리를 전체 완료·stable 승인으로 대신하지 않는다.
4. RCM 예비 조사에 근거한 G2.1~G2.5 구체 실행 계획. 설치 배치·필요한 정상 설치 경로·변경할 호스트/패처 경로·API별 의미·효과 소유자·실패/중지/재시작 처리·검증 명령과 지원/제외 조합을 명시한다. 이는 G2.2~G2.4 완료를 진입 전에 요구한다는 뜻이 아니다. 미확인 항목은 담당 단계·확인 방법·그 결과 전에는 구현하지 않을 경로를 적고, 사용자 결과를 바꾸는 선택은 해당 코드 구현 전에 결정한다.

**진입 근거 기록 (2026-10-16 KST):** 사용자 진행 결정으로 다음 범위의 통합 본 구현 진입 근거를 기록한다.

- **진입 범위:** G2.2a capability 정확화 한 단위만 연다. G2.2(필수 read API·MCP·의도적 차단·저장 후 관찰)~G2.5는 G2.2a 결과를 본 뒤 별도 진행 결정으로 연다.
- **추가 (2026-10-17 KST):** G2.2a 결과([검증](BG-G2-2A-CAPABILITY-VALIDATION.md))를 본 사용자 진행 결정으로 G2.2의 **조사와 실행 계획 작성**을 연다. 코드 구현은 계획 검토 뒤 별도 진행으로 하며, G2.3~G2.5와 위 조건 3의 미확인 지원 한계는 그대로 유지한다.
- **조건 1:** 충족. 사용자가 RCM을 선택했다(§9.2).
- **조건 2:** 충족. [호스트 호환성 검토 §2](BG-G2-HOST-COMPATIBILITY-REVIEW.md#2-g1-잔여-의존-표)의 G1 잔여 의존 표를 사용한다.
- **조건 3:** G1 §8 완료 조건 5번(실제 기기 확인)은 미충족이다. 아래 항목을 통과로 바꾸지 않고 **미확인 지원 한계**로 명시한 사용자 진행 결정으로 G2.2a 진입에 한해 대신한다.
- **조건 4:** G2.2a는 [호스트 호환성 검토 §6](BG-G2-HOST-COMPATIBILITY-REVIEW.md#6-g22a-실행-sub-plan)의 sub plan으로 구체화돼 있다. G2.2~G2.5는 §9.3과 호환성 검토 §4의 배정을 따르며 G2.2a 결과로 갱신한다.
- **기준선:** 호환성 검토 §1의 `8adb75f`/experimental.48/adapter 0.7.55는 조사 당시 기준이다. G2.2a 착수 시 현재 patcher main HEAD에서 registry/dispatcher/installer 기준선을 다시 고정한다.
- **추가 (2026-10-22 KST):** 사용자 진행 결정으로 G2.2 안의 다음 범위를 진행했다. G2.2b 구현·검증·`origin/main` 반영(`dd5641a`), G2.2c 실측, D1-a 구현 계획과 보충 결정(같은 작업 앞 단계의 실행 실패로 꺼진 플러그인도 beforeRequest 시점에 요청 실패, identity 변경은 알림 후 진행), D3 결정(유한 대기로 지원, 호스트 공통 계약, 구조는 측정 뒤 결정), D4 결정(server engine 필수 + 턴별 시작 창). D1-a·D3·D2의 코드 구현은 각 계획 검수 뒤 진행한다. G2.3~G2.5와 조건 3의 미확인 지원 한계는 그대로 유지한다.

| 미충족 G1 항목 | 현재 상태 | 재검증 배정 |
|---|---|---|
| MARP 전체 분석의 실제 주입·지연 원인 | 미확인 | G2.2a: 공유 Proxy/worker 변경 후 원본 MARP 자동 회귀. MARP+RCM 실제 분석·주입과 기기는 G2.5 |
| 앱 전환·잠금 | 기기 보류 | G2.3: 구간별 browser 종료·복귀 전 채팅/기억 확인. G2.5: 실제 기기 |
| 설정 저장 | 기기 보류 | G2.2/G2.5: 설정 변경 전후·override/custom endpoint/로컬 모델 회귀 |
| 편집·대기열 N+1 | 기기 보류 | G2.3: RCM 조합의 이전/수정 원문, N+1 실제 payload, 기억 지연/중복 |
| 중지·복구 | 기기 보류 | G2.2: 의도적 차단 신호. G2.4: 단계별 입력/답변/기억/job 잔존·중복·후속 전송 |
| 실패 알림 | 기기 보류 | G2.2a: unsupported RPC 거절·알림 정책 회귀. G2.4: 부분 외부 효과 알림 |
| 모듈 선택 | 기기 보류 | G2.2: module selector·lore parity. lore parity는 G2.2b(`dd5641a`)로 닫음, module selector는 남음 |
| 스트리밍 기기 항목 | 미기록(기존 사용자 결정) | G2.2a: 기존 streaming 자동 회귀만. 기기 지원 범위는 G2.5 지원표 |

G2.5의 L5에는 RCM을 끈 G1 단독 시나리오를 별도 행으로 둔다. 이 기록은 위 항목의 통과, G1 완료, 운영 활성화, stable 승인을 뜻하지 않는다.

### 9.2 G2.0 — RCM 선택 기록과 비교 자료 보존

**현재 결정:** RCM을 설치·연동 대상으로 선택했다. AC는 §9.6의 DEFERRED 후보이며 운영/정확도 비교의 승패를 선언한 것은 아니다. 자체 합성 품질 시험이나 유료 양자 비교는 사용자가 별도로 원할 때 활용할 선택 자료다. 사전 작성한 6개 품질 사례는 미실행 자료로 보존하며 현재 설치/연동의 필수 gate로 쓰지 않는다.

아래 기준선·0-A~0-D 절차·공통 비교 조건은 당시 조사와 향후 재비교를 위한 참고다. 현재 실행 순서는 §9.3의 RCM 단계를 따른다. 0-D의 제품 선택은 이번 지시로 종료하며, 0-B 전체·0-C 품질·G2 제품 완료를 소급 통과 처리하지 않는다.

#### 조사 출발점과 확인 한계

다음은 2026-10-15 공개 소스 조사 기준이다. 시험 통과 기록이나 채택 순위가 아니다. 비교 착수 때 release와 실행 파일을 다시 대조하고, 버전이 바뀌면 바뀐 호출 경로를 갱신한다. 과거 AC 4.3.1 로드 실험과 내부 수정 후보는 현재 공식판의 실행 증거가 아니다.

| 후보·공식 출처 | 조사 기준선 | 구현에서 확인한 출발점 | 새로 확인할 연결 조건 |
|---|---|---|---|
| [AC](https://github.com/Flazer31/archive-center) | [v4.9.0](https://github.com/Flazer31/archive-center/releases/tag/v4.9.0), commit `f2c92ebe00382b8ea83e6424314b2cde90074706` | Go backend, MariaDB 정본, ChromaDB 검색 보조 계층. 기억 준비/완료, 평론가, 선택적 다중 담당 전처리와 출판사 구성이 있다. | 원본 JS의 요청 훅·채팅 listener·누락 원문 보충 경로, 저장 시점 설정, browser/server 동시 참여와 파생 기억 작업 중복. |
| [RCM](https://github.com/Pulproom/rcm) | [v1.0.12](https://github.com/Pulproom/rcm/releases/tag/v1.0.12), commit `8f662b5008afe832b632ea28375c3fe685165da9` | Node backend, SQLite/FTS/sqlite-vec. `beforeRequest` 기억 준비, `afterRequest`/output listener 후 비동기 동기화, 서버/Risu 모델 작업자 경로가 있다. | 요청별 JS 초기화의 DOM/timer 의존, 실제 저장 뒤 listener와 비동기 작업 인계, 작업자 heartbeat/lease, 선택적 기억 도구 호출의 서버 지원. |

근거 경로: AC [구조 설명](https://github.com/Flazer31/archive-center/blob/v4.9.0/README.md), [전처리](https://github.com/Flazer31/archive-center/blob/v4.9.0/go-service/internal/httpapi/prepare_turn_multi_agent.go); RCM [요청/저장 훅](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/plugin/src/runtime.ts), [초기화](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/plugin/src/index.ts), [서버 작업자](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/server/src/server-worker.ts), [기억 선택](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/server/src/retrieval.ts), [설치 범위와 한계](https://github.com/Pulproom/rcm/releases/tag/v1.0.12). RCM의 Linux/ARM 설치 파일 제공과 해당 환경의 실기기 검증은 구분한다.

#### 당시 비교 절차와 산출물 보존 — 현재 실행 순서 아님

| 순서 | 할 일 | 다음 단계로 넘길 산출물 |
|---|---|---|
| 0-A 기준선·배치 조사 | 양쪽 release/JS/backend/schema/hash·라이선스·배포 조건을 고정한다. 브라우저 JS, 요청별 격리 JS, 제품 backend, DB, 모델 호출과 작업자의 실행 위치를 그린다. | 제품별 기준선 표, 데이터/제어 흐름, 권한·인증 전달·네이티브 모듈 설치 조건, 기존 호스트 API 지원/미지원 목록. 제품 backend의 네이티브 DB 모듈을 격리 JS 안에 넣는 설계를 가정하지 않는다. |
| 0-B 무과금 연결 실험 | 사용자 데이터와 분리된 DB·합성 대화·가짜 모델/임베딩 응답으로 원본의 일반 동작과 기존 BG 호스트 동작을 비교한다. 원본 수정·검사 우회·제품별 본 구현 없이 초기화, 준비, 저장 관찰, 작업 인계를 따라간다. | 사례별 통과/부분 확인/실패/미실행, 실제 마지막 caller와 막힌 API/수명 경계, 앱 부재와 재접속 시 중복/누락 관찰. 기존 호스트의 미지원으로 막히면 일반 실행 경로의 품질 비교와 BG 연결 미확인을 분리한다. |
| 0-C 품질·비용·운영 비교 | 아래 공통 사례와 조건표를 먼저 작성하고, 허용된 조건에서 실제 모델을 이용한 비교를 수행한다. 유료 조건이 없으면 이 부분을 미실행으로 남기고 소스/합성 결과만 보고한다. | 사례별 기대/실제 기억·최종 주입·근거, 호출 내역·지연·운영 표. 합성 응답의 통과를 실제 모델 품질로 계산하지 않는다. |
| 0-D 선택 | **제품 선택 완료: RCM 설치·BG 연동. AC는 DEFERRED.** 사용자는 자체 점수 비교보다 사용 조건·기능·운영 적합성을 근거로 선택했다. | 조사 기준선은 RCM 1.0.12이며 설치 시 공식판을 다시 고정한다. 실제 품질/비용·지원 조합·프로필/모델 설정은 미확정/미검증 범위대로 남긴다. 이 선택을 G1 면제·임의 기능 축소·새 비용 승인으로 확대하지 않는다. |

0-B의 격리 backend 시작은 운영 서비스와 포트·DB·인증·사용자 데이터를 공유하지 않는 loopback 시험 환경을 뜻한다. 외부 모델/임베딩 호출은 가짜 응답으로 막고 자원 한계를 확인한다. 이는 운영 설치·서비스 시작과 구분하며, 이 문서 개정 자체가 지금 시험 서비스를 시작하라는 지시는 아니다.

0-C는 두 제품의 기억 기능을 원래 실행 경로에서 비교할 수 있다. 그 결과를 BG 호환으로 확대하지 않는다. 한쪽의 연결 실험이 막혀도 양쪽 결과를 억지로 같게 만들거나, 시험을 통과시키려고 원본 정책을 제거하지 않는다. 실제 실행 불가·접근 부재·비용 미승인도 선택 자료에 남긴다. 비교용 fixture와 harness는 검증 자료로 관리하며 패처 runtime에 벤치마크 기능을 추가하지 않는다.

#### 공통 비교 조건

- **입력과 판정:** 같은 합성 대화로 명시적 사실 회상, 오래된 사건·관계 변화, 현재 상태/약속 갱신, 정정, 인물별 비밀 인지 범위, 편집·리롤·분기의 구버전 기억 혼입을 확인한다. 실행 전에 원문 근거·반드시 회상할 사실·주입되면 안 되는 사실을 사례별로 적는다. 원문 저장, 추출된 기억, 실제 모델 payload, 최종 응답을 구분하고, 모델이 우연히 맞힌 답을 기억 주입 성공으로 계산하지 않는다.
- **설정 동등성:** 같은 주/보조 모델·endpoint·입력 범위·기억 예산·추출 주기·스트리밍·retry/fallback·임베딩 조건을 가능한 범위에서 맞춘다. 제품의 문자/토큰 예산 단위나 지원 모델이 달라 같게 맞출 수 없으면 실제 값과 차이를 공개한다. 기본 구성과 선택 기능을 추가한 구성을 따로 기록한다. AC 전처리/출판사, RCM 기억 도구 등 추가 호출이 있는 구성을 기본 구성과 섞지 않는다.
- **호출과 비용:** main, 기억 추출, 평론/검사·상태 조정, 전처리, 도구 후속 요청, 임베딩, retry/fallback과 복구 호출을 종류별로 센다. 과금 없는 실험 뒤 실제 endpoint·전송 데이터·모델·최대 호출/토큰/비용·실패 중단 조건을 담은 계약을 만들고, 기존 승인으로 충족하지 않는 비용/데이터 결정만 사용자에게 받는다. 2026-10-15 이번 계획 개정 시점에는 G2.0 실제 호출·실제 대화 전송의 범위와 비용을 확정하지 않았다. G1.10/MARP 등 다른 목표의 호출 승인을 G2.0 비교에 전용하지 않는다. 문서 수정 승인은 유료 시험이나 실제 사용자 대화 전송 승인이 아니다.
- **지연:** 같은 서버 조건에서 cold start, main 전 기억 준비의 추가 대기, 답변 뒤 기억 저장/인계, 다음 턴이 기다린 시간을 나눠 기록한다. 제품 고유 제한과 호스트 제한도 함께 남긴다. 빠르다/저렴하다/기억이 좋다는 결론을 구조나 파일 수로 대신하지 않는다.
- **운영:** CPU/RAM·디스크·별도 서비스 수, ARM 실행과 네이티브 의존성, 인증/접속 경로, 백업/복원, 업데이트, 중지/제거 시 데이터 보존을 비교한다. 전체 서버의 실제 가용 자원과 함께 판단하며 free-tier 이름만으로 추가 여유를 가정하지 않는다. 운영 설치와 운영 서비스 시작은 당시 요청의 실행 범위를 확인하며, 0-B의 격리 시험 backend 시작과 혼동하지 않는다.
- **결론:** 임의 가중치나 합격 점수를 만들지 않는다. 사례별 결과·관측값·한계로 비교하고 사용자가 우선순위를 정한다. 모델/예산 등 결과를 바꾸는 미확정 조건은 실행 전에 결정하며 빈칸을 담당자 추측으로 채우지 않는다.

#### RCM 조사에서 보존한 수명·확인창 경계 — G2.2~G2.4에서 검증

공식 v1.0.12는 플러그인에서 15초 간격 heartbeat를 등록하고 서버 작업자에 45초 제어 lease를 둔다. lease 만료는 **새 작업 시작**을 막는 조건이며, 진행 중 작업 완료 조건과 다르다. 요청별 JS가 종료된 뒤 누가 lease를 갱신하고 누가 남은 작업을 끝내는지, 브라우저 lease와 서버 인스턴스가 경쟁하는지 확인한다. 이 수치를 늘리거나 lease를 우회해 호환을 꾸미지 않는다. **1.0.21 관측(G2.2c §4·§4b):** 15초 heartbeat·45초 lease 값은 같다. heartbeat 1회는 약 45초의 job 시작 창을 열고, 그 창에서 시작한 job은 lease가 끝난 뒤에도 완료까지 진행하며, 창이 닫힌 뒤 새 job은 heartbeat 없이 시작되지 않았다. 추출 job은 한 번에 하나씩 실행된다. 새 설치의 실제 추출 engine은 `risu`(플러그인 JS가 추출)이고 `server` engine은 사용자의 서버 LLM 설정 저장 뒤에만 반영된다. 새 채팅은 플러그인 화면의 초기 보정을 처리하기 전까지 추출하지 않는다. 이에 따른 D4 결정은 [G2.2 실행 계획](BG-G2-2-EXECUTION-PLAN.md) §3(B)이다.

기억 준비는 30초 뒤 기억 없이 전송/전송 중단 선택을 표시하고 180초에 원본의 차단 선택을 실행하는 코드가 있다. 이는 플러그인 API 권한을 묻는 §2의 권한 확인이 아니라, 이미 시작한 요청의 진행 방법을 묻는 선택이다. 서버가 사용자 대신 응답하지 않는 원칙은 동일하게 적용하되, 저장된 권한 답이 없을 때 플러그인을 제외하는 규칙으로 이 진행 선택을 대신 답하지 않는다. 화면 조작이 없을 때 원본이 실제로 종료하는 결과와 오류 신호를 먼저 측정한다. **1.0.21 foreground 측정(G2.2c §2):** 30초에 "기억 없이 보내기"·"보내지 않기" 선택이 표시되고, 조작 없이 준비가 끝나면 기억을 담아 한 번 보낸다. "기억 없이 보내기"는 즉시 기억 없이 보내고, "보내지 않기"와 180초 경과는 `MemoryInjectionBlockedError("turn/prepare timeout")`로 모델 요청을 차단한다(입력창은 비고 사용자 메시지는 채팅에 남음). BG에는 이 화면이 없으므로 180초 경과 시 원본은 차단 오류를 던지며, 이는 D1-a의 요청 실패 경로로 이어진다. 서버가 30초 선택을 대신 답하지 않는다. 해당 동작이 요구 결과와 맞지 않거나 원본 신호를 현재 호스트에서 보존할 수 없으면 지원 한계와 대안을 사용자에게 제시한다. 새 자동 선택이나 timeout 정책을 구현자가 임의로 추가하지 않는다.

### 9.3 RCM 설치·BG 연동의 실행 순서

사용자 결과는 공식 RCM backend·JS를 설치하고도 G1이 유지되며, **기억 준비 → 실제 요청 주입 → 생성/출력 처리 → 정상 채팅 저장 → 기억 동기화/저장 → 다음 턴 반영**이 앱 없이 이어지는 것이다. RCM 원본의 실제 훅 순서를 그려 각 결과와 연결하며, 위 순서도를 원본 훅 재배치 지시로 사용하지 않는다. 기본 기동/연결 확인, BG 지원, 실제 기기 결과는 서로 다른 완료 기록이다.

| ID | 진입·작업 | 완료 시 남길 자료 |
|---|---|---|
| G2.1 RCM 기준선·격리 설치 확인 | 선택된 RCM의 release·JS·backend·schema·설정/권한을 고정하고 아래 설치 항목을 데이터 없는 환경에서 확인한다. 버전이 바뀌면 소스와 동작을 다시 대조한다. | 공식 파일/설치 영수증, ARM·Node/native 모듈 결과, backend 기본 기동·상태/인증 API·새 DB 확인, 브라우저/서버 주소 배치안, 통합 실행 계획. 이는 §9.1의 G1 의존 표/진행 근거를 대신하지 않는다. |
| G2.2 API와 호출 의미 | §9.1의 통합 진입 근거를 갖추고 §4를 RCM의 요청 훅·입력/본문 처리·저장 후 관찰·DB/로어북·설정 저장·도구/모델 호출에 적용한다. 요청 전후는 같은 요청 인스턴스로 연결한다. | API별 등록/인자/반환/시점/실패/외부 효과 표, 최종 caller, 필요한 공통 호스트 수정/확장, 의도적 차단과 일반 오류 구분, 종료/인계/다음 턴 정책 및 검증 사례. |
| G2.2a 공통 capability 정확화 (G2.2 하위 단위) | 같은 진입 조건 아래 foreground guest/BG worker가 실제 등록·지원 API만 함수로 노출하도록 수정한다. 상수/alias/정상 RPC·권한·기존 플러그인 경로를 보존한다. | [실행 sub plan](BG-G2-HOST-COMPATIBILITY-REVIEW.md#6-g22a-실행-sub-plan)의 parity/회귀·실제 원본 JS 연결 결과와 남은 BG 의미 경계. output listener/기억 완주를 이 단위에 끼워 넣지 않는다. |
| G2.3 경쟁과 수명 | 브라우저 열림/종료, 두 탭·두 채팅·N+1, JS 종료와 backend 작업 지속, lease·캐시·listener·공유 저장소 경합을 시험한다. | 정상 채팅 ID/revision과 제품 원문/기억/job의 대응, 호출 횟수, 중복 억제/불확실 결과, 후속 턴 가시성, 재시작 전후 복구와 유료 재실행 구분. |
| G2.4 실패·복구 계약 | 미설치/비활성, 권한 없음, 초기화/준비/저장 실패, 의도적 차단, backend 단절, 응답 유실, 중지/timeout/restart, 저장 후 편집·삭제·리롤/분기를 시험한다. | 단계별 채팅/기억/작업의 남은 상태, 진행/차단/알림/복구의 사용자 결과 표. 원본의 자체 누락 보충·retry와 호스트 재실행을 구분하고 결정이 필요한 차이를 해소한다. |
| G2.5 운영 설치·조합·전달 | 앞 단계 계약과 검증된 설치 절차를 실제 RCM 서비스/JS 및 Send에 연결하고 MARP·preset/module·대기열·편집·stream/nonstream·종료/복귀·업데이트를 지원할 조합에서 검증한다. 기존 플러그인·설정·채팅은 보존한다. | L1~L4·graph/re-plan/exact revert·안전 설치/전달/독립 readback, 실제 브라우저/iPhone L5, L6 지원표/복구/업데이트/버전 문서. RCM 없이 G1 보존도 확인한다. |

#### G2.1의 설치 조사와 인계 항목

기본 배치안은 현재 PocketRisu 서버와 같은 Linux/ARM 서버에 **RCM backend를 별도 프로세스·별도 사용자 데이터 디렉터리**로 두고, PocketRisu에는 공식 JS를 정상 설치 경로로 넣는 방식이다. G2.1의 격리 환경은 운영과 포트·DB·인증·사용자 데이터·로그/저장 경로를 공유하지 않는 별도 loopback 환경이다. 정상 RCM 설치가 BG 호환을 자동으로 만들지는 않으므로 운영 JS 활성화는 해당 지원 경로가 검증된 G2.5에 연결한다.

공식 브라우저 경로 조사는 **데이터 없는 공식 PocketRisu 1.10.0 복사본과 별도 브라우저 세션**에 원본 RCM JS를 정상 설치해 수행한다. 해당 버전/소스를 시작 시 다시 고정하고, 운영 save/인증/설정을 연결하지 않으며 모델·임베딩은 가짜 응답 경로만 허용한다. 기존 격리 worker의 registry callback probe는 이 브라우저 경로를 대신하지 못한다. 서버 쪽 기동/인증과 격리 데스크톱 브라우저 연결을 G2.1에서 확인하고, 실제 iPhone/운영 URL 연결은 G2.5에서 확인한다.

| 항목 | 확인·결정할 내용 | 완료 근거 |
|---|---|---|
| 공식 배포와 버전 | 조사 출발점 RCM 1.0.12의 ZIP·JS·server.mjs hash는 [비교 보고서 §1](BG-G2-0-CANDIDATE-COMPARISON.md#1-공식-기준선과-무결성)을 따른다. 실제 설치판을 다시 고정하고 새 버전이면 바뀐 API/동작을 대조한다. | release/commit/hash, 설치한 backend/JS/API revision 조합. 배포본을 임의 재작성하지 않음 |
| POSIX 파일 배치 | 조사 ZIP의 역슬래시 member 경로를 설치 도구가 어떻게 푸는지 확인한다. 정규화가 필요하면 원본 ZIP을 보존하고 내용 hash를 유지한 채 POSIX 디렉터리로 전개한다. 동봉 Node/POSIX 실행 절차를 읽고 사용한다. | 파일명/내용 전수 대조, 원본과 설치 JS/server hash 일치 |
| Node·ARM 의존성 | 공식 Node 요구 버전과 현재 실행 버전/ABI, 배포 runtime의 better-sqlite3 12.11.1·sqlite-vec 0.1.9가 linux-arm64에서 실제 설치·로드되는지 확인한다. prebuild 부재 시 필요한 빌드 도구를 조사한다. | 설치/로드 로그와 새 SQLite 무결성. 기존 harness의 better-sqlite3 12.9.0 결과를 대신 사용하지 않음 |
| 프로세스·데이터·복원 | 설치/RCM DB·필수 설정의 분리 경로, 실제 포트, 기동/중지·자동 시작/로그 관리 방식을 현재 환경에 맞춰 정한다. CPU/RAM·디스크 여유와 backup/restore/update/remove의 데이터 보존 범위도 기록한다. | 격리 backend 기동/중지·인증 health/status·새 DB 확인, 검증된 설치/복원 절차와 운영 배치안 |
| 브라우저와 BG의 연결 | iPhone 브라우저와 서버의 localhost는 다르다. 원본 JS의 주소/token 설정 저장 방식과 실제 browser/server caller를 확인하고, 기존 접근 경로·HTTPS/CORS·인증을 포함해 양쪽에서 닿는 배치안을 정한다. | G2.1: 양쪽 배치안, 서버 쪽 격리 연결·인증과 별도 데스크톱 브라우저 연결 결과. G2.5: 운영 경로와 iPhone 인증/연결 성공·장애 결과·기존 라우트 보존. 실제 개인 주소/경로·인증값은 private 작업 기록에만 보관 |
| 초기 사용 설정 | Companion/World Simulation은 인원수가 아닌 대화 목적에 맞춰 정한다. 자동 기억·선택적 기억 도구·추출/보호 주기·모델/임베딩 경로가 사용자 결과와 호출량에 미치는 차이를 제시한다. | 선택 설정과 미해결 사용자 결과, 테스트용 합성 데이터/가짜 모델 조건. 자체 품질 점수 비교를 요구하지 않음 |

운영 서비스 등록·접속 경로 구성·JS 설치/활성화는 설치 실행 범위와 결과를 계획에 명시해 G2.5에서 기존 저장소의 전달 정책에 따라 수행한다. 기존 작업 권한·런타임 승인 경계·데이터 보존·active generation 읽기 전용 확인/안전 대기·해당 자동 검증·sweep/commit/push·안전한 apply/build/restart·독립 readback·L5 stable gate 중 해당하는 규칙은 유지하며, 매 단계 새 승인을 받는 절차를 추가하지 않는다. 공개 노출·보안 경계 변경·데이터 삭제 등 요청 범위를 넘는 변경은 기존 권한 규칙을 따르고, 실제 자동 시험의 모델/임베딩 호출은 경로·데이터·횟수/토큰/비용 상한을 먼저 구체화해 부족한 결정만 받는다. 이번 문서 개정 자체가 실제 설치/외부 호출을 수행한 기록은 아니다.

#### 현재 RCM에서 이어서 확인할 알려진 경계

[인과 실험 §7](BG-G2-0-CANDIDATE-COMPARISON.md#7-기능-노출을-바꾼-격리-인과-검증)은 변경 위치를 찾기 위한 근거다. 시험 worker의 guard를 운영에 복사하는 것만으로 지원 완료 처리하지 않는다.

- 미지원 기능의 typeof 노출과 잡힌 오류의 entry 비활성화를 구분한다. optional MCP/채널의 원본 부재 처리와 기존 MARP/provider 동작을 함께 보존한다. 도구를 강제로 끄거나 없는 API를 전부 새로 만드는 선택으로 대체하지 않는다.
- 현재 C 시험에서 RCM은 before 2/after 1 설치 뒤 before_request의 이름 없는 hook 오류를 보였다. 정상 backend 계약과 실제 caller에서 원인을 분리한다. getCurrentLorebookEntries·허용 DB projection·DOM/초기화·backend 장애는 조사 경로이며 이번 오류의 확정 원인 목록이 아니다. **2026-10-22(1.0.21, G2.2b·G2.2c):** `getCurrentLorebookEntries`는 G2.2b로 제공했다. BG에서 같은 계열의 이름 없는 hook 실패가 관측된 원인은 두 가지였다. 프롬프트에 `[[RCM]]` marker가 없을 때 RCM이 의도적으로 던지는 차단(`MissingRcmMarkerError`, 소스 확인)과 backend 단절로 인한 prepare 실패다. marker가 있고 backend가 정상이면 beforeRequest가 성공해 기억이 실제 모델 요청에 주입됐다. 옛 C 시험(1.0.12/1.0.13, 격리 worker) 오류의 원인으로 이를 확정하지는 않는다.
- §9.2에 기록한 원본 15초 heartbeat/45초 lease와 30/180초 진행 선택을 실제 RCM 작업에 연결해 확인한다. 저장 후 관찰은 실제 capability 정책에서 선택되는 listener/fallback 경로를 검증한다. 1500ms fallback을 지원 경로로 유지하면 timer·callback 수명·영속 인계를 확인하고, listener가 선택돼 실행되지 않는 timer를 미통과로 세지 않는다. 프로세스 수명 연장이나 자동 재실행을 임의로 추가하지 않는다. **2026-10-22:** 30/180초와 lease는 G2.2c에서 측정했다(§9.2). 현재 capability 정책에서는 listener가 없어 1500ms fallback이 선택되며, foreground는 응답 약 1.5초 뒤 출력 동기화를 실행하지만 BG는 host가 commit 전에 닫혀 실행하지 않았다. D3 결정에 따라 commit 뒤 유한 continuation으로 지원하며 설계는 [D3 계획](BG-G2-2-D3-OUTPUT-SYNC-PLAN.md)이다.
- **지원 한계로 남길 관측(2026-10-22, G2.5 지원표에 연결):** BG 플러그인 host가 꺼진 현재 기본 상태에서는 RCM이 BG 요청에서 실행되지 않는다(켜진 플러그인마다 `server_plugin_host_disabled` 알림 후 진행, 소스 확인; 알림 표시는 미관측). BG의 RCM 지원은 host 활성화와 `server` engine을 전제로 한다. 새 채팅은 초기 보정 처리 전까지 기억을 추출하지 않는다.

#### 해당 경로의 코드 구현 전에 닫을 공통 경계

아래 항목은 G2 전체 착수 전에 모두 완료해야 하는 별도 gate가 아니다. §9.1의 4번에 따라 G2.2~G2.4에서 조사·검증할 단계를 배정하고, 그 결과에 의존하는 코드 경로를 구현하기 전에 해당 계약과 필요한 사용자 결정을 확정한다.

1. **종료와 인계:** 요청별 JS의 미완료 효과는 그 프로세스 안에서 완료를 확인하거나 제품 자체의 원래 외부 backend/API에 영속 접수된 사실을 확인한 뒤 종료한다. 단순 RPC 성공·비동기 함수 시작·메모리 내 큐 등록은 영속 인계 증거가 아니다. 원래 backend의 저장/작업 상태로 인계를 입증하고, 인계 뒤 실행 주체와 앱 부재 중 완료를 확인한다. 호스트가 다음 JS 프로세스로 작업을 넘기는 새 큐나 상시 JS 인스턴스는 기존 요청별 수명 결정에 포함되지 않는다. 그런 구조가 필요하면 대안/영향과 사용자 결정을 먼저 남긴다. 제품 원래 backend를 별도 서비스로 운영하는 것과 요청별 JS를 상주시켜 우회하는 것은 구분한다.
2. **유한 대기:** 기존 호스트/제품의 제한과 실제 caller를 먼저 확인해 기다리는 범위·중단 신호·종료 시점을 계획에 명시한다. 새 제한값이 필요하면 측정/원문 근거와 사용자 결과를 정한 뒤 도입한다. 기한에 완료/인계를 확인하지 못하면 현재 종료 제어에 따라 정리하고 그 효과를 실패 또는 불확실로 남겨 알린다. 외부 효과가 없었다고 간주하거나 유료 작업을 호스트가 재실행하지 않는다.
3. **저장 identity:** 답변 뒤 동기화는 실제 canonical 채팅에 저장된 메시지 ID·본문·revision과 연결한다. `afterRequest`가 저장보다 먼저면 출력 문자열을 이미 저장된 답변으로 간주하지 않는다. listener를 어느 저장 지점에서 실행하고 비동기 반환을 어디까지 기다릴지 명시한다. 기억 실패가 정상 채팅 저장을 되돌리거나 이미 받은 답변을 다시 생성하게 해서는 안 된다.
4. **다음 턴:** N의 채팅 저장만으로 N의 기억 완료를 가정하지 않는다. N+1 조립 전 원본이 기다림/누락 보충/이전 기억 사용 중 무엇을 하는지 확인하고, 지원 계약에서 N의 기억을 언제 사용할 수 있는지 명시한다. 기억 완료 대기가 필요한 경우 원본 완료 상태와 유한 실패 처리를 연결한다. 즉시 반영이 성립하지 않으면 지연과 알림을 포함한 결과를 사용자가 결정하며, 조용히 G2 완료로 계산하지 않는다.
5. **실패와 의도적 차단:** 기존 기본은 플러그인 실패를 알리고 해당 효과 없이 진행하는 것이다. 다만 원본의 명시적 요청 차단을 일반 훅 오류로 삼켜 main을 실행하지 않는다. G2.2에서 구분 가능한 신호와 최종 caller를 검증한다. 불가하면 해당 조합의 지원 여부/결과를 사용자와 결정한다. 부분 저장 가능성이 있으면 ‘기억 효과 없음’ 대신 확인된 저장과 불확실 범위를 알린다. 원본 내부에서 흡수한 의미적 실패/기억 품질까지 transport 성공으로 판정하지 않는다.
6. **복구와 비용:** PocketRisu BG의 생성 재실행과 제품 backend의 원문 보충/기억 job 재시도는 별도다. 원본 자체 복구를 호스트 중복으로 잘못 제거하지 않으며, 실제 호출과 비용을 기록해 실행 계약 안에서 검증한다. 응답 유실이나 timeout 뒤 접수 여부가 불명확하면 원본 조회/멱등 기능을 먼저 확인한다. 그런 기능이 없으면 그 한계를 기록하고 자동 재요청으로 숨기지 않는다.
7. **사용자 변경 보존:** 답변 저장 전후 편집·삭제·리롤·분기가 원문과 파생 기억에 미치는 영향을 원본 상태 전이로 확인한다. 옛 답변의 기억이 새 분기에 잘못 붙는지와 정상 채팅의 사용자 수정을 보존하는지 별도로 검사한다. 시험 편의를 위한 운영 데이터 삭제나 기억 수동 조작으로 통과시키지 않는다.

### 9.4 G2 완료 조건과 L1~L6

1. RCM 선택 기록, 공식 JS/backend/schema 기준선, 실제 backend/JS 설치·기본 연결 확인이 있으며 검증 전후 원본 identity가 일치한다. 숨은 replacement·스크립트 재작성·권한/검사 우회가 없다. 격리 설치와 운영 적용 기록을 구분한다.
2. 같은 작업에서 기억 준비/최종 주입, 정상 채팅 저장, 제품의 원문/파생 기억 저장, 다음 턴 payload 반영을 연결한다. 기억 준비 중, main 중, 답변 저장 뒤 기억 동기화/영속 인계가 끝나기 전을 별도 사례로 나눠 브라우저를 종료하고, 복귀 전에 일반 채팅 API와 제품 backend 상태로 저장을 확인한다. 마지막 구간이 원본에서 분리 관찰되지 않으면 그 이유와 같은 수명 경계를 검증할 방법을 기록하며, 단순히 main 종료 사례로 대신하지 않는다. 그 뒤 재접속/후속 Send에서 중복 효과가 없는지 확인한다.
3. 브라우저·서버·후속 작업자 공존과 N+1에서 이중 처리/호스트 추가 유료 실행이 없으며, 관측 가능한 누락/실패/불확실 결과가 계약한 알림과 복구로 드러난다. 원본 retry/fallback 호출은 별도 집계한다.
4. RCM의 미설치/비활성/고장과 업데이트에서도 G1 단독 지원 경로·기존 설정 override/custom endpoint/로컬 모델·사용자 편집을 보존한다. 미지원 경로와 미검증 범위는 지원표에 명시하고 §9.1의 구체 실행 계획 및 필요한 사용자 결과 결정에서 확정한 지원 범위와 대응시킨다. 제품 선택만으로 한계를 수용했다고 간주하거나 2번의 핵심 서버 완주 경로를 미지원으로 돌리고 G2 완료를 선언하지 않는다.
5. L1~L4와 실제 브라우저/iPhone L5를 해당 지원 조합에서 마치고 L6 기록·문서·발행 후 확인을 수행한다. 보류한 G1 기기 항목은 선택 제품을 켠 결과로 소급 통과 처리하지 않는다. Stable은 기존 사용자 gate를 유지한다.

G2.0의 제품 선택은 RCM으로 종료했지만 G2 제품 완료나 비교 시험 전체 통과가 아니다. 미실행 0-C 품질 비교는 RCM 설치·연동의 선행 조건으로 쓰지 않는다. L1~L4는 변경 소유자와 실제 caller에 적용하고 공통 기반 증거는 source/환경/계약이 같은 범위에서만 재사용한다. G2.5의 L5 안내는 UI 기능 / 이번 변경 / 구체적 조작과 정상·이상 결과 표로 작성한다. L6에는 선택 이유·지원표·공식 버전·실패/복귀/업데이트/되돌리기 절차·미확인 사항과 AC의 DEFERRED 상태를 남긴다. 이 목록은 실제 발견에 필요한 검증을 제한하지 않는다.

### 9.5 원본 변경 예외를 검토하는 조건

현재 대상 RCM의 원본 수정 불가피성은 입증되지 않았다. 다음 근거를 갖춘 특정 요구만 변경 예외로 검토한다. 미래에 AC를 재개하더라도 같은 원칙을 적용한다.

- 수정하지 않은 공식판을 기존 호스트/원래 backend로 시험한 정상/실패 증거와 실제 막힌 호출 경로가 있다.
- 공통 호스트 API 의미·실행 순서·인스턴스 배타 실행·원래 backend의 영속 인계로 같은 결과를 얻을 수 없는 이유를 기록했다.
- 최소 변경 범위, 보존할 기능, 상류 업데이트·배포·되돌리기 책임, 미채택/다른 후보 선택 대안을 제시한다.

근거가 마련돼도 자동으로 변형판 개발로 전환하지 않는다. 사용자 결정 뒤 진행한다. 미선택 후보에 대한 통합 구현이나 데이터 이관 기능은 별도 요구가 없으면 범위에 넣지 않는다.

### 9.6 AC — 미래 후보(DEFERRED)

마지막 확인일: 2026-10-15 KST. 현재 G2는 RCM 설치·BG 연동이며 AC는 실행 대기열에 넣지 않는다. AC의 공식 기능·구조·조사 기준선과 [비교/인과 실험 보고서](BG-G2-0-CANDIDATE-COMPARISON.md), [옛 AC 상세 기술 계획](POCKETRISU-1.10-BG-PRESERVE-SERVER-CHAT-SAVE-ARCHIVE-CENTER-PLAN.md)은 미래 판단 자료로 보존한다. AC 4.9.0 조사 및 과거 4.3.1 변형 후보를 현재 설치·BG 호환 증거로 해석하지 않는다.

| 보존할 이유 | 재검토를 시작할 구체 조건 | 그때 확인할 내용 |
|---|---|---|
| 원작 DB·로어북 보조 참조, 범주별 예산과 확정 시점 등 AC의 명시적 운용 선택 | 사용자가 이런 기능을 요구하거나 RCM 사용 중 충족되지 않는 요구를 확인한 경우 | RCM의 현재 지원/대안과 AC 공식 기능을 같은 사용자 결과로 대조. 기능 존재를 실제 품질 우위로 승격하지 않음 |
| RCM에서 실측한 기억/운영/연동의 공백을 해결할 다른 접근 | 실제 공백을 해소하는 AC 변경을 확인하거나 사용자가 AC 재검토를 요청한 경우 | 당시 공식 AC JS/backend/schema 재고정, 원본 API/인스턴스 경쟁·비용·자원·복원/업데이트 검증 |

새 AC release나 소규모/대규모 인원수 자체만으로 자동 재개하지 않는다. 사용자 재개 결정 뒤 요구와 범위를 구체화한다. 현재 RCM 도입 중 AC Go/MariaDB/Chroma를 병행 설치하거나 AC 전용 API 계약을 이식하지 않는다. RCM↔AC 기억 이관·동시 사용·대체 운영은 별도 요구가 생길 때 데이터/호환/되돌리기 범위를 설계하며, 지금 구현하지 않는다. 기존 소스·기록·복구 자료는 삭제하지 않는다.

## 10. 기존 작업의 재배치

| 기존 작업 | 새 목표에서의 취급 |
|---|---|
| C1 서버 commit, C2 BG 결과 연결 | G1의 기반. 전체 지문 비교 부분은 G1.1 anchor 추가 저장으로 대체한다. |
| C3 입력·설정·projection·hydration, H1 프로세스 검증 | G1의 기반과 증거. 입력 시점 설정 고정은 G1.3에서 재검토한다. |
| 2026-09-27 G1 격리 후보와 live 적용 | G1.0 회귀 원인을 포함한다. 효과 ID·N+1·수명 요약 등 검증된 부분은 재사용한다. |
| 전역 preset/module/plugin 가드 | G1.5 요청별 판정으로 대체한다. |
| C0·C4/H2·C5/H3의 AC 수정·확장 후보 | 참고 자료로 보존하고 현재 G2에서 제외한다. §9.6에 따라 AC가 재개·선택되고 §9.5 원본 변경 예외 조건이 충족될 때만 재사용을 검토한다. RCM에 이식할 요구가 아니다. |
| C6의 AC claim/change/prepare/complete/retention | AC가 재개·선택되면 달성할 효과와 당시 공식 API를 대조한다. 현재 RCM에는 이 계약명을 이식하지 않고 중복 방지·저장·복구 등 필요한 사용자 결과만 RCM의 원래 계약으로 검증한다. |
| C7 및 H6/H7 qualification·문서·release 절차 | 각 목표의 실제 변경과 지원 범위에 맞춰 적용한다. |

기존 commit·dirty 변경·증거·source snapshot은 삭제하지 않는다. 모든 결과를 다시 측정하지 않고 변경·모순·새 최종 호출 경로가 생긴 범위에 검증을 집중한다.

## 11. 남은 실측 항목

| 항목 | 닫는 시점 |
|---|---|
| MARP 현재 공급자 설정의 실사용 | G1.11 적용 뒤 과금 없는 실측과, 사용자 확인 후 MARP 분석 1회 실행으로 확인한다. |
| MARP 실제 앱 경로 동등성 | G1.7 M1~M3에서 현재 호스트·브라우저·최종 어댑터를 합성 비교하고, G1.10에서 실제 기기를 확인한다. §6의 시제품 비교만으로 현재 caller를 통과 처리하지 않는다. |
| MARP timeout과 후속 retry의 수명 | M3에서 headers/body/stream을 나눠 error·entry 상태·후속 분석·transport 정리를 확인한다. |
| MARP 설정 저장 직후 전송 | M4에서 인자와 pluginStorage, UI await·strict root flush·queued 갱신·cache를 포함해 최신값을 확인한다. |
| MARP의 내부 실패와 진단 이력 | M5에서 관찰 가능한 실패와 private 의미적 실패를 구분한 뒤 일반 RPC 진단 필요성을 결정한다. |
| 플러그인 cold start·혼합 집합·초기화 효과 | M6에서 실제 비용과 효과/replay 경계를 확인하며 hash allowlist나 이름별 임의 제외로 대체하지 않는다. |
| preset 경로 `requestRetrys`의 실행 검증 | G1.8 자동 테스트 |
| 조립 시점 최신값과 비밀값 경계 | G1.3 설계·테스트 |
| AC·RCM 제품 선택 | **완료: RCM 선택, AC는 DEFERRED.** 0-C 실제 품질/비용 비교는 미실행이며 현재 설치의 선행 조건이 아니다. |
| RCM 기본 설치·연결 | G2.1 예비 조사에서 공식 파일·Node/ARM native 모듈·새 DB·인증 API·양쪽 접근 배치안을 확인한다. 운영 활성화는 G2.5 전달에 연결한다. 1.0.21은 G2.2c에서 공식 파일·native 로드·인증 API를 확인했으나 의존성 `npm install` 관측은 미완료다(G2.5 설치 절차에서 확인). |
| RCM 인스턴스 경쟁, 파생 기억 이중 처리, 자체 복구 동작 | G2.3·G2.4의 격리 환경. AC는 §9.6의 재개 조건이 생기기 전까지 병행 구현하지 않는다. |

## 12. 목표별 완료 기록

각 목표 종료 시 다음 항목을 한 기록으로 남긴다.

- 사용자에게 제공되는 결과와 지원/비지원 조합, 터널 지원표.
- 정확한 source·installer·선택한 기억 플러그인의 공식 기준선과 선택 기록.
- 직접 관측한 자동검증·process/browser·실제 기기 결과와 아직 확인하지 못한 경로.
- 실패·복구·알림·업데이트·되돌리기 절차와 남은 위험.
- 다음 목표에 넘기는 제약과 필요한 결정.

각 목표의 candidate 구현·검증·전달은 기존 저장소 절차를 따른다. Stable tag/release는 해당 사용자 검증과 문서·버전·민감정보 검사를 마친 뒤에만 수행한다.

이 문서는 [기존 상세 통합 계획](POCKETRISU-1.10-BG-PRESERVE-SERVER-CHAT-SAVE-ARCHIVE-CENTER-PLAN.md)의 AC 기술 자료를 미래 후보의 참고로 보존한다. 그 문서의 일괄 활성화 순서·AC 채택/수정 전제·옛 G2/G3 구분을 현재 실행 순서나 완료 조건으로 가져오지 않는다. 현재 G2는 공식 RCM 설치·서버 완주이며 AC는 §9.6의 DEFERRED 후보다.

## 13. 후속 step — patcher 정정 계획의 남은 항목 (BG 계획과 별개)

마지막 확인일: 2026-10-22 KST. 이 step은 BG 계획(G1·G2)의 목표가 아니다. 2026-10-18의 patcher 전체 보안·구조 감사와 그 결과를 정리한 정정 계획(Phase A~E)에서 남은 항목을 BG 계획 뒤에 보존하는 자리다. 이 step의 완료는 G1·G2 완료 조건에 포함되지 않으며, 반대로 G1·G2의 진행이 이 항목들을 기다리지 않는다.

진행 상태:
- Phase A(재시작으로 고아가 된 서버 입력)와 Phase B(저장소 복원·초기화의 원자성, 저장소 epoch, BG 세션 검사, 복원 뒤 이전 탭 무효화, 복원으로 고아가 된 marker 정리)는 구현·자동 검증·브라우저 검증까지 진행했다.
- 2026-10-19 사용자 결정: Phase C 전체(client-build fence F-1~F-4, 설정 PUT 세션 검사 S-1~S-3), C-21(`fmIndex` 없이 만들어지는 채팅), 브라우저 probe 스크립트의 server-input marker v4 namespace 반영은 G2 재개 전에 한 묶음으로 처리한다. 이어 Phase A·B와 이 묶음을 patcher `main`에 합친 뒤 G2.2 계획 검수(BG-G2-2-EXECUTION-PLAN.md §4)부터 재개한다.
- 2026-10-22 완료: 묶음 C-1~C-5(patcher `0.2.4-experimental.79`~`.82`와 probe 스크립트 갱신)를 구현·자동 검증·브라우저 검증하고, Phase A·B와 함께 patcher `origin/main`에 fast-forward로 합쳤다(`c7945b9..83496a9`). README는 이어서 `902148a`로 갱신했다. 휴대폰 검증과 live 적용은 하지 않았다. 세션 기록은 patcher `docs/records/`에 있다. G2.2 재개 시 참고: 계획 기준 `58af7b2`와 `83496a9` 사이에 `bgPluginHost.cjs`·`bgPluginWorker.cjs`는 바뀌지 않았고, 플러그인·요청·lorebook·MCP·tool 관련 경로 중에서는 `scripts/probe-bg-plugin-process.cjs`의 426 기대값만 바뀌었다. 2026-10-22 G2.2 계획을 r2로 갱신했다: 기준을 patcher `2adc8a5`(코드는 `902148a`)와 사용자 결정에 따른 RCM 1.0.21로 다시 고정하고, Astra 계획 검수 1회차의 지적 10건을 모두 반영했다(계획 §7). 같은 날 G2.2b 구현 계획·Astra 검수·Argon 시나리오·블라인드 테스트를 마쳤고, 이어 구현·자동 검증·코드 검수·검증 실행까지 마쳐 patcher commit `dd5641a`(experimental.83)로 `origin/main`에 fast-forward push했다(CI `patch-integrity` 성공, [G2.2b 계획](BG-G2-2B-LOREBOOK-PARITY-PLAN.md)). 같은 날 G2.2c 실측을 마치고 D1-a 구현 계획, D3 설계 분석, D3·D4 결정을 기록했다(BG 진행 상태는 이 문서 머리말 「현재 상태」).

이 step에 남기는 항목(시작 조건이 생기거나 사용자가 지시할 때 진행):

| 묶음 | 항목 | 시작 조건 |
|---|---|---|
| Phase D 런타임 | C-03 메타데이터 대기 상태로 남은 journal 기록의 정리, C-07 채팅·캐릭터 삭제 시 `bg-stream-draft:` 키 정리, C-08 detached 턴의 동시 처리 의도 판단, C-09 `extractThoughts` 최적화(측정상 문제일 때만) | journal 용량 또는 orphan 수 증가, draft 키 누적, 처리량 요구 또는 측정된 파서 비용 |
| Phase D toolchain | C-10, C-11, C-12, C-14, C-15, C-16 | 패처 `src/` 변경 전에는 C-14를 먼저, `supersedes` 첫 사용 전에는 C-16을 먼저 |
| Phase D CI guard | C-17, C-18, C-19, 업그레이드 경로 비교 guard, root pack 단독 plan guard | CI 도입 또는 release 절차 정비 시 |
| 결정 필요 | C-13 CSS UI rollback 스크립트의 수리 또는 은퇴(D-7). 현재 스크립트는 CSS가 아닌 `editor-*` unit까지 제거하므로 실행하지 않는다 | rollback 스크립트를 쓰기 전, 또는 사용자 결정 시 |
| 독립 | C-20 옛 governance 저장소 정리 | 사용자 지시 시 |
| Phase E(선택) | M-1~M-6 동작 보존 유지보수 | 정확성 작업(Phase D 런타임·toolchain)이 끝난 뒤 |

실제로 시작할 때는 이 표가 아니라 Phase 문서를 정본으로 읽는다. 모두 patcher 저장소(`pocketrisu-personal-patches`)에 있다.
- 정정 계획 인계: `docs/audits/2026-10-18-final-correction-implementation-handoff.md`(branch `claude/final-correction-handoff-2026-10-18`) — §3 Phase C~E의 항목·근거·최소 합격 기준, §4 교차 회귀 표.
- Phase B 설계 결정과 C-21 백로그: `docs/audits/2026-10-18-phase-b-design-decisions.md`(Phase B 브랜치, `main` 합병 뒤 `main`).
- 근거 보고서 R1~R3: `docs/audits/2026-10-18-r2-restore-write-reset-contract.md`, `docs/audits/2026-10-18-r3-client-build-and-session-gates.md`(branch `claude/r1-restart-recovery-investigation-d1r7in`).
- 작업 기록: `docs/records/2026-10-18-final-handoff-phase-a-and-phase-b-session.md`(branch `claude/session-record-2026-10-18`) §7.

항목을 다시 시작할 때는 당시 patcher `main`과 PocketRisu 기준선에서 근거를 다시 확인한다. 인계 문서의 행 번호와 composed-tree 위치는 2026-10-18 기준이다.
