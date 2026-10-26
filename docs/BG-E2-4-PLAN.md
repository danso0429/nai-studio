# E2-4 계획 — persona·character·import·settings owner를 PocketRisu 1.16.1로

**상태 (2026-10-27 KST):** 초안. 탐색 4건(haiku-explorer)과 orchestrator 확인을 마쳤고, 계획 검수 전이다. 정본: patcher `docs/POCKETRISU-1.16-REBASE-AUDIT.md`의 「Ordered plan」 E2-4 행과 Decisions(2026-10-26 E2-0b, fastimport).
**위험 분류:** risky. 여러 pack과 catalog·custom state 채택 규칙, 설정 저장 경로, asset 정리 보호를 바꾼다.

## 1. 목표

E2-0b 결정을 1.16.1 전용 계약(E2-2 계획 「공통 계약」)으로 적용한다.

- `character-organizer`, `toolchain-hardening`, `fastimport-ios-picker`를 retire한다.
- `haejeok-korean-search-adapter`를 원본 character manager 검색 위의 단독 pack으로 다시 만든다.
- `persona-organizer`를 원본 persona 폴더 위로 옮기고, 원본에 없는 기능만 남긴다.
- `personal-settings`의 route 번호와 저장 경로를 1.16.1에 맞춘다.
- `character-import-ux`를 E2-3 뒤에 1.16.1로 옮긴다.

의존 adapter(`haejeok-chat-width-adapter`, `personal-settings-lazy-session-adapter`)는 E2-8이다.

## 2. 확인한 사실

출처의 「탐색」은 haiku-explorer 보고(로컬 기록 `e2/e24/findings.md`)다. 「확인함」은 orchestrator가 해당 줄을 직접 읽은 것이다. 원본 경로는 PocketRisu 1.16.1(`5da95f7`) 기준이다.

