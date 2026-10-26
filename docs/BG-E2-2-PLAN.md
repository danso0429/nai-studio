# E2-2 계획 — client build fence의 PocketRisu 1.16.1 rebase

**상태 (2026-10-26 KST):** 계획 작성, Astra 계획 검수 1회 반영(§7). 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`(`e150de8`)의 「Ordered plan」 E2-2와 R2.
**위험 분류:** risky. installer가 적용하는 pack의 선언·unit을 바꾸고, 서버 쓰기 route의 차단 범위와 클라이언트 요청 경로를 바꾼다.

## 1. 목표

`client-build-fence`가 PocketRisu 1.16.1에서 1.10.0과 같은 보장을 하게 한다. 보장: 서버가 알리는 build와 다른 클라이언트 build는 fence가 정한 writer route 집합(`/api/db/flush`·proxy·model-job 생성처럼 기존 정책이 뺀 route는 계속 제외)에서 HTTP 426(`CLIENT_UPGRADE_REQUIRED`, `commitOutcome: 'not-committed'`)으로 거부되고, 클라이언트는 그 응답을 받으면 upgrade 처리로 넘어간다. 1.16.1에 새로 생긴 데이터 쓰기 route도 같은 보장을 받는다. 1.10.0 적용 결과는 바꾸지 않는다.

## 2. 확인한 사실

| # | 사실 | 출처 |
|---|---|---|
| F1 | pack은 version 0.1.3, unit 58개(owned 8, insert 21, replace 29), 모두 `['1.10.0']` 범위, pack `requires` 없음. 이 pack을 `requires`하는 pack: fence adapter 4개, `server-backup-snapshot-core`. | catalog 실측(`e150de8`) |
| F2 | 1.16.1에서 anchor가 사라진 unit은 4개다. 나머지 54개 anchor는 그대로다. | `anchors2.tsv`(`677595c`), 탐색 보고 |
| F3 | `node-session-fetch:1.9`·`node-session-accept:1.9`: 1.16.1 `_doInitSession`은 `authRequest('/api/session', {...}, async (res) => res.ok)`로 요청한다. `authRequest`는 전역 `fetch`와 timeout race를 쓰고, 본문은 콜백 안에서만 읽힌다. 옛 unit의 `res`는 콜백 밖에서 쓸 수 없다. | u116 `src/ts/storage/nodeStorage.ts:42-58,332-343` (확인함) |
| F4 | `node-auth-fetch:1.9`: 1.16.1 `authFetchOnce`는 `this.fetchFn(input, {...init, headers})`를 부르고(`fetchFn` 기본값 `fetch`, 주입 가능), 뒤이어 423 `ACCOUNT_IMPORT_ACTIVE` 처리가 있다. | u116 `nodeStorage.ts:39,306,521-535` (확인함) |
| F5 | `global-dirty-probe:1.9`: 1.16.1 `hasTrackedChanges`에서 `toSave.pluginCustomStorage ||` 줄이 빠졌다. probe 내용은 그대로 쓸 수 있다. | 탐색 보고 u116 `globalApi.svelte.ts:742-751,871-873` |
| F6 | `clientBuildFetch(input, init)`은 `withClientBuildHeader(init.headers)`로 `x-client-build`를 붙여 `fetch`하고, `handleClientBuildResponse(response)`가 426·`CLIENT_UPGRADE_REQUIRED`일 때 upgrade 처리를 부른 뒤 응답을 그대로 돌려준다. | pack `files/src/ts/storage/clientBuildHandshake.ts:282-314`, `clientBuild.ts:1-11` (탐색 보고) |
| F7 | fence route 목록(`EXACT_WRITER_ROUTES`, `isWriterRoute`)은 owned 파일 `server/node/clientBuildFence.cjs:10-82`에 있다. 다른 pack은 이 목록에 insert unit으로 route를 더한다(`personal-settings` external-headers, `lazy-chat-bg-adapter` notification). | 탐색 보고, `patches/personal-settings/settings/external-headers/units.cjs:30-33` |
| F8 | 1.10.0에 있던 fence 대상 route는 1.16.1에 모두 같은 method·path로 남아 있다. | 탐색 보고(route별 u110/u116 줄) |
| F9 | 1.16.1에 새로 생긴 쓰기 계열 route는 13개이고 그중 서버 데이터를 쓰는 것은 11개다: `POST /api/risu-account/{prepare,download,cancel,apply}`, `POST /api/characters/:chaId/archive`, `POST /api/characters/archive-batch`, `POST /api/characters/:chaId/activate`, `DELETE /api/characters/:chaId/archive`, `POST /api/db/archive/purge-orphans`, `POST /api/db/assets/auto-sweep`, `PATCH /api/asset-manifests/owner/:kind/:ownerId`. 데이터를 쓰지 않는 둘: `POST /api/termux-notify`(로컬 알림 프로세스), `POST /api/asset-manifests/resolve`(조회). | u116 `server.cjs:1315,5113,5130,5798-5836,7314,7345,7383,7482,7503,8303` (탐색 보고) |
| F10 | 새 route의 클라이언트 호출: 계정 가져오기·archive·activate·manifest PATCH는 `authFetch`(계정 가져오기는 `risuAccountRequest` → `authFetch`)를 거친다. `auto-sweep`(`src/ts/bootstrap.ts` `cleanChunks`)과 archive `purge-orphans`(`SystemDashboard.svelte:185`)는 맨 `fetch`다. | u116 `nodeStorage.ts:942-963,1255-1320,1398-1450`, `bootstrap.ts:549-562` (확인함), `SystemDashboard.svelte:185` (확인함) |
| F11 | 기존 fence 대상 route의 1.16.1 새 맨 `fetch` 호출: `jobFetch.ts:156`(`DELETE /api/model-jobs/:id`, 취소된 생성의 job 찾기 경로). 1.10.0에 대응 호출이 없다. | u116 `src/ts/process/request/jobFetch.ts:150-157` (확인함) |
| F12 | `POST /api/db/snapshots/restore` 맨 `fetch`(`SystemBackup.svelte:146`)는 `client-build-fence-kei-adapter`가 덮는다. `POST /api/backup/import` XHR(1.10.0 `nodeStorage.ts:530`, 1.16.1 `:1075`)은 base pack이 아니라 `client-build-fence-kei-lazy-storage-adapter`(`backup-xhr-header`·`backup-xhr-response`)가 덮는다. 1.10.0에서도 base pack 혼자서는 이 XHR을 덮지 않았다. 둘 다 E2-6의 필수 확인 항목이다. | `patches/client-build-fence-kei-adapter/manifest.cjs:25-26`, `patches/client-build-fence-kei-lazy-storage-adapter/manifest.cjs:15-40` (확인함) |
| F15 | 남기는 unit 중 둘이 대체되는 unit을 `requires`한다: `node-migration-xhr-header:1.9` → `node-auth-fetch:1.9`, `global-flush:1.9` → `global-dirty-probe:1.9`. 대체 unit을 새 id로 만들면 1.16.1에서 `MISSING_DEPENDENCY`가 난다. 다른 pack은 대체되는 4개를 `requires`하지 않는다. | `patches/client-build-fence/manifest.cjs:251,331`, `src/compose.cjs:307` (확인함), Astra 메모리 조합 재현 |
| F16 | 1.16.1에서 plugin 값은 DB 밖 `pluginStorageStore`에 있고(`globalApi.svelte.ts:729,871`), `setItemSync`가 메모리 값을 바꾼 뒤 저장을 queue에 넣는다(`pluginStorageStore.ts:538-551`, 보류·진행 추적 `:298-335`). 이 상태는 DB dirty probe에 잡히지 않아, 426 뒤 자동 reload(`clientBuildHandshake.ts:249-260`)가 보류 중인 plugin 값을 버릴 수 있다. | Astra 검수(코드 줄 확인), u116 `pluginStorageStore.ts` export 목록 (확인함) |
| F13 | 계정 가져오기 apply는 원본 backup import(`applyEntries`)로 들어가 pre-import snapshot·replace semantics를 그대로 쓴다. 별도 snapshot 강제는 E2-6에서 snapshot pack이 이 경로를 덮는지로 확인한다. | u116 `server/node/risu-account-import.cjs:20-24` (확인함) |
| F14 | 1.16.1의 orphan 정리는 서버 `computeAssetSweep` 하나가 판정하고, asset manifest와 archive row 참조를 이미 포함한다. 클라이언트 `getUncleanables`는 자동 정리에 쓰이지 않는다(`cleanChunks`가 서버 `auto-sweep`을 부름). 우리 pack이 더한 참조(persona 폴더 아이콘, persona `imageGallery`, personal-settings 자산)는 원본 walker에 없다. | 탐색 보고 u116 `server.cjs:6931-6948,7594-7628,7647-7708,7736-7770`, `bootstrap.ts:549-562` (확인함) |

## 3. 단위

| ID | 제목 |
|---|---|
| E2-2a | Rebase the client build fence onto PocketRisu 1.16.1 |

### E2-2a

- 바뀐 4개 unit과 그것을 `requires`하는 2개 unit(F15)은 1.10.0 전용으로 남기고, 1.16.1 전용 대체 unit을 새 id로 만든다(coverage `replaced` 6개). 대체 unit의 `requires`는 1.16.1 대체 unit을 가리킨다.
  - 세션 시작(F3): `authRequest`는 그대로 두고 그 `read` 콜백 안에서 처리한다. 요청은 `x-client-build`를 싣고, 426이면 `clientBuildFetch`와 같은 upgrade 처리를 하고, 성공 응답의 `build`를 `handleAdvertisedClientBuild`에 넘긴 뒤 `res.ok`를 돌려준다. 본문 읽기는 기존 timeout race 안에서 끝난다. 다른 `authRequest` 호출자는 바꾸지 않는다.
  - `authFetchOnce`(F4): 기존 `Headers`에 `x-client-build`를 넣고, 주입된 `this.fetchFn`이 돌려준 응답에 곧바로 `handleClientBuildResponse`를 적용한다. 423·인증 재시도·일시 오류 재시도의 순서와 동작은 그대로다.
  - dirty probe(F5·F16): 1.16.1 `hasTrackedChanges` 뒤에 probe를 넣고, `pluginStorageStore`의 보류 중·진행 중 쓰기가 있으면 dirty로 본다. 그 상태를 읽을 export가 없으면 1.16.1 전용 unit으로 읽기 전용 함수를 더한다.
  - `node-migration-xhr-header`·`global-flush`: 내용은 같고 `requires`만 1.16.1 대체 unit을 가리킨다.
- 나머지 52개 unit의 범위를 `['1.10.0', '1.16.1']`로 넓힌다(내용·anchor는 그대로).
- 새 route 11개(F9의 데이터 쓰기 route)를 fence 대상으로 더한다. owned 파일 `clientBuildFence.cjs`의 1.10.0 bytes를 바꾸지 않도록 1.16.1 전용 insert unit으로 넣는다(F7의 방식). `termux-notify`·`asset-manifests/resolve`는 넣지 않는다.
- 새 맨 `fetch` 호출 3곳(F10의 `auto-sweep`·archive `purge-orphans`, F11의 `jobFetch.ts:156`)을 1.16.1 전용 unit으로 `clientBuildFetch`에 태운다.
- pack: `reviewing: ['1.16.1']`, version 0.1.4, `patches/target-coverage.cjs`에 1.16.1 항목(대체 6개는 `replaced`, 새 unit은 `added`, 나머지 52개 `retained`).
- 테스트(owned test 파일 포함)는 1.10.0 owned bytes를 바꾸지 않는다. 1.16.1 동작 테스트가 필요하면 1.16.1 전용 owned test unit으로 더한다.
- patcher `0.2.4-experimental.91`, CHANGELOG, `dist` 재빌드. commit 직전 1.10.0 후보 gate.

## 4. 바뀌면 안 되는 것

- 모든 pack의 1.10.0 선택 unit과 적용 결과 bytes·mode(기준선 fixture, 1.10.0 후보 gate 19/19).
- 1.10.0에서의 fence 동작과 route 목록.
- 1.16.1 원본 동작 중 fence와 무관한 것: `authRequest`의 timeout, `authFetchOnce`의 재시도·423 처리, `fetchFn` 주입, 계정 가져오기의 쓰기 차단, `termux-notify`·`resolve`.
- build stamp가 없으면 fence가 꺼지는 기존 동작(`clientBuildFence.cjs:96-108`).
- 다른 44개 pack의 선언·unit.

## 5. 수용 기준과 검사

| # | 기준 | 검사 |
|---|---|---|
| A1 | 1.16.1 조립 트리에서 F9의 11개 route는 맞지 않는 `x-client-build`에 426·`CLIENT_UPGRADE_REQUIRED`·`not-committed`를 돌려주고 핸들러를 실행하지 않는다(실제 서버의 미들웨어 순서에서 body 처리·핸들러보다 먼저). 맞는 build는 통과한다. path 패턴 route는 다른 id 값에도 걸리고, 다른 method·대소문자·끝 슬래시 변형의 판정은 기존 fence 규칙과 같다. `termux-notify`·`resolve`는 fence 대상이 아니다. | owned 서버 테스트(1.16.1 전용) |
| A2 | 1.16.1 클라이언트의 세션 시작, `authFetch`, 새 맨 `fetch` 3곳이 `x-client-build`를 싣고, 426 응답에 upgrade 처리를 부른다. 세션 성공 응답의 `build`가 전달된다. | owned 클라이언트 테스트(1.16.1 전용) |
| A3 | `authFetchOnce`는 주입된 `fetchFn`을 쓰고 423 `ACCOUNT_IMPORT_ACTIVE`·인증 재시도·일시 오류 재시도가 그대로다. 세션 시작은 성공 본문·426 본문이 늦게 오면 기존 timeout 안에서 끝나고, 426이 아닌 실패는 기존처럼 다음 `checkAuth`에서 다시 시도한다. | owned 클라이언트 테스트, 원본 1.16.1 테스트 통과 |
| A3b | plugin 저장소에 보류 중이거나 진행 중인 쓰기가 있으면 dirty probe가 dirty를 돌려주고, 426을 받아도 자동 reload하지 않는다. 쓰기가 끝나면 다시 clean이다. | owned 클라이언트 테스트(1.16.1 전용) |
| A3c | 1.16.1에서 이 pack의 선택 unit이 조립된다(대체 unit의 `requires` 해결, `MISSING_DEPENDENCY` 없음). | 저장소 테스트(실제 catalog, 1.16.1 target 선택·조립) |
| A4 | `client-build-fence`를 subset harness로 원본 1.16.1 새 사본에 돌려 모든 단계가 통과한다. | `scripts/qualify-subset.cjs` 실측 |
| A5 | 1.10.0 선택 unit·bytes가 기준선과 같고 1.10.0 후보 gate가 19/19다. | 저장소 테스트, 후보 gate |
| A6 | coverage 검사가 이 pack의 1.16.1 항목을 통과시킨다(대체 4개 `replaced`, 새 unit `added`). | 저장소 테스트 |

### Test contract

| 기준 | 입력 | 기존 상태 | 기대 | 범위 밖 |
|---|---|---|---|---|
| A1 | 11개 route 각각, build 헤더 없음·다름·같음 | 1.16.1 조립 서버, build stamp 있음 | 없음·다름 → 426, 핸들러 미실행. 같음 → 기존 응답 | 각 route의 업무 결과 |
| A1 | `termux-notify`, `resolve` | 같음 | 헤더와 무관하게 fence가 막지 않음 | — |
| A1 | build stamp 없음 | 1.16.1 조립 서버 | fence 꺼짐(기존 동작) | — |
| A2 | 세션 시작, `authFetch`, 3곳 호출 | 1.16.1 조립 클라이언트, fetch 대역 | 요청 헤더에 build, 426이면 upgrade 처리 호출, 세션 성공 시 advertised build 처리 | UI 표시 |
| A3 | `fetchFn` 주입, 423 응답, 세션 본문 지연, 426이 아닌 세션 실패 | 같음 | 주입 함수 호출, 423 처리 동일, timeout 안에서 끝남, 다음 시도 유지 | — |
| A3b | plugin 쓰기 보류·진행 중, 다른 dirty 신호 없음, 426 | 같음 | dirty, 자동 reload 없음 | 실제 plugin 실행 |
| A3c | 실제 catalog, 1.16.1 target | 합성 1.16.1 root 또는 메모리 조합 | 조립 성공, 대체 6개 선택 | — |
| A5·A6 | 실제 catalog | 기준선 fixture | 같음, coverage ok | — |

### 전제 출처

| 전제 | 출처 |
|---|---|
| F3·F4 | 코드 u116 줄 (확인함) |
| F5·F6·F8·F9 | 탐색 보고(haiku-explorer). 구현 전 Astra 검수에서 해당 줄 재확인 |
| F10·F11·F13·F14 | 코드 u116 줄 (확인함) |
| F12 | patcher 코드 줄 (확인함) |

## 6. 범위 밖으로 남기는 것

- fence adapter 4개, `server-backup-snapshot-*`, `kei-backup-restore-safety-*`: E2-6.
- 우리 pack이 더한 asset 참조를 서버 `computeAssetSweep`에 넣는 일(F14): persona(`persona-organizer`)와 personal-settings는 E2-4에서 각 owner가 한다. 클라이언트 `getUncleanables` 패치는 1.16.1 자동 정리를 지키지 못하므로 서버 쪽이어야 한다.
- audit의 "E2-2에서 manifest·archive를 포함한 walker 하나" 항목은 원본이 이미 해결했다(F14). `lazy-chat-sync`의 전체 교체가 원본 walker를 지우지 않는 것은 E2-3에서 확인한다.

## 7. 계획 검수

Astra(gpt-6-astra, 2026-10-26) 1회. F5·F6·F8·F9를 코드로 확인했고, 새 데이터 쓰기 route 11개 밖의 누락과 52개 unit의 의미 변화는 찾지 못했다. 반영: 대체 unit에 기대는 unit 2개도 대체(F15), F12 정정과 backup import XHR의 E2-6 필수 확인, plugin 저장소 쓰기를 dirty probe에 포함(F16, A3b), 1.16.1 조립·세션 지연·미들웨어 순서·경로 변형 검사(A1·A3·A3c), 보장 범위를 fence가 정한 writer route 집합으로 표현. 반영하지 않음: base pack이 backup import XHR을 직접 덮는 안. 1.10.0에서도 adapter가 덮었고 배포는 `all` 묶음 단위라, 기존 소유 구조를 유지하고 E2-6에서 확인한다. `startCookieDownload`의 `/api/session` GET은 writer route가 아니라 범위 밖이다.
