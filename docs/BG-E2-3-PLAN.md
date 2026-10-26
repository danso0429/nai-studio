# E2-3 계획 — lazy-chat-sync를 PocketRisu 1.16.1 원본 위 unit으로 재구성

**상태 (2026-10-26 KST):** 초안. 탐색과 이력 대조를 마쳤고, 계획 검수 전이다. 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`의 「Ordered plan」 E2-3 행, R1, Decisions(2026-10-26 E2-3).
**위험 분류:** risky. 채팅 저장, 저장소 reset, import·restore의 원자성, 세션 잠금, BG 연동을 바꾼다.

## 1. 목표

`lazy-chat-sync`가 1.16.1에서 통째 파일 교체를 하지 않고 원본 1.16.1 위에 unit으로 얹힌다. 원본의 lazy 로딩(stub와 열 때 hydrate)과 prefix 지문 delta 전송은 그대로 쓴다. 원본에 없고 pack 이력이 실제 문제를 고친 보장만 다시 얹는다. BG와 snapshot lazy adapter가 기대는 symbol은 계약으로 유지한다.

결정 근거(사용자 선택, 2026-10-26): 통째 교체 사본은 원본의 archive route, asset manifest, 계정 가져오기, chat-post 추적, `restoringSnapshotKey`, plugin 목록 쓰기 보호를 모두 지운다. 업스트림이 바뀔 때마다 이 기능들을 다시 옮겨야 한다.

## 2. 확인한 사실

출처의 「탐색」은 haiku-explorer 보고(로컬 탐색 기록)다. 「확인함」은 orchestrator가 해당 줄을 직접 읽은 것이다.

| # | 사실 | 출처 |
|---|---|---|
| H1 | 원본 1.16.1은 `/api/read`에서 채팅을 stub으로 바꿔 보내고(`server.cjs:818-838`), 클라이언트는 채팅을 열 때 hydrate한다(`chatStorage.ts:162-233`). | 탐색 |
| H2 | 원본 채팅 저장은 `POST /api/chat-content/:chaId/:chatIndex`(`server.cjs:6418`)이고, `fullChatStore`에 쓴 뒤 5초 debounce로 DB를 저장한다. POST마다 timer를 다시 건다(`:78`, `:6466-6470`). | 확인함 |
| H3 | 원본은 앞부분 지문으로 delta를 확인하고 맞지 않으면 409를 준다(`server.cjs:6354-6358`, `:6450-6454`). 채팅 revision은 없다(grep 0). | 확인함 |
| H4 | 원본 backup import는 `importInProgress`로 다른 import만 막는다(`server.cjs:5633-5637`). `checkActiveSession`은 계정 가져오기 중(`risuAccountImport.isBlocking()`)일 때만 모든 쓰기를 423으로 막는다(`:2148-2155`). 일반 쓰기와 채팅 POST는 backup import, server restore, save-folder, snapshot restore, `/api/remove`와 경쟁할 수 있다. | 확인함(`importInProgress` 사용처 전수, `checkActiveSession` 본문) |
| H5 | 원본에는 채팅 쓰기 journal, storage epoch, reset 뒤 세션 무효화(`revokeAll`은 계정 가져오기에서만, `:5769`), create-only 채팅 쓰기, 채팅 id 복구가 없다. | 탐색(grep·코드 경로) |
| H6 | pack 기능 대부분(journal 호출, revision CAS, reset barrier, dirty API, 저장 재시도)은 원본 함수 몸체 안에 섞여 있다. 독립 module은 `chatDelta.cjs`(275줄), `chatWriteJournal.cjs`(443), `storageResetPrepare.cjs`(431), `serverChatCommit.cjs`, `storageResetTestHooks.cjs`, 클라이언트 `writerSession.ts`, `chatSaveIntent.ts`, `chatIdentityRepair.ts`, `chatSaveRebase.ts`, `conflictRebase.ts`, `pluginChatAccess.ts`, `startupDatabaseCache.ts`다. | 탐색 |
| H7 | 다른 pack의 unit은 원본 1.10 글귀에 anchor를 둔다. 예외는 `lazy-chat-bg-adapter` unit 34개로, pack 사본에만 있는 글귀(reset 경로 8, publication·owned-root 쓰기 5, nodeStorage publication 오류 4, globalApi 저장·import 8, 복구 읽기 7, hydration adopt 2)에 붙는다. | 실측(unit anchor 대조 script, patcher `a309b5b`) |
| H8 | 다른 pack이 `requires`하는 `lazy-chat-sync` unit: `lazy-chat-bg-adapter`(chatStorage 교체, `serverChatCommit`, `chatWriteJournal`, server.cjs 교체, `writerSession`), `client-build-fence-lazy-session-adapter`·`personal-settings-lazy-session-adapter`(`writerSession`), `haejeok-persistence-safety-adapter`(`chat-missing-payload-notice`). | 탐색 |
| H9 | snapshot core의 compat 테스트 중 `storage-reset-b1a`, `session-reset-b2`(일부), `reset-orphans-b3`(일부)는 이 pack의 reset 동작을 시험한다(E2-2b F23). | 실측 E2-2b probe |

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
| storage reset barrier·runner, 원자적 backup import·server restore·save-folder·snapshot restore·DB 삭제 (0046677, 84ed00d, ffc6f7d) | 경쟁이 남음(H4) | 유지. 원본의 계정 가져오기 차단 gate(`checkActiveSession`)를 확장하는 구조를 먼저 검토한다 |
| storage epoch (6527449) | 없음 | 유지, BG 계약 |
| reset 뒤 이전 세션 무효화 (bd85ccd) | `revokeAll`은 계정 가져오기에서만 | 유지. session-lock unit 5개는 1.16.1의 `revokeAll`·fresh/passive/tookOver 의미를 보존하도록 다시 쓴다 |
| writer session header helper (4f9436d) | 일반 쓰기는 원본이 처리(`nodeStorage.ts:525-539`) | 원본 사용. BG가 쓰는 helper는 원본 함수를 감싸는 얇은 module로 유지(BG 계약) |
| reset 시 recovery row 정리·run 취소 (7760965) | 해당 없음(BG) | BG 계약(hook만 제공) |
| fmIndex를 새·가져온 채팅에 (502dd28) | 서버 기본 채팅에 fmIndex 없음(`:6194-6195`) | 유지 |
| patch baseline과 hash cache 단일 상태 (2bda466) | hash fold의 미보호 key·공유 namespace가 남음(`risuSave.ts:945,951,1058,1074`) | 확인 필요(C1 재현 조건) |
| 새 설치 첫 채팅 저장 (a96becc) | 원본 patcher가 `characters`가 없으면 `[]`로 정규화한다(`risuSave.ts:1047-1051`, `globalApi.svelte.ts:735`). 첫 채팅 POST에는 404·존재 검사가 없다(`server.cjs:6418-6464`) | 원본 사용. E2-3d 테스트에서 새 설치 첫 채팅 저장을 확인한다 |
| 편집 보존 중 답변 복구 (a646988) | 해당 없음. 고친 파일이 BG만 쓰는 `serverChatCommit.cjs`다 | BG 계약 |
| dirty API, streaming checkpoint, 저장 재시도·지연 복구, 3-way rebase | 원본에 dirty API 없음(grep 0), rebase는 `rebaseMerge.ts`. 다른 pack 사용처: `requestImportedCharacterSave`·`requestImportedModuleSave`는 `character-import-ux`, `ChatConflictError`·`ManualSaveConflictError`·`markChatDirtyImpl`·`readServerChatSnapshot`·`confirmCurrentSnapshotOnServer`는 `lazy-chat-bg-adapter`. `requestChatSave`·`markChatDirty`·`markCharacterDirty`는 pack 안에서만 쓴다 | 다른 pack이 쓰는 export는 계약으로 유지. pack 안에서만 쓰는 것은 E2-3d에서 원본 `changeTracker`로 대체할 수 있는지 정한다 |
| startup DB cache (ETag, 304) | 서버는 304를 지원하지만(`server.cjs:4265-4268`) 원본 클라이언트는 validator를 보내지 않고 `database.bin`의 로컬 사본도 없어, 시작할 때마다 전체를 받는다(`bootstrap.ts:61`, `nodeStorage.ts:620-631`) | 유지(독립 module `startupDatabaseCache.ts`와 bootstrap·nodeStorage의 작은 unit) |
| plugin 로드를 placeholder 변환 뒤로 (906d4c6) | 원본은 `loadPlugins()`(`bootstrap.ts:131`)와 `await` 두 번 뒤에 stub을 변환한다(`:145-151`). 그 사이 `getChatFromIndex`는 `_placeholder`가 없는 stub을 그대로 돌려주고(`v3.svelte.ts:990`), `setChatToIndex`의 보호(`:1041`)도 통과해 plugin이 빈 채팅을 되쓸 수 있다 | 유지(bootstrap 순서 unit) |
| plugin API v3 재작성(`pluginChatAccess`) | 원본이 1.14·1.16에서 async·placeholder 보호·plugin 목록 보호를 넣음 | 원본 사용을 기본으로 하고, 빠진 보장만 E2-7(R3)에서 정한다 |

## 4. 단위(초안)

| ID | 제목 |
|---|---|
| E2-3a | Confirm the open lazy-chat-sync items on 1.16.1 |
| E2-3b | Rebuild server chat-write safety over native 1.16.1 |
| E2-3c | Rebuild the storage reset barrier over native 1.16.1 |
| E2-3d | Rebuild client chat-save safety over native 1.16.1 |

- E2-3a: §3의 「확인 필요」 항목을 실측이나 코드 읽기로 정하고, 이 문서를 고친다(코드 변경 없음).
- E2-3b: 독립 module(`chatDelta.cjs`의 검증, `chatWriteJournal.cjs`, `serverChatCommit.cjs`)을 owned로 두고, 원본 chat-content GET/POST와 DB 저장 경로에 revision, create-only, journal, 검증, fmIndex를 unit으로 단다. 원본 delta header, `recordChatPost`, asset manifest hydrate는 보존한다.
- E2-3c: 모든 reset 경로(backup import, server restore, save-folder execute·upload, snapshot restore, `/api/remove`의 DB 삭제)가 쓰기를 막고 하나의 transaction으로 바뀌게 한다. epoch, 세션 무효화, pending-save 인계, BG hook을 둔다. 원본의 `importInProgress`, 계정 가져오기 gate, `restoringSnapshotKey`, `pluginStorage.restoreFrom`, `createBackupAndRotate`는 보존한다. snapshot core에서 옮겨 온 compat 테스트 `storage-reset-b1a`와 B2·B3의 reset 부분을 여기서 다시 넣는다.
- E2-3d: 클라이언트 저장(create·update 분류, id 복구, stale view rebase, recovery slot, dirty API 중 BG가 쓰는 것)을 원본 `chatDeltaSync`·`globalApi` 위에 단다.
- 각 단위는 공통 계약(1.16.1만 선언, coverage, per-commit 검사)을 따른다. `lazy-chat-sync`는 E2-3 동안 단위마다 coverage `retained`·`replaced`·`retired`·`added`를 갱신한다. 마지막 단위에서 통째 교체 unit 10개(9개 파일과 `session-lock.cjs`)는 `retired` 또는 `replaced`가 된다.
- BG adapter 34개 unit의 재작성은 E2-7이다. E2-3은 그 unit들이 붙을 symbol과 hook을 계약으로 문서화한다(§5).

## 5. BG와 다른 pack에 제공할 계약

- symbol: `serverChatCommit`(input·commit owner), `chatWriteJournal`(prefix, `resetMemory`, 복구), storage epoch(`internal/storage-epoch/v1`), `writerSession` helper, `sessionLock.invalidateBefore`, reset 시 BG run 취소 hook, `storageResetActive`·`importInProgress`(snapshot lazy adapter의 `fragments/server-helpers.cjs.txt:111,125`).
- unit id: H8의 `requires` 대상 id는 바꾸지 않는다. 바꿔야 하면 사용처 pack의 rebase 단위에서 함께 고친다.

## 6. 바뀌면 안 되는 것

- 원본 1.16.1의 lazy 로딩, delta 전송과 409 fallback, asset manifest, plugin storage route, archive route, 계정 가져오기와 그 gate, `recordChatPost`, `restoringSnapshotKey`, `createBackupAndRotate`, plugin 목록 쓰기 보호, `/api/write`의 ETag 계산.
- 아직 rebase하지 않은 pack(기준선과 같음).
- 일반 installer는 `reviewing`만 선언된 target을 거부한다.

## 7. 다음

E2-3a 결과로 §3·§4를 확정한 뒤 계획 검수(Astra)를 하고, 단위별 수용 기준·테스트 계약 표를 붙인다.