| # | 사실 | 출처 |
|---|---|---|
| G1 | 원본 검색은 `matchesSearch(name, search)` 하나다(`src/ts/characterManager.ts:63-67`). 호출은 `CharacterManager.svelte:66-67` 두 곳이고 둘 다 `e.name`만 넘긴다. 모바일도 같은 component를 쓴다(`MobileBody.svelte:61`). `ManagerEntry`에는 제작자·태그가 없다(`characterManager.ts:9-21`). | 확인함(정의, 호출, `ManagerEntry`), 탐색(모바일) |
| G2 | `haejeok-korean-search-adapter`는 unit 11개다. `requires`·`autoWhen`이 `character-organizer`이고 `userSelectable: false`다(`manifest.cjs:34-37`). matcher(`haejeokKoreanSearch.ts`, 테스트 9개)는 초성·자모·로마자·자판 변환과 제작자(가중치 0.6)·태그(0.7)를 지원한다. 화면 unit 5개의 대상 파일(`GridCatalog.svelte`, `MobileCharacters.svelte`)은 1.16.1에 없다. `es-hangul` 2.4.0 의존 unit 4개가 있다. | 탐색 |
| G3 | `lazy-chat-bg-adapter/notification-units.cjs:7-8`은 load 시 `personal-settings`, `character-organizer`, `bg-preserve`, `client-build-fence`의 manifest를 `require`하고, 같은 파일을 고치는 unit id를 `after`로 쓴다. | 확인함 |
| G4 | `src/catalog.cjs:12` `RETIRED_OWNER_IDS`는 `['background-import']`이고, custom state 채택(`:107-125`)에서 없는 pack id는 이 목록에 있을 때만 통과한다. 앞선 retire commit `19b0140`은 CHANGELOG, README, dist, 문서, `src/catalog.cjs`, `test/catalog.test.cjs`를 고쳤고 pack 디렉터리는 남아 있지 않다. | 확인함(commit stat, 디렉터리 없음), 탐색(catalog 줄) |
| G5 | `toolchain-hardening` id는 `haejeok-korean-search-adapter`(`manifest.cjs:14-19`)와 `pagefold-model-preset`(`:18-23`)에서 `after`로만 쓰인다. compose는 없는 `after` id를 무시한다. `fastimport-ios-picker` id를 `requires`하는 pack은 없다. 두 pack을 직접 시험하는 파일은 `test/toolchain-hardening.test.cjs`, `test/fastimport-ios-picker.test.cjs`이고, catalog·resolver·cli 테스트가 pack 목록을 고정한다. | 탐색 |
| G6 | 원본 persona 폴더: `db.personaFolders`(`PromptPresetFolder {id,name}`, `database.svelte.ts:1089-1092`, `:1284`), `RisuPersona.folderId`(`:1079`). 폴더 만들기·이름 바꾸기·지우기·이동·끌어 놓기(`FolderedList.svelte`), persona 복제, picker 검색과 폴더 묶음이 있다. persona별 이미지 gallery, 폴더 아이콘, 폴더로 가져오기, 고른 폴더에 새 persona 만들기, picker의 폴더·미분류 범위 필터는 없다. | 탐색 |
| G7 | pack persona 폴더는 원본과 같은 이름(`personaFolders`, `folderId`)을 쓰고 폴더에 `icon` 문자열을 더한다(`persona-organizer/manifest.cjs:76-106`). pack unit 27개 중 9·16-18·26·27번 anchor는 1.16.1에 없고, 7·10번은 원본이 이미 선언한 필드를 다시 더한다. 원본 `exportUserPersona(personaIndex)`(`persona.ts:56`)가 고른 persona 이미지를 내보낸다. | 확인함(pack 폴더 shape), 탐색(unit별 anchor) |
| G8 | 원본 asset 보호: client `getUncleanables`의 persona 처리(`globalApi.svelte.ts:2162-2183`)는 `icon`, 옛 `image`, `embeddedModule`만 넣는다. 서버 `buildUncleanableSet`(`server.cjs:7683-7693`)과 `computeAssetSweep`(`:7736`, `:7751`), backup(`backuplocal.ts:165-171`)도 persona icon만 다룬다. character 폴더 아이콘은 원본에 있다(`database.svelte.ts:2140-2152`, `lib/CharacterManager/folderIcons.ts`). | 탐색 |
| G9 | 원본 route 24는 `LongTermMemory`(`routing.ts:44`)이고 `Settings.svelte:325`의 render 분기가 먼저 걸린다. pack은 `Personal: 24`를 넣으므로 Personal 화면이 열리지 않는다. 비어 있는 번호는 18-20, 25-98이다. pack 안에서 Personal을 숫자로 직접 쓰는 곳은 route 상수 unit, 메뉴 버튼, render 분기다. 검색 manifest는 `SettingsRoute.Personal`을 쓴다. | 확인함(24, render 순서), 탐색(빈 번호, 사용처) |
| G10 | 1.10 pack의 개인 설정 저장(`strict-save.txt`)은 (a) 진행 중 저장을 기다리고, (b) root block이 바뀌지 않으면 patch만 쓰고, (c) 전체 쓰기 대체·충돌 rebase·ETag 없는 전체 쓰기를 하지 않고 실패를 던지며, (d) `/api/db/flush`로 서버 저장을 기다린 뒤 성공을 알리고, (e) 실패하면 patch 기준과 바뀐 값을 되돌린다. 1.16.1의 붙일 자리: `persistTrackedChanges(toSave, timing, options)`(`globalApi.svelte.ts:1226`), 전체 쓰기 결정 `if (!saved)`(`:1558`), 전체 쓰기 `setItem`(`:1576`), `triggerSave`(`:1617`), `flushSavesImpl`(`:1711`). pack의 `encoder.set` anchor는 없다. | 탐색(guarantee와 줄), 확인함(`encoder.set` 0) |
| G11 | 원본 `/api/db/flush`는 storage queue 안에서 `flushPendingDb`로 debounce 중인 DB를 쓰고 ETag를 돌려준다(`server.cjs:4699-4709`, `:341-353`). | 확인함 |
| G12 | `personal-settings`는 unit 약 130개다. anchor가 없는 것: `SettingRowLayout` 접근성 unit 2개, 저장 경로 unit 2개(`encoder.set`, ETag 줄 들여쓰기). 두 번 나오는 anchor 2개(`characterCards.ts:1760`/`:1783`, `Toggles.svelte:288`/`:298`)는 형제 unit이 먼저 적용되어야 한다. external headers의 fence route insert는 rebase한 fence의 owned 파일에 붙는다. | 탐색 |
| G13 | `character-import-ux`는 `lazy-chat-sync`를 `requires`하고 `requestImportedCharacterSave`·`requestImportedModuleSave`를 쓴다. anchor 9개가 1.16.1에 없다. 원본에는 비차단 진행 알림, 가져오기 중 backup·restore·update 차단, share GET route, `suppressImportJob`이 없다. | 탐색 |

