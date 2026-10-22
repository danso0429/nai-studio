# G2.2c — RCM 1.0.21 실측 조사 (2026-10-22)

정본: [G2.2 실행 계획](BG-G2-2-EXECUTION-PLAN.md) §3(A) G2.2c. 구현 없는 측정 단계다. 격리 loopback 환경, 합성 데이터, 가짜 모델·provider만 사용했고 실제 모델·임베딩 호출은 없다. 운영 PocketRisu·사용자 데이터는 바꾸지 않았다.

- 대상: patcher `dd5641a`(0.2.4-experimental.83, G2.2b 포함)를 PocketRisu 1.10.0(`98e9683`)에 apply한 조립 트리. RCM 1.0.21 공식 배포본(JS·backend 무수정).
- 실행: validation-runner 두 개(서버 쪽 항목 0·1·3·4, 브라우저 쪽 항목 2). 증거는 ignored 작업 디렉터리에만 둔다.
- 외부 요청: RCM backend 시작 시 업데이트 manifest 조회, 플러그인 기본 번역(Google), PocketRisu 서버의 업데이트·홈 피드 조회, 브라우저의 CDN·폰트 요청을 시도했고 모두 차단돼 전송되지 않았다.

## 0. 기준선과 설치

| 항목 | 관찰값 |
|---|---|
| 공식 release | v1.0.21, annotated tag → commit `50c76fe6ced2fa1927c27975ccda4c574999b18a` |
| Node ZIP | `RCM-node-install.zip` 921,065 bytes, SHA-256 `071ddf2132b8a19e6b107f6895f4e2c287a49f794fd37eae87de8ec959062317` (release asset과 동일) |
| ZIP 내용 | 22 members, `SHA256SUMS` 20항목 모두 일치, server.mjs manifest hash 일치 |
| RCM JS | SHA-256 `08705f3b31657094901b73aac8742492422127794b64ea02457c27d0913d7edc`, 실행 전후 동일 |
| 실행 환경 | Linux ARM64, Node 25.9.0, ABI 141, SQLite 3.53.2, sqlite-vec v0.1.9 |
| backend 계약 | `/v1/health` 무인증 200, version 1.0.21, apiRevision 98. 인증 admin route는 토큰 있음 200, 없음/틀림 401. `X-RCM-API-Revision` 97 → 409, revision 없음 → 409, 98 → 200. plugin version은 강제하지 않는다(1.0.0도 허용). 재시작 뒤 instanceId 유지, 종료 뒤 `integrity_check` ok |
| route 수 | 정적 소스 기준 154 method route(호출로 확인하지 않음) |

**한계:** 1.0.21 의존성의 `npm install`을 관측하지 못했다. 실행 환경의 권한 검사가 설치 명령을 거절해, 같은 버전(better-sqlite3 12.11.1, sqlite-vec 0.1.9)이 이미 설치된 G2.1(1.0.13) 설치본의 `node_modules`를 복사해 사용했다. 1.0.21이 같은 의존성 트리를 해석하는지와 새 설치 경로는 미확인이며 G2.5 설치 절차에서 확인한다.

## 1. 추출 engine 설정

- 소스: 플러그인 설정 `extractionEngine`의 기본값은 `server`, backend 설정 `engine`의 기본값은 `risu`다. 플러그인은 대시보드 설정 저장에서 backend 설정이 다를 때만 `PUT /v1/admin/server-llm`으로 `engine`을 보낸다. 다른 호출 경로는 없다.
- 관찰: 새 설치에서 backend engine은 `risu`, worker 상태도 `risu`다. 플러그인을 연결한 BG 실행 뒤에도 `risu`였다(그 실행은 이 PUT을 호출하지 않음).
- `engine: "server"` 저장은 provider·endpoint·model이 없으면 400이고, 이를 갖추면 200이며 그 뒤 health가 `engine: server`, worker `standby`, `modelConfigured: true`를 보고한다. 서버 LLM endpoint는 `https://`만 받는다.
- 결론: **새 설치의 실제 추출 engine은 `risu`**(플러그인 JS가 PocketRisu 쪽 모델로 추출)이고, 플러그인 기본값 `server`는 사용자가 대시보드에서 서버 LLM을 설정해 저장한 뒤에만 backend에 반영된다.

## 2. 브라우저(foreground)의 30초·180초 기억 준비 선택

조립 트리 foreground, 원본 RCM 1.0.21 JS를 정상 import UI로 설치, 실제 RCM backend 앞에 `/v1/turn/prepare`만 지연시키는 proxy를 두었다.

| 사례 | 관찰 |
|---|---|
| a. 준비 약 50ms | 모델 요청 1회, 기억 packet 주입, `[[RCM]]` marker 제거. 응답 약 1.5초 뒤 두 번째 `/v1/turn/prepare`(출력 동기화) |
| b. 60초 지연, 조작 없음 | 30.95초에 선택 표시("기억 없이 보내기", "보내지 않기", "기다리면 기억을 담아 보내요. 3분이 지나도 끝나지 않으면 보내지 않아요"). 60.02초 준비 완료 뒤 55ms에 모델 요청 1회, 기억 주입 |
| c. 120초 지연, 33.4초에 "기억 없이 보내기" | 즉시 모델 요청 1회, 기억 없음, marker 제거. 진행 중 prepare는 브라우저가 중단 |
| d. 120초 지연, 33.4초에 "보내지 않기" | 모델 요청 없음. 오류 창 "RCM 기억을 준비하거나 최종 프롬프트에 넣지 못해 모델 요청을 차단했습니다. … (turn/prepare timeout)". 입력창은 비고, 사용자 메시지는 채팅에 답변 없이 남음(새로고침 뒤 확인) |
| e. 240초 지연, 조작 없음 | 180.0초에 "전체 기억 준비 실패" 표시와 d와 같은 오류. 모델 요청 없음, 사용자 메시지는 채팅에 남음 |

