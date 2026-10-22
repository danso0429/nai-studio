# D1-a 구현 계획 — BG beforeRequest 실패를 요청 실패로

**상태 (2026-10-22 KST):** 구현·자동 검증·코드 검수 완료. patcher branch `claude/d1a-before-request-failure`에 commit `5e3ed85`(0.2.4-experimental.84, lazy-chat-bg-adapter 0.7.79). push·live 적용·기기 확인은 하지 않았다. 결과는 아래 「구현과 검증 기록」.
정본: [G2.2 실행 계획](BG-G2-2-EXECUTION-PLAN.md) §3(B) D1(결정 2026-10-17: D1-a)와 Astra r2 구현 조건. 대상: patcher `origin/main` `dd5641a`(0.2.4-experimental.83, lazy-chat-bg-adapter 0.7.78).
위험 분류: **risky** (G1의 플러그인 실패 정책 변경, 공통 BG plugin host, 기존 probe 기대 다수 변경).

## 목표

BG 작업에서 플러그인의 `beforeRequest` replacer가 실행에 실패하면, foreground처럼 요청을 실패로 끝낸다. 모델을 호출하지 않고, 사용자 입력을 보존하고, 알림을 남기며, 자동으로 다시 실행하지 않는다. 현재 BG는 실패를 알린 뒤 그 플러그인의 효과 없이 진행한다(fail-open). RCM처럼 beforeRequest에서 기억 준비·주입을 하거나 의도적으로 요청을 차단하는 플러그인은 이 경로에서 기억 없이 모델이 호출된다.

## 확인한 사실

경로는 patcher 저장소와 그 조립 트리(PocketRisu 1.10.0 + `dd5641a` apply) 기준이다.

1. native 호출(조립 트리 `src/ts/process/request/request.ts:252-256`): `for (const replacer of pluginV2.replacerbeforeRequest) arg.formated = await replacer(arg.formated, model)`. try가 없다. `requestChatData`·`sendChat`(`index.svelte.ts:1617`)·`sendChatWithDirectLifecycle`(`index.svelte.ts:102-118`)에도 이 throw를 잡는 catch가 없다. 따라서 foreground에서 replacer throw는 요청 실패다. PageFold route 상태에서는 이 루프를 건너뛴다(`:251`).
2. 재시도: fallback 모델마다 `arg.formated`를 원본으로 되돌리고(`:231-233`), 같은 모델의 재시도(`while(true)`, 빈 응답·금지 문자·retrySameRoute·`requestRetrys`)에서는 beforeRequest를 다시 실행한다. 두 번째 실행의 실패도 같은 경로로 전파된다. 이때 앞선 provider 시도는 이미 일어났다.
3. host 래퍼(`bgPluginHost.cjs` `invoke`, 452-510):
   - 시작 시 `closed || entry.failed`이면 원래 입력을 반환한다(456-460).
   - identity 확인 뒤 `entry.failed`이면 원래 입력을 반환한다(470-473).
   - callback 실행 뒤 `entry.failed`이면 `plugin_hook_failed`를 throw하고(479), replacer beforeRequest 결과가 배열이 아니면 `plugin_hook_result_invalid`(480).
   - catch(490-503): notice/identity 실패는 우선 rethrow, `closed || tearingDown || entry.closing`이면 rethrow, 그 밖에는 `disable(entry, code)` 뒤 provider가 아니면 원래 입력을 반환한다. `signal.aborted`이면 `plugin_operation_closed`를 throw한다.
   - 같은 `invoke`가 body interceptor(kind `before_request`, contract `body`, 536)와 afterRequest·script·provider에도 쓰인다.