## 3. 판정

판정 기준: 원본에 같은 기능이 있으면 원본을 쓰고, 원본에 없는 사용자 기능은 남긴다(기존 정상 기능 보존). 아래 「권고」는 근거와 함께 이 계획이 정한 것이다.

| 대상 | 판정 | 근거 |
|---|---|---|
| `toolchain-hardening` | retire(결정됨). pin은 최종 후보 gate가 필요를 보일 때만 다시 넣는다 | Decisions 2026-10-26 |
| `fastimport-ios-picker` | retire(결정됨) | Decisions 2026-10-26 |
| `character-organizer` | retire(결정됨). 단 `patches/character-organizer/manifest.cjs`는 E2-7까지 남기고 catalog에서만 뺀다 | G3: 아직 rebase하지 않은 BG adapter가 load 시 이 manifest를 `require`한다. 지우면 catalog load가 실패하고, 그 adapter를 고치면 A5(손대지 않은 pack은 기준선과 같음)를 깬다 |
| 한국어 검색 | 단독 pack, `userSelectable: true`, `requires` 없음. matcher와 `es-hangul`은 그대로 쓴다. 화면 unit은 `matchesSearch`의 두 호출 자리를 바꾸는 unit으로 다시 쓴다. **권고: 제작자·태그 검색을 남긴다.** `ManagerEntry`에 제작자·태그를 더하는 unit을 두고 두 호출 자리가 entry를 넘기게 한다 | G1, G2. 1.10에서 쓰던 검색 범위(이름·제작자·태그)를 줄이지 않는다 |
| `persona-organizer` | 원본 폴더 모델·폴더 UI·복제·picker 묶음을 쓴다. **권고: 원본에 없는 기능(persona별 gallery, 폴더 아이콘, 폴더로 가져오기, 고른 폴더에 만들기, picker 범위 필터)을 남긴다.** 폴더 아이콘은 원본 `PromptPresetFolder`에 선택 필드 `icon`을 더하고 `FolderedList`의 persona 폴더 머리에 그린다. gallery 이미지와 폴더 아이콘을 client·서버 asset 보호와 backup에 더한다 | G6-G8. 데이터 이름이 같아(G7) 1.10 데이터는 그대로 읽힌다. E2-0b 결정은 폴더 아이콘만 적었지만, gallery 등은 원본에 없어 지우면 사용자 기능이 줄어든다 |
| `personal-settings` | 남긴다(결정됨). **권고: route 번호 90.** 숫자는 상수 하나와 메뉴·render unit에만 쓰이므로 값만 바꾼다. 업스트림이 순서대로 늘리는 번호(최근 23, 24)와 겹칠 가능성이 낮은 쪽을 고른다. 저장 보장 (a)-(e)는 G10의 1.16.1 자리에 다시 붙인다 | G9-G11 |
| `character-import-ux` | 남긴다. E2-3이 `requestImportedCharacterSave`·`requestImportedModuleSave`(E2-3 d12)를 제공한 뒤 옮긴다 | G13 |

## 4. 단위

| ID | 제목 |
|---|---|
| E2-4a | Retire toolchain-hardening and fastimport-ios-picker |
| E2-4b | Rebuild Korean search on the native character manager and retire character-organizer |
| E2-4c | Rebase persona-organizer onto native persona folders |
| E2-4d | Rebase personal-settings onto PocketRisu 1.16.1 |
| E2-4e | Rebase character-import-ux onto PocketRisu 1.16.1 |

