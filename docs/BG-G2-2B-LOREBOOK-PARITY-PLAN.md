# G2.2b 구현 계획 — BG `getCurrentLorebookEntries` parity

**상태 (2026-10-22 KST):** 구현·자동 검증·코드 검수·검증 실행까지 완료했고 patcher branch `claude/g22b-lorebook-parity`에 commit `dd5641a`(0.2.4-experimental.83, lazy-chat-bg-adapter 0.7.78)로 남겼다. push·merge·live 적용·기기 확인은 하지 않았다. 결과는 아래 「구현과 검증 기록」.
정본: [G2.2 실행 계획](BG-G2-2-EXECUTION-PLAN.md) r2 §3(A) G2.2b·§7. 대상: patcher `origin/main` `2adc8a5`(코드는 `902148a`, experimental.82, lazy-chat-bg-adapter 0.7.77), 작업 branch `claude/g22b-lorebook-parity`(push 전).
위험 분류: **risky** (공통 BG plugin host, 서버 번들 binding, 여러 파일).

## 목표

BG 요청별 플러그인 host에 `getCurrentLorebookEntries`를 제공해, 같은 작업에서 foreground 패치판과 같은 항목·순서를 돌려준다. RCM 1.0.21은 이 API가 없으면 빈 목록으로 진행해 BG 기억 준비에서 로어북이 조용히 빠진다.

## 확인한 사실

경로는 patcher 저장소 기준이다.

1. foreground 패치판(`patches/lazy-chat-sync/files-1.10/src/ts/plugins/apiV3/v3.svelte.ts:1106-1125`): 현재 캐릭터가 없으면 `[]`, 있으면 `char.globalLore ?? []` + 현재 chat(`chatPage`)의 `localLore ?? []` + `getModuleLorebooks()`를 snapshot으로 반환한다. 비동기 hydrate 중 대상이 바뀌면 throw한다.
2. native 모듈 해석(PocketRisu 1.10.0 `src/ts/process/modules.ts:380-450`): 활성 ID를 enabledModules → chat.modules → character.modules → persona.embeddedModule.id → moduleIntergration에서 모은 뒤, `db.modules`를 **배열 순서대로** filter(`id` 또는 `namespace` 일치)하고 ID로 중복 제거해 각 module의 `lorebook`을 이어 붙인다. persona는 선택 chat의 `bindedPersona`만 본다(`util.ts` `checkPersonaBinded`). getModules cache는 bg-preserve가 `db.modules` 배열 identity까지 키로 쓰도록 패치한다(`patches/bg-preserve.json:1426-1436`).
3. BG 작업의 DB와 선택(`patches/lazy-chat-bg-adapter/manifest.cjs:2919-2932`): 조립 context의 DB를 복제하고, 선택 위치에 조립 시점 chat을 넣는다. 이 chat은 메타데이터 `modules`를 덮어쓴 것이고(`serverChatAssemblyContext.cjs:7-15`) stub을 거절한다(23-25). 그 뒤 `chatPage = chatIdx`, `dbmod.setDatabase(db)`, `selectedCharID.set(charIdx)`를 실행한다. host는 그 뒤 생성된다(`plugin-host-units.cjs:181-184`).
4. 직렬화: 서버 번들의 DBState·selectedCharID는 전역이다. host 생성부터 hook, 모델 호출, `pluginHost.close()`까지 `runServerPreview` 전체가 `_previewLock`으로 직렬화된다. 따라서 같은 작업 안에서 번들의 `getModuleLorebooks()`는 그 작업의 DB와 선택을 본다. host-refresh(`plugin-host-units.cjs:200-204`)도 같은 작업의 DB로 다시 설정한다. 플러그인 host 자격은 `full` mode와 조립 context를 요구하므로 비첨부 preview는 별도 host 경로가 아니다.
5. 노출: `bgPluginHost.cjs` `ROOT_HANDLERS`(68-137)의 key가 worker 노출 목록(`SUPPORTED_ROOT_METHODS`)의 유일한 출처다. 기존 `getCharacter`·`getChatFromIndex`는 `ctx.hydrate([character])`로 그 캐릭터의 모든 chat을 hydrate한다.
6. binding: `bgPluginBindings.ts`에는 module lore binding이 없다. host 자격 검사(`bgPluginEligibility.cjs`)가 필수 binding 목록을 가진다. binding이 없으면 기존 경로대로 `server_plugin_host_bindings` 알림 뒤 플러그인 없이 진행한다.

## 설계