4. 로드 단계: hook은 로드가 실패하지 않은 entry에만 설치된다(`bgPluginHost.cjs:671` `if (!entry.failed) { entry.ready = true; install(entry); }`). 로드에서 빠진 플러그인(권한 답 없음, 로드 중 미지원 API, 등록 오류 등)은 beforeRequest가 registry에 없으므로 이 변경의 대상이 아니다.
5. identity 변경으로 인한 비활성화(`validateIdentity` 380-393): `plugin_identity_ambiguous`, `plugin_identity_changed`, `plugin_set_changed`. local cache 불안정은 `plugin_identity_cache_unstable`로 기록된다(probe `probe-bg-plugin-host.cjs:441-452`).
6. BG 종료 경로(조립 트리 `server/node/bgOrchestrator.cjs`): full mode에서 `markProviderEffects()`(967)가 `sendChatWithDirectLifecycle` 직전에 실행되고, throw는 `fullThrew`(974)로 잡힌다. 결과는 `terminal-error`(1678-1686) → `generation_failed` 알림(1750-1752) → 결과 영속(1754) → `markRunFailureSynchronously(operationId, serverInputProviderStarted)`(1769-1775)이다. 서버 입력(inputCommandVersion 1)에서 attached 기록은 `settleSynchronously('failed')`(`serverChatInputOwner.cjs:1700-1713`). 이 경로에 자동 재실행은 없다(조사에서 이 terminal 상태를 다시 시작하는 코드를 찾지 못함; drain의 자동 재시작은 waiting envelope 전용, `serverChatInputDrain.cjs:39-78`).
7. 취소: 사용자 중지는 `orchestration cancelled`로 llmAbort를 중단하고, host는 `plugin_operation_closed`를 throw하며(468, 501), orchestrator는 `activeRun.cancelled`로 결과를 버린다(1673-1676). 600초 timeout도 같은 host 경로다.
8. 사용자 결정(2026-10-22):
   - 같은 작업의 앞 단계(입력 스크립트 hook 등)에서 실행 실패로 꺼진 플러그인이 beforeRequest를 등록해 두었으면, 그 beforeRequest 시점에 요청을 실패로 처리한다.
   - 작업 도중 사용자의 플러그인 수정·비활성화·순서 변경(identity 변경)으로 꺼진 플러그인은 알림 후 그 플러그인 없이 진행한다(foreground에서 플러그인을 내리면 hook이 빠진 채 요청이 계속되는 것과 같음).

## 설계

대상은 **contract `replacer`, kind `before_request`**인 호출 하나다. body interceptor·afterRequest·script·provider의 실패 처리는 바꾸지 않는다.

- entry에 비활성화 원인을 남긴다. `disable(entry, code, api)`가 실제로 entry를 failed로 바꾸는 경우(344의 no-op 조건 뒤)에만 원인을 한 번 기록하고, 이후의 `plugin_hook_failed`·session 종료·identity refresh가 덮어쓰지 않는다.
  - `identity`: `code === 'plugin_identity_changed'`, 또는 `code === 'plugin_api_unsupported'`이면서 `api`가 `plugin_identity_ambiguous`·`plugin_set_changed`·`plugin_identity_cache_unstable`인 경우(`bgPluginHost.cjs:383,385,391,660`).
  - `execution`: 그 밖의 모든 비활성화(권한, 미지원 API, dispatcher 오류, session/worker 실패, worker 자체 timeout `plugin_sandbox_timeout`, callback·결과 오류, host 한도, 저장 CAS 충돌).
  - 기존 알림 내용·우선순위·eventKey는 바꾸지 않는다.