소스(minified JS): `a4=3e4`(30초 표시), `NA=18e4`(180초에 `block` 선택). `omit`은 빈 packet으로 요청을 그대로 보내고, `block`과 180초 timer는 `MemoryInjectionBlockedError("turn/prepare timeout")`를 던진다. 버튼은 pointerdown/pointerup으로 처리된다.

**BG에 주는 의미:** BG에는 이 선택 화면이 없으므로, 준비가 180초를 넘으면 원본은 차단 오류를 던진다. 현재 BG(fail-open)는 알림 뒤 기억 없이 진행하고, [D1-a](BG-G2-2-D1A-BEFORE-REQUEST-FAILURE-PLAN.md) 적용 뒤에는 요청 실패가 된다. 30초 시점의 "기억 없이 보내기"를 대신 고르는 동작은 두지 않는다(§2 확인창 원칙).

**부수 관찰(설계된 G1 동작):** BG 플러그인 host가 꺼진 기본 상태에서 RCM이 켜진 채팅의 일반 전송은 BG 서버 orchestration으로 처리되고, 플러그인은 실행되지 않아 `[[RCM]]` marker가 그대로 모델에 가며 기억이 없다. 소스상 이때 켜진 플러그인마다 `server_plugin_host_disabled` 알림을 남기고 진행한다(`bgPluginUnavailable.cjs:17-31`). 이번 실행에서 알림 표시는 확인하지 않았다. foreground 측정을 위해 클라이언트 후처리가 필요한 일반 설정(자동 TTS)을 켜 foreground 경로를 사용했다.

## 3. BG beforeRequest(실제 backend, G2.2b 적용, host 켬)

| 실행 | 관찰 |
|---|---|
| 공통 | 플러그인 로드 성공. absent API: `addRisuChatListener`, `registerMCP`, `addPluginChannelListener`(load). beforeRequest replacer 2개, afterRequest 1개 등록 |
| 기억 없음 | prepare 200, `omissionReason: no_memories`. hook 반환, 모델 호출, marker 제거, 채팅 커밋, 알림 0 |
| 기억 1개 | prepare 200 packet 있음 → `POST /v1/turn/delivery` ok. 가짜 모델 요청의 marker 위치에 `<rp_memory_context>`와 기억 본문. 채팅 커밋, 알림 0. afterRequest는 답변을 그대로 반환했고 출력 동기화 호출(두 번째 prepare)은 없었다 |
| backend 중단 | 모든 RCM 요청 ECONNREFUSED, beforeRequest 실패(`plugin_execution_failed`), `plugin_hook_failed` 알림(phase before_request) 뒤 **기억 없이 모델 호출**(marker 남음), 채팅 커밋. D1-a 적용 전 fail-open 측정 사례 |

prepare 응답 시간은 관측 실행에서 약 47–53ms였다.

## 4. 앱 없는 `server` engine job

- 소스: 플러그인 heartbeat 15초(`setInterval(..., 15e3)`), backend 제어 lease 45초(`controlLeaseMs`), 동시 실행 상한 2. lease는 새 job 시작 조건이며 진행 중 job의 조건이 아니다.
- 관찰(heartbeat 1회 뒤 중단, 브라우저·BG host 없음, 가짜 서버 LLM 지연 40–70초):
  - 진행 중 job은 lease가 끊긴 뒤에도 LLM 호출을 계속했다(70초, 140초). 이후 가짜 응답이 다음 추출 단계 검증을 통과하지 못해 실패로 끝났다. 같은 채팅의 실패 job은 그 채팅의 다른 대기 job을 막았다.
  - lease 만료 뒤 새 job은 관측 구간 동안 시작되지 않았다. 다만 대기 job이 막힌 채팅에 있어 lease 영향과 분리되지 않았다.
  - lease가 살아 있을 때 heartbeat는 대기 job 하나를 즉시 시작했다.
  - health의 worker 상태는 lease 공백 동안 `running`, job 실패 뒤 `standby`와 `lastError`.
- `PUT /v1/chats/:id/work`(`{enabled}`): `false`는 진행 중 job을 중단해 queued로 되돌리고 worker를 standby로 둔다. `true`는 lease가 살아 있을 때만 job을 다시 시작했고, lease 만료 뒤에는 queued로 남았다.
- **미관측:** 성공으로 끝나는 추출 job, 다른 채팅에서의 깨끗한 "lease 만료 뒤 새 job 미시작" 확인.

## 결정 항목에 넘기는 사실

- **D3(출력 동기화·다음 턴):** foreground는 응답 약 1.5초 뒤 두 번째 prepare로 출력을 동기화한다(listener 부재 fallback). BG 실행에서는 이 호출이 일어나지 않았다(host가 작업 끝에 닫힘). 다음 턴의 prepare는 채팅 snapshot을 다시 보낸다.
- **D4(추출 engine·lease):** 새 설치의 engine은 `risu`라 추출을 플러그인 JS가 맡는다. `server` engine은 사용자의 서버 LLM 설정이 필요하고, 새 job 시작은 살아 있는 heartbeat(브라우저 또는 실행 중인 BG host)에 묶인다. 진행 중 job은 lease와 무관하게 계속된다.
- **운영 상태:** BG 플러그인 host가 꺼진 현재 기본값에서는 RCM이 BG 요청에서 실행되지 않는다(알림 후 진행). RCM을 BG에서 쓰려면 host 활성화가 G2.5의 전제다.
