# G2.2 후속 단위 계획 — BG plugin RPC의 비유한 숫자 전달

**상태 (2026-10-22 KST):** 계획. Astra 1회차 반영, 구현 전.
배경: [D1-a 계획](BG-G2-2-D1A-BEFORE-REQUEST-FAILURE-PLAN.md) 「구현과 검증 기록」의 후속 단위(사용자 결정: D1-a 바로 다음). 대상: patcher `origin/main` `d476d60`(0.2.4-experimental.84, lazy-chat-bg-adapter 0.7.79), 작업 branch `claude/bg-nonfinite-values`.
위험 분류: **risky** (host↔worker RPC 경계의 값 영역이 넓어져 모든 host handler와 플러그인이 받는 입력이 바뀜).

## 목표

BG 요청별 플러그인 host와 worker 사이의 값 전달이 foreground와 같이 `NaN`, `Infinity`, `-Infinity`, `-0`을 보존하게 한다. 지금은 이런 값이 들어 있으면 RPC가 `plugin_rpc_type_unsupported`로 실패해, 같은 작업에서 답변 뒤 `getCharacter`처럼 정상 데이터를 읽는 호출이 실패한다.

## 확인한 사실

1. 원인 사례: 캐릭터 `reloadKeys`는 초기값이 없는 선택 필드이고(`database.svelte.ts:1820` 타입 선언만), 답변 뒤 native 코드가 `reloadKeys += 1`을 실행해(`index.svelte.ts:1682,1721,1727,1786,1817,1907`) `NaN`이 된다. 같은 작업의 답변 뒤 요청에서 플러그인이 `getCharacter()`를 부르면 실패한다(D1-a 검증 중 관측). D1-a 뒤에는 답변 뒤 보조 요청에서 `terminal-partial`과 `generation_failed`로 드러난다.
2. 전송 형식: worker와 host는 JSON 줄 프레임을 주고받는다(`bgPluginSandbox.cjs:182` parse, `:230` stringify, `bgPluginWorker.cjs:767` parse). JSON은 `NaN`·`±Infinity`를 표현하지 못하고(`null`이 됨) `-0`의 부호를 잃는다.
3. 값 인코딩(`bgPluginWorker.cjs`의 `pack`/`unpack`, 양쪽 peer가 같은 코드를 쓴다): 숫자는 `Number.isFinite`일 때만 `['value', n]`으로 보내고(`:238`), 받을 때도 같은 조건만 받는다(`:377`). 그 밖의 숫자는 보낼 때 `plugin_rpc_type_unsupported`, 받을 때 `plugin_rpc_value_invalid`다. 다른 타입은 태그(`date`, `bytes`, `headers`, `search`, `response` 등)로 보낸다. `-0`은 지금 `['value', -0]`으로 나가 JSON에서 `0`이 된다.
4. foreground: guest iframe과 host는 `postMessage`(structured clone)로 값을 넘긴다(`src/ts/plugins/apiV3/factory.ts`). structured clone은 `NaN`, `±Infinity`, `-0`을 보존한다.
5. host 쪽 값 복사 `clonePluginValue`(`bgPluginValue.cjs:36-39`)는 `structuredClone`이라 이 값들을 보존한다. 크기 측정 `measurePluginValue`(`:5-`)는 숫자 값의 종류를 구분하지 않는다.
6. 기존 테스트 중 RPC 경계에서 비유한 숫자 거절을 단언하는 것은 찾지 못했다(`probe-bg-plugin-local-rpc.cjs`의 type 거절 사례는 `Map`).

## 설계

