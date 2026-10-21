# G2.2b 구현 계획 — BG `getCurrentLorebookEntries` parity

**상태 (2026-10-22 KST):** 계획, Astra 계획 검수 1회차, Argon 시나리오, 블라인드 테스트까지 완료. 구현은 시작하지 않았다.
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

## 다음 단계

1. opus-implementer로 구현한다. 위 파일들을 고정 테스트로 넘긴다.
2. 후보 gate를 실행하고 Codex 코드 검수를 받는다(`dist` 제외 diff).
3. 합격 기준 6·8의 검증 실행(validation-runner)을 한다.
4. commit한다. push·live 적용·기기 확인은 각각 별도 사용자 결정이 필요하다.
