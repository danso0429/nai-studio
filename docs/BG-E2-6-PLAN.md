# E2-6 계획 — fence adapter, backup과 restore를 PocketRisu 1.16.1로

**상태 (2026-10-27 KST):** 초안. 탐색 2건(haiku-explorer)과 orchestrator 확인을 마쳤고, 계획 검수 전이다. E2-3의 계약(BG-E2-3-PLAN §5)이 구현된 뒤에 시작한다. 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`의 「Ordered plan」 E2-6 행.
**위험 분류:** risky. backup·restore·snapshot의 일관성, 쓰기 fence, 복원 안전장치를 바꾼다.

## 1. 목표

`server-backup-snapshot-lazy-adapter`, `kei-backup-restore-safety-core`·`-lazy-adapter`, fence adapter(`-lazy-session`, `-kei`, `-kei-lazy-storage`)를 1.16.1 전용 계약으로 옮긴다. 원본에 없는 보장(시점 고정 backup, 복원 전 snapshot과 확인, 복사본 검증)은 남긴다. E2-2b에서 뺀 compat 테스트 `backup-point-in-time`과 `storage-reset-b1a`의 capture·reset 배제 부분을 owner 아래로 다시 넣는다. `client-build-fence-bg-adapter`는 `bg-preserve`를 `requires`하므로 E2-8이다.

## 2. 확인한 사실

탐색 기록은 로컬 `e2/e26/findings.md`.

| # | 사실 | 출처 |
|---|---|---|
| S1 | 원본 서버 backup 저장(`server.cjs:5849`)과 export(`:5437`)는 debounce 중인 DB를 쓴 뒤 그 순간의 KV를 읽는다. 한 시점에 고정한 읽기가 아니다. `createBackupAndRotate`(`:311-336`)는 DB 복사와 plugin 행을 한 transaction으로 만든다. `trimSnapshotsToLimits`(`:219-250`)는 `restoringSnapshotKey`만 보호한다. snapshot restore(`:8498`)는 복원 전에 snapshot을 만들지 않는다. | 탐색 |
| S2 | backup import(`importBackupFromSource`, `:2944`)는 flush 뒤 `createBackupAndRotate({force: true})`(`:3031`)로 가져오기 전 snapshot을 강제로 만든다. 계정 가져오기 적용(`:5749` → `:5764`)도 이 경로를 쓴다. | 탐색, E2-2 계획 F13과 같음 |
| S3 | snapshot lazy adapter는 unit 9개이고 모두 `server.cjs`다. 5개는 anchor가 한 번씩 있고, canonical slice 2개(`cold-storage-reader`, `maintenance-gate`)는 시작·끝 표지가 맞는다(본문 미비교). `settings-and-download-export`와 `server-save-export`는 1.16.1에서 범위 길이가 달라 맞지 않는다. `lazy-chat-sync`의 1.10 통째 교체 unit을 `after`로 가리키고, `storageResetActive`·`storageResetGeneration`·`compressionGeneration`을 쓴다(원본에는 `importInProgress`만). | 탐색 |
| S4 | Kei restore safety core(`restoreSafety.cjs`): `copyVerifiedSnapshot`(복사본 크기 확인), `prepareFreshRestoreSnapshot`(새 snapshot이 없으면 409와 한 번만 쓰는 확인 토큰), `requireLazyChatSnapshotCompleteness`(metadata를 기다리는 채팅 쓰기가 있으면 거부). 원본에 대응이 없다. core UI unit 6개 중 2개, lazy server unit 17개 중 7개, lazy node 11개 중 4개, lazy auto 3개 중 1개의 anchor가 1.16.1에 없다. | 탐색 |
| S5 | rebase한 fence는 `POST /api/backup/import`와 `POST /api/db/snapshots/restore`를 쓰기 route로 막는다(`clientBuildFence.cjs:17`, `:30`). 원본 클라이언트의 backup import XHR(`nodeStorage.ts:1074-1079`)과 snapshot restore fetch(`SystemBackup.svelte:146`)는 `x-client-build`를 보내지 않는다. 이 header는 Kei fence adapter 둘만 더하고, 그 adapter는 Kei restore safety pack(`userSelectable: false`)이 있을 때만 들어온다. | 확인함 |
| S6 | fence lazy-session adapter는 `SystemBackup.svelte`의 snapshot 한도·backup 경로 요청에 writer session header를 더한다(anchor 3개 모두 한 번씩). `lazy-chat-sync`의 `writerSession`이 필요하다. Kei fence adapter의 anchor는 Kei core·lazy adapter가 바꾼 글귀(들여쓰기 16칸, 표지 주석)라 그 pack이 먼저 적용되어야 한다. | 탐색 |
| S7 | fence에 걸리지 않는 원본 맨 `fetch` 쓰기(session, token, login, `set_password`, crypto, model-jobs·pending-sends·proxy-stream-jobs 생성, request-logs, logs, tunnel, update, termux-notify, sw 등록)는 서버 fence 목록에도 없다. | 탐색 |

## 3. 판정

| 대상 | 판정 | 근거 |
|---|---|---|
| backup import·snapshot restore의 build header | **권고: fence pack이 원본의 두 호출에 직접 header와 426 처리를 붙인다.** Kei fence adapter는 Kei가 바꾼 글귀에만 남긴다 | S5. 지금 구조에서는 Kei restore safety 없이 fence만 쓰면, build stamp가 있을 때 사용자가 backup을 가져오거나 snapshot을 복원하면 426으로 막힌다. 1.10에도 같은 구조였다. 서버가 막는 route의 정상 호출은 fence가 스스로 덮어야 한다 |
| 시점 고정 backup·export | 유지(lazy adapter). 두 canonical slice는 원본 1.16.1 route 위의 작은 unit으로 다시 쓰고, 원본이 export에 더한 것(asset manifest, plugin 값, archive)을 고정 reader에서 만든다 | S1, S3. 원본은 시점을 고정하지 않는다 |
| snapshot rotation 보호, maintenance 조정, inlay compress의 reset 확인 | 유지. E2-3이 제공하는 `storageResetActive`·`storageResetGeneration`과 이 pack의 `compressionGeneration`을 쓴다 | S3, BG-E2-3-PLAN §5 |
| 복원 안전장치(새 snapshot 확인, 복사본 검증, lazy 채팅 완결성) | 유지. 원본 응답 형태 위에 다시 쓴다 | S4 |
| 가져오기 전 snapshot | 원본 사용 | S2 |
| fence에 걸리지 않는 맨 `fetch` | 바꾸지 않는다 | S7. 서버 목록에 없는 route다 |

## 4. 단위

| ID | 제목 |
|---|---|
| E2-6a | Fence the native backup import and snapshot restore calls |
| E2-6b | Rebase the snapshot lazy adapter onto PocketRisu 1.16.1 |
| E2-6c | Rebase Kei backup restore safety onto PocketRisu 1.16.1 |
| E2-6d | Rebase the lazy-session and Kei fence adapters onto PocketRisu 1.16.1 |

- E2-6a: `client-build-fence`에 unit 2개를 더한다(coverage `added`, version +1). E2-6 중 E2-3과 무관한 유일한 단위라 먼저 해도 된다.
- E2-6b: E2-3 구현 뒤. `after`의 `lazy-chat-sync` 1.10 id를 E2-3의 unit id로 바꾼다. compat `backup-point-in-time`을 이 pack의 unit으로 다시 넣는다.
- E2-6c: E2-3 뒤(lazy adapter가 `lazy-chat-sync`를 `autoWhen`으로 요구). compat `storage-reset-b1a`의 capture·reset 배제 부분을 나눠 넣는다(E2-3 c9와 나눈 경계를 따름).
- E2-6d: E2-3e(`writerSession`)와 E2-6a·E2-6c 뒤. Kei fence adapter는 E2-6a가 원본 호출을 덮은 뒤에도 Kei가 바꾼 글귀에만 header를 다는지 확인한다(같은 요청에 header가 두 번 붙지 않게).

## 5. 바뀌면 안 되는 것

- 원본 1.16.1의 backup import 전 강제 snapshot, snapshot 생성 transaction, rotation 한도, `restoringSnapshotKey`, 계정 가져오기, export 내용(asset manifest, plugin 값, archive 포함).
- fence 판정 규칙과 build stamp가 없을 때 꺼지는 동작. 서버 fence 목록.
- 1.10에서 만든 backup 파일과 snapshot을 그대로 읽고 복원할 수 있다.
- 이미 rebase한 pack과 아직 rebase하지 않은 pack(기준선과 같음). 일반 installer는 `reviewing`만 선언된 target을 거부한다.

## 6. 수용 기준과 테스트 계약

공통 C0-C2는 E2-4 계획과 같다.

| # | 단위 | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|---|
| a1 | E2-6a | fence만 설치(Kei 없음), build stamp 있음, 같은 build의 클라이언트가 backup import·snapshot restore | - | `x-client-build`가 실려 서버가 받아들인다 | - |
| a2 | E2-6a | 다른 build의 클라이언트가 같은 요청 | stamp 불일치 | 426, 클라이언트는 upgrade 처리(dirty probe 규칙대로) | - |
| a3 | E2-6a | Kei restore safety와 Kei fence adapter도 설치 | - | 요청마다 header가 한 번만 실리고 결과는 a1·a2와 같다 | - |
| b1 | E2-6b | backup 저장·export 중 다른 쓰기가 계속됨 | 쓰기 진행 | 결과 파일은 시작 시점 한 상태다(동시 쓰기의 일부만 섞이지 않음) | - |
| b2 | E2-6b | export 내용 | asset manifest·plugin 값·archive 있음 | 원본 export와 같은 항목이 들어 있다 | - |
| b3 | E2-6b | backup reader가 열려 있는 동안 optimize·wal-checkpoint·rotation | - | reader가 끝날 때까지 maintenance가 기다리거나 거부하고, reader의 내용은 바뀌지 않는다 | - |
| b4 | E2-6b | inlay compress 중 storage reset | - | compress 결과가 reset 결과 위에 쓰이지 않는다 | - |
| b5 | E2-6b | 연결이 끊긴 backup 요청 | - | 고정 reader와 임시 파일이 정리된다 | - |
| b6 | E2-6b | compat `backup-point-in-time` | - | 통과 | - |
| c1 | E2-6c | snapshot restore, 최근 snapshot 없음 | - | 409와 확인 토큰. 토큰으로 다시 요청하면 복원 전 snapshot을 만들고 복원한다. 토큰은 한 번만 쓰인다 | - |
| c2 | E2-6c | 복원 직전 복사본 크기가 다름 | 주입한 실패 | 복원하지 않고 실패를 알린다 | - |
| c3 | E2-6c | metadata를 기다리는 채팅 쓰기가 있는 상태의 복원·backup | E2-3 journal 항목 | 거부되거나 완결된 뒤 진행한다(pack 기존 규칙) | - |
| c4 | E2-6c | 원본 backup import·계정 가져오기 | - | 원본의 가져오기 전 snapshot이 그대로 만들어진다 | - |
| c5 | E2-6c | compat `storage-reset-b1a`의 capture·reset 배제 부분 | - | 통과 | E2-3·E2-7 부분 |
| d1 | E2-6d | `SystemBackup` snapshot 한도·backup 경로 저장 | writer session | writer session header가 실리고 423이면 세션 비활성 처리 | - |
| d2 | E2-6d | Kei가 바꾼 snapshot restore·backup import 요청 | Kei 설치 | build header가 실리고 426 처리 | - |

## 7. 전제 출처

- 확인함: S5. S1: export(`:5452` flush, `:5504`·`:5512` 목록, `:5566` 항목마다 `kvGet`, 사이에 `waitForDrain`)와 server save(`:5853` flush, `:5890`-`:5892` 목록, `:5924` `kvGet`, `:5941` DB 값)는 transaction 없이 await 사이사이 읽는다. snapshot restore(`:8498`-`:8560`)에 `createBackupAndRotate` 호출이 없다. S4: `restoreSafety.cjs:166`·`:234`·`:256`의 세 함수.
- 탐색: S3의 slice 범위와 S4의 unit별 anchor 수. 둘 다 구현 단위의 compose가 직접 잰다.
- E2-3 구현 결과(§5 계약 symbol 이름과 동작)를 E2-6b·E2-6c 시작 전에 다시 읽는다.

## 8. 다음

E2-6a는 E2-3과 무관하므로 E2-4·E2-5와 같은 때에 계획 검수를 받는다. E2-6b-d는 E2-3 구현 뒤 계획을 다시 확인하고 검수한다.