- `pack`: 숫자가 `Number.isFinite`가 아니거나 `Object.is(value, -0)`이면 새 태그 `['number', 'NaN' | 'Infinity' | '-Infinity' | '-0']`으로 보낸다. 유한한 숫자(−0 제외)는 지금처럼 `['value', n]`.
- `unpack`: `['number', s]`는 길이 2이고 `s`가 정확히 네 문자열 중 하나일 때만 받아 해당 값으로 되돌린다. 그 밖의 `['number', …]`와, `['value', n]`의 비유한 `n`은 지금처럼 `plugin_rpc_value_invalid`.
- 양방향(host→guest, guest→host)에 같은 규칙이 적용된다(같은 `pack`/`unpack`). foreground도 양방향 모두 보존한다.
- 노드 수·깊이·바이트 한도는 기존 규칙 그대로 적용한다(태그 하나가 노드 하나).
- host handler의 입력 검증(정수·범위 검사 등)은 바꾸지 않는다. 비유한 숫자를 받게 되는 handler가 이를 안전하게 다루는지는 검수와 시험에서 확인하고, 문제가 있으면 그 handler의 기존 검증으로 거절되어야 한다.

## 수정 파일과 커밋 단위

| ID | 제목 |
|---|---|
| NF-1 | BG plugin RPC carries non-finite numbers |

- 구현: `patches/lazy-chat-bg-adapter/files-1.10/server/node/bgPluginWorker.cjs`.
- 릴리스 식별: `package.json`(0.2.4-experimental.85), `patches/lazy-chat-bg-adapter/manifest.cjs`(0.7.80), `CHANGELOG.md`, `dist/`, 버전 단언(`test/bg-independent-g1.test.cjs`, `test/g22a-capability.test.cjs`).

## 합격 기준

1. host→guest와 guest→host 양방향에서 `NaN`, `Infinity`, `-Infinity`, `-0`이 최상위 값, 배열 원소, 객체 속성, 중첩 구조 안에서 모두 `Object.is`로 같은 값이 된다. 유한한 숫자와 다른 타입의 전달은 바뀌지 않는다.
2. 위조 프레임: `['number', x]`에서 `x`가 네 문자열이 아니거나 길이가 다르면 `plugin_rpc_value_invalid`. `['value', NaN]`처럼 JSON으로 만들 수 없는 값을 흉내 낸 프레임(예: `['value', null]`은 null로 유지, 문자열 `"NaN"`은 문자열로 유지)은 의미가 바뀌지 않는다.
3. 한도: 비유한 숫자가 많은 값도 기존 노드·깊이·바이트 한도로 계산되고, 한도 초과는 기존 오류 코드다.
4. 원인 사례: 실제 서버 실행에서 `reloadKeys`가 없는 캐릭터로 답변 뒤 보조 요청(감정 등)의 beforeRequest가 `getCharacter()`를 불러도 실패하지 않고, 플러그인이 받은 `reloadKeys`가 `NaN`이다. D1-a의 `terminal-partial`·`generation_failed`가 이 원인으로 생기지 않는다.
5. host handler: 비유한 숫자 인자를 받는 주요 root handler(`getChatFromIndex`, `getCharacterFromIndex`, storage `setItem`/`setArgument`, `nativeFetch` 옵션 등)가 기존 검증으로 거절하거나 foreground와 같은 결과를 내고, 예외로 host를 깨지 않는다.
6. 기존 동작 유지: 다른 RPC 값·스트림·응답·함수 핸들, 한도, D1-a·G2.2b·G2.2a 동작, 기존 테스트 수(직전 client 2621/4, server 789/12, compat 123/5, `pnpm check` 0/0, 저장소 351/348/0/3, host probe 176/0, capability 12/0, worker 12/0, D1a process 15/0).

