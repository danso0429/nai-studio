# G2.1 — RCM 격리 설치 검증 (2026-10-15)

실행 순서 정본은 [ordered goals §9](BG-PRESERVE-ORDERED-GOALS.md#9-g2--공식-rcm-설치와-서버-완주)다. RCM은 현재 선택 제품이고 AC는 미래 후보로 유지한다.

**결과: backend 설치·기본 API·재시작·빈 DB 백업/복원은 확인했다. 공식 PocketRisu 1.10.0 브라우저에서 원본 RCM JS는 설치되지만 초기화가 중단된다. 브라우저 연결 성공, G2.1 전체 완료, BG 통합 완료를 선언하지 않는다.**

## 1. 설치 기준선

앞선 [비교 기록](BG-G2-0-CANDIDATE-COMPARISON.md)은 RCM 1.0.12 기준이다. 설치 직전 최신 release를 다시 조회해 1.0.13을 확인했고, 이번 검증은 서버와 JS를 모두 1.0.13으로 고정했다. 종료 시 release 이름과 ZIP digest가 같은 것도 확인했다. 이전 worker 결과를 새 버전의 결과로 승격하지 않는다.

| 항목 | 고정한 값 |
|---|---|
| 공식 RCM | [v1.0.13](https://github.com/Pulproom/rcm/releases/tag/v1.0.13), commit `3d15972696e166cbd5f2dd7c1596e762b34c9cf0` |
| Node ZIP | 837,951 bytes; SHA-256 `92084b58f34cf107079035e49aee2f4dd160fcef3a7ea4e09bd5811cae909b71` |
| server.mjs | SHA-256 `fd1326db0f9dc505a1d6564cee9a2c4eb5ccbe6591340812e9e8219f3c0e27a0` |
| RCM JS | 1,455,983 bytes; SHA-256 `fcdce0fea6e27acf23efb29bda1568d5308dd43607b05cc7eb1cc7d2996bfede` |
| 실제 backend 계약 | server/plugin 1.0.13, API revision 90, schema migration 49, plugin settings revision 21 |
| RCM 실행 환경 | Linux ARM64, Node 25.9.0, ABI 141, npm 11.12.1 |
| runtime dependencies | better-sqlite3 12.11.1, sqlite-vec 0.1.9, sqlite-vec-linux-arm64 0.1.9 |
| 생성된 npm lockfile | SHA-256 `51977b55d12786f6e7f4525d59ec8baac5f8df317b639d018913028616d16b03` |
| 공식 PocketRisu | [v1.10.0](https://github.com/PocketRisu/PocketRisu/releases/tag/v1.10.0), source `98e9683`, 공식 Linux ARM64 배포본 |
| PocketRisu 배포 archive | 357,651,482 bytes; SHA-256 `9eda16a0ebdbc2e1b6cfca71fedc387a917907ecec39f8f2146eaa8303582b8b` |
| PocketRisu 실행 환경 | 배포본 동봉 Node 24.14.1, 별도 새 save, Chromium/Playwright 1.63.0의 별도 프로필 |

RCM ZIP의 역슬래시 member를 POSIX 경로로 정규화하고 절대 경로·상위 경로 탈출을 거부했다. 파일 내용은 변경하지 않았다. 동봉 SHA256SUMS 21항목과 manifest 자체를 포함한 원본 22파일을 확인했고 종료 뒤에도 22파일 hash가 일치했다. JS/server.mjs는 태그 소스의 `channels/stable` 파일과 byte-equal이다. 소스 archive의 PAX commit comment도 위 commit과 일치한다.

ZIP에 lockfile은 없었다. 위 lockfile과 dependency tree는 이번 설치가 해석한 하위 의존성의 기록이며, 미래의 무잠금 설치가 같은 결과라는 보장은 아니다. `npm install --omit=dev --no-audit --no-fund`가 성공했다. 최초 설치 로그는 native 방식의 세부를 출력하지 않았고, 별도 foreground rebuild에서는 ABI 141/linux-arm64의 로컬 cached prebuild를 풀어 설치하는 경로가 성공했다. 이를 최초 설치 경로의 직접 관측으로 대신하지 않는다. rebuild 전후 native binary hash를 남기지 않아 같은 binary였다는 보장도 하지 않는다. 대신 rebuild 이후에도 같은 backend 검증을 두 차례 별도 재실행해 인증·API revision·native 로드·재시작·DB 무결성을 확인했고 이전 영수증은 보존했다. `prebuild-install`의 유지 중단 경고가 있었다.

## 2. 격리 배치와 실행 조건

- 운영 PocketRisu, PM2, 사용자 save, provider 설정 및 기존 플러그인은 변경하지 않았다. 공식 배포본에 새 save와 합성 비밀번호를 만들었다. 정상 플러그인 가져오기 UI로 JS를 설치했고 DB readback에서 character 0, plugin 1, enabled, version 1.0.13과 script byte-equal을 확인했다. 플러그인에서 최상위 `plugins` 배열을 쓰는 API로 설치하지 않았다.
- RCM은 별도 데이터/복원 디렉터리와 시험용 loopback 포트를 사용했다. launcher에 `RCM_DATA_DIR`, `RCM_PORT`, `RCM_EMBEDDINGS=off`를 전달하고 PATH 외의 부모 환경을 상속하지 않았다. 주소·token·실제 경로는 ignored 실행 기록에만 보관한다.
- 원본 `sh start.sh`가 호출하는 `node launch.mjs`를 실행했다. launcher는 DB/secrets 경로를 DATA_DIR 아래로 지정하고 자체 connection.json token을 사용하므로 `RCM_DB_PATH`/`RCM_SECRETS_PATH`를 별도 override 수단으로 설명하지 않는다. connection.json 권한은 0600이었다.
- PocketRisu는 원본 서버/배포 frontend를 사용했다. 기본 wildcard listen을 막기 위해 기존 loopback bind 전용 Node preload만 적용했다. 제품 API·JS·동작 capability를 바꾸는 가드는 적용하지 않았다. 이 실행 환경 차이는 원본 소스 호환성 결과와 구분한다.
- 모델/임베딩 자격 증명을 주입하지 않았고 Send·추출·임베딩 호출을 실행하지 않았다. RCM의 공개 update manifest 조회는 원본 시작 동작이다. stage/apply는 호출하지 않았고 pending update는 없었다. 브라우저 외부 CDN/폰트/plugin update 요청은 차단했다. PocketRisu 서버의 공개 홈 피드·업데이트 조회까지 차단한 완전한 egress 격리는 아니었다.
- 종료 뒤 세 시험 포트가 닫혔고 PocketRisu 프로세스도 종료됐다. 상시 서비스나 운영 접속 경로는 아직 등록하지 않았다.

## 3. backend 실측

`verify-backend.mjs`로 원본 launcher를 두 차례 시작·중지했다. 각 실행에서 아래 assertion을 확인했다.

| 경로/조건 | 관찰값 |
|---|---|
| native DB | SQLite 3.53.2, `vec_version()` = v0.1.9 |
| GET /v1/health, 무인증 | 200, version 1.0.13, apiRevision 90, vectorEnabled true, embeddingReady false |
| GET /v1/admin/chats, 토큰 없음/오류 | 각각 401 |
| 같은 경로, 정상 토큰 | 200, 빈 items |
| plugin version만 전송 / 틀린 API revision | 각각 409 |
| plugin 1.0.13 + API revision 90 | 200 |
| GET /v1/update/status, 정상 토큰 | 200, currentServerVersion 1.0.13 |
| 재시작 | instanceId와 token identity 유지 |
| 종료 후 DB | 두 실행 모두 integrity_check = ok, chats 0, migration 49 |

`health`는 인증 미들웨어보다 앞에 등록된 공개 경로다. health 200 자체를 인증 성공으로 계산하지 않았다. CORS는 원본 `origin: *`이므로 운영 노출 경계는 G2.5에서 별도로 결정·검증한다.

공식 `/v1/export` → 별도 새 backend의 `/v1/import/inspect` → `/v1/import/restore`도 실행했다. 빈 DB와 합성 pluginSettings만 넣은 ZIP은 11,328 bytes였고 각 API는 200이었다. 복원 결과 `ok=true`, `restartRequired=true`, 합성 설정 일치를 확인했다. 종료 후 원본·복원 DB 모두 integrity_check = ok, chats 0이었다. 실제 기억/벡터/원문이 든 복구와 복원 후 재기동은 이번 시험 범위가 아니다. 완전 백업에는 token/secret이 포함될 수 있어 시험 ZIP은 ignored 경로의 0600 파일로 보관했다.

검증 순서상 한 실패가 있었다. native prebuild 설치 경로를 추가 확인하는 rebuild를 backend 실행 중에 수행했고, 이후 첫 export 시 연결이 끊기며 launcher가 1로 종료됐다. stderr 원인은 없으므로 구체 종료 신호는 미확인이다. 실행 중 native 파일 교체와 겹친 시험 환경 문제 가능성을 남기며 RCM export 결함으로 분류하지 않는다. 새 프로세스에서 동일 export와 별도 복원은 성공했다. 이후 설치/업데이트/rebuild는 대상 프로세스를 중지한 상태에서 수행한다.

## 4. 실제 브라우저에서 확인한 중단점

공식 PocketRisu의 Plugin 화면에서 원본 JS를 가져오고 해당 RCM의 replacer 권한 요청을 정상 UI로 허용했다. 페이지를 다시 여는 두 실행에서 다음 오류를 확인했다. 두 번째 실행은 오류 1건 및 RCM 설정 메뉴 부재를 assertion으로 확인했다.

```text
[Risu Cognitive Memory] initialization failed
Error: API method addRisuChatListener not found
```

이는 이전 [worker 기능 노출 실험](BG-G2-0-CANDIDATE-COMPARISON.md#7-기능-노출을-바꾼-격리-인과-검증)과 독립된 실제 브라우저 재현이다. 원본 조합은 RCM 설정 메뉴 등록 전에 중단되므로 주소/token 저장과 브라우저→backend 인증 연결 성공을 아직 입증하지 못했다.

확인한 소스 경로는 다음과 같다.

1. RCM 1.0.13 `packages/plugin/src/runtime.ts:334`는 `typeof risuai.addRisuChatListener === "function"`으로 출력 저장 listener의 존재를 판별한다. `:866`은 이 판별이 참이면 listener를 등록한다. 부재로 판별되면 `:850`의 분기와 `:853`의 1,500ms 후처리 fallback이 있다. 현재 공식 PocketRisu Proxy에서는 부재 판별이 성립하지 않아 이 fallback이 선택되지 않는다.
2. PocketRisu 1.10.0 `src/ts/plugins/apiV3/factory.ts:374`의 iframe Proxy는 캐시되지 않은 이름을 모두 CALL_ROOT 함수로 반환한다. 따라서 없는 API도 위 typeof 검사를 통과한다.
3. 같은 파일 `:852`의 실제 root dispatch는 등록 API가 함수가 아니면 `API method ... not found`를 반환한다. 공식 plugin API 소스에는 `addRisuChatListener` 등록이 없다.
4. RCM `packages/plugin/src/index.ts:22`는 request hook 설치를 await한다. 여기서 reject되면 이후 설정 메뉴·상태 widget·heartbeat 초기화까지 도달하지 못한다.

따라서 현재 중단점을 DB·ARM·토큰 오류로 설명하지 않는다. 이 오류가 listener 자체를 필수 기능으로 만든다는 뜻도 아니다. 원본에는 부재 시 fallback이 있으며, 호스트의 기능 노출과 실제 호출 지원 사이의 불일치를 먼저 다뤄야 한다. 아직 host correction, listener 신규 구현, 원본 RCM 변경 중 어느 것도 제품에 적용하지 않았다.

추가 사용자 영향은 소스 근거와 실측을 구분한다. `index.ts:17`은 준비 완료 전 model 요청을 차단하는 gate를 먼저 설치하고, `:23`에서 hook 설치 성공 뒤에만 준비 상태를 연다. `runtime.ts:225`의 gate는 준비 전이면 `MemoryInjectionBlockedError`를 던지고 PocketRisu `src/ts/process/request/request.ts:171`은 replacer를 await한다. 따라서 이번 초기화 실패 뒤 일반 model Send도 차단될 가능성이 있다. Send는 실행하지 않아 실제 화면/최종 오류는 미확인이다. Promise.all로 일부 hook만 등록된 상태의 영향도 미확인이다. G2.2에서는 초기화 실패·의도적 차단·일반 hook 오류 및 G1 정상 전송 보존을 별도 검증해야 하며, 단순히 기억 기능만 빠진 상태로 설명하지 않는다.

## 5. 접속 경로와 후속 실행

공식 RCM `packages/plugin/src/api-client.ts`는 `risuai.nativeFetch`에 주소/token/API revision을 전달한다. 공식 PocketRisu `src/ts/globalApi.svelte.ts:2060`의 `fetchNativeRaw`는 일반 요청을 먼저 브라우저 direct fetch로 시도하고 네트워크 오류 시 `/proxy2`로 넘긴다. 명시적 local-network 경로는 별도 분기다. `usePlainFetch=false`만으로 일반 요청이 항상 서버에서 출발한다고 단정하지 않는다.

이 때문에 서버의 127.0.0.1과 iPhone의 127.0.0.1을 동일시할 수 없다. 이번 브라우저는 서버와 같은 머신의 격리 세션이며 초기화 중단 때문에 실제 RCM 연결 경로를 끝까지 관찰하지 못했다. 후속 검증에서는 서버 접근과 브라우저 direct/proxy 실제 선택, HTTPS/mixed-content/CORS/인증을 각각 확인해야 한다. 운영 주소 공개나 새 외부 포트 개방은 현재 배치안에 포함하지 않는다.

현재 G2.1은 **부분 완료**다. 다음 작업은 다음 순서로 연결한다.

1. G1 잔여 의존 표와 ordered-goals §1 선행 조건을 현재 G1 정본에 맞춰 작성한다. 이번 설치 성공이나 브라우저 실패가 G1 잔여 gate를 해제하지 않는다.
2. G2.2의 구체 실행 계획에 foreground iframe API와 BG worker API를 별도 surface로 적는다. (a) 실제 API 목록에 맞는 부재 노출과 원본 fallback 사용, (b) 실제 저장 의미를 갖는 output listener 구현을 나란히 검토한다. 후자는 상류 API의 존재/의미도 먼저 확인한다. 전자는 모든 정상 API와 existing MARP/provider의 노출을 보존해야 하고, fallback의 timer/프로세스 수명도 검증해야 한다. 없는 listener를 빈 함수로 등록하거나 모든 도구를 강제로 꺼서 통과시키지 않는다. 아직 어느 안으로도 구현을 확정하지 않는다.
3. 해당 구현 진입 조건을 충족한 뒤 선택한 호스트 변경을 구현·검증한다. 원본 JS를 유지한 상태에서 정상 설정 메뉴→주소/token 저장→보호 API 연결까지 G2.1의 남은 항목을 재확인한다. 그 뒤 실제 listener/fallback 선택·저장 identity·서버 작업 인계·N+1을 G2.2~G2.4에서 확인한다. 즉 G2.1의 브라우저 연결 잔여는 G2.2급 호스트 호환성 해결에 의존하며, 그 변경은 §9.1의 G1 선행 조건을 따른다. 같은 원본 조합을 다시 설치하는 것만으로 해결되는 잔여가 아니다.
4. 실데이터 백업/복원, 자동 시작·로그 보관·업데이트/제거 시 데이터 보존, 운영 연결/iPhone은 G2.5의 전달 계획과 gate로 남긴다. 이번 빈 DB 복원은 그 전체를 대신하지 않는다.

## 6. 증거와 검증 범위

ignored 증거 디렉터리는 `.code-review/workspaces/bg/g21-rcm-install/`다. 공개 문서에는 실제 경로·주소·token 및 브라우저 저장소 내용을 복제하지 않는다.

| 파일 | 증거 |
|---|---|
| provenance.json | ZIP 22파일 원본 hash |
| npm-install.log, npm-rebuild.log, npm-tree.txt, runtime package-lock.json | 설치·native prebuild·의존성 해석 |
| verify-backend.mjs, backend-receipt.json, backend-receipt-after-rebuild.json | rebuild 전/후 각각 인증·API revision·native·재시작 assertion |
| browser.mjs, actions-*.mjs, browser-open.json, browser-reproduce.json | 정상 import·권한·초기화 실패 재현 |
| pocketrisu-readback.json | 정상 UI 설치 후 SQLite readback, 원본 JS byte-equal |
| verify-backup.mjs, backup-receipt.json | 빈 DB 합성 설정 백업/검사/새 DB 복원 |
| stop-verify.mjs, stop-receipt.json | 시험 프로세스 종료, 22파일 원본 보존, 두 DB integrity |

이번 변경은 조사 문서와 격리 시험 자료다. 운영 코드/installer 변경, G2 통합 L1~L6, iPhone L5, stable tag/release를 실행한 기록이 아니다. 원본 조합에서 막힌 지점을 재현한 것으로 G2 완료를 계산하지 않는다.

## 7. 후속 호스트 진단과 수정 계획

[호스트 호환성 검토](BG-G2-HOST-COMPATIBILITY-REVIEW.md)에서 G1 의존 표와 G2.2a capability 정확화 수정안을 작성했다. 실제 브라우저의 별도 호스트 진단본에서는 원본 RCM 메뉴·주소/token 저장·재접속 보호 API 200을 확인했다. 이는 호스트 guard를 바꾼 결과이며 본 문서의 수정하지 않은 공식 원본 조합 실패를 통과로 바꾸지 않는다. 제품 코드/installer 구현과 운영 설치는 아직 없고, 현재 다음 구현 단위는 ordered-goals §9.3의 G2.2a다. §9.1의 진입 근거는 2026-10-16 G2.2a 한 단위에 한해 기록했다.