- replacer beforeRequest의 판정(우선순위 순):
  1. notice/identity 저장 실패(`noticeFailure`, `identityFailure`)는 지금처럼 가장 먼저 rethrow한다.
  2. 취소·종료(`closed`·`tearingDown`·`entry.closing`·`signal.aborted`)는 `plugin_operation_closed`로 reject한다. 456-460에서 `closed` host가 원래 입력을 반환하던 경로도 포함한다. 이 판정은 `await`(`noticesSettled`, `currentIdentity`, `pullAbsent`) 뒤마다, 그리고 반환·실패 합성 직전에 다시 한다. teardown catch(495)가 원래 오류를 그대로 rethrow하는 경로도 이 계약에서는 `plugin_operation_closed`로 맞춘다. 작업 timeout(orchestrator 600초 타이머, `bgOrchestrator.cjs:448`)은 `signal.aborted`로 이 분류에 속하고, worker/sandbox 자체 timeout은 실행 실패다.
  3. 호출 중 callback이 throw하거나, 결과가 배열이 아니거나, 호출 중 실행 실패로 entry가 꺼지면(479 포함): 기존대로 `pullAbsent` → `disable` → 알림 정산을 한 뒤 원래 입력을 반환하지 않고 `plugin_before_request_failed`를 throw한다.
  4. 호출 시점에 이미 실행 실패로 꺼진 entry(456-460, 470-473): 알림 정산 뒤 `plugin_before_request_failed`를 throw한다. 그 실패의 최종 알림은 이미 나갔으므로 새 플러그인 알림을 만들지 않는다.
  5. identity 원인으로 꺼진 entry(호출 전이든 호출 중이든): 지금처럼 원래 입력을 반환한다(진행).
- 플러그인 내부에서 API 거절을 잡고 배열을 돌려준 경우는 **entry가 꺼지지 않았을 때만** 진행한다(진단 전용 absent API, 복구 가능한 한도 거절, 잡힌 local storage CAS). 호출 중 entry가 실행 실패로 꺼졌다면(예: 동기 binding 실패, `probe-bg-plugin-host.cjs:1112-1120`) 플러그인이 잡았더라도 요청 실패다.
- `pullAbsent()`는 catch의 disable 전, 두 identity 확인 지점, 알림 정산의 현재 순서를 유지한다. 이미 꺼졌거나 session이 실패한 entry는 absent 진단을 회수하지 못할 수 있으며(`collectAbsent`가 건너뜀), 이를 회수한다고 약속하지 않는다.
- orchestrator·request 코드는 바꾸지 않는다. 결과는 실패가 일어난 요청에 따라 다음과 같다(Astra 확인, 조립 트리 기준).
  - **본 답변 요청(`model`)과 그 재시도:** throw가 `request.ts:254` → `sendChat`(`index.svelte.ts:1617`) → direct lifecycle → `fullThrew`(`bgOrchestrator.cjs:974`)로 전파된다. 답변이 없으므로 `terminal-error`, `generation_failed`, 입력 기록 `failed` 정산이다. 같은 모델 재시도에서 throw하면 다음 재시도·fallback으로 가지 않는다.
  - **본 답변 전 기억 요약(HypaV3 등):** 요약 실패는 기억 코드가 잡아 오류 객체로 돌려주고(`hypav3.ts:1163,1390`, `:443-455`, `taskRateLimiter.ts:54-57`) `sendChat`이 `false`로 끝난다(`index.svelte.ts:1146-1155`). `fullThrew`는 비지만 답변이 없으므로 `terminal-error`다.
  - **본 답변 뒤 보조 요청(감정·IGP `index.svelte.ts:1965,2162`, 이미지 prompt `stableDiff.ts:34`):** 이미 답변이 있으므로 `terminal-partial`로 커밋된다(`bgOrchestrator.cjs:1678-1690`). 결과가 throw됐으므로 커밋 뒤에도 `generation_failed`가 게시된다(`serverChatCommitOwner.cjs:892`, `bgOperationNotices.cjs:42`; 계획 초안의 "나가지 않는다"는 구현 중 정정). 플러그인 실패 알림은 남는다. 이미 만들어진 답변을 되돌리지 않으며, foreground에서도 답변 저장 뒤 보조 요청 throw는 답변을 유지한다.
  - **번역:** `translator.ts:573`에서 throw가 그대로 전파된다(호출자 처리는 foreground와 같음).
  - BG는 실행 실패로 꺼진 entry가 작업이 끝날 때까지 꺼져 있으므로, 같은 작업의 이후 beforeRequest 호출도 실패한다. foreground는 같은 hook을 다시 실행할 수 있으므로 한 작업 전체에서의 완전한 foreground parity를 주장하지 않는다.