7. 시험은 실제 JSON stringify/parse를 양방향으로 거친다(기존 local-RPC pair는 frame 객체를 그대로 넘기므로 `-0` 손실을 잡지 못한다). 호출 인자·반환값·callback 결과·stream chunk를 따로 시험하고, `null`·문자열 `"NaN"` 같은 닮은 값과 인접한 특수값을 함께 둔다.
8. 위조·경계 프레임: 잘못된 `['number', …]` 태그, 실제 JSON 넘침 프레임(`["value",1e400]`은 parse 뒤 Infinity)은 거절하고, 숫자 id·response status·largeString 길이 검사는 완화하지 않는다. pack 노드/깊이 한도, unpack 검증 실패, wire 바이트 한도는 각각의 기존 오류 코드로 단언한다.
9. host 검증 경계: 비유한 숫자가 이제 host dispatch까지 도달하므로, handler 검증 실패가 플러그인을 비활성화하는 기존 수명 결과를 새 session에서 단언한다(index 인자, `setArgument` 숫자 거절, 권한 인자).
10. timeout: `nativeFetch`/`risuFetch`의 `requestTimeoutMs`에 `Infinity`를 주면 공용 helper가 Node에서 약 1ms timeout으로 처리하고(`lazy-chat-sync globalApi.svelte.ts:80-89`), `NaN`·`-Infinity`·`-0`은 timeout 없이 진행한다. foreground도 같은 helper를 쓰므로 parity 동작으로 시험에 고정하고 이 단위에서 바꾸지 않는다.
11. 인과 서버 시험: `reloadKeys`가 처음에 없음을 확인하고, native 답변 처리가 `NaN`을 만들게 둔 뒤, 보조 요청 beforeRequest에서 `Object.is(x, NaN)` 결과를 boolean으로 돌려받아 확인한다(로그는 `NaN`을 `null`로 표시하므로 쓰지 않는다).

## 남는 한계 (이 단위에서 바꾸지 않음)

- BG plugin storage(`bgPluginStorage.cjs:22,77,126,138`)는 값을 JSON으로 정규화해 `NaN`·`±Infinity`는 `null`, `-0`은 `0`이 된다. foreground는 root storage에 원래 값을 그대로 두고 local storage도 cache에서 바로 읽으면 원래 값을 돌려준다(디스크 저장은 JSON). 즉 즉시 읽기 결과가 다르다.
- storage fingerprint(`bgPluginStorage.cjs:51` → `serverChatCommit.cjs:38,82` `stableJSON`/`clonePlainValue`)는 비유한 숫자를 거절한다. 다른 경로로 이미 비유한 숫자가 저장된 항목을 읽거나 갱신하면 RPC 전에 실패할 수 있다(일반 `getCharacter` hydrate는 이 경로를 쓰지 않음).
- DB 영속은 경로마다 다르다(MessagePack `encodeRisuSaveLegacy`는 `NaN`·`±Infinity`를 보존하고 `-0`은 `0`이 됨, 일부 저장 경로는 JSON). 영속 parity는 이 단위의 범위가 아니다.
- 알림 로그(`bgPluginHost.cjs:74`)는 문자열이 아닌 값을 JSON으로 보여 주므로 `NaN`이 `null`로 표시된다.

## 검수 기록

- **Astra(gpt-6-astra, read-only) 1회차:** 양방향·`-0` 포함 권고. 지적 6건(경로 충분성 확인, `Infinity` timeout, storage 정규화, DB 영속 경로 차이, storage fingerprint 경계, 로그 손실)과 시험 추가 항목을 모두 채택해 합격 기준 7~11과 「남는 한계」에 반영했다. 검수자는 제안 codec을 메모리에서 48회 JSON 왕복으로 시험했다.

## 바꾸지 않을 동작

host handler의 입력 검증, 영속화(플러그인 storage·DB 저장 시 값의 처리), 한도, 다른 태그, foreground 코드, D1-a·G2.2b 계약.

## 검사 명령

- 후보 전체 gate 스크립트(commit 직전).
- 조립 트리: `probe-bg-plugin-local-rpc.cjs`, `probe-bg-plugin-worker.cjs`, `probe-bg-plugin-host.cjs`, `probe-bg-plugin-capability.cjs`, `probe-bg-d1a-before-request.cjs`.
- `node --test test/*.test.cjs`.

## 미확인

- 플러그인이 비유한 숫자를 storage에 저장할 때의 영속 결과(JSON 저장이면 `null`)가 foreground와 같은지. 이 단위는 전송만 다루고 영속화는 바꾸지 않는다.
