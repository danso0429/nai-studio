# G2.2a — 플러그인 capability 노출 정확화 검증 (2026-10-17)

실행 순서 정본은 [ordered goals §9](BG-PRESERVE-ORDERED-GOALS.md#9-g2--공식-rcm-설치와-서버-완주), 단위 계획은 [호스트 호환성 검토 §6](BG-G2-HOST-COMPATIBILITY-REVIEW.md#6-g22a-실행-sub-plan)이다.

**결과: foreground guest와 BG worker가 실제로 제공하는 root API만 함수로 노출한다. 수정하지 않은 원본 RCM 1.0.13 JS가 후보 PocketRisu 1.10.0 브라우저에서 G2.1의 초기화 중단 없이 설치·설정 저장·재접속 보호 API 200까지 진행했다. BG에서는 없는 API 이름이 진단에 기록되고, 필수 미지원 API `getCurrentLorebookEntries`는 hook 실패로 남는다. 후보는 patcher branch의 commit이며 push·live 적용·iPhone L5는 하지 않았다. G2.2와 BG 기억 완주는 이 단위의 완료 조건이 아니다.**

## 1. 기준선과 commit

| 항목 | 값 |
|---|---|
| patcher 기준선 | 작업 시작 `origin/main` `8dfd086` (package `0.2.4-experimental.52`, `lazy-chat-bg-adapter` `0.7.57`). 작업 중 main이 `c237ddc`(experimental.55, adapter 0.7.59)로 진행해 그 위로 rebase했다. 겹친 파일은 버전 표기뿐이며 G2.2a 소스·probe는 rebase 전후 동일하다. |
| 대상 | 공식 PocketRisu 1.10.0 (`98e9683`) 원본 복사본 |
| 후보 commit | `28a7eae` capability 노출, `e4585b2` dispatcher 표에서 노출 목록 도출, `58af7b2` 늦은 진단 응답 유실 수정 (rebase 전 `8920983`, `bef6572`, `9872beb`) |
| 후보 버전 | package `0.2.4-experimental.56`, `lazy-chat-bg-adapter` `0.7.60` |
| 설치 범위 | foreground 변경은 `lazy-chat-bg-adapter`의 `factory.ts` unit 3개이며, `bg-preserve`와 `lazy-chat-sync`를 함께 선택한 경우에만 설치된다. |

## 2. 변경 계약

- **Foreground:** guest Proxy는 `apiFactory`의 own function key만 노출한다. 그 밖의 이름, `then`, symbol, 상속 이름은 `get`이 `undefined`, `has`가 `false`다. 목록은 guest 문서를 만들 때 계산해 escape한 literal로 주입한다. 없는 이름의 직접 호출은 guest 안의 `TypeError`이며 `CALL_ROOT`를 보내지 않는다. host의 `CALL_ROOT` 거절은 유지한다.
- **BG:** root API dispatch는 handler 표 하나로 수행하고, worker에 보내는 노출 목록은 그 표의 key에서 도출한다. 별도 이름 목록은 없다. session은 호출자가 넘긴 목록만 쓰며 없으면 worker를 시작하지 않는다. worker는 `load`에서 목록을 검증한 뒤 plugin code를 실행한다. own handler가 없는 이름(상속 이름 포함)은 기존처럼 `plugin_api_unsupported`로 비활성화된다. handler는 동기 검증·권한 확인을 이전 switch와 같은 tick에서 throw한다.
- **진단:** worker는 없는 이름을 최대 32개와 overflow flag로 기록하고, host가 load·hook 완료 뒤와 close 전에 이를 가져온다. 이 읽기는 일반 RPC 슬롯·예산을 쓰지 않고 치명 timeout도 없으며, 대기만 제한한다. 결과는 진단 요약의 선택 필드 `absentApis`({api, phase})로 저장되고 BG 플러그인 진단 화면에 표시된다. 기존 저장 행은 그대로 읽힌다.
- **동작 변화:** 없는 API 호출을 잡은 플러그인은 활성 상태로 남는다. 잡지 않은 호출은 기존 hook/load 실패(`plugin_hook_failed`)로 처리된다. `.catch()`만 붙인 호출은 거절된 promise 대신 동기 `TypeError`가 된다.

## 3. 자동 검증

| 범위 | 관찰값 |
|---|---|
| patcher `npm test` | 340 tests, 337 pass, 0 fail, 3 skip (범위 밖 항목을 이유와 함께 명시한 placeholder) |
| worker/session/sandbox probe | 44/44 |
| 후보 대상 probe | capability 11/11, host 128/128, diagnostics 9/9, settlement 13/13, local-rpc 30/30, large-local 25/25 |
| 원본 플러그인 회귀 probe | MARP native·protocol·bootstrap, combination 10 profile, PageFold 12 case, process normal/provider/provider-off 통과 |
| 대상 suite (rebase 뒤 `58af7b2`) | `pnpm test` 2511 pass/4 skip, server 652 pass/12 skip(rebase 전 2482/650 대비 증가분은 main의 experimental.55 테스트, skip 수 동일), `test:compat` 74 pass/5 skip, `check` 0 error/0 warning, `check:help`·`build`·bgOrchBundle build 통과 |
| installer | 두 번 build byte-identical·commit본과 동일, `node --check`, mode 755, apply(43 packs) → re-plan 변경 0 → exact revert clean |

위 patcher·probe 수치는 rebase 뒤 `58af7b2`에서 다시 관찰한 값이며 rebase 전과 같다. combination 10 profile·notice 2·잔여 task 0, PageFold 12 case, MARP protocol 35 case도 같다.

테스트는 구현 전에 다른 모델이 작성했고(시나리오는 Gemini 4 Argon, 테스트는 Codex), 구현 뒤 기존 assertion은 수정하지 않았다. 테스트 결함 3건(반환형 계약 위반, 다른 realm 배열 비교, 옛 계약을 고정한 case)은 동작을 약화하지 않는 방향으로 고쳤다.

## 4. 원본 RCM 실행

격리 환경: loopback 전용, 외부 통신 차단, 합성 save, RCM backend 1.0.13 별도 data dir, RCM 기본 도구 설정 유지.

| 확인 | 결과 |
|---|---|
| Foreground import·권한 | 원본 JS가 G2.1의 `addRisuChatListener` 초기화 중단 없이 설치됨, plugin 관련 console error 0 |
| 메뉴·설정 | 메뉴·대시보드 열림, 주소/token 저장, reload 뒤 유지 |
| 보호 API | `/v1/admin/chats`, `/v1/update/status`, `/v1/worker/heartbeat` 200, 브라우저 직접 호출 |
| BG load | `beforeRequest` hook 2, `afterRequest` hook 1 |
| BG `absentApis` | `addRisuChatListener`, `registerMCP`, `addPluginChannelListener` (load), `getCurrentLorebookEntries` (before_request, `[[RCM]]` marker 포함 요청) |
| BG 필수 미지원 API | `getCurrentLorebookEntries` 부재로 hook 실패, 알림 `plugin_hook_failed`, 입력 유지, plugin 활성 유지 |

브라우저 확인은 rebase 전 `8920983`에서 했다. 이후 commit은 foreground unit을 바꾸지 않았다. BG 결과는 rebase 전 `8920983`과 `bef6572`에서 시간·id를 빼고 같았다. `getCurrentLorebookEntries`와 `registerMCP`는 원본이 존재 확인 없이 호출하므로 G2.2의 과제로 남는다.

원본 MARP Lite, PageFold, RCM 1.0.13 소스의 root API 사용을 정적으로 대조한 결과, MARP Lite와 PageFold가 쓰는 API는 BG·foreground 모두 지원된다. RCM은 BG에서 5개(`addPluginChannelListener`, `postPluginChannelMessage`, `addRisuChatListener`, `getCurrentLorebookEntries`, `registerMCP`)가 없다.

## 5. 검수

- 코드 리뷰(Codex, 3회): 진단 읽기의 치명 timeout과 handler async화로 인한 같은 tick 순서 변화를 수정했다. 같은 phase에서 부모가 비활성화하기 직전에 읽은 없는 이름이 진단에 남지 않는 점은 실패 경로를 늦추지 않기 위해 알려진 한계로 기록했다.
- 구조 검수(L3)·런타임 검수(L4): 테스트 입력에 맞춘 분기, assertion 약화, 실행 우회는 확인되지 않았다. 확인된 결함 1건(제한 시간 뒤 도착한 진단 응답의 이름 유실, Low)은 `58af7b2`(rebase 전 `9872beb`)에서 수정하고, 수정 전 실패를 확인한 회귀 case를 추가했다. 진단 읽기 대기열의 실제 지연·누적 크기와 장시간·실기기 동작은 측정하지 않은 surface로 남는다.

## 6. 한계와 범위 밖

- `initOldApiGlobal`은 기존처럼 아무 legacy global도 할당하지 않는다(원본에도 있는 결함).
- 새로 만든 빈 save에서는 후보 PocketRisu의 저장이 `browser statistic count is invalid`와 rebase 충돌 반복으로 실패했다. 오류 위치는 이번 변경 파일 밖(`browser-stat-effect-rebase` unit)이며 원인은 분석하지 않았다. 브라우저 검증은 기존 합성 save로 진행했다.
- iPhone L5, live 적용, push, stable 발행은 하지 않았다. G2.2~G2.5는 이 결과를 본 뒤 별도 진행 결정이 필요하다.