## 수정 파일과 커밋 단위

| ID | 제목 |
|---|---|
| D1a-1 | BG beforeRequest failure fails the request |

- 구현: `patches/lazy-chat-bg-adapter/files-1.10/server/node/bgPluginHost.cjs`.
- 바뀌는 기존 기대(probe, 실행 실패 원인만): `scripts/probe-bg-plugin-host.cjs`의 454-459(failed-order), 603-616(canonical argument conflict), 741-751(uncaught local frame refusal), 783-793(failed hook keeps chain value), 823-836(forged unknown root RPC), 838-846(policy-rejected getArg), 981-988(permission denial after input effect), 1112-1120(sync binding failure), 1234-1242(limit then terminal failure), 1244-1255(limit then resource failure), 1342-1356(.catch-only absent API), 1358-1371(forged inherited names); `scripts/probe-bg-plugin-capability.cjs`의 322-324(S1 forged outside list), 392-397(S7 uncaught absent). 각 사례는 "resolve to input"에서 "`plugin_before_request_failed`로 reject, 기존 알림·effects·network 단언 유지"로 바뀐다. 783-793(hook chain)에는 세 번째 hook이 실행되지 않음을 단언으로 추가한다. 741-751과 1234-1255의 경고 알림과 최종 실패 알림을 따로 세는 기대는 유지한다. 줄 번호는 `dd5641a` 기준 조사 결과이며 구현 전에 다시 확인한다.
- 유지되는 기존 기대: identity 원인 사례(321-332, 334-342, 344-353, 355-364, 366-372, 374-379, 441-452, 477-484, 486-520, 522-530 tail append, 533-548 live arguments, 550-560 disabled same-name duplicate, 562-571, 584-601 provider identity invalidation 뒤 beforeRequest, 618-626 relative-order insertion), 취소·closed·identity 저장 실패 사례(407-413, 415-422, 468-475, 1122-1141, 1257-1269), provider·body·afterRequest·script 사례, 플러그인이 잡고 정상 반환하는 사례.
- MARP·PageFold·combination probe는 host fail-open에 기대지 않는 것으로 조사됐다(MARP는 플러그인 자체 복구, PageFold는 provider). 외부 플러그인 원본이 저장소에 없어 확정하지 못한 사례(`probe-bg-marp.cjs:84,90`, `probe-bg-marp-pdf-limits.cjs:109`, `probe-bg-plugin-combination.cjs:121`, `scripts/probes/bg-marp-pdf-host.cjs:38`)는 구현 뒤 실제 실행으로 확인한다.
- 릴리스 식별: `package.json`(0.2.4-experimental.84), `patches/lazy-chat-bg-adapter/manifest.cjs`(0.7.79), `CHANGELOG.md`, `dist/`, 버전 단언(`test/bg-independent-g1.test.cjs`, `test/g22a-capability.test.cjs`).

## 합격 기준