- `bgPluginBindings.ts`에 `moduleLorebooks: () => getModuleLorebooks()`를 추가한다. 같은 소스 함수를 쓰고 모듈 해석을 다시 구현하지 않는다.
- `bgPluginEligibility.cjs`의 필수 binding 목록에 `moduleLorebooks`를 추가한다. 빈 배열을 돌려주는 대체 binding은 두지 않는다.
- `bgPluginHost.cjs` `ROOT_HANDLERS`에 `getCurrentLorebookEntries`를 추가한다.
  - 선택 캐릭터가 없으면 `[]`를 반환한다.
  - `character.chats[chatIndex]`(조립 시점 chat)를 읽는다. **hydrate를 호출하지 않는다.** chat이 없으면 chat lore만 비우고 캐릭터·모듈 lore는 반환한다.
  - 방어 경계: 선택 chat이 `_stub`·`_placeholder`이거나 cold storage 형태이면 `plugin_chat_snapshot_unavailable`로 실패한다. 이는 foreground parity가 아니라 의도한 BG 경계이며, 정상 조립에서는 도달하지 않는 것이 기대값이다.
  - 반환값은 `clonePluginValue([...globalLore, ...localLore, ...moduleLorebooks()])`다. 기존 BG 값 한도(약 4 MiB, 100,000 node, 깊이 64, RPC 8 MiB frame)를 그대로 적용한다. 한도 초과는 기존 오류 코드로 실패하며, 잘라내거나 `[]`로 대신하지 않는다.
  - 권한 요구와 네트워크 예산 사용이 없고 인자는 무시한다. teardown 중 호출은 기존 cleanup allowlist에 따라 거절된다.
  - foreground의 "대상 변경 throw"는 흉내 내지 않는다. BG 선택은 작업 동안 고정이다.
- 새 테스트 파일은 pack 소유 파일로 `plugin-host-units.cjs`에 등록한다.

## 수정 파일과 커밋 단위

| ID | 제목 |
|---|---|
| G2.2b-1 | BG current lorebook entries parity |

- 구현: `patches/lazy-chat-bg-adapter/files-1.10/server/node/bgPluginHost.cjs`, `bgPluginEligibility.cjs`, `patches/lazy-chat-bg-adapter/files-1.10/src/ts/bgPluginBindings.ts`.
- 릴리스 식별: `package.json`(0.2.4-experimental.83), `patches/lazy-chat-bg-adapter/manifest.cjs`(0.7.78), `CHANGELOG.md`, `dist/`, 버전 단언(`test/bg-independent-g1.test.cjs:17`, `test/g22a-capability.test.cjs:39`).

## 합격 기준

1. 같은 합성 DB에서 BG handler 결과가 foreground 결과(같은 DB와 선택에서 실제 `getModuleLorebooks()` 포함)와 deep-equal이다. 사례: 활성 ID 순서와 `db.modules` 순서가 다른 경우, namespace, 중복 ID, persona embedded 모듈(등록·미등록), 전역 선택 persona와 다른 chat-bound persona, moduleIntergration, 같은 활성 ID에서 lorebook 내용만 바뀐 연속 작업.
2. 캐릭터 없음은 `[]`, chat 없음은 캐릭터·모듈 lore, 선택 chat이 stub·placeholder·cold이면 `plugin_chat_snapshot_unavailable`이다.
3. hydrate binding을 부르지 않는다.
4. 반환값(중첩 포함)을 바꿔도 host DB가 바뀌지 않는다. 값 한도 초과는 기존 오류 코드로 실패한다.
5. `SUPPORTED_ROOT_METHODS`에 포함되고 absent 진단에서 빠진다. binding이 없으면 host 자격이 false이고 기존 알림 뒤 플러그인 없이 진행한다.
6. 실제 worker 경유 확인(capability 발견, absent 진단 제외, 권한·네트워크 counter 불변)과 실제 번들 binding의 연속 작업·host-refresh 확인. 블라인드 테스트 환경에서는 worker sandbox가 뜨지 않아(`plugin_sandbox_budget_unavailable`) 이 항목은 구현 뒤 검증 실행(validation-runner)에서 확인한다.
7. 기존 동작 유지: 다른 handler의 결과·권한·예산, G2.2a capability 노출과 진단, MARP·PageFold BG probe, 기존 테스트 수(직전 기준 client 2621/4, server 775/12, compat 123/5, `pnpm check` 0/0, 저장소 351/348/0/3).
8. 검증 실행(validation-runner, handler 성공과 분리): 조립 트리에 원본 RCM 1.0.21 JS를 설치하고, 가짜 RCM backend가 받은 `/v1/turn/prepare` 본문의 로어북 항목을 같은 합성 DB의 foreground 결과와 비교한다. 오래된 build·session으로 거절된 시작은 플러그인·backend 효과가 0이어야 한다. 그 뒤 before_request에 남는 실패 지점을 기록한다. RCM이 함께 부르는 `getCharacter`·`getChatFromIndex`·`getDatabase([... "characters"])`의 기존 hydrate 실패는 별도 판정한다.

