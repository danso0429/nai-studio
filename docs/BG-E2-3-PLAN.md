# E2-3 계획 — lazy-chat-sync를 PocketRisu 1.16.1 원본 위 unit으로 재구성

**상태 (2026-10-27 KST):** 초안 r2. 탐색, 이력 대조, E2-3a 코드 읽기 항목을 마쳤다. 계획 검수 1회차(Astra) 지적 11건과 2회차 지적 5건을 코드로 확인해 모두 반영했다(H18-H23, §3·§4·§5·§7). 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`의 「Ordered plan」 E2-3 행, R1, Decisions(2026-10-26 E2-3).
**위험 분류:** risky. 채팅 저장, 저장소 reset, import·restore의 원자성, 세션 잠금, BG 연동을 바꾼다.

## 1. 목표

`lazy-chat-sync`가 1.16.1에서 통째 파일 교체를 하지 않고 원본 1.16.1 위에 unit으로 얹힌다. 원본의 lazy 로딩(stub와 열 때 hydrate)과 prefix 지문 delta 전송은 그대로 쓴다. 원본에 없고 pack 이력이 실제 문제를 고친 보장만 다시 얹는다. BG와 snapshot lazy adapter가 기대는 symbol은 계약으로 유지한다.

결정 근거(사용자 선택, 2026-10-26): 통째 교체 사본은 원본의 archive route, asset manifest, 계정 가져오기, chat-post 추적, `restoringSnapshotKey`, plugin 목록 쓰기 보호를 모두 지운다. 업스트림이 바뀔 때마다 이 기능들을 다시 옮겨야 한다.

## 2. 확인한 사실

출처의 「탐색」은 haiku-explorer 보고(로컬 탐색 기록)다. 「확인함」은 orchestrator가 해당 줄을 직접 읽은 것이다.

| # | 사실 | 출처 |
|---|---|---|
| H1 | 원본 1.16.1은 `/api/read`에서 채팅을 stub으로 바꿔 보내고(`stripChatsFromDb`·`stripDatabaseForClient`, `server.cjs:818-845`), 클라이언트는 채팅을 열 때 hydrate한다(`ensureChatHydrated`, `chatStorage.ts:162-233`). | 확인함(2026-10-27) |
| H2 | 원본 채팅 저장은 `POST /api/chat-content/:chaId/:chatIndex`(`server.cjs:6418`)이고, `fullChatStore`에 쓴 뒤 5초 debounce로 DB를 저장한다. POST마다 timer를 다시 건다(`:78`, `:6466-6470`). | 확인함 |
| H3 | 원본은 앞부분 지문으로 delta를 확인하고 맞지 않으면 409를 준다(`server.cjs:6354-6358`, `:6450-6454`). 채팅 revision은 없다(grep 0). | 확인함 |
| H4 | 원본 backup import는 `importInProgress`로 다른 import만 막는다(`server.cjs:5633-5637`). `checkActiveSession`은 계정 가져오기 중(`risuAccountImport.isBlocking()`)일 때만 모든 쓰기를 423으로 막는다(`:2148-2155`). 일반 쓰기와 채팅 POST는 backup import, server restore, save-folder, snapshot restore, `/api/remove`와 경쟁할 수 있다. | 확인함(`importInProgress` 사용처 전수, `checkActiveSession` 본문) |
| H5 | 원본에는 채팅 쓰기 journal, storage epoch, reset 뒤 세션 무효화(`revokeAll`은 계정 가져오기에서만, `:5769`), create-only 채팅 쓰기, 채팅 revision이 없다(`chatWriteJournal`·`storage-epoch`·`If-None-Match`·`x-chat-base-revision` grep 0, `revokeAll` 호출은 `:5769` 하나). 채팅 id 복구는 서버 decode와 클라이언트 시작 시점에 원본에도 있다(H18). | 확인함(2026-10-27 grep, `server/node`·`src/ts`) |
| H6 | pack 기능 대부분(journal 호출, revision CAS, reset barrier, dirty API, 저장 재시도)은 원본 함수 몸체 안에 섞여 있다. 독립 module은 `chatDelta.cjs`(275줄), `chatWriteJournal.cjs`(443), `storageResetPrepare.cjs`(431), `serverChatCommit.cjs`, `storageResetTestHooks.cjs`, 클라이언트 `writerSession.ts`, `chatSaveIntent.ts`, `chatIdentityRepair.ts`, `chatSaveRebase.ts`, `conflictRebase.ts`, `pluginChatAccess.ts`, `startupDatabaseCache.ts`다(`writerSession.ts`·`storageResetPrepare.cjs`·`serverChatCommit.cjs`·`storageResetTestHooks.cjs`는 `files-1.10/`, 나머지는 `files/`). | 확인함(줄 수·파일 목록, 2026-10-27), 탐색(함수 몸체 안 섞임) |
| H7 | 다른 pack의 unit은 원본 1.10 글귀에 anchor를 둔다. 예외는 `lazy-chat-bg-adapter` unit 34개로, pack 사본에만 있는 글귀(reset 경로 8, publication·owned-root 쓰기 5, nodeStorage publication 오류 4, globalApi 저장·import 8, 복구 읽기 7, hydration adopt 2)에 붙는다. | 실측(unit anchor 대조 script, patcher `a309b5b`) |
| H8 | 다른 pack이 `requires`하는 `lazy-chat-sync` unit: `lazy-chat-bg-adapter`(chatStorage 교체, `serverChatCommit`, `chatWriteJournal`, server.cjs 교체, `writerSession`), `client-build-fence-lazy-session-adapter`·`personal-settings-lazy-session-adapter`(`writerSession`), `haejeok-persistence-safety-adapter`(`chat-missing-payload-notice`). | 탐색 |
| H9 | snapshot core의 compat 테스트 중 `storage-reset-b1a`, `session-reset-b2`(일부), `reset-orphans-b3`(일부)는 이 pack의 reset 동작을 시험한다(E2-2b F23). | 실측 E2-2b probe |
| H10 | `checkActiveSession`(`server.cjs:2148-2168`)은 middleware가 아니라 route마다 부르는 함수이고, 39곳에서 호출된다. `/api/write`(`:4473`), `/api/patch`(`:4722`), chat-content POST(`:6420`), `/api/assets/bulk-write`(`:5267`), `/api/remove`(`:4332`)와 모든 reset 경로가 이를 부른다. `/api/db/flush`(`:4699`)는 `sessionAuthMiddleware`만 쓰고 이를 부르지 않는다(주석 `:4695-4698`: 자동 flush가 쓰기 잠금을 옮기지 않게 함). | 확인함(본문, 호출 수, flush 주석) |
| H11 | `importInProgress`(`:1539`)는 backup import(`:5633`), 계정 적용(`:5750`), server restore(`:6011`), save-folder execute·upload(`:6667`, `:6697`)가 서로를 막는 데만 쓰고, 쓰기 route는 읽지 않는다. snapshot restore(`:8498-8536`)는 `queueStorageOperation` 안에서 `flushPendingDb` 뒤 blob과 plugin 행을 한 transaction으로 바꾸며, `restoringSnapshotKey`는 그 flush 동안만 설정된다. `/api/remove`는 `database/database.bin`을 포함한 임의 key를 `kvDel`한다(`:4364`). | 확인함 |
| H12 | `risuAccountImport.isBlocking()`은 계정 가져오기 closure의 `started`로 정해지고(`risu-account-import.cjs:213`, `:929`), 시작 시 marker 파일에 남겨 재시작 뒤에도 유지된다(`:217-228`, `:763-766`). 다른 reset 경로는 이 상태를 쓰지 않는다. | 확인함 |
| H13 | 원본 hash 불일치 처리: 서버는 patch를 적용하지 않고 409 `HASH_MISMATCH`를 준다(`server.cjs:4829-4861`). 클라이언트는 다른 revision이면 최신 서버 DB에 tracked 변경을 rebase해 재시도하고(`globalApi.svelte.ts:1534-1554`, 연속 5회를 넘으면 `SaveRejectedError` 알림 후 변경을 대기열에 남김 `:1653-1668`), 아니면 현재 DB 전체 쓰기로 넘어간다(`:1558-1576`). 전체 쓰기 뒤 서버 view hash가 다르면 시스템 로그에 남기고 5분에 한 번까지 baseline을 서버 view로 다시 맞춘다(`:1024-1060`). | 확인함 |
| H15 | 다른 pack이 `lazy-chat-sync` unit id를 `requires`하는 곳은 12곳이다. owned module id(`writerSession`, `chatWriteJournal`, `serverChatCommit`)와 `chat-missing-payload-notice`가 대상이고, 통째 교체 unit은 `lazy-chat-bg-adapter`만 `requires`한다(`server.cjs` 2곳, `chatStorage.ts` 1곳). 나머지 참조 80여 곳은 `after`(순서)다. compose는 없는 id의 `after`를 무시하고(`src/compose.cjs:320-321`), 겹치는 unit의 순서가 정해지지 않으면 `declare before/after` 오류를 낸다(`:357`). coverage 검사는 pack 사이의 `requires`를 보지 않는다(`scripts/lib/target-coverage.cjs`). | 실측(catalog 순회, patcher `a309b5b`), 확인함(compose 줄) |
| H16 | `lazy-chat-sync` 0.5.19는 unit 47개다: 통째 교체 10개(`server.cjs`, `bootstrap.ts`, `globalApi.svelte.ts`, `v3.svelte.ts`, `autoStorage.ts`, `chatStorage.ts`, `nodeStorage.ts`, `risuSave.ts`와 테스트 교체 2개), owned 30개, `chat-missing-payload-notice`·`plugin-api-chat-metadata-types` 교체 2개, `session-lock.cjs` unit 5개. pack `requires`·`autoWhen`은 없다. 이 pack을 `requires`하는 pack은 8개다(`character-import-ux`, lazy adapter 7개). | 실측(catalog) |
| H17 | pack의 채팅 revision 규약: revision은 채팅 legacy encoding의 sha256이다. GET은 `x-chat-revision`을 주고 `If-None-Match`가 맞으면 304다. 전체 POST는 `x-chat-base-revision`을 받고, 있던 채팅을 base 없이 바꾸면 428, base가 다르면 409(`currentRevision` 포함), `If-None-Match: *`인데 채팅이 있으면 412다. 응답은 `x-chat-revision`과 `x-chat-save-mode`를 준다. stripped DB 불변식 위반은 422 `DB_INVARIANT_REJECTED`, reset 중 쓰기는 503 `STORAGE_RESET_IN_PROGRESS`(`retryable: true`), reset 경쟁은 409다. | 확인함(pack `files/server/node/chatDelta.cjs:12-52`, `files-1.10/server/node/server.cjs:146-200`, `:1126-1160`, `:4386-4398`, `:5652-5690`) |
| H14 | 원본 저장 추적: 화면의 채팅과 선택된 캐릭터는 `$effect`가 자동 추적하고, 그 밖의 채팅·캐릭터는 `trackChatForSave`·`trackCharacterForSave`(`globalApi.svelte.ts:546-557`)와 `requestImmediateSave`로 저장한다(`process/triggerOrigin.ts:38-44`). plugin API v3는 열려 있지 않은 채팅을 `saveChatToServer`로 바로 저장한다(`plugins/apiV3/v3.svelte.ts:1050-1066`). pack의 `requestChatSave`는 pack 안 호출이 0이고, `markChatDirty`·`markCharacterDirty`는 pack `pluginChatAccess.ts`에서만 부른다. | 확인함(원본 줄), 탐색(pack 호출 수) |
| H18 | pack의 stripped DB 검사는 빈 `chaId`·중복 `chaId`, 빈 채팅 id·같은 캐릭터 안 중복 채팅 id를 거부한다(`files/server/node/chatDelta.cjs:189-238`). payload 없는 채팅은 직전 DB에 이미 없던 것만 거부하고, 이미 없던 것은 그대로 두거나 지워도 통과한다(`validateStrippedDatabaseTransition`, `:248-255`). pack `/api/write`는 받은 DB를 stub으로 바꾼 뒤 검사한다(`files-1.10/server/node/server.cjs:4381`). 원본 클라이언트는 id 없는 채팅을 저장 대상에서 빼고(`globalApi.svelte.ts:975-982`), `normalizeChat`은 메시지 id만 고친다. 원본 서버는 DB를 decode할 때 빠진 채팅 id를 붙이고(`assignMissingChatIds`, `server.cjs:480-492`, `:565`) 중복 `chaId`·채팅 id를 새 id로 바꾸며(`dedupeCharacterAndChatIds`, `:503-530`, `:580`), 클라이언트도 시작할 때 `assignIds`를 돈다(`bootstrap.ts:216`, `:577`). 그래서 저장된 옛 DB의 id 문제는 원본이 읽을 때 고친다. 남는 것은 세션 중 클라이언트가 새로 만든 id 없는 채팅이고, pack 클라이언트 `chatIdentityRepair.ts`가 확정 기준에 없는 새 캐릭터의 채팅에만 id를 붙인다(이미 있던 캐릭터의 빈 id는 거부, `:103-115`). | 확인함 |
| H19 | journal 복구는 남은 record로 채팅 store 항목을 무조건 바꾼다(`chatWriteJournal.cjs:368-379`). pack은 snapshot restore에서 DB 교체와 journal 삭제를 한 transaction에 넣는다(`commitSnapshotRestore`, `:36-50`). 원본 reset 경로는 journal을 모른다. | 확인함 |
| H20 | 원본 `queueStorageOperation`은 promise를 잇기만 한다(`server.cjs:122-126`). `/api/write`·`/api/patch`·채팅 POST는 queue에 넣기 전에 `checkActiveSession`을 부른다(`:4473`, `:4722`, `:6420`). `/api/patch`와 채팅 POST의 debounce timer는 queue 밖에서 저장하고(`:4994-5000`, `:6466-6472`), `persistDbCacheWithChats`는 await 전에 DB root를 잡는다(`:1122-1124`). 원본 reset 경로(backup import `:5631`, server restore `:6009`, snapshot restore `:8500`, prepare `:5596`)도 `checkActiveSession`을 먼저 부른다. 계정 가져오기 route 4곳은 `allowDuringAccountImport: true`로 계정 gate만 건너뛴다(`:5800`, `:5815`, `:5825`, `:5838`). | 확인함 |
| H21 | pack 1.10의 reset barrier가 막은 route는 쓰기 route 23개(채팅 POST·delta, write, patch, remove, bulk-write, BG route, flush, purge-orphans, optimize, wal-checkpoint, snapshot·backup 삭제, inlay compress(실행 시점까지 검사))와 reset 시작 route 6개(prepare 포함, 409)다(`files-1.10/server/node/server.cjs:1095-1194`). `/api/logs`, request-logs, model-jobs, `/api/set_password`는 막지 않았다. 원본 1.16.1에서 BG 밖의 그 쓰기 route는 `/api/db/flush`(H10)를 빼고 모두 `checkActiveSession`을 부른다(`:8288`, `:8322`, `:8379`, `:8479`, `:6078`). 받아들인 inlay compress는 비동기 작업 뒤 쓰고(`:8653-8703`), 읽기 route인 archived-inline GET도 queue 안에서 `flushPendingDb`를 부른다(`:7461-7465`). | 확인함 |
| H22 | 원본 채팅 저장 transport는 `saveChatContentDelta`·`saveChatContent`(`nodeStorage.ts:1361`, `:1386`) 두 개이고, 둘 다 revision을 보내지 않는다. 이를 부르는 곳은 autosave(`globalApi.svelte.ts:1267`), plugin의 열려 있지 않은 채팅 쓰기(`v3.svelte.ts:1050-1066`), 복구된 model job(`process/request/jobRecovery.ts:267`)이다. plugin이 열려 있지 않은 채팅을 읽을 때는 전체 fetch 경로를 쓴다(`v3.svelte.ts:987`, `chatStorage.ts:110`). 원본 delta는 prefix만 확인한다(`server.cjs:6450`). plugin의 열려 있지 않은 채팅 쓰기는 캐릭터를 추적하지 않는데, 서버 병합은 stub의 `name`·`lastDate`·`folderId`·`modules`로 payload 값을 덮는다(`server.cjs:848-875`). pack은 채팅과 캐릭터를 함께 dirty로 둔다(`pluginChatAccess.ts:325-326`). | 확인함 |
| H23 | 원본 bootstrap은 로컬 DB가 없으면 `{}`를 만들어 쓴다(`bootstrap.ts:63-67`). pack 분류기는 `characters` 배열이 없는 기준 DB에서 `update`를 준다(`chatSaveIntent.ts:37`). BG adapter는 `decodeDatabaseWithPersistentChatIds`, `cacheStrippedDatabase`, `scheduleChatStorePersist`, `readStorageEpoch`를 쓴다(`lazy-chat-bg-adapter/manifest.cjs:2426-2481`). snapshot lazy adapter의 inlay compress는 `storageResetGeneration`·`storageResetActive`를 queue 안에서 다시 확인한다(`server-backup-snapshot-core/adapter-manifest.cjs:144-149`). | 확인함 |

## 3. 기능별 처리

판정: **유지**(원본에 같은 문제가 남아 unit으로 다시 얹음), **원본 사용**(원본이 같은 목적을 이룸), **확인 필요**(구현 전 실측이나 코드 읽기로 정함), **BG 계약**(원본에 대응이 없고 BG가 기대므로 유지).

| 기능 (pack 이력) | 원본 1.16.1 | 판정 |
|---|---|---|
| lazy 로딩, 채팅 stub·hydrate (906d4c6) | 있음(H1) | 원본 사용 |
| JSON-patch delta 전송, `/patch` route | prefix 지문 delta(H3) | 원본 사용(사용자 결정. 채팅 중간 편집은 전체 전송) |
| 채팅 revision CAS, stale view 저장 시 보이지 않은 답변 보존 (4bbc135, a4ae61a) | 없음(H3) | 유지. 원본 chat-content GET/POST에 revision header를 더하고, 원본 delta header와 함께 쓴다 |
| create-only 새 채팅, 새 채팅 분류 (01a4fbb) | POST가 무조건 덮어씀(`:6452-6463`) | 유지 |
| 채팅 id 복구 (4f939e1) | id 없는 채팅은 저장에서 빠지고 충돌은 덮어씀 | 유지 |
| payload 없는 stub의 정확한 shell, stripped DB 불변식 (1911a76) | GET이 DB 항목으로 200 응답, 쓰기는 stub flag 손실만 검사 | 유지 |
| payload 먼저, metadata 나중 (aff7cb8), recovery slot 한도 (675b549) | 클라이언트 순서는 일부 있음, 서버 5초 메모리 창 | 유지(journal과 함께) |
| 내구성 있는 채팅 쓰기 journal, 원자적 snapshot·journal 교체 (45a3eec, 28d62d2, b95b946) | 없음 | 유지, BG 계약 |
| server chat commit (1e6e974, 38f19d3, 11dffcf, 6a75a2d) | 없음 | BG 계약 |
| storage reset barrier·runner, 원자적 backup import·server restore·save-folder·snapshot restore·DB 삭제 (0046677, 84ed00d, ffc6f7d) | 경쟁이 남음(H4) | 유지. 구조(E2-3a 결정): `checkActiveSession` 첫머리에 storage reset gate 검사를 unit 하나로 더하고(H10), 이를 부르지 않는 `/api/db/flush`에는 같은 검사를 따로 단다. pack의 전역 router와 쓰기 route 목록(pack `server.cjs:1095-1194`)은 옮기지 않는다. 근거: 원본이 새 쓰기 route를 더해도 `checkActiveSession`을 부르면 자동으로 막히고, route 목록을 업스트림마다 다시 맞출 필요가 없다. 계정 가져오기 상태(H12)는 marker 영속·전용 code·예외 route가 있어 공용 flag로 바꾸지 않고, reset gate는 별도 flag로 둔다. reset 경로끼리의 경쟁은 원본 `importInProgress`를 그대로 쓰고 snapshot restore와 `/api/remove`의 DB 삭제를 같은 배제에 넣는다(H11). 검수 뒤 보강(H20, H21): ① 순서는 계정 가져오기 검사(원본 그대로) → reset gate다. reset을 시작하는 route(backup import·prepare, server restore, save-folder execute·upload, snapshot restore, DB 삭제)는 reset gate를 건너뛰고 `importInProgress`에서 409를 받는다. 계정 적용은 원본처럼 route가 곧바로 응답하고 적용 안에서 `importInProgress`를 확인해 `ACCOUNT_IMPORT_BUSY`를 상태 조회로 알린다(`server.cjs:5749-5752`, `risu-account-import.cjs:837-885`). 원본 응답을 바꾸지 않기 위해 동기 409로 바꾸지 않는다. 계정 가져오기가 진행 중이면 계정 gate가 먼저 423을 준다. `allowDuringAccountImport`는 계정 gate만 건너뛴다. `/api/db/flush`는 원본처럼 계정 gate를 쓰지 않고 reset gate만 단다. ② 입구 검사만으로는 queue에서 기다리던 쓰기와 이미 걸린 debounce timer를 막지 못하므로, 입구에서 reset generation을 기록하고 queue 안 실행 시점과 debounce 저장(cold-store 재시도 포함) 시점에 다시 확인한다. reset은 교체 전에 timer를 지우고 실행 중인 저장을 기다린다(pack의 admission generation과 같은 보장). ③ 막는 범위는 pack 1.10과 같다. reset이 바꾸는 저장소(DB, 채팅 store, journal, asset·inlay, plugin storage, snapshot·backup)의 쓰기이고, `/api/logs`·request-logs·model-jobs·`/api/set_password`는 pack처럼 범위 밖이다. inlay compress는 pack과 lazy adapter처럼 실행 시점까지 확인한다. `/api/remove`의 inlay 삭제는 pack 0.5.19처럼 입구 검사만 하며, 이 한계를 문서에 남긴다 |
| storage epoch (6527449) | 없음 | 유지, BG 계약 |
| reset 뒤 이전 세션 무효화 (bd85ccd) | `revokeAll`은 계정 가져오기에서만 | 유지. session-lock unit 5개는 1.16.1의 `revokeAll`·fresh/passive/tookOver 의미를 보존하도록 다시 쓴다 |
| writer session header helper (4f9436d) | 일반 쓰기는 원본이 처리(`nodeStorage.ts:525-539`) | 원본 사용. BG가 쓰는 helper는 원본 함수를 감싸는 얇은 module로 유지(BG 계약) |
| reset 시 recovery row 정리·run 취소 (7760965) | 해당 없음(BG) | BG 계약(hook만 제공) |
| fmIndex를 새·가져온 채팅에 (502dd28) | 서버 기본 채팅에 fmIndex 없음(`:6194-6195`) | 유지 |
| patch baseline과 hash cache 단일 상태 (2bda466) | 실측(원본 `RisuSavePatcher`의 `set()` 결과 hash와 patch를 적용한 서버 쪽 `calculateHash` 비교): `botPresets`·`modules`가 없다가 생기는 경우와 `chaId` 없는 캐릭터는 일치했다. 중복 `chaId`와 root key 이름과 같은 `chaId`는 어긋났다. 값이 `undefined`인 root key는 1 차이로 어긋났지만, 실제 서버 DB에 `undefined` key가 남는지는 확인하지 않았다. 원본은 불일치 보고(`describeHashMismatch`, `duplicateCharIds`, `risuSave.ts:996-1044`)를 갖는다 | 원본 사용(E2-3a 결정, H13). 불일치 뒤 원본은 rebase 재시도 또는 현재 DB 전체 쓰기로 사용자 변경을 보존하고, 반복 충돌은 알림과 대기열 유지로 끝나 저장이 조용히 멈추지 않는다. 한계: 불일치가 계속되면 baseline 재조정(5분 간격) 사이의 저장이 전체 업로드가 된다. 이는 전송량 문제이고 데이터 손실이 아니므로 pack 수정을 다시 얹지 않는다 |
| 새 설치 첫 채팅 저장 (a96becc) | 원본 patcher가 `characters`가 없으면 `[]`로 정규화한다(`risuSave.ts:1047-1051`, `globalApi.svelte.ts:735`). 첫 채팅 POST에는 404·존재 검사가 없다(`server.cjs:6418-6464`) | 원본 사용. 단 E2-3d의 분류기가 원본 시작 경로의 기준 DB(`{}`, H23)를 받으므로, 분류 전에 `characters`를 `[]`로 정규화한 기준을 쓴다. E2-3d 테스트는 실제 bootstrap → 기준 DB → 첫 저장 순서로 확인한다 |
| 편집 보존 중 답변 복구 (a646988) | 해당 없음. 고친 파일이 BG만 쓰는 `serverChatCommit.cjs`다 | BG 계약 |
| dirty API, streaming checkpoint, 저장 재시도·지연 복구, 3-way rebase | 원본에 dirty API 없음(grep 0), rebase는 `rebaseMerge.ts`. 다른 pack 사용처: `requestImportedCharacterSave`·`requestImportedModuleSave`는 `character-import-ux`, `ChatConflictError`·`ManualSaveConflictError`·`markChatDirtyImpl`·`readServerChatSnapshot`·`confirmCurrentSnapshotOnServer`는 `lazy-chat-bg-adapter`. `requestChatSave`·`markChatDirty`·`markCharacterDirty`는 pack 안에서만 쓴다 | 다른 pack이 쓰는 export는 계약으로 유지. pack 안에서만 쓰는 세 함수는 원본 사용(E2-3a 결정, H14): 화면 채팅·선택 캐릭터는 원본 자동 추적, 그 밖은 `trackChatForSave`·`trackCharacterForSave`와 `requestImmediateSave`, plugin 쓰기는 원본 v3 경로가 맡는다. 검수 뒤 보강(H22): 원본 v3의 열려 있지 않은 채팅 쓰기는 캐릭터를 추적하지 않아, plugin이 바꾼 채팅 이름·폴더·modules가 다음 DB 저장에서 stub 값으로 되돌아간다. pack이 고친 보호이므로 E2-3d에서 그 경로에 원본 `trackCharacterForSave`를 더하는 작은 unit을 둔다 |
| startup DB cache (ETag, 304) | 서버는 304를 지원하지만(`server.cjs:4265-4268`) 원본 클라이언트는 validator를 보내지 않고 `database.bin`의 로컬 사본도 없어, 시작할 때마다 전체를 받는다(`bootstrap.ts:61`, `nodeStorage.ts:620-631`) | 유지(독립 module `startupDatabaseCache.ts`와 bootstrap·nodeStorage의 작은 unit) |
| plugin 로드를 placeholder 변환 뒤로 (906d4c6) | 원본은 `loadPlugins()`(`bootstrap.ts:131`)와 `await` 두 번 뒤에 stub을 변환한다(`:145-151`). 그 사이 `getChatFromIndex`는 `_placeholder`가 없는 stub을 그대로 돌려주고(`v3.svelte.ts:990`), `setChatToIndex`의 보호(`:1041`)도 통과해 plugin이 빈 채팅을 되쓸 수 있다 | 유지(bootstrap 순서 unit) |
| plugin API v3 재작성(`pluginChatAccess`) | 원본이 1.14·1.16에서 async·placeholder 보호·plugin 목록 보호를 넣음 | 원본 사용을 기본으로 하고, 빠진 보장만 E2-7(R3)에서 정한다 |

## 4. 단위

단위는 서버와 클라이언트로 나누지 않고 규약 단위로 나눈다. 채팅 revision처럼 서버가 요구하고 클라이언트가 보내야 하는 규약을 한쪽만 넣으면, 그 commit의 조립 트리에서 원본 클라이언트가 428·409를 받아 저장이 깨진다.

| ID | 제목 |
|---|---|
| E2-3a | Confirm the open lazy-chat-sync items on 1.16.1 |
| E2-3b | Rebuild server chat-write durability over native 1.16.1 |
| E2-3c | Rebuild the storage reset barrier over native 1.16.1 |
| E2-3d | Rebuild the chat revision protocol over native 1.16.1 |
| E2-3e | Rebuild client startup safety over native 1.16.1 |

- E2-3a(완료, 문서만): §3의 「확인 필요」 항목을 코드 읽기로 정했다(H10-H14).
- E2-3b(서버만): 채팅 쓰기 journal(200 응답 전 내구 기록, DB 저장 뒤 정리, 재시작 복구), 전체 POST 검증(id 불일치, 배열 아닌 `message`), 서버가 만드는 기본 채팅의 fmIndex. journal이 생기는 commit부터 원본 reset 경로(backup import, server restore, save-folder, snapshot restore, 계정 적용, DB 삭제)가 DB를 바꿀 때 journal을 같은 transaction에서 지우고 commit 뒤 메모리를 비운다(H19). 이것이 없으면 reset 뒤 재시작에서 reset 전 채팅이 되살아난다. 전체 barrier는 E2-3c다. stripped DB 불변식은 채팅 id 복구와 함께 E2-3d로 옮긴다(H18: 저장된 DB의 id는 원본이 읽을 때 고치지만, 세션 중 새로 만든 id 없는 채팅은 클라이언트 복구 없이 불변식에 걸려 그 뒤의 저장이 모두 거부된다). `chatWriteJournal.cjs`·`serverChatCommit.cjs`는 owned로 두고 id를 유지한다(BG 계약). 원본 delta header, delta 409, `recordChatPost`, asset manifest hydrate는 보존한다.
- E2-3c(서버만): reset barrier(§3 결정 구조와 검수 뒤 보강 ①-③: gate 순서, 실행 시점 generation 확인, timer 정리와 실행 중 저장 대기), 모든 reset 경로의 단일 transaction 교체(COMMIT 전 실패는 이전 상태 그대로, inlay 교체 뒤의 COMMIT 실패와 그 inlay 되돌리기 실패는 복구 필요 상태로 알림(c4b, 1.10과 같이 inlay 교체를 COMMIT 앞에 둔다)), storage epoch, reset 뒤 `invalidateBefore`, pending-save 인계, BG run 취소 hook. 원본 `importInProgress`, 계정 가져오기 gate, `restoringSnapshotKey`, `pluginStorage.restoreFrom`, `createBackupAndRotate`는 보존한다. `session-lock.cjs` unit 5개는 1.16.1의 `revokeAll`·fresh/passive/tookOver 의미 위에 다시 쓴다. snapshot core에서 옮긴 compat 테스트 `storage-reset-b1a`와 B2·B3의 reset 부분을 여기서 다시 넣는다.
- E2-3d(서버와 클라이언트): chat-content GET·POST의 revision과 create-only, payload 없는 stub의 `CHAT_PAYLOAD_MISSING`과 그 안내(`chat-missing-payload-notice`), 클라이언트의 create·update 분류, 채팅 id 복구, stale view rebase(보이지 않은 답변 보존), payload 먼저·metadata 나중과 recovery slot, 다른 pack이 쓰는 저장 export(§3), stripped DB 불변식(`/api/write`·`/api/patch`, H18의 전이 규칙, 서버가 stub으로 바꾼 뒤 검사), plugin의 열려 있지 않은 채팅 쓰기의 캐릭터 추적(H22). revision은 원본 transport 두 개(H22)에 넣어 autosave·plugin·복구 job·trigger 경로가 모두 같은 규약을 쓰게 하고, 전체 fetch 경로도 revision을 받는다. delta POST도 base revision을 보내고 서버가 확인한다(prefix만 맞는 오래된 delta가 서버에만 있는 뒷부분을 지우지 않게). 불변식은 중복 `chaId`를 pack 0.5.19처럼 거부한다. 저장된 DB의 중복은 원본 decode가 먼저 고치므로(H18), 이 거부는 세션 중 새로 생긴 중복에만 걸리고, 그 경우 원본 hash 불일치 처리(§3 2bda466 행)보다 먼저 걸린다. live DB가 이 검사를 통과하는지는 E2-9 rehearsal에서 확인한다.
- E2-3e(클라이언트만): startup DB cache, plugin 로드를 stub 변환 뒤로, `writerSession` helper(원본 header 처리를 감싸는 얇은 module, BG 계약).
- 각 단위는 공통 계약(1.16.1만 선언, coverage, per-commit 검사)을 따른다. `lazy-chat-sync`는 E2-3 동안 단위마다 coverage `retained`·`replaced`·`retired`·`added`·`rewritten`을 갱신한다. E2-3b가 처음으로 `reviewing: ['1.16.1']`을 선언하고, 그 단위에서 아직 다시 얹지 않은 기능의 통째 교체 unit은 `retired`(이유: 해당 단위 ID)로 둔다. 1.16.1 조립 트리에서 통째 교체 unit은 처음부터 고르지 않는다.
- 통째 교체 unit을 `requires`하는 `lazy-chat-bg-adapter`(H15)는 E2-7까지 1.16.1에서 조립되지 않으므로 E2-3이 그 id를 지켜야 할 이유가 없다. owned module id와 `chat-missing-payload-notice` id는 유지한다.
- 이미 rebase한 pack(E2-1c 6개, fence, snapshot core)의 unit과 새 `lazy-chat-sync` unit이 같은 글귀에 붙어 compose가 순서를 요구하면, 순서는 `lazy-chat-sync` unit의 `before`·`after`로 정한다. rebase한 pack을 고쳐야 하면 그 pack의 coverage `rewritten`에 이유를 적고 같은 commit에 넣는다.
- BG adapter 34개 unit의 재작성은 E2-7이다. E2-3은 그 unit들이 붙을 symbol과 hook을 계약으로 문서화한다(§5).

## 5. BG와 다른 pack에 제공할 계약

- symbol: `serverChatCommit`(input·commit owner), `chatWriteJournal`(prefix, `resetMemory`, 복구), storage epoch(`internal/storage-epoch/v1`), `writerSession` helper, `sessionLock.invalidateBefore`, reset 시 BG run 취소 hook, `storageResetActive`·`storageResetGeneration`·`importInProgress`(snapshot lazy adapter의 `fragments/server-helpers.cjs.txt:111,125`, `server-backup-snapshot-core/adapter-manifest.cjs:144-149`), BG 초기화가 쓰는 `decodeDatabaseWithPersistentChatIds`(원본에도 있음, `server.cjs:552`)·`cacheStrippedDatabase`·`scheduleChatStorePersist`·`readStorageEpoch`·`chatRevision`과 canonical store·queue 접근(H23). BG adapter의 클라이언트 unit이 쓰는 `markChatDirtyImpl`, `readServerChatSnapshot`, `confirmCurrentSnapshotOnServer`, `ChatConflictError`, `ManualSaveConflictError`(§3 dirty API 행, d12와 같은 목록).
- 이름만이 아니라 동작을 계약으로 둔다: reset hook의 호출 순서(교체 transaction 안의 durable 복구 행 삭제, commit 뒤 메모리 공개), 이전 epoch commit 거부, generation 비교의 의미. E2-7은 이 동작에 붙는다.
- unit id: H8의 `requires` 대상 id는 바꾸지 않는다. 바꿔야 하면 사용처 pack의 rebase 단위에서 함께 고친다.

### 5b. 테스트 인터페이스 (blind 테스트가 고정함)

- 시험용 hook은 pack의 owned module `server/node/storageResetTestHooks.cjs`의 환경 변수 규약을 그대로 쓴다(`files-1.10/server/node/storageResetTestHooks.cjs`). 모든 hook은 `NODE_ENV=test`이고 해당 변수가 있을 때만 동작한다. 이 module은 처음 필요한 단위(E2-3b)에서 들어온다.
  - gate 파일 규약: 디렉터리에 `<kind>.hold`가 있으면 그 지점에서 `<kind>.entered`를 쓰고, `<kind>.release`가 생기거나 hold 파일이 지워질 때까지 기다린다.
  - `POCKETRISU_TEST_STORAGE_PERSIST_GATE_DIR`(새로 더함, E2-3b): kind `db-persist`. debounce된 DB 저장이 저장할 DB와 채팅 상태를 읽은 뒤, 디스크에 쓰기 전에 멈춘다(b2, c7).
  - `POCKETRISU_TEST_STORAGE_ADMISSION_GATE_DIR`(E2-3c): 쓰기가 입구를 통과해 reset generation을 기록한 뒤, 실행 전에 멈춘다. kind는 pack 1.10의 route 종류 이름이다: `chat-content-delta`, `chat-content`, `patch`, `write`, `remove`, `assets-bulk-write`, `db-flush`, `db-purge-orphans`, `db-optimize`, `db-wal-checkpoint`, `db-snapshot-delete`, `backup-delete`, `inlays-compress`(pack `files-1.10/server/node/server.cjs:1095-1118`).
  - `POCKETRISU_TEST_STORAGE_RESET_GATE_DIR`(E2-3c): reset이 진행 중 상태가 된 뒤 교체 전에 `<kind>.apply`에서 멈춘다. reset kind는 `backup-import`, `server-restore`, `save-folder-execute`, `save-folder-upload`, `snapshot-restore`, `database-remove`다.
  - `POCKETRISU_TEST_STORAGE_RESET_FAILPOINT`(E2-3c): `after-storage-epoch-write`, `after-destructive-deletes`, `entry:<n>`, `second-inlay-rename`, `commit-after-inlay-swap`, `reverse-inlay-rename`(c4a는 COMMIT 전 지점. c4b는 `reverse-inlay-rename`이며, 이 값은 `commit-after-inlay-swap`도 실패시켜 되돌리기 경로를 돌린다. pack `files-1.10/server/node/storageResetTestHooks.cjs:47-55`, 응답은 `server.cjs:175-183`, `:1129-1136`, `:3062-3078`). `POCKETRISU_TEST_STORAGE_RESET_TRACE_FILE`은 `begin`·`commit`·`rollback`·`cancel-persistence-timers` 사건을 JSON 줄로 남긴다.
- 서버 동작 테스트는 1.16.1 원본의 compat helper(`test/compat/helpers/spawnServer.ts`)로 서버 process를 띄우고 HTTP로 시험한다. 강제 종료·같은 저장 폴더로 재시작이 필요한 행(b1, b5, u3)은 `spawnServer`와 같은 방식(임시 cwd의 `save/`, `NODE_ENV=test`, `server.cjs` 직접 실행)으로 child를 띄우고 그 child와 폴더를 돌려주는 test helper(`*.e2-3.helper.ts`)를 쓴다(원본 helper는 child를 노출하지 않고 cleanup이 폴더를 지운다, `spawnServer.ts:102-116`). 계정 가져오기 진행 상태(c3b, c8, c8b, u4)는 원본 compat helper `test/compat/helpers/fakeRisuAccount.ts`와 `POCKETRISU_RISU_ACCOUNT_URL`로 만든다(원본 `risu-account-import.test.ts:24-60`). 새 테스트 파일은 `patches/lazy-chat-sync/files-1.16/` 아래 `*.e2-3.test.ts`로 두고, 해당 단위에서 owned unit으로 등록한다.
- 클라이언트 테스트는 H6의 pack module(현재 `files/`·`files-1.10/`의 export 이름과 호출 형태)과 원본 저장 함수(`saveChatToServer`, plugin API v3)를 쓴다. 구현 전 조립 트리에는 그 module이 없으므로, 아직 없는 symbol은 동적으로 불러와 존재를 첫 assertion으로 확인한다(import 오류가 아니라 assertion 실패가 되도록).
- 공용 node 테스트(C0)는 `lazy-chat-sync`의 버전이 기준선과 major·minor가 같고 patch가 더 큰지만 확인한다.

## 6. 바뀌면 안 되는 것

- 원본 1.16.1의 lazy 로딩, delta 전송과 409 fallback, asset manifest, plugin storage route, archive route, 계정 가져오기와 그 gate, `recordChatPost`, `restoringSnapshotKey`, `createBackupAndRotate`, plugin 목록 쓰기 보호, `/api/write`의 ETag 계산.
- 아직 rebase하지 않은 pack(기준선과 같음).
- 일반 installer는 `reviewing`만 선언된 target을 거부한다.

## 7. 수용 기준과 테스트 계약

공통(모든 단위): C0 `lazy-chat-sync`가 `targets.pocketrisu = {verified: [], reviewing: ['1.16.1']}`을 선언하고 coverage 검사가 위반 0이다. C1 per-commit 검사(저장소 테스트, dist 두 번 빌드 동일, mode 755, `node --check`)와 subset harness 두 번이 통과한다: `lazy-chat-sync` closure, 그리고 그때까지 rebase한 pack 전부와 `lazy-chat-sync`를 함께 고른 묶음(closure는 의존만 따라가므로 순서·anchor 충돌은 묶음에서만 드러난다). C2 rebase하지 않은 pack의 unit hash가 기준선과 같다. 단위별 기준은 아래 표의 행이다.

E2-3b 구현에서 정한 적용 범위(근거: 구현 보고와 orchestrator 확인, 2026-10-27):

- C1 묶음은 `autoWhen` closure 전체가 1.16.1을 선언하는 pack만 묶는다. `client-build-fence`·`server-backup-snapshot-core`는 `lazy-chat-sync`와 함께 고르면 `autoWhen`으로 1.10만 선언한 `client-build-fence-lazy-session-adapter`·`server-backup-snapshot-lazy-adapter`가 끌려와 closure가 `TARGET_NOT_DECLARED`로 멈춘다. 이 둘은 E2-6에서 adapter를 rebase한 뒤 묶음에 넣는다. 그때까지 묶음은 `lazy-chat-sync`와 E2-1c pack 6개다.
- C2의 예외는 `lazy-chat-bg-adapter` 하나다. 이 pack의 unit builder는 `after`를 `lazy-chat-sync` manifest의 현재 unit에서 계산하므로(`plugin-host-units.cjs:7-10` 등), `lazy-chat-sync`의 1.10 통째 교체 unit을 빼면 파일은 그대로여도 unit hash와 declaration hash가 바뀐다. 이 pack은 1.10만 선언하고 `lazy-chat-sync`(이제 1.16.1만 선언)를 요구하므로 어느 target에서도 조립되지 않는다. 기준선 test는 이 pack에 대해 unit id 목록과 version만 확인하고, hash 비교 예외에 이유를 적는다. 예외는 E2-7에서 이 pack을 rebase할 때 없앤다.
- `lazy-chat-sync`의 1.10 선언을 확인하는 기존 저장소 test(`test/lazy-chat-sync.test.cjs`, `test/bg-independent-g1.test.cjs`의 해당 assertion)는 이전 rebase commit(`d0e32d7`, `52dd656`, `b5bb209`)처럼 같은 단위에서 1.16.1 상태로 고친다. blind test는 고치지 않는다. 각 행의 테스트는 1.16.1 원본 위에 조립한 트리에서 돈다.

### E2-3b

| # | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|
| b1 | 채팅 전체 POST가 200을 받은 직후 process가 죽음(5초 debounce 전) | 채팅 있음 | 재시작 뒤 GET이 그 POST의 내용을 준다 | DB metadata 쪽 최신성 |
| b2 | 같은 채팅에 POST A, DB 저장이 A를 읽은 뒤 끝나기 전에 POST B(정해진 끼어들기 지점, test hook) | journal 항목 있음 | 저장이 끝나면 A는 journal에서 사라지고 B는 남는다. 재시작 뒤 GET은 B를 준다 | journal 파일 형식 |
| b3 | `x-chat-id`와 body의 id가 다른 전체 POST | 채팅 있음 | 409, 디스크·journal·메모리 그대로 | delta POST |
| b4 | `message`가 배열이 아닌 전체 POST | 채팅 있음 | 400, 디스크·journal·메모리 그대로 | - |
| b5 | 원본 reset 경로(backup import, server restore, save-folder execute, snapshot restore, 계정 적용, DB 삭제) 하나가 성공 | 그 채팅의 journal 항목이 남아 있음(DB 저장 전, metadata 대기 포함) | reset 뒤 재시작해도 GET은 reset 결과를 주고 reset 전 내용이 되살아나지 않는다 | reset 중 쓰기 차단(E2-3c) |
| b7 | 서버가 만드는 기본 채팅(새 캐릭터 등) | - | `fmIndex`가 있다 | 클라이언트가 만드는 채팅 |
| b8 | 원본 delta POST(맞는 prefix 지문)·틀린 지문 | 채팅 있음 | 맞으면 200 splice, 틀리면 409 `CHAT_DELTA_BASE_MISMATCH`(원본과 같음) | - |

### E2-3c

| # | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|
| c1 | reset 진행 중 `/api/write`·`/api/patch`·채팅 POST·`/api/assets/bulk-write`·`/api/db/flush`·`/api/remove`(일반 key)·purge-orphans·optimize·wal-checkpoint·snapshot 삭제·backup 삭제·inlay compress | backup import, server restore, save-folder execute·upload, snapshot restore, DB 삭제 중 하나가 진행 중이고 계정 가져오기는 진행 중이 아님 | 503 `STORAGE_RESET_IN_PROGRESS`, `retryable: true`, 저장소 변화 없음 | 읽기 route, `/api/logs`·request-logs·model-jobs·`/api/set_password`(§3 범위 밖), 계정 가져오기 중(c8) |
| c2 | reset 시작 전에 입구를 통과해 queue에서 기다리던 쓰기(정해진 끼어들기 지점) | 그 뒤 reset 시작, 실행 시점에 reset 진행 중 또는 이미 끝남 | 두 경우 모두 그 쓰기는 reset 결과 위에 반영되지 않고 503을 받는다 | - |
| c3 | reset 진행 중 다른 reset 요청(backup import·prepare, server restore, save-folder execute·upload, snapshot restore, DB 삭제 각각) | 계정 가져오기가 아닌 reset 진행 중 | 409, 진행 중 reset은 계속된다 | 계정 가져오기 중(c8) |
| c3b | reset 진행 중 계정 적용 시작 | 계정 가져오기가 아닌 reset 진행 중 | 원본처럼 route는 곧바로 응답하고(적용은 비동기), 적용은 `ACCOUNT_IMPORT_BUSY`로 실패해 상태 조회의 오류로 드러나며 데이터는 바뀌지 않는다. 진행 중 reset은 계속된다 | 계정 적용 응답을 동기 409로 바꾸는 것(원본 응답 보존, u4) |
| c4a | reset이 COMMIT 전에 실패 | 기존 DB·plugin storage·asset·journal 있음 | 이전 상태 그대로, 다음 쓰기는 정상 | - |
| c4b | reset이 inlay 교체 뒤 COMMIT에서 실패하고, inlay 되돌리기도 실패(failpoint `reverse-inlay-rename`) | 같음 | DB는 이전 상태(ROLLBACK)이고, reset 응답은 503 `STORAGE_RECOVERY_REQUIRED`(`retryable: false`, `recoveryPath`)다. 그 뒤 저장소 쓰기와 다른 reset도 재시작 전까지 같은 503을 받는다. 조용히 성공으로 끝나지 않는다 | inlay 수동 복구 경로, 재시작 뒤 동작 |
| c5 | reset 성공 | 이전 세션의 writer session | 이전 세션의 쓰기는 423, 새 세션은 원본 규칙(fresh·passive·tookOver)대로 잠금을 얻는다 | 계정 가져오기의 `revokeAll` 동작(원본 그대로) |
| c6 | reset 성공 | storage epoch 값 | epoch가 바뀌고, 이전 epoch로 부른 `serverChatCommit` commit이 거부되어 저장소가 그대로다 | BG run 자체 |
| c7 | reset 시작 시점에 debounce timer가 걸린 DB·채팅 저장, 그리고 이미 실행 중인 저장(정해진 끼어들기 지점) | pending 있음 | timer는 지워지고 실행 중 저장은 끝난 뒤 reset이 교체한다. reset 결과는 덮이지 않는다 | - |
| c8 | 계정 가져오기 진행 중 `checkActiveSession`을 예외 없이 부르는 쓰기 / 예외 route / `/api/db/flush` | 계정 가져오기 시작됨 | 첫째는 원본과 같이 423 `ACCOUNT_IMPORT_ACTIVE`, 예외 route와 flush는 원본과 같은 응답 | - |
| c8b | 계정 가져오기와 reset gate가 함께 켜진 상태에서 `checkActiveSession`을 예외 없이 부르는 쓰기 | 둘 다 진행 중으로 설정 | 423 `ACCOUNT_IMPORT_ACTIVE`(계정 검사가 먼저) | 예외 route와 `/api/db/flush`(계정 gate를 지나 reset gate의 503) |
| c9 | snapshot core에서 뺀 compat `storage-reset-b1a`, B2·B3 중 이 pack과 fence(이미 rebase됨)만으로 도는 reset 부분. 파일을 전제 pack별로 나눠 다시 넣는다 | - | 통과 | capture·reset 배제(E2-6), BG 취소·정리와 B2·B3의 BG 부분(E2-7) |

E2-3c 구현 착수 때 정한 사항(근거: 구현자 사전 조사와 orchestrator 확인, 2026-10-27):

- 단일 transaction: 원본 구조를 유지한다. 원본 `importBackupFromSource`는 요청 본문을 BEGIN 안에서 읽으며 5,000개마다 commit한다(1.16.1 `server.cjs:3035`, `:3159-3163`). 중간 commit을 없애 reset마다 transaction 하나로 만들고, reset 상태와 generation은 reset 시작 때 잡으며, save-folder upload는 본문을 읽기 전에 reset을 시작한다. 1.10의 본문 임시 파일(spool)과 prepare/apply 분리는 옮기지 않는다(원본 import 함수를 통째로 바꾸는 것에 가깝다). 따라서 그 구조를 시험하는 b1a 사례(BEGIN-COMMIT 사이 비동기 양보 없음, spool 자원 실패, metrics, upload spool 순서)는 c9에 넣지 않는다. 한계: 원본처럼 BEGIN 안에서 await가 있으므로, barrier 밖의 쓰기가 같은 SQLite 연결에서 그 사이에 실행되면 같은 transaction에 들어간다(원본과 같은 성질, 미측정).
- inlay 교체: c4b대로 COMMIT 앞에 둔다. 되돌리기가 실패하면 inlay backup을 지우지 않는다(복구 경로).
- 계정 가져오기의 예외 route 4개(prepare·download·cancel·apply)는 reset gate도 건너뛴다(u4 원본 응답). 계정 적용은 원본 `importInProgress`가 막아 `ACCOUNT_IMPORT_BUSY`가 된다(c3b).
- 입구 gate의 멈춤 지점: `checkActiveSession`은 동기이므로 admission gate는 요청이 `queueStorageOperation`에 들어가는 자리에서 멈추고, 실행 때 generation을 다시 확인한다. queue를 거치지 않는 route(`remove`, `backup-delete`)는 입구 검사만 한다.
- session lock: `invalidateBefore(t)` unit 하나를 1.16.1의 `revokeAll` 의미 위에 다시 쓰고(`rewritten`), 나머지 1.10 unit 4개는 `retired`로 둔다.
- c9: `lazy-chat-sync`만으로 도는 사례만 넣는다(`client-build-fence`와 함께 조립하는 것은 E2-6 뒤). revision CAS는 E2-3d, BG는 E2-7, backup export·backup source gate는 E2-6이다.
- 계정 적용도 reset이므로(b5) 적용 중에는 reset 상태가 켜지고 `/api/db/flush`는 503 `STORAGE_RESET_IN_PROGRESS`(재시도 가능)를 받는다. 다운로드 단계의 flush는 c8대로 원본과 같다.
- pack version은 E2-3 단위 동안 0.5.20을 유지한다. 1.16.1은 `reviewing`이라 단위 사이의 설치본이 없고, version은 저장소 테스트 두 곳이 고정한다. patcher release version은 단위마다 올린다.
- 고정 테스트 결함(테스트 작성자가 구현 없는 트리에서 고친다): c7은 원본 `/api/write`가 DB를 바로 쓰고 debounce timer를 지우므로(`server.cjs:4664-4680`) `db-persist` gate에 닿지 않는다. debounce를 거는 쓰기(`/api/patch` 또는 채팅 POST)로 바꾼다. c6의 둘째 테스트는 `owners: []`로 보내 epoch 검사 전에 요청 형식 오류로 거부된다(`serverChatCommit.cjs:511-513`). 형식이 맞는 요청으로 바꾼다. 구현 뒤 확인에서 세 건이 더 나왔다. c1과 c4a의 `/api/db/flush`가 세션 쿠키 없이 보내져 원본 `sessionAuthMiddleware`의 401을 받는다(compat의 flush는 실제 세션 쿠키가 필요하다). c4a는 실패한 reset 응답에 `ok: false`를 기대하지만 원본 실패 응답은 `{error}`이고 계약(c4a)은 응답 모양을 정하지 않는다. c4b는 `/api/read` 결과를 `/api/write`로 쓴 전체 DB와 byte 단위로 비교하지만 원본 `/api/read`는 stub으로 줄인 DB를 돌려주므로 reset 없이도 같지 않다(구현자 측정 439 vs 569 byte). 비교 기준을 실패 전의 `/api/read` 결과로 바꾼다.

### E2-3d

| # | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|
| d1 | chat-content GET | 채팅 있음 | `x-chat-revision` header, 같은 값의 `If-None-Match`면 304 | - |
| d2 | 전체 POST, base revision 없음, `If-None-Match` 없음 | 채팅 있음 | 428, 저장 안 됨 | - |
| d3 | 전체 POST, 다른 base revision | 채팅 있음 | 409와 `currentRevision`, 저장 안 됨 | - |
| d4 | 전체 POST, `If-None-Match: *`(base revision 유무와 무관) | 채팅 있음 / 없음 | 있으면 412(428보다 먼저), 없으면 만들고 200 | - |
| d5 | payload 없는 stub의 GET | DB에 stub만 있음 | 404 `CHAT_PAYLOAD_MISSING`, 클라이언트는 안내를 보이고 빈 채팅을 저장하지 않는다 | 안내 문구 |
| d6 | 두 기기가 같은 채팅을 고침, 늦은 쪽이 오래된 view에서 저장 | 서버에 상대 답변 있음 | 늦은 쪽 저장 뒤에도 상대 답변이 남는다 | 같은 메시지 동시 편집의 병합 결과 |
| d7 | id 없는 채팅, 같은 캐릭터 안 id 중복 채팅 | 새 캐릭터 | 저장 전에 고유 id가 붙고 서로 덮지 않는다 | - |
| d8 | 새 채팅 저장 | 서버에 그 id 없음 | create로 분류되어 create-only로 저장, 실패 시 metadata를 먼저 저장하지 않는다 | - |
| d9 | 채팅 payload 저장 실패 후 DB 저장 | payload 실패 | metadata가 payload 없는 채팅을 가리키지 않는다(recovery slot 1개) | - |
| d10 | 원본 delta 전송 | 채팅 있음 | 원본처럼 prefix delta를 쓰고 409면 전체 전송한다. delta와 전체 전송 모두 base revision을 함께 보낸다 | - |
| d10b | prefix 지문은 맞지만 base revision이 오래된 delta POST | 서버에만 있는 뒷부분 메시지가 있음 | 409, 서버의 뒷부분이 남는다 | - |
| d11 | 새 설치 첫 채팅 저장, 실제 bootstrap 경로(로컬 DB 없음 → `{}` → 기준 DB) | 빈 DB | create로 분류되어 저장되고 다시 열면 남아 있다 | - |
| d12 | 다른 pack이 쓰는 저장 export(§3) | - | 이름이 유지되고, `ChatConflictError`·`ManualSaveConflictError`는 충돌에서 던져지며, `readServerChatSnapshot`·`confirmCurrentSnapshotOnServer`·`requestImportedCharacterSave`·`requestImportedModuleSave`는 서버 상태를 읽거나 저장을 일으킨다 | 내부 구현 |
| d13 | plugin의 열려 있지 않은 채팅 쓰기, 복구된 model job 저장. 채팅을 얻은 경로마다: 전체 fetch, delta hydration, 이미 메모리에 있던 채팅, plugin이 읽지 않고 바로 쓰기 | 서버에 그 채팅 있음 | 앞의 세 경로는 그 채팅을 얻을 때 받은 revision을 base로 보내 200이고, 그 사이 다른 기기가 바꿨으면 409 뒤 stale view rebase(d6)로 상대 내용이 남는다. 알려진 base가 없는 쓰기는 서버 채팅과 revision을 받아 d6과 같이 rebase한 뒤 저장한다. 어느 경로도 428로 저장이 막히지 않고, 새로 받은 revision으로 오래된 view를 그대로 덮지 않는다 | plugin API 재작성(E2-7) |
| d14 | plugin이 열려 있지 않은 채팅의 이름·폴더·modules를 바꿈 | 선택되지 않은 캐릭터 | 다음 DB 저장 뒤 다시 읽어도 바뀐 값이 남는다 | - |
| d15 | `/api/write`로 DB를 씀. 서버가 받은 DB를 stub으로 바꾼 뒤(H18) 그 결과가: payload 없는 새 채팅을 넣음 / 직전부터 payload 없던 채팅을 그대로 두거나 지움 / payload가 있던 채팅을 stub으로 유지 | stripped DB 저장됨 | 새로 넣음은 422 `DB_INVARIANT_REJECTED`, DB 그대로. 나머지는 200 | 클라이언트 처리 |
| d15b | `/api/patch`의 결과 DB가 H18 규칙을 어김(payload 없는 새 채팅, stub이 아닌 채팅, 빈·중복 id) | stripped DB 저장됨 | 422 `DB_INVARIANT_REJECTED`, DB·patch 기준 그대로 | - |
| d16 | 저장된 DB에 id 없는 채팅·중복 id가 있는 상태에서 서버 시작 뒤 원본 저장 경로로 다른 변경을 저장 | 옛 DB | 원본 decode가 id를 고친 뒤라 저장은 200이고 그 채팅들은 남는다(원본 동작 보존) | - |
| d17 | 원본 클라이언트의 정상 저장(stub 유지, 새 채팅 추가) | 같은 상태 | 200, 원본과 같은 ETag 계산(`/api/write`) | - |

**E2-3d 구현 중 정한 사항 (2026-10-27).** 첫 구현이 d2·d15와 기존 테스트의 충돌로 멈춘 뒤 코드로 확인해 정했다.

- d2(base revision 없는 전체 POST는 428)는 그대로 둔다. 원본 클라이언트의 채팅 쓰기는 원본 transport 두 개를 지나므로(H22) 그 경로는 revision을 보낸다. 1.11-1.16에서 생긴 원본 test(`test/compat/chat-delta-sync`·`chat-store-cold-load`·`character-archive`, `server/node/archiveRestore.test.ts:389`)는 HTTP로 직접 덮어쓰며 revision을 보내지 않는다. 1.10 pack은 이 test들을 만난 적이 없다(1.10.0 트리에 없음). 이 pack이 그 test들을 `rewritten` unit으로 고쳐, 덮어쓰기 전에 GET으로 받은 revision을 보내고 새 채팅은 `If-None-Match: *`를 보낸다. assertion과 기대값은 바꾸지 않는다.
- E2-3b 고정 test(`restart-durability.e2-3.test.ts`의 b1, b5)는 E2-3d 이전 규약으로 작성되어 revision 없이 덮어쓴다. test 작성자가 구현 없는 트리에서 `readChat`이 받은 revision을 보내도록 고친다(사후 보정 규칙).
- d15(payload 없는 새 채팅은 422)는 그대로 둔다. 원본 server test(`duplicateIds`·`archiveBatch`·`archiveRestore`)는 "디스크에 이미 있는 상태"를 만들려고 `seedDb`에서 `/api/write`를 쓴다(`duplicateIds.test.ts:167-169`). 검사 대상은 load 때의 복구라서, 이 pack이 그 helper만 `rewritten` unit으로 고쳐 서버 시작 전에 저장소에 직접 쓴다. assertion은 바꾸지 않는다. 불변식에 "이전 DB가 없는 첫 쓰기" 같은 예외는 두지 않는다.
- `/api/write` 불변식에서 채팅 본문이 있다고 보는 경우: chat store의 본문, 쓰기에 함께 실린 본문(stub이 아닌 채팅), 그 캐릭터의 archive 행. archive 행을 빼면 원본 archive 복원이 막힌다(u3).
- d5 fixture `{_stub:true, message:[]}`는 원본이 본문 있는 빈 채팅으로 다룬다(`server.cjs:669-684` `chatToStub`, `:695-723` `initChatStore`). test 결함이므로 test 작성자가 `message` 없는 stub으로 고친다. 원본 hybrid 처리는 바꾸지 않는다.
- d13의 마지막 경로(plugin이 읽지 않고 바로 쓰기)는 3-way 기준이 없으므로 서버 사본과 revision을 기준으로 받아 plugin이 준 내용을 저장한다(1.10 pack과 같음). plugin API 재작성은 E2-7이다.
- `/api/write` 불변식은 `message` 배열을 실은 stub(원본 hybrid)을 본문 있는 채팅으로 센다. `/api/patch`는 d15b대로 정규 stub이 아닌 채팅을 거부한다.
- 코드 검수 5회차(d8 보강): update로 분류된 저장이 기준 없이 서버를 읽어 404를 받으면 다른 기기가 지운 채팅이므로 create-only로 다시 만들지 않고 충돌로 끝난다(`chatSaveIntent.ts`의 분류 주석과 같음). 분류가 없는 저장의 404는 지금처럼 create-only다. 열린 채팅에 대한 plugin 쓰기는 기준이 같은 revision이어도 새 기준 항목을 설치해, 진행 중이던 자동 저장의 결과가 plugin 내용의 기준을 올리지 않게 하고, 그 기준 항목이 plugin이 쓴 내용 그대로(그 뒤 사용자 편집이 섞이지 않고) rebase 없이 저장되면 쓰기의 표식도 그 결과로 나아간다. 사용자 편집이 섞인 저장으로 표식이 나아가면 plugin의 오래된 view가 그 편집을 충돌 없이 지울 수 있기 때문이다. 저장 불변식 거부(422, 본문 없는 채팅 지목)의 복구 저장은 클라이언트가 가진 본문을 서버에 다시 두는 경로이므로, 그 한 채팅의 그 재시도는 분류와 관계없이 404에서 create-only로 저장한다.
- **미해결 (코드 검수 6회차, 2026-10-27; 사용자 결정으로 현 상태 commit 뒤 다음 세션 첫 일, E2-9 live 전 필수):** ① P1: 앞선 저장이 큐를 잡은 사이 열린 채팅의 자동 저장이 큐에 들어가고, 그 뒤 plugin 쓰기가 채팅 객체를 바꾸고 새 slot 기준을 설치하면, 대기하던 자동 저장이 옛 객체의 내용을 새 기준으로 저장해 그 기준을 올린다. 다음 plugin 내용 저장이 사용자 메시지를 지운다(Codex 재현). 구조 원인: 자동 저장이 내용은 큐에 넣을 때의 객체에서, 기준은 실행 시점에 채팅 id로 slot에서 따로 잡는다(2회차 뿌리 원인과 같은 모양). 방향: slot 기준을 그 채팅 객체에 묶고 자동 저장은 자기 객체의 기준을 잡는다. 착수 전 버그 수정 프로토콜의 구조 보고와 사용자 승인을 거친다. ② P2: 열린 채팅 plugin 쓰기의 쓴 내용 사본(`pluginWrittenEntries`)이 기준 사본 메모리 한도 밖에 있다. 방향: 바이트 대신 hash를 둔다. ③ 422 복구가 대상 채팅을 건너뛰면 다시 만들기 표시가 남아 나중의 기준 없는 update가 404에서 채팅을 만들 수 있다(Codex 추론, 미재현). ①과 함께 표시 수명을 정한다.

**저장 기준 규칙 (2026-10-27, 코드 검수 2회 뒤 구조 수정).** 기준 revision을 채팅 id마다 하나만 기억하고 저장 때 그 키로 찾으면, 오래된 view가 나중에 갱신된 revision을 달고 저장되어 서버의 새 내용을 지운다. 코드 검수가 세 경로를 재현했다: 같은 채팅을 두 번 전체 읽은 뒤 첫 view 저장, 전체 읽기 뒤 delta hydration이 기준을 바꾼 다음 앞 view 저장, 열려 있지 않은 채팅에 대한 plugin 쓰기 두 개가 큐에서 기다리는 사이 앞 저장의 rebase가 기준을 올림. 1.10 pack의 view 표식(`files-1.10/src/ts/storage/nodeStorage.ts:1139`, `:410`)은 DB 교체 때만 바뀌는 토큰이라 이 경로들을 막지 못한다. 원본 1.16.1은 delta 조립·plugin snapshot·복구 job에서 객체를 새로 만들거나 다시 읽으므로(`chatDeltaSync.ts:67`, `v3.svelte.ts:990`, `jobRecovery.ts:209`) 객체 identity도 view를 구분하지 못한다. 규칙:
  - 저장은 보내는 내용과 그 내용의 기준 revision·기준 snapshot을 한 묶음(저장 문맥)으로 들고, 큐 대기·delta에서 전체 전송으로의 전환·재시도 동안 바꾸지 않는다. 채팅 id로 찾은 최신 revision을 쓰지 않는다. 기준은 그 내용이 서버에 반영되었거나 rebase가 확인된 뒤에만 앞으로 간다.
  - 열린 채팅의 자동 저장은 큐 작업이 시작될 때 현재 내용과 그 기준을 함께 잡는다. 열려 있지 않은 채팅의 plugin 쓰기와 복구 job은 큐에 넣기 전에 snapshot과 그 기준을 잡는다.
  - 기준은 받은 내용이 실제로 화면 slot에 설치될 때만 갱신된다. 설치되지 않고 버려진 hydration은 기준을 바꾸지 않는다. export 같은 읽기 전용 읽기는 열린 채팅의 기준을 바꾸지 않는다.
  - rebase 결과를 slot에 반영하는 것은 별도 확인(같은 채팅 id, 그 사이 slot 교체 없음)을 거친다. 기준을 모르거나 잃은 저장은 서버 내용을 그대로 덮지 않고 서버 사본을 받아 rebase하거나 충돌로 끝난다.
  - plugin 경로(코드 검수 3·4회차): plugin은 iframe과 `postMessage`로 채팅을 주고받아(`factory.ts`) 객체가 복제되므로, view에 묶은 기준이 경계를 넘지 못한다. 3회차 뒤의 "채팅마다 가장 이른 읽기 기록 하나" 규칙은 4회차 검수에서 세 경로로 깨졌다: 열린 채팅에 쓰면 기록을 쓰지 않고 slot 기준으로 저장됨, 기록이 개수 한도로 지워지면 "읽지 않고 쓰기"(d13)로 오인되어 덮어씀, 기록의 사본만 지워지면 다시 읽어도 기록이 바뀌지 않아 쓰기가 계속 충돌함. 대체 규칙(2026-10-27 사용자 승인, 버그 수정 프로토콜):
    - `getChatFromIndex`는 넘기는 채팅마다 읽기 표식(그 읽기 하나를 가리키는 불투명 토큰)을 객체의 필드로 실어 보낸다. 표식은 복제와 함께 plugin에서 돌아온다. host는 표식마다 채팅(`chaId`, 채팅 id)과 그 읽기의 기준(revision, 가능하면 snapshot)을 한도 안에서 기억한다.
    - `setChatToIndex`는 저장 전에 표식 필드를 지우고, 표식이 가리키는 기준으로 저장한다. 열린 채팅과 열려 있지 않은 채팅 모두 같다. 열린 채팅은 plugin 내용을 그 기준과 함께 slot에 설치하므로 자동 저장이 slot의 더 새로운 기준을 쓰지 않는다.
    - 표식이 있지만 host가 그 기준을 더는 모르면(한도로 지워짐) 쓰기를 거부하고 다시 읽으라는 오류를 낸다. d13으로 바꾸지 않는다. 기준 snapshot만 없으면 서버가 바뀌지 않은 경우만 저장되고, 바뀌었으면 충돌로 끝난다. 어느 경우든 plugin이 다시 읽으면 새 표식으로 회복된다.
    - 표식이 다른 채팅을 가리키거나 표식이 없으면 d13의 "읽지 않고 쓰기"다.
    - 같은 표식으로 다시 쓰면, 앞 쓰기가 rebase 없이 받아들여진 경우 그 결과를 기준으로 쓰고, rebase된 경우 원래 기준을 그대로 쓴다.
    - 한계: plugin이 표식 필드를 지우거나 채팅을 새 객체로 만들어 쓰면 d13이 된다. 표식은 `setChatToIndex`에서만 지우므로, plugin이 받은 채팅을 다른 API로 저장하면 필드가 남을 수 있다.
  - plugin 경로와 그 밖의 기준 없는 저장은 slot의 기준을 대신 쓰지 않는다. 기준 없는 일반 저장은 서버 사본을 받아 rebase하거나 충돌로 끝난다.
  - 테스트: 위 세 경로, 열린 채팅의 연속 자동 저장(거짓 충돌 없음), 편집과 저장 사이의 export, 버려진 hydration, 복제되어 돌아온 plugin view(그 사이 hydration으로 slot 기준이 바뀜), 열린 채팅에 대한 plugin 쓰기, 기억 한도를 넘긴 뒤의 오래된 plugin view 쓰기, 사본이 지워진 뒤 다시 읽고 쓰기, 저장된 채팅에 표식이 남지 않음. 은퇴한 `chatSaveView.svelte.test.ts`는 slot 반영만 다루므로 이 규칙의 근거가 아니다.

### §6 보존 항목 (해당 기능을 건드리는 단위마다)

| # | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|
| u1 | asset manifest가 있는 캐릭터의 `/api/read`와 채팅 POST | manifest 있음 | 원본과 같이 hydrate되고 manifest가 남는다 | - |
| u2 | plugin storage route 쓰기·읽기, plugin 목록을 줄이는 DB 쓰기 | plugin 있음 | 원본과 같은 응답과 목록 보호 | - |
| u3 | archive 이동·활성화 뒤 DB 저장과 재시작 | archive 캐릭터 있음 | 원본과 같이 archive 상태가 남는다 | - |
| u4 | 계정 가져오기의 예외 route 4개(prepare·download·cancel·apply) | 계정 가져오기 진행 중 | 원본과 같은 응답 | - |
| u5 | DB에 아직 없는 채팅의 POST, metadata가 오기 전에 store 재구성(저장·전체 쓰기·cold load), 그 뒤 metadata 저장 | 그 채팅이 DB 목록에 없음 | 재구성 뒤에도 본문이 남고, metadata 저장 뒤 디스크에 남는다(`recordChatPost`, `server.cjs:725-769`) | TTL 만료 |
| u6 | rotation 한도를 넘기는 snapshot 생성(보호 snapshot 포함), snapshot restore 내부의 flush, 그와 별개로 바깥 `/api/db/flush` | snapshot 여럿 | 보호 snapshot이 남는다. restore 내부 flush는 원본처럼 `restoringSnapshotKey`를 쓰고 reset gate에 막히지 않는다. 바깥 flush는 c1대로 503 | - |
| u7 | 일반 installer apply | `lazy-chat-sync`가 `reviewing`만 선언 | `TARGET_REVIEW_REQUIRED`로 거부 | - |

### E2-3e

| # | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|
| e1 | 두 번째 시작 | 앞 시작에서 받은 DB 사본 | validator를 보내 304면 사본을 쓰고, 200이면 새 DB와 사본을 쓴다 | 사본 저장 위치 |
| e2 | 시작 직후 plugin이 `getChatFromIndex`·`setChatToIndex` 호출 | stub 채팅 | plugin은 stub 변환 뒤에 로드되어 원본 placeholder 보호를 받고, 빈 채팅을 되쓰지 않는다 | plugin API 재작성(E2-7) |
| e3 | `writerSession` helper로 만든 header | - | 원본 일반 쓰기와 같은 writer session header를 준다 | BG 호출부 |

## 8. 다음

E2-3a의 코드 읽기 항목(reset gate 구조, hash 불일치, pack 안 dirty API)은 H10-H14로 정했다. 단위를 규약 단위로 다시 나누고(§4) 수용 기준·테스트 계약 표를 붙였다(§7). 계획 검수 1회차(2026-10-27)의 지적 11건을 코드로 확인해 반영했다: 불변식을 E2-3d로 옮김, journal의 reset 연동을 E2-3b에 둠, gate 순서·실행 시점 확인·범위, revision을 원본 transport 전체와 delta에 적용, plugin 캐릭터 추적, 분류기 기준 정규화, 계약 symbol과 동작, 묶음 subset, 표 보강. 계획이 크게 바뀌었으므로 남은 일은 계획 검수 2회차, 전제 출처 확인(H1·H5·H6), Argon 시나리오, 테스트 작성 순서다.