1. host 단위: replacer beforeRequest가 throw·reject·배열 아닌 결과·호출 중 실행 실패(권한 없음, 미지원 API, host 한도, worker 실패, worker 자체 timeout, 저장 CAS 충돌)일 때 `plugin_before_request_failed`로 reject하고, 그 플러그인의 최종 실패 알림은 기존 코드·phase·effectsMayHaveOccurred로 한 번 남는다(앞선 경고 알림이 있으면 그것은 그대로 유지).
2. 같은 작업 앞 단계(입력 스크립트 hook, 앞 beforeRequest 호출, entry를 비활성화하는 provider 실패)에서 실행 실패로 꺼진 플러그인의 beforeRequest 호출은 reject한다. provider가 `plugin_execution_failed`로 실패하면 기존 provider 처리대로 알림만 남기고 entry를 끄지 않으므로(`bgPluginHost.cjs` provider catch), 그 뒤 beforeRequest는 정상 실행된다(구현 중 확인, provider 실패 처리는 바꾸지 않는다). 앞 단계에서 꺼진 플러그인의 beforeRequest 호출은 reject하고 새 플러그인 알림을 만들지 않는다. 로드 단계에서 빠진 플러그인은 hook이 설치되지 않아 요청이 진행된다(§2 결정 유지).
3. identity 원인(수정·비활성화·순서 변경·추가·이름 중복·cache 불안정, 각 `code`/`api` 조합)으로 꺼진 플러그인의 beforeRequest는 원래 입력을 반환하고 요청이 진행된다. identity로 먼저 꺼진 뒤 다른 오류가 나도 원인은 identity로 남는다. "먼저"는 host가 비활성화를 기록한 순서다. 플러그인 집합이 바뀌었더라도 host가 그 변경을 감지하기 전에 API 실패로 먼저 비활성화했다면 원인은 실행 실패다(구현 중 확인). 플러그인이 스스로 던진 `plugin_identity_changed` 코드는 identity 원인으로 취급하지 않는다.
4. 우선순위: notice/identity 저장 실패 > 취소·closed·teardown·작업 timeout(`plugin_operation_closed`) > 실행 실패(`plugin_before_request_failed`) > identity 진행. 알림 정산 대기 중 취소가 일어나는 경우를 실행 실패로 꺼진 entry와 identity로 꺼진 entry 각각에서 시험한다.
5. body interceptor·afterRequest·input/output script·provider의 실패 처리, entry가 살아 있는 상태에서 플러그인이 잡고 배열을 돌려주는 경우(진단 전용 absent API, 복구 가능한 한도 거절), 다른 handler의 결과·권한·예산은 바뀌지 않는다. local storage CAS 충돌을 잡은 경우(진행)와 잡지 않은 경우(요청 실패)를 각각 시험한다.
6. 서버 실행(실제 orchestrator, 합성 데이터, 가짜 provider), 본 답변 전 실패: 첫 호출 throw(효과 전), backend/보조 호출 뒤 throw(효과 뒤), 앞선 provider 시도 뒤 같은 모델 재시도에서의 throw(재시도 예산 소진 포함), 입력 스크립트 hook 실패 뒤의 beforeRequest를 각각 실행해 다음을 단언한다: 실패 뒤 provider 호출 없음(앞선 시도는 그 수만큼), terminal 결과 `terminal-error`, `generation_failed`와 플러그인 알림, 정상 채팅의 사용자 메시지 보존, 새 assistant 답변 없음. 서버 입력(inputCommandVersion 1)은 영속 input receipt와 `failed` 정산을, 기존 위임 시작 경로는 그 경로의 결과·입력 소유 기록을 단언한다.
6a. 자동 재실행 없음: 6의 실패 뒤 서버 재시작, 결과 claim/ACK, 재접속을 거쳐도 provider 호출과 operation 수가 늘지 않고 입력이 다시 시작되지 않는다(두 시작 경로 모두).
6b. 본 답변 뒤 보조 요청(감정·이미지 prompt 등)의 beforeRequest 실패: 기존 답변이 `terminal-partial`로 커밋되어 남고, 플러그인 실패 알림과 `generation_failed` 작업 알림이 남으며, 그 뒤 provider 호출이 없다. (정정: 결과가 throw되면 commit owner가 `notificationGenerationFailed`를 기록해 커밋 성공 뒤에도 `generation_failed`가 게시된다, `serverChatCommitOwner.cjs:892`·`bgOperationNotices.cjs:42`. 이는 기존 동작이며 이 단위에서 바꾸지 않는다.)
- 시험 주의: 플러그인 실패 알림은 작업이 달라도 같은 플러그인 identity·code·phase·effects이면 보관 기간 안에서 하나로 묶인다(`bgNotifications.cjs` `publishPluginFailure`). 여러 작업에 걸친 사례는 플러그인을 달리하거나 이 묶음을 감안해 단언한다.
7. 기존 동작 유지: MARP·PageFold·combination·capability·host·worker·process probe(바뀌는 기대 외), G2.2a·G2.2b 테스트, 기존 테스트 수(직전 client 2621/4, server 789/12, compat 123/5, `pnpm check` 0/0, 저장소 351/348/0/3).
8. D1 적용 전 fail-open 측정 사례를 보존한다: G2.2c 서버 실측의 RCM backend 중단 실행 기록과, 위 probe 사례의 변경 전 기대를 이 문서와 commit diff로 남긴다.