- E2-4a: 두 pack을 catalog에서 빼고 디렉터리와 전용 테스트를 지우며, id를 `RETIRED_OWNER_IDS`에 넣는다. catalog·resolver·cli 테스트의 pack 목록, README, CHANGELOG를 고친다. `haejeok`·`pagefold`의 `after` 문자열은 손대지 않는다(무시되고, 손대면 A5를 깬다).
- E2-4b: 한국어 검색 pack을 1.16.1 전용 계약으로 다시 쓰고(`rewritten`·`retired`·`added`), 같은 commit에서 `character-organizer`를 catalog에서 빼고 `RETIRED_OWNER_IDS`에 넣는다. 검색 pack이 지금 organizer를 `requires`하므로 둘은 한 commit이어야 graph가 깨지지 않는다. organizer manifest 파일은 남긴다(§3).
- E2-4c: 원본과 겹치는 unit(폴더 필드·interface·폴더 UI·picker 전체 교체·export 이미지)은 `retired` 또는 원본 위 작은 unit으로 `replaced`, 남기는 기능은 원본 화면 위 unit으로 다시 쓴다. asset 보호는 client(`getUncleanables`, `replaceDbResources`), 서버(`buildUncleanableSet`, manifest 참조), backup 세 곳에 더한다.
- E2-4d: route 상수를 90으로, 메뉴·render unit을 원본 1.16.1 글귀에 맞게, 접근성 unit 2개를 원본 `SettingRowLayout`에, 저장 경로 unit을 G10 자리에 다시 쓴다. 두 번 나오는 anchor는 형제 unit의 `before`·`after`와 `anchorPolicy`로 순서를 고정한다.
- E2-4e: E2-3 commit 뒤. anchor 9개를 다시 쓰고 `lazy-chat-sync`의 1.10 unit id를 가리키는 `after`를 E2-3의 unit id로 바꾼다.
- 각 단위는 E2-2 「공통 계약」을 따른다(1.16.1만 `reviewing`, unit 범위 없음, coverage, commit마다 검사, 손댄 pack closure의 subset harness).

## 5. 바뀌면 안 되는 것

- 원본 1.16.1의 character manager(검색 결과는 영문 이름 검색에서 원본과 같거나 더 넓다), persona 폴더 모델과 폴더 UI, persona 복제, `exportUserPersona`, MemorySettings(route 24), 원본 저장 경로의 일반 저장(개인 설정 저장 밖).
- 1.10 데이터: 기존 `personaFolders`·`folderId`·폴더 `icon`·persona gallery 값을 그대로 읽는다. 개인 설정 저장값과 외부 request header 설정을 그대로 읽는다.
- 이미 rebase한 pack과 아직 rebase하지 않은 pack(기준선과 같음). retire한 pack id가 있는 custom state는 채택된다.
- 일반 installer는 `reviewing`만 선언된 target을 거부한다.

## 6. 수용 기준과 테스트 계약

공통: C0 손댄 pack은 1.16.1만 `reviewing`으로 선언하고 coverage가 위반 0이다. C1 per-commit 검사와 손댄 pack closure의 subset harness가 통과한다. C2 rebase하지 않은 pack의 unit hash가 기준선과 같다.