## 바꾸지 않을 동작

다른 ROOT_HANDLERS, `getDatabase`의 characters hydrate, 권한·예산, worker·sandbox, foreground 코드, RCM 원본, beforeRequest 실패 정책(D1-a는 별도 단위).

## 검사 명령

- 후보 전체 gate 스크립트(commit 직전, 버전·CHANGELOG·dist 갱신 뒤).
- 조립 트리 focused 실행: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run server/node/bgCurrentLorebookEntries.test.ts`.
- `node --test test/*.test.cjs`.

## 검수와 시험 기록

- **Astra(gpt-6-astra, read-only) 1회차:** 지적 6건을 모두 채택했다. 내용은 lock·선택 경로 확인, stub·cold 방어, persona·cache 사례, 오래된 번들 자격, 값 한도, 테스트 등록·fixture·실제 worker·번들 시험이다.
- **Argon(gemini-4-argon-medium):** 시나리오 12개를 받았다(`SUCCESS`). 11번의 동시 작업 부분은 서버 직렬화로 발생할 수 없어 제외했다. 12번의 MARP·provider 회귀는 기존 suite가 다루므로 제외했다.
- **블라인드 테스트(Codex gpt-5.6-sol, 1회):** 결과는 아래와 같다.
  - 새 파일 `patches/lazy-chat-bg-adapter/files-1.10/server/node/bgCurrentLorebookEntries.test.ts`에 `[G2.2b-1]` 블록 하나, 11개 테스트(수집 14개)가 있다. pack 등록 1줄과 fixture 2개(`bgPluginEligibility.test.ts`, `bgInputExecutionContext.test.ts`에 `moduleLorebooks` 추가)를 고쳤다.
  - 관찰값: 새 suite는 14개 중 13개 실패, 1개 통과(teardown 거절은 기존 경로로 통과)다. 실패 원인은 handler 부재 11개, 목록 부재 1개, 자격 검사 미요구 1개다. 고친 fixture는 22개 모두 통과, `pnpm check`는 0/0, 저장소 테스트는 55 파일 통과다.
  - 라벨 검사는 위반 0건이다. 모듈 해석은 실제 `modules.ts`를 쓴다(database·util·주변 import는 test double).
  - 고정 테스트 파일은 branch에서 commit하지 않은 상태로 보존한다. SHA-256은 아래와 같다.

| 파일 | SHA-256 |
|---|---|
| `bgCurrentLorebookEntries.test.ts` | `4195fe1e82d106170343079b3d076516c57fa311c8630b7534a253b52d8c739c` |
| `bgPluginEligibility.test.ts` | `8f70f33b33eccdb0742a0458e35174b3b0fded7432424cca2ed768ae7a8033e0` |
| `bgInputExecutionContext.test.ts` | `4e25d1d47c02a1e9c0b76687df1405cab4408f5ca848df69fe8552a4445784f0` |
| `plugin-host-units.cjs`(등록 1줄 포함) | `84d332fadb26da144598469a1dfc389df6c1882f610e7fb9ffbebd79ef7a71ff` |

## 구현과 검증 기록 (2026-10-22 KST)

- **구현(opus-implementer):** `bgPluginHost.cjs`에 `getCurrentLorebookEntries` handler, `bgPluginEligibility.cjs` 필수 binding에 `moduleLorebooks`, `bgPluginBindings.ts`에 `moduleLorebooks: () => getModuleLorebooks()`(`./process/modules`). cold chat 판정은 lazy-chat-sync `server.cjs`의 `isColdStorageChat`과 같은 헤더(`COLDSTORAGE`) 비교, stub·placeholder 판정은 `serverChatAssemblyContext.cjs`와 같은 필드다. 릴리스 식별·CHANGELOG·버전 단언·`dist`를 갱신했다. patcher commit `dd5641a`.
- **고정 테스트 정정 2건(같은 Codex 테스트 작성 세션 resume, 각 1회):**
  1. 자격·알림 테스트가 `operationId: 'op'`(2자)를 넘겨 기존 `bgPluginUnavailable.cjs:3`의 8~128자 검사에서 알림 전에 실패했다. 구현 전에는 앞 단언에서 멈춰 드러나지 않았다. 값만 `'op-00000001'`로 바꿨다.
  2. Codex 코드 검수(gpt-6.1-sol) 지적: 반환값 변경 테스트가 host DB에 넣은 객체와 같은 `original`과 비교해, 참조를 돌려주는 handler에서도 통과했다(합격 기준 4 미보호). 변경 전 `structuredClone(original)` 스냅샷과 비교하도록 3줄을 바꿨다. 조립 트리에서 clone을 뺀 handler로 바꾸면 이 테스트와 값 한도 테스트가 실패하고 원래 구현에서는 14/14 통과함을 확인했다.
  - 최종 SHA-256: `bgCurrentLorebookEntries.test.ts` `118b57c14600711c4ae021c2b67d18b378907a652f6b39c18a915d9588d9923f`. 나머지 셋(`bgPluginEligibility.test.ts`, `bgInputExecutionContext.test.ts`, `plugin-host-units.cjs`)은 위 표와 같다. 라벨은 `[G2.2b-1]` 블록 하나로 위반 0건.
- **코드 검수:** 제품 코드 결함 0건, 테스트 지적 1건(위 2번 채택). 테스트만 바뀌어 재검수는 하지 않았다.
- **후보 gate(commit 직전):** 19/19 PASS. client 2621/4, server 789/12(775 + 새 14), compat 123/5, `pnpm check` 0/0, 저장소 351/348/0/3, `dist` 재현·755·`node --check`, apply→revert 왕복 clean.
- **검증 실행(validation-runner, 합성 데이터·loopback·가짜 provider/backend):**
  - 합격 기준 6: 실제 worker에서 capability 발견(`function`), absent 진단 제외(남은 미지원 API는 계속 표시), 권한 상태·network counter 불변, 실제 번들 `moduleLorebooks` binding 결과가 foreground와 deep-equal(`db.modules` 순서·namespace·중복 ID·chat-bound persona embedded 모듈, 전역 persona 모듈 제외), 연속 작업과 host refresh가 각자의 DB를 반환.
  - 합격 기준 8: 원본 RCM 1.0.21 JS(SHA-256 `08705f3b…` 전후 동일)로 BG 실행 1회. absentApis에서 사라졌고, `getCurrentLorebookEntries` wire 값이 foreground와 deep-equal(10개)이며, `/v1/turn/prepare` 본문의 lore는 `staticProjection.hash`로만 실리는데 그 hash가 foreground 항목으로 재계산한 값과 같고 모듈 lore 제외·빈 목록 hash와는 다르다. 프롬프트에 `[[RCM]]` marker가 있을 때 beforeRequest가 성공하고 prepare·delivery가 backend에 도달했으며 가짜 모델 요청에 주입 packet이 들어갔다. marker가 없으면 `getChatFromIndex` 뒤 `plugin_hook_failed`(worker는 메시지 없는 `plugin_execution_failed`)로 끝나고 이 API·prepare는 호출되지 않았다(marker 원인은 DB 차이에서 추론). marker 실행에서 hook 반환 뒤 RCM 자체 호출로 `plugin_late_call` 알림 1건이 있었다(이 API와 무관, 기존 동작).
  - 오래된 build(426)·session(423) 시작은 플러그인·backend·provider 효과 0, worker 미기동.
  - 회귀 probe: capability 11/11, host 128/128, worker 12/12, process(normal·old-client) 통과.

## 남은 한계

- `character.coldstorage`가 남은 선택 캐릭터는 거절하지 않는다(사용자 결정, foreground parity). 서버는 정상 읽기 경로(`decodeDatabaseWithPersistentChatIds`, 저장소 복원)에서 cold 캐릭터를 풀어 두며, `/api/write`로 `database.bin`을 직접 쓴 경우에만 캐시에 남을 수 있다(lazy-chat-sync `server.cjs:4451`, 재현하지 않음). 그 경우 RCM은 이 API보다 먼저 부르는 기존 `getCharacter`·`getDatabase(["characters"])` hydrate에서 `plugin_chat_snapshot_unavailable`로 실패한다.
- RCM beforeRequest 실패는 RCM 안에서 재시도·대체 없이 `MemoryInjectionBlockedError`로 던져진다. 현재 BG 정책(D1-a 적용 전)은 알림 뒤 기억 없이 진행한다.
- 실제 RCM backend·브라우저·기기 경로는 확인하지 않았다(G2.2c·G2.5).

## 다음 단계

1. push·merge·live 적용·기기 확인은 각각 별도 사용자 결정이 필요하다.
2. 이어서 G2.2c(RCM 1.0.21 설치 확인부터), 그 뒤 D2 구현 계획과 도구 발견 시점 결정.