## 바꾸지 않을 동작

request.ts·sendChat·orchestrator, body interceptor·afterRequest·script·provider 실패 처리, 로드 단계 제외 규칙(§2), identity 변경 시 진행, 알림 코드·eventKey·우선순위, 권한·예산·worker·sandbox, foreground 코드, RCM 원본, D2(MCP)·D3·D4.

## 검사 명령

- 후보 전체 gate 스크립트(commit 직전).
- 조립 트리: `node scripts/probe-bg-plugin-host.cjs <tree>`, `node scripts/probe-bg-plugin-capability.cjs <tree>`, worker·process·MARP·PageFold·combination probe.
- 새 테스트 focused 실행(`--config vitest.config.server.ts`).
- `node --test test/*.test.cjs`.

## 검수 기록

- **Astra(gpt-6-astra, read-only) 1회차:** 지적 5건을 모두 채택했다. ① identity 분류는 `code`와 `api`를 함께 봐야 한다(ambiguous·set changed·cache unstable은 `plugin_api_unsupported` + `api`), 원인은 최초 전환 때 한 번만 기록. ② 보조 요청 결과는 하나가 아니다: 본 답변 전 기억 요약은 `sendChat` false로 `terminal-error`, 본 답변 뒤 보조 요청은 `terminal-partial` 커밋. ③ 취소 우선순위를 비동기 정산 뒤 재판정, worker 자체 timeout은 실행 실패. ④ 잡고 반환한 경우는 entry가 살아 있을 때만 진행, 알림 수는 최종 실패 알림 기준. ⑤ 자동 재실행 없음은 restart·claim/ACK·재접속으로 확인. 추가로 chain 중단 단언, local CAS 두 사례, 유지 identity 사례 5건을 목록에 넣었다. 오케스트레이터가 직접 확인한 근거: `bgPluginHost.cjs:383,391,660`의 `code`/`api` 조합, `index.svelte.ts:1146-1155`, `bgOrchestrator.cjs:1678-1690,1745-1752`. 변경이 지적 반영 범위라 2회차는 받지 않았다.

## 구현과 검증 기록 (2026-10-22 KST)

- **블라인드 테스트:** Argon(gemini-4-argon-medium) 시나리오 22개(`SUCCESS`, 제외 없음) → Codex gpt-5.6-sol 테스트 작성. 새 파일 `scripts/probe-bg-d1a-before-request.cjs`(실제 서버 실행: 두 시작 경로, 재시작·claim/ACK·재접속 뒤 재실행 없음, 보조 요청 `terminal-partial`)와 보조 파일 두 개, `probe-bg-plugin-host.cjs`·`probe-bg-plugin-capability.cjs` 끝의 `[D1a-1]` 블록. 기존 테스트는 작성자가 건드리지 않았고, 기존 fail-open 기대 14곳은 구현자가 "입력 반환"을 "`plugin_before_request_failed` reject"로만 바꿨다(오케스트레이터가 줄 단위로 확인).
- **구현(opus-implementer):** `bgPluginHost.cjs`에 `failClosed`(replacer + before_request) 경로와 `settleBeforeRequest`(알림 정산 → notice/identity 저장 실패 → 취소·닫힘 → identity면 입력 반환, 아니면 reject). 비활성화 원인은 `disable(..., cause)`의 명시 인자로만 기록하고, `identity`는 `validateIdentity`와 host가 만든 identity 오류(WeakSet: cache 재로드 거절, `bgPluginStorage.cjs`의 스크립트 불일치 거절)에서만 넘긴다.
- **구현 중 정정 3건:**
  1. 테스트 7개가 계획 전제·fixture 문제로 실패: provider `plugin_execution_failed`는 entry를 끄지 않음(기준 2 정정), "먼저"는 host가 기록한 순서(기준 3 정정), 답변 뒤 보조 요청 실패에도 `generation_failed` 게시(6b 정정), 알림의 작업 간 중복 묶음, 재시도 fixture, 경고+최종 알림 두 개, 지원 API를 부른 잘못된 행. 같은 Codex 세션 resume으로 테스트를 고쳤다.
  2. Codex 코드 검수 1회차 P1: 플러그인이 던진 오류 코드·RPC 이름으로 identity 원인을 위조할 수 있었다(입력 스크립트 catch, API dispatcher catch). 문자열 추론을 없애고 위의 신뢰 인자로 바꿨다. storage가 감지한 스크립트 변경도 같은 표식으로 identity에 넣었다(사용자 결정 「identity 변경은 진행」 적용).
  3. 검수 2회차 P1: 마지막 알림 정산 대기 중 worker가 실패하면 값을 그대로 반환했다. 정산 뒤 `entry.failed`를 다시 판정하도록 고치고, 이 경합의 회귀 테스트를 추가했다(수정 전 트리에서 실패 확인). 3회차 검수는 새 지적 0건.