| # | 단위 | 입력 | 기존 상태 | 기대 결과 | 범위 밖 |
|---|---|---|---|---|---|
| a1 | E2-4a | catalog load, `all` profile | - | 두 pack이 catalog와 `all`에 없고, 남은 pack 수가 하나씩 줄어든다 | - |
| a2 | E2-4a | 두 pack id가 든 custom state에서 profile 전환 | custom state | 거부되지 않고 채택된다(`RETIRED_OWNER_IDS`) | - |
| a3 | E2-4a | 1.16.1 subset harness(남은 rebase pack 묶음) | - | 통과(두 pack 없이) | 최종 lock pin(E2-9) |
| b1 | E2-4b | 한국어 검색어(초성, 자모, 로마자, 자판 변환)로 character manager 검색 | 한글 이름 character | 해당 character가 결과에 나온다(데스크톱·모바일 같은 component) | 순위 표시 |
| b2 | E2-4b | 제작자·태그로 검색 | 제작자·태그가 있는 character | 결과에 나온다 | - |
| b3 | E2-4b | 영문·숫자 검색어, 빈 검색어 | - | 원본 `matchesSearch`가 고르는 character를 모두 고른다. 빈 검색어는 전부 | - |
| b4 | E2-4b | 휴지통 목록 검색 | 휴지통 character | 같은 matcher를 쓴다 | - |
| b5 | E2-4b | organizer id가 든 custom state, catalog load | - | organizer는 catalog에 없고 채택되며, BG adapter manifest load가 실패하지 않는다 | BG adapter 재작성(E2-7) |
| c1 | E2-4c | 1.10 데이터(폴더에 `icon`, persona에 gallery) | 저장된 DB | 원본 폴더 화면에 폴더와 소속이 그대로 보이고, 폴더 아이콘과 gallery가 남는다 | - |
| c2 | E2-4c | 폴더 아이콘·gallery 이미지만 참조되는 asset | asset 정리 실행(client 정리, 서버 `computeAssetSweep`) | 지워지지 않는다. 참조가 없어지면 지워진다 | - |
| c3 | E2-4c | backup 만들기와 복원 | 폴더 아이콘·gallery | 이미지가 함께 저장·복원된다 | - |
| c4 | E2-4c | 폴더를 고른 상태에서 persona 가져오기·새로 만들기 | 폴더 있음 | 그 폴더에 들어간다 | - |
| c5 | E2-4c | picker 범위 필터(폴더, 미분류) | 폴더 여럿 | 고른 범위의 persona만 보인다 | - |
| c6 | E2-4c | 원본 폴더 만들기·이름 바꾸기·지우기·이동, persona 복제, export | - | 원본과 같다 | - |
| d1 | E2-4d | 설정에서 Personal 메뉴 | - | Personal 화면이 열리고, 장기 기억(route 24) 화면도 원본처럼 열린다 | - |
| d2 | E2-4d | 개인 설정(CSS·글꼴·외부 header) 저장 | 정상 서버 | patch로 저장되고 서버 flush 뒤 성공을 알린다 | - |
| d3 | E2-4d | 개인 설정 저장 중 patch 충돌·실패 | 서버가 409 또는 실패 | 전체 쓰기·충돌 rebase로 넘어가지 않고 실패를 알리며, 바뀐 값과 patch 기준이 되돌아간다 | - |
| d4 | E2-4d | 개인 설정 저장 중 다른 저장이 진행 중 | 진행 중 저장 | 그 저장이 끝난 뒤 저장한다 | - |
| d5 | E2-4d | 일반 저장(개인 설정 밖) | - | 원본 1.16.1 저장 경로와 같다(전체 쓰기 대체 포함) | - |
| d6 | E2-4d | 외부 request header route 쓰기 | build stamp 불일치 | fence가 426으로 막는다 | - |
| d7 | E2-4d | 1.10 개인 설정값 | 저장된 DB | 그대로 적용된다(CSS, 글꼴, header) | - |
| e1 | E2-4e | 큰 character·module 가져오기 | - | 비차단 진행 알림이 보이고, 그동안 backup·restore·update가 막힌다 | - |
| e2 | E2-4e | share target으로 module 받기 | SW cache 있음·없음 | 원본 POST 경로 보존, pack GET 경로와 cache miss 404 | - |
| e3 | E2-4e | 가져온 character·module 저장 | E2-3 적용 | `requestImportedCharacterSave`·`requestImportedModuleSave`로 저장된다 | - |

## 7. 전제 출처

- 「확인함」이 아닌 행(G2, G5, G6, G8 일부, G10의 guarantee 목록, G12, G13)은 테스트를 요청하기 전에 코드 줄로 확인한다.
- 측정값 없음(모두 코드 읽기). 테스트 요청 직전에 `git --no-pager diff --name-only 328f4fb..HEAD -- patches/{persona-organizer,personal-settings,haejeok-korean-search-adapter,character-organizer,character-import-ux,toolchain-hardening,fastimport-ios-picker} src/catalog.cjs`로 바뀐 경로를 확인한다.

## 8. 다음

계획 검수(Astra, Codex 5시간 창 reset 뒤), 전제 확인, Argon 시나리오, 테스트, 구현 순서. E2-4a-d는 E2-3과 독립이고, E2-4e는 E2-3 구현 뒤다.
