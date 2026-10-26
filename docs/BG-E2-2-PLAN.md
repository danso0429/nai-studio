# E2-2 계획 — client build fence의 PocketRisu 1.16.1 rebase

**상태 (2026-10-26 KST):** 계획 작성, Astra 계획 검수 1회 반영(§7), 사용자 결정으로 1.16.1 전용 계약으로 개정(§3), Astra 2차 검수 반영(§7). 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`(`e150de8`)의 「Ordered plan」 E2-2와 R2.
**위험 분류:** risky. installer가 적용하는 pack의 선언·unit을 바꾸고, 서버 쓰기 route의 차단 범위와 클라이언트 요청 경로를 바꾼다.

## 1. 목표

`client-build-fence`가 PocketRisu 1.16.1에서 1.10.0과 같은 보장을 하게 한다. 보장: 서버가 알리는 build와 다른 클라이언트 build는 fence가 정한 writer route 집합(`/api/db/flush`·proxy·model-job 생성처럼 기존 정책이 뺀 route는 계속 제외)에서 HTTP 426(`CLIENT_UPGRADE_REQUIRED`, `commitOutcome: 'not-committed'`)으로 거부되고, 클라이언트는 그 응답을 받으면 upgrade 처리로 넘어간다. 1.16.1에 새로 생긴 데이터 쓰기 route도 같은 보장을 받는다. E2 branch는 1.16.1 전용이므로(§3) 이 pack은 1.10.0을 더 선언하지 않는다.

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
| F17 | `server-backup-snapshot-core`는 `requires: ['client-build-fence']`와 `autoWhen.all: ['client-build-fence']`를 가진다. fence만 harness로 돌려도 closure에 snapshot-core가 들어오고, snapshot-core가 1.16.1을 선언하지 않으면 harness가 `TARGET_NOT_DECLARED`로 멈춘다. | `patches/server-backup-snapshot-core/manifest.cjs:21`, `scripts/qualify-subset.cjs:584`, Astra 2차 메모리 재현 |
| F18 | coverage 검사기는 pack이 1.10.0을 선언할 때만 기준선 항목이 없음을 위반으로 본다. 1.16.1만 선언한 pack은 기준선 항목이 빠져도 모든 unit을 `added`로 적으면 통과한다. | `scripts/lib/target-coverage.cjs:149`, Astra 2차 재현 |
| F19 | `pluginStorageStore`는 재시도 대기 중에 `inflight`를 비우고 보류 batch를 queue 밖에 둔다. queue와 `inflight`만 보면 clean으로 잘못 보인다. | u116 `src/ts/plugins/pluginStorageStore.ts:320-330` (Astra 2차) |
| F16 | 1.16.1에서 plugin 값은 DB 밖 `pluginStorageStore`에 있고(`globalApi.svelte.ts:729,871`), `setItemSync`가 메모리 값을 바꾼 뒤 저장을 queue에 넣는다(`pluginStorageStore.ts:538-551`, 보류·진행 추적 `:298-335`). 이 상태는 DB dirty probe에 잡히지 않아, 426 뒤 자동 reload(`clientBuildHandshake.ts:249-260`)가 보류 중인 plugin 값을 버릴 수 있다. | Astra 검수(코드 줄 확인), u116 `pluginStorageStore.ts` export 목록 (확인함) |
| F13 | 계정 가져오기 apply는 원본 backup import(`applyEntries`)로 들어가 pre-import snapshot·replace semantics를 그대로 쓴다. 별도 snapshot 강제는 E2-6에서 snapshot pack이 이 경로를 덮는지로 확인한다. | u116 `server/node/risu-account-import.cjs:20-24` (확인함) |
| F14 | 1.16.1의 orphan 정리는 서버 `computeAssetSweep` 하나가 판정하고, asset manifest와 archive row 참조를 이미 포함한다. 클라이언트 `getUncleanables`는 자동 정리에 쓰이지 않는다(`cleanChunks`가 서버 `auto-sweep`을 부름). 우리 pack이 더한 참조(persona 폴더 아이콘, persona `imageGallery`, personal-settings 자산)는 원본 walker에 없다. | 탐색 보고 u116 `server.cjs:6931-6948,7594-7628,7647-7708,7736-7770`, `bootstrap.ts:549-562` (확인함) |

## 3. 단위

**개정 (2026-10-26):** 사용자 결정으로 E2 branch는 1.16.1 전용이다(patcher audit 「Target declaration per pack」, Decisions). 처음 계획은 1.10.0 bytes를 그대로 두려고 바뀐 unit을 새 id로 복사했는데, anchor가 사라진 4개 unit에 pack 안 unit 5개가 의존 사슬로 묶여(`node-migration-xhr-header`·`node-migration-xhr-response`·`global-flush`·`global-proxy-stream-cancel`·`global-proxy-stream-abort`) 복사가 9개로 늘었다. 이제 rebase하는 pack은 그 자리에서 1.16.1에 맞게 고친다.

| ID | 제목 |
|---|---|
| E2-1c | Make the six E2-1b packs 1.16.1-only |
| E2-2a | Rebase the client build fence onto PocketRisu 1.16.1 |
| E2-2b | Rebase the server backup snapshot core onto PocketRisu 1.16.1 |

E2-2b는 F17 때문에 E2-6에서 당겨 왔다. 설계는 아래 「E2-2b」에 있다. fence의 A4 실측은 E2-2b 뒤 closure(`client-build-fence` + `server-backup-snapshot-core`)로 한다.

### 공통 계약 (rebase한 pack)

- 선언은 `targets.pocketrisu = { verified: [], reviewing: ['1.16.1'] }`. unit에 1.10.0 범위가 없다(`targetVersions`를 두지 않음).
- 1.16.1에서 바뀐 unit은 같은 id로 내용을 고친다. 같은 보장을 하는 unit의 id는 바꾸지 않으므로 pack 안팎의 `requires`가 그대로 이어진다.
- coverage: frozen 1.10.0 기준선의 모든 unit id가 `retained`(1.16.1에도 같은 id가 있음)·`replaced`·`retired` 중 하나에 있고, 새 unit은 `added`. `retained` 중 내용을 일부러 고친 unit은 `rewritten: { id: 이유 }`에 적는다. 나머지 `retained` unit은 `targetVersions`를 뺀 정의가 1.10.0 기준선(unit별 fixture)과 같아야 한다.
- 아직 rebase하지 않은 pack은 1.10.0 선언과 unit을 그대로 둔다.
- commit마다 검사: 저장소 테스트, installer 두 번 빌드의 동일성·mode·`node --check`, 손댄 pack closure의 subset harness(원본 1.16.1 새 사본). 1.10.0 후보 gate와 CI는 E2 동안 요구하지 않는다.

### E2-1c

- coverage 검사기: 기준선 fixture에 있는 pack의 1.16.1 항목은 기준선 항목이 있어야 한다(F18). 선택 인자 `unitBaseline`을 받으면 `rewritten`에 없는 `retained` unit의 정의를 비교하고, 다르면 `retained-unit-changed`, `rewritten` 키가 `retained`에 없으면 `invalid-rewritten`을 보고한다. harness와 catalog 테스트가 이 인자를 넘긴다.
- unit별 기준선 fixture `test/fixtures/target-baseline-1.10.0-units.json`: `9b15c32` catalog의 pack별 unit id → `targetVersions`를 뺀 unit 정의의 정규화 hash. orchestrator가 만들고 이후 바꾸지 않는다.
  - 생성(2026-10-26): `{ format: 1, source, hash, packs: { packId: { unitId: hex } } }`. hash는 1.10.0에서 선택된 unit마다 `sha256(stableStringify(targetVersions를 뺀 unit))`(`src/manager.cjs`의 `stableStringify`). 45개 pack·1,957개 unit이고, id 목록과 순서는 `target-baseline-1.10.0.json`의 `units110`과 같다. `44bb1be`에서 다시 계산한 값도 모두 같다.
- 판정 세부(Argon 시나리오 검토에서 확정):
  - 검사 대상 pack(`packIds`)마다 기준선 항목(`units110` 배열)이 있어야 한다. 없으면 선언한 각 target마다 `missing-baseline`이다. 1.10.0에 없던 새 pack은 E2 계획에 없으므로 따로 허용하지 않는다.
  - `rewritten`은 선택 항목이고, 있으면 객체여야 한다(아니면 `invalid-rewritten`, unitId `null`). 이유가 비거나 공백뿐이면 `empty-reason`이다. 키가 `retained` 밖에 있으면 `invalid-rewritten`이다. 이 구조 검사는 `unitBaseline` 유무와 관계없이 한다.
  - `unitBaseline`을 넘기지 않으면 내용 비교(`retained-unit-changed`)만 하지 않는다. 넘겼을 때 `rewritten`에 없는 `retained` unit의 기준선 hash가 없으면 `retained-unit-changed`다.
  - `rewritten`에 적었지만 내용이 같은 unit도 통과한다.
- 테스트 배치: E2-1c와 E2-2a의 테스트는 각 단위의 commit에 들어간다. E2-1c가 고치는 공용 테스트(catalog·compatibility 등)는 E2-1c 상태와 E2-2a 상태에서 모두 통과해야 한다. 그래서 rebase한 pack 집합을 고정된 6개 목록이 아니라 coverage map의 키에서 얻는다. fence에만 해당하는 기대는 E2-2a 테스트 파일들에만 둔다.

- E2-1b의 6개 pack(`charx-archive-integrity`, `parser-hardening`, `log-load-performance`, `kei-prompt-role-compat-core`, `kei-text-theme-normalization-core`, `kei-fullscreen-image-viewer-core`)을 공통 계약으로 바꾼다: `verified: []`, unit의 `targetVersions` 제거, 각 pack version은 E2-1b 버전에서 patch +1(기준선 +2: `charx-archive-integrity`·`parser-hardening`·`kei-prompt-role-compat-core`·`kei-text-theme-normalization-core` 0.1.3, `log-load-performance` 0.1.2, `kei-fullscreen-image-viewer-core` 0.2.3). E2-1b 버전에는 이미 다른 내용이 commit되어 있으므로 같은 버전을 다시 쓰지 않는다. 공용 테스트는 단계와 무관하게 "기준선과 major·minor가 같고 patch가 더 크다"만 확인하고, 정확한 버전은 pack별 테스트가 확인한다. coverage 항목(`retained: 'all'`)은 그대로다.
- patcher `0.2.4-experimental.91`, CHANGELOG, `dist` 재빌드.

### E2-2a

- 1.16.1에서 anchor가 사라진 4개 unit을 같은 id로 고친다.
  - 세션 시작(F3): `authRequest`는 그대로 두고 그 `read` 콜백 안에서 처리한다. 요청은 `x-client-build`를 싣고, 426이면 `clientBuildFetch`와 같은 upgrade 처리를 하고, 성공 응답의 `build`를 `handleAdvertisedClientBuild`에 넘긴 뒤 `res.ok`를 돌려준다. 본문 읽기는 기존 timeout race 안에서 끝난다. 다른 `authRequest` 호출자는 바꾸지 않는다.
  - `authFetchOnce`(F4): 기존 `Headers`에 `x-client-build`를 넣고, 주입된 `this.fetchFn`이 돌려준 응답에 곧바로 `handleClientBuildResponse`를 적용한다. 423·인증 재시도·일시 오류 재시도의 순서와 동작은 그대로다.
  - dirty probe(F5·F16): 1.16.1 `hasTrackedChanges` 뒤에 probe를 넣고, `pluginStorageStore`의 보류 중·진행 중 쓰기가 있으면 dirty로 본다. 그 상태는 새 unit이 `src/ts/plugins/pluginStorageStore.ts`에 더하는 읽기 전용 export `hasPendingPluginStorageWrites(): boolean`(보류·진행 중 쓰기가 하나라도 있으면 `true`)으로 읽는다(blind 테스트가 이 이름을 고정).
- 나머지 unit은 범위만 없앤다. 내용을 고쳐야 하는 unit(route 목록이 든 owned `clientBuildFence.cjs`, 새 helper를 import하는 unit 등)은 같은 id로 고치고 coverage `rewritten`에 이유를 적는다. 다른 pack이 anchor로 쓰는 줄(`const EXACT_WRITER_ROUTES = new Set([`, boot-reminder 항목)은 그대로 둔다(`patches/lazy-chat-bg-adapter/notification-units.cjs:45`, `patches/personal-settings/settings/external-headers/units.cjs:30`).
- `handleClientBuildResponse`는 `Promise<void>`다. 기다린 뒤 원래 응답을 계속 쓴다.
- `hasPendingPluginStorageWrites`는 queue·`inflight`뿐 아니라 재시도 대기 중인 작업도 보류로 센다(F19).
- 새 route 11개(F9의 데이터 쓰기 route)를 fence 대상으로 더한다. owned 파일 `server/node/clientBuildFence.cjs`의 목록·패턴을 직접 고친다. `termux-notify`·`asset-manifests/resolve`는 넣지 않는다.
- 새 맨 `fetch` 호출 3곳(F10의 `auto-sweep`·archive `purge-orphans`, F11의 `jobFetch.ts:156`)을 새 unit으로 `clientBuildFetch`에 태운다.
- 1.16.1 동작 테스트 7개(`files-1.16/`의 `*.e2-2a.test.ts`)를 owned unit으로 등록한다.
- pack: 공통 계약, version 0.1.4, coverage 항목(58개 `retained`, 고친 unit `rewritten`, 새 unit `added`).
- patcher `0.2.4-experimental.92`, CHANGELOG, `dist` 재빌드.

### E2-2b

확인한 사실(2026-10-26):

| # | 사실 | 출처 |
|---|---|---|
| F20 | `server-backup-snapshot-core`는 version 0.1.7, unit 11개다. owned 8개는 `server/node/backupSnapshot.cjs`·`backupSource.cjs`와 그 vitest 2개, compat 테스트 4개(`test/compat/backup-point-in-time`·`storage-reset-b1a`·`session-reset-b2`·`reset-orphans-b3`)다. `db.cjs` unit 3개가 있다. pack `requires`·`autoWhen`은 `client-build-fence`이고, fence unit id를 직접 `requires`하는 unit은 없다. 이 pack에 기대는 pack은 `server-backup-snapshot-lazy-adapter` 하나다. 다른 pack은 compat 테스트 unit id를 `requires`하지 않는다. | `patches/server-backup-snapshot-core/manifest.cjs:13-80`, `adapter-manifest.cjs:200-201`, grep (확인함) |
| F21 | `db.cjs` unit 3개의 anchor는 1.16.1에 각각 한 번 있다(`db.cjs:6,207,249`). 1.16.1에는 `createKvSnapshot`·`openKvSnapshot`이 없고, `db.cjs` export 목록은 1.10.0과 같다. | u116 `server/node/db.cjs` grep (확인함), 탐색 보고 |
| F22 | 원본 1.16.1 사본에 이 pack의 unit 11개만 손으로 조립했다(fence의 owned 파일은 있으나 insert unit은 없음). 서버 vitest 2개는 6/6 통과했다. compat 4개 파일은 55개 중 52개가 실패했다. | 실측 `e2/e22b/probe`(1.16.1 `5da95f7`, pack `44bb1be`), 로그 `server-tests.log`·`compat-tests.log` |
| F23 | compat 4개는 core closure 밖 pack이 있어야 도는 통합 테스트다. storage reset barrier·epoch·원자적 import와 restore는 `lazy-chat-sync`의 1.10 전체 교체 `server.cjs`에 있다(`storageReset` 76회. 1.16.1 원본에는 0회). pinned backup endpoint는 `server-backup-snapshot-lazy-adapter`가 `/api/backup/server/save`·export·`/api/db/optimize`를 바꿔서 만든다. B2·B3의 BG session·결과 정리는 BG adapter 쪽이다. core는 이 pack들을 `requires`하지 않는다. 1.10.0에서는 `all` 전체 graph에서만 돌았기 때문에 드러나지 않았다. 파일별로 미뤄지는 검사(계획 검수, 2026-10-27): `backup-point-in-time`은 core와 lazy adapter의 통합(동시 변경 중 pinned KV·chunk 읽기와 파일 복사 `:235`·`:251`, 연결 끊김 정리 `:299`, reader가 있을 때 maintenance 조정 `:314`)이고, core 서버 테스트 6개는 이 endpoint 수명을 대신하지 않는다. `storage-reset-b1a`는 reset 동작이 대부분이지만 fence 426 우선순위(`:340`), capture·reset 배제(`:426`, `:982`, `:1006`), BG 취소·복구 정리(`:1177`)를 함께 요구한다. `session-reset-b2`·`reset-orphans-b3`는 core 모듈을 직접 시험하지 않는다. | `patches/lazy-chat-sync/files-1.10/server/node/server.cjs`, u116 `server.cjs` grep, `adapter-manifest.cjs:105-170` (확인함), 실패 제목, compat 파일 줄(검수 보고, 줄 위치만 사용) |
| F24 | core의 snapshot reader는 prefix 목록에 `LIKE`를 쓴다(`backupSnapshot.cjs:13-17`). 1.16.1 원본 `db.cjs`는 끝 글자가 출력 가능한 ASCII인 prefix에 대소문자를 가리는 key 범위를 쓰고 나머지만 `LIKE`를 쓴다(`db.cjs:170-205`). SQLite `LIKE`는 ASCII 대소문자를 가리지 않으므로 `archive/`로 찾으면 `Archive/two`도 나온다(검수자의 메모리 내 재현). pinned reader가 live reader와 다른 key 집합을 줄 수 있다. | `backupSnapshot.cjs:13-17`, u116 `db.cjs:170-205` (확인함), 재현(검수 보고) |

설계:

- core는 공통 계약을 따르고 version 0.1.8이 된다. `backupSource.cjs`와 그 vitest, `db.cjs` unit 3개는 내용을 그대로 두고 범위만 없앤다(coverage `retained`). `backupSnapshot.cjs`의 prefix 목록은 원본 `db.cjs`와 같은 규칙(끝 글자가 출력 가능한 ASCII면 key 범위, 아니면 escape한 `LIKE`)으로 바꾸고, chunk 값의 논리 크기 보고는 그대로 둔다(F24). 그 vitest에 대소문자만 다른 prefix 회귀와, 원본 snapshot rotation·plugin blob 정리 뒤에도 pinned read가 이전 view를 주는 회귀를 더한다. 이 둘은 coverage `rewritten`(이유: 원본 prefix 규칙과 일치)이다.
- compat 테스트 4개는 core의 1.16.1 unit에서 뺀다(coverage `retired`. 이유: core closure 밖 pack이 있어야 도는 통합 테스트). 테스트 파일은 저장소에 그대로 둔다. 각 테스트는 자기가 시험하는 동작의 owner pack을 rebase할 때 그 pack의 unit으로 다시 넣는다(1.16.1에 맞게 고쳐서). 해당 단위는 E2-3 `lazy-chat-sync`, E2-6 `server-backup-snapshot-lazy-adapter`, E2-7 BG adapter다. 어느 owner가 어느 테스트를 받을지는 그 단위의 계획에서 테스트별로 정한다. 대신 E2-9에서 네 파일이 1.16.1 전체 graph의 테스트로 모두 돌아왔고 통과하는지 확인한다(audit E2-3·E2-6·E2-7·E2-9 행에 적는다).
- 다른 방법을 버린 이유: core에 그대로 두면 fence와 core의 subset 실측(A4)이 E2-3·E2-6·E2-7이 끝날 때까지 항상 실패한다. 그러면 fence를 1.16.1에서 확인하는 일이 E2 끝까지 미뤄진다. owner를 지금 옮기려면 아직 rebase하지 않은 pack의 unit을 바꿔야 해서 A5(손대지 않은 pack은 기준선과 같음)를 깬다.
- patcher `0.2.4-experimental.93`, CHANGELOG, `dist` 재빌드.

수용 기준:

| # | 기준 | 검사 |
|---|---|---|
| B0 | core는 1.16.1만 선언하고 unit에 범위가 없으며 version은 0.1.8이다. 1.16.1 선택 unit은 기준선 11개 중 compat 4개를 뺀 7개다. coverage는 `retained` 7개(그중 `backupSnapshot.cjs`와 그 vitest는 `rewritten`, 이유 있음), `retired` 4개(이유 있음), `replaced`·`added`는 비어 있고, `unitBaseline` 검사를 통과한다. | 저장소 테스트(실제 catalog) |
| B0b | snapshot reader의 prefix 목록이 원본 `kvList`·`kvListWithSizes`와 같은 key 집합을 준다(대소문자만 다른 prefix 포함). chunk 값은 논리 크기를 보고한다. 원본 snapshot rotation과 plugin blob 정리 뒤에도 먼저 연 pinned read는 이전 값을 준다. | core vitest(조립 트리) |
| B1 | `client-build-fence`(closure에 core 포함)를 subset harness로 원본 1.16.1 새 사본에 돌리면 모든 단계가 통과하고 잔여 없이 되돌아간다. fence의 vitest 7개와 core의 서버 vitest 2개가 실행되고 통과한 것을 로그로 확인한다(fence와 E2-2b의 A4). | `scripts/qualify-subset.cjs` 실측 |
| B2 | `server-backup-snapshot-lazy-adapter`와 다른 pack의 1.10.0 선언·unit은 바뀌지 않는다(A5). | 저장소 테스트 |



- 아직 rebase하지 않은 38개 pack의 선언·unit(기준선 fixture의 version·선언 hash·1.10.0 선택 unit).
- 1.16.1 원본 동작 중 fence와 무관한 것: `authRequest`의 timeout, `authFetchOnce`의 재시도·423 처리, `fetchFn` 주입, 계정 가져오기의 쓰기 차단, `termux-notify`·`resolve`.
- fence의 기존 판정 규칙(경로 소문자화, 끝 슬래시 제거, query string 미제거, 패턴 segment 규칙)과 build stamp가 없으면 fence가 꺼지는 동작(`clientBuildFence.cjs:96-108`).
- 기존 fence 대상 route가 계속 fence 대상인 것.
- 일반 installer는 `reviewing`만 선언된 target을 거부한다.

## 5. 수용 기준과 검사

| # | 기준 | 검사 |
|---|---|---|
| A0 | E2-1c: 6개 pack은 1.16.1만 선언하고 unit에 범위가 없으며 version이 올라갔다. 1.16.1 선택 unit 집합은 E2-1b 때와 같다. coverage가 통과한다. | 저장소 테스트 |
| A1 | 1.16.1 조립 트리에서 F9의 11개 route는 맞지 않는 `x-client-build`에 426·`CLIENT_UPGRADE_REQUIRED`·`not-committed`를 돌려주고 핸들러를 실행하지 않는다(실제 서버의 미들웨어 순서에서 body 처리·핸들러보다 먼저). 맞는 build는 통과한다. path 패턴 route는 다른 id 값에도 걸리고, 다른 method·대소문자·끝 슬래시 변형의 판정은 기존 fence 규칙과 같다. `termux-notify`·`resolve`는 fence 대상이 아니다. | owned 서버 테스트 |
| A2 | 1.16.1 클라이언트의 세션 시작, `authFetch`, 새 맨 `fetch` 3곳이 `x-client-build`를 싣고, 426 응답에 upgrade 처리를 부른다. 세션 성공 응답의 `build`가 전달된다. | owned 클라이언트 테스트 |
| A3 | `authFetchOnce`는 주입된 `fetchFn`을 쓰고 423 `ACCOUNT_IMPORT_ACTIVE`·인증 재시도·일시 오류 재시도가 그대로다. 세션 시작은 성공 본문·426 본문이 늦게 오면 기존 timeout 안에서 끝나고, 426이 아닌 실패는 기존처럼 다음 `checkAuth`에서 다시 시도한다. | owned 클라이언트 테스트, 원본 1.16.1 테스트 통과 |
| A3b | plugin 저장소에 보류 중이거나 진행 중인 쓰기, 또는 재시도 대기 중인 쓰기가 있으면 dirty probe가 dirty를 돌려주고, 426을 받아도 자동 reload하지 않는다. 쓰기가 끝나면 다시 clean이다. | owned 클라이언트 테스트 |
| A3c | 1.16.1에서 이 pack이 선택·조립된다(`MISSING_DEPENDENCY` 없음). fence 선언은 1.16.1만이고 unit에 범위가 없다. | 저장소 테스트(실제 catalog) |
| A4 | E2-1c는 6개 pack 묶음을, E2-2a·E2-2b는 E2-2b 뒤 `client-build-fence`(closure에 snapshot-core 포함)를 subset harness로 원본 1.16.1 새 사본에 돌려 모든 단계가 통과한다. E2-2a commit 자체에는 A4가 없다(F17). | `scripts/qualify-subset.cjs` 실측 |
| A5 | 아직 rebase하지 않은 38개 pack은 기준선과 같다. installer 두 번 빌드가 같고 mode 755, `node --check` 통과. | 저장소 테스트, 빌드 |
| A6 | coverage 검사가 통과한다(fence: 58개 `retained`, 고친 unit은 `rewritten`, 새 unit `added`). 기준선 항목이 없는 rebase pack, 이유 없이 내용이 바뀐 `retained` unit, `retained`에 없는 `rewritten` 키는 위반이다. | 저장소 테스트 |

### Test contract

| 기준 | 입력 | 기존 상태 | 기대 | 범위 밖 |
|---|---|---|---|---|
| A0 | 실제 catalog | 기준선 fixture | 6개 pack 1.16.1만, 범위 없음, version +1, 선택 unit id = 기준선 `units110` | — |
| A1 | 11개 route 각각, build 헤더 없음·다름·같음 | 1.16.1 조립 서버, build stamp 있음 | 없음·다름 → 426, 핸들러 미실행. 같음 → 기존 응답 | 각 route의 업무 결과 |
| A1 | `termux-notify`, `resolve` | 같음 | 헤더와 무관하게 fence가 막지 않음 | — |
| A1 | build stamp 없음 | 1.16.1 조립 서버 | fence 꺼짐(기존 동작) | — |
| A2 | 세션 시작, `authFetch`, 3곳 호출 | 1.16.1 조립 클라이언트, fetch 대역 | 요청 헤더에 build, 426이면 upgrade 처리 호출, 세션 성공 시 advertised build 처리 | UI 표시 |
| A3 | `fetchFn` 주입, 423 응답, 세션 본문 지연, 426이 아닌 세션 실패 | 같음 | 주입 함수 호출, 423 처리 동일, timeout 안에서 끝남, 다음 시도 유지 | — |
| A3b | plugin 쓰기 보류·진행·재시도 대기 중, 다른 dirty 신호 없음, 426 | 같음 | dirty, 자동 reload 없음 | 실제 plugin 실행 |
| A3c | 실제 catalog, 1.16.1 target | 합성 1.16.1 root 또는 메모리 조합 | 조립 성공 | — |
| A5·A6 | 실제 catalog | 기준선 fixture 2개 | 38개 같음, coverage ok | — |
| A6 | 합성 coverage·catalog·기준선 | 기준선 항목 없음, `retained` 내용 변경(`rewritten` 있음·없음), `rewritten` 키가 `retained` 밖 | 각각 위반 kind로 보고, `rewritten`에 적힌 변경은 통과 | — |

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

2차(2026-10-26, 1.16.1 전용 계약 개정 뒤): 혼합 선언에서 catalog·resolver·`all`·installer 빌드가 깨지지 않음을 확인했다. 반영: snapshot-core의 `autoWhen` 때문에 fence 단독 A4가 불가능함(F17) → E2-2b로 당기고 A4를 closure 완성 뒤로, coverage 기준선 누락 구멍(F18)과 `retained` 내용 기준선·`rewritten` 표시, owned helper·import unit 고침의 명시, `handleClientBuildResponse` 반환값, plugin 재시도 대기 상태(F19), 고쳐야 할 기존 테스트 목록. cutover 위험(남은 1.10 journal이 `status` 때 1.16.1 파일을 덮을 수 있음, 남은 custom state의 은퇴 owner 인식)은 audit의 E2-9 확인 항목으로 옮겼다.