- **최종 확인(commit 직전 후보 gate, 조립 트리):** gate 19/19 PASS. client 2621/4, server 789/12, compat 123/5, `pnpm check` 0/0, 저장소 351/348/0/3. host probe 176/0, capability 12/0, worker 12/0, D1a 서버 실행 probe 15/0. 고정 테스트 SHA-256 일치.
- **미실행:** `probe-bg-plugin-process.cjs`(fixture 부재), MARP·PageFold·combination probe(외부 플러그인 원본 필요). 실제 RCM과 함께 D1-a 경로를 돌리는 확인은 G2.2c 방식으로 별도 실행한다.
- **후속 단위(사용자 결정, D1-a 다음):** 캐릭터의 `reloadKeys`는 초기값 없이 선택 필드라, 답변 뒤 native 코드의 `reloadKeys += 1`이 `NaN`을 만든다(`index.svelte.ts:1682` 등). BG RPC는 유한한 숫자만 보내므로(`bgPluginWorker.cjs:238`) 같은 작업의 답변 뒤 요청에서 `getCharacter`가 실패한다. 이전에는 그 플러그인이 꺼진 채 진행했고, D1-a 뒤에는 답변 뒤 보조 요청에서 `terminal-partial`과 `generation_failed`로 드러난다. foreground는 `NaN`을 그대로 전달한다. host의 비유한 숫자 전달 규칙을 정하는 별도 단위로 고친다.
- **시험 위생:** D1a 서버 실행 probe는 실행마다 `/tmp/pocketrisu-d1a-*` 작업 폴더를 남긴다. 실행한 쪽이 정확한 경로로 지웠다.

## 미확인

- 경계 사례: 작업 중 외부에서 플러그인 인자(`realArg`)를 고친 뒤 플러그인의 `setArgument`가 CAS 충돌로 거절되는 경우(`probe-bg-plugin-host.cjs:603-616`)는 현재 `plugin_hook_failed`(실행 실패)로 기록된다. 원인은 사용자 편집이지만 플러그인 자신의 쓰기가 실패해 hook이 끝나지 못한 것이므로 이 계획은 실행 실패(요청 실패)로 분류한다. 검수 결과에 따라 사용자 결정이 필요하면 구현 전에 받는다.
- `settleSynchronously('failed')`가 정상 채팅의 사용자 메시지를 보존하는지(합격 기준 6에서 실측).
- 보조 모드(`model`이 아닌 requestChatData 호출, 예: 기억 요약) 호출자가 replacer throw를 잡는지. native와 같은 전파이므로 결과는 호출자에 따르며, 서버 실행에서 관측한다.
- RCM의 30초/180초 선택이 BG(화면 없음)에서 어떻게 끝나는지는 G2.2c 브라우저 실측 뒤 이 계약에 연결한다.
