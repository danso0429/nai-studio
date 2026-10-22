# D2 구현 계획 — BG에서 플러그인 MCP 도구 지원

**상태 (2026-10-22 KST):** 계획 초안. Astra 계획 검수 전, 구현 전.
정본: [G2.2 실행 계획](BG-G2-2-EXECUTION-PLAN.md) §3(B) D2(결정 2026-10-17: 지원 구현, 2026-10-22: BG에서 beforeRequest 뒤 도구 다시 읽기)와 Astra r2 구현 조건. 대상: patcher `origin/main` `d476d60` 이후(NaN 단위 뒤에 착수).
위험 분류: **risky** (공통 BG host, request 경로, 오래 사는 서버 번들의 전역 cache, 유료 모델 후속 요청, 시한).

## 목표

BG 작업에서 RCM처럼 `registerMCP`로 도구를 등록하는 플러그인의 도구가 그 작업의 모델 요청에 보이고, 모델이 부른 도구가 플러그인 callback으로 실행되며, 결과가 기존 도구 loop로 모델에 돌아간다. 작업이 끝나면 등록과 cache가 모두 정리되어 다음 작업이 닫힌 host의 callback을 부르지 않는다. 시한·예산은 기존 값 안에서 지킨다.

## 확인한 사실

경로는 patcher를 apply한 PocketRisu 1.10.0 조립 트리 기준이다.

1. foreground 등록: `v3.svelte.ts:1344-1345`가 `registerMCP`/`unregisterMCP`를 `pluginmcp.ts`의 `registerMCPModule`/`unregisterMCPModule`에 그대로 연결한다. 식별자는 `plugin:`으로 시작해야 하고(`pluginmcp.ts:45`), 등록은 모듈 수준 Map `registeredCustomPluginMCPs`에 client를 넣는다(`:48-53`). 해제는 그 Map에서만 지운다(`:56-58`).
2. 도구 노출: `mcp.ts:137-151` `getMCPTools`는 `MCPs`를 순회하고, `MCPs`는 활성 모듈의 `mcp.url`(`modules.ts:361-365`, 활성 모듈 = enabledModules·chat·character·persona 모듈)로 채워진다. `plugin:` URL은 그 URL이 모듈 목록에 있을 때만 등록 Map에서 가져온다(`mcp.ts:71-77`). `MCPs`에 이미 있으면 다시 해석하지 않고(`:28-29`), URL이 모듈 목록에서 빠질 때만 지운다(`:129-134`). 해제는 `MCPs`를 지우지 않는다.
3. 도구 시점: `request.ts:213` `const tools = arg.tools ?? (await getTools())`가 요청마다 한 번, fallback loop와 beforeRequest replacer(`:252-254`) **전에** 실행되고, 같은 `tools`가 각 재시도에 쓰인다(`:287`). 실행 중 다시 읽지 않는다. ModelPreset만 `preset.toolUse`·adapter 능력으로 도구 사용을 거른다(`:942-947`); classic provider는 `arg.tools`를 그대로 쓴다.
4. 도구 호출자:
   - ModelPreset: `runModelPresetToolLoop`(`request.ts:1468-1517`) → `executeModelPresetTool`(`:1519-1540`, callTool을 try로 감싸 "Tool call failed" 문자열). 최대 8단계(`:855`), 첫 송신 오류는 rethrow, 이후 오류는 부분 결과, 도구 전 abort 확인. `rememberToolUsage`일 때만 저장(`:1503`). 도구 실행 뒤 바깥 retry 금지(`:301-309`).
   - OpenAI classic: `openAI/requests.ts:711-800`(callTool을 try로 감쌈, 실패 문자열, follow-up을 `requestRetrys`만큼). Responses/stream `:1323-1340` 같은 방식. 단계 상한 미확인.
   - Google: `google.ts:886-944`(callTool에 try 없음, 오류 전파). follow-up backoff와 abort 확인(`:957-968`). 단계 상한 미확인.
   - Anthropic: `anthropic.ts:1020-1074`(callTool에 try 없음). abort 확인은 stream 경로에만(`:886`). 단계 상한 미확인.
5. RCM: `registerMCP({identifier:"plugin:risu-cognitive-memory", ...}, getToolList, callTool)`를 기능 확인 없이 부르고, 실패는 잡아 경고만 남긴다(로드 계속). `getToolList`는 `memoryToolsEnabled`이고 `memoryToolOpportunity.chatId`가 현재 채팅이며 archive 검색 가능 또는 recall 후보가 있을 때만 `recall_rp_memory`·`expand_rp_memory`를 내놓는다(`ao`). 이 기회는 beforeRequest 준비가 채운다. `callTool`은 backend에 POST하며 시한은 recall `mcpRequestTimeoutMs` 또는 920초, expand 15초. RCM은 `unregisterMCP`를 부르지 않고, MCP 모듈을 스스로 만들지 않는다(사용자가 `plugin:risu-cognitive-memory` URL 모듈을 켜는 방식, 확인 필요).
6. BG 현재: host `ROOT_HANDLERS`에 `registerMCP`/`unregisterMCP`가 없다(absent로 진단). MCP 모듈이 켜진 채팅은 BG 서버 입력으로 받지 않는다(`bgServerInputProviderPolicy.ts:132-134`, `mcp-unqualified`, 클라이언트 준비로 처리). provider는 `addProvider` 등록 → `install`에서 `bindings.installProvider`에 `invoke(entry,'provider',...)` callback을 넘기는 방식이다.
6a. 수용 판정 범위와 서버 번들(2026-10-22 추가 확인): `mcp-unqualified`는 원래 클라이언트 준비 경로였던 조합(`formerlyPrepared`: 확장 native route, 플러그인 route, 모듈 모델 바인딩, preset 고정, chat preset, `reverse_proxy`·`xcustom:::`·`pluginmodel:::` 모델)에만 적용된다(`bgServerInputProviderPolicy.ts:119-134`). 일반 classic 채팅은 MCP 모듈이 켜져 있어도 이미 BG 서버 입력이다. 서버 번들(`bgOrchBundle.build.cjs:91-107`, 진입 `process/index.svelte` 등)에는 `mcp.ts`·`pluginmcp.ts`·`getTools`가 그대로 들어 있고 MCP를 막는 patch가 없다. 따라서 외부 `http(s)` MCP URL은 서버에서 `MCPClient` handshake(`mcp.ts:109-122`, `mcplib.ts` `fetchNative`)를 거쳐 도구로 노출되고, `plugin:` URL은 서버 쪽 등록 Map이 비어 조용히 빠진다(코드 추론, 실행하지 않음). 클라이언트는 `/api/bg-orchestrate-capabilities`(`bgOrchestrator.cjs:1118-1134`)의 `serverPluginHostVersion`만 받으며, MCP 지원 여부를 나타내는 필드는 없다.
7. 예산·시한: host 전체 network/model 호출 128회(`bgPluginHost.cjs:37,119`, 공유), session 600초(`bgPluginSession.cjs:12`), 작업 600초 timer(`bgOrchestrator.cjs:448`).

## 설계 (검수 전 초안)

1. **등록 handler:** host `ROOT_HANDLERS`에 `registerMCP`/`unregisterMCP`를 추가한다. 등록은 load 단계(및 허용된 hook 단계)에서 받은 메타데이터와 두 callback 핸들을 entry에 행으로 기록하고, `install` 때 서버 번들의 `registerMCPModule`에 host 쪽 래퍼를 넘긴다. 래퍼는 `invoke(entry, 'tool_list' | 'tool_call', ...)` 형태로 worker callback을 부르며, 권한·identity·예산·취소·알림 규칙을 기존 hook과 같은 방식으로 적용한다. 식별자 `plugin:` 규칙과 다른 플러그인과의 식별자 충돌은 provider 이름 충돌과 같은 방식으로 거절한다.
2. **수명:** host `close()`의 cleanup에서 `unregisterMCPModule`과 함께 `MCPs` cache의 해당 `plugin:` 항목을 지운다(서버 번들 binding으로 노출). 다음 작업은 새 host의 등록만 본다. 닫힌 host의 callback 호출은 거절된다.
3. **도구 발견(사용자 결정):** BG 작업에서만, beforeRequest replacer loop가 끝난 뒤 `getTools()`를 다시 읽어 그 시도의 `tools`로 쓴다. foreground 경로와 `arg.tools`가 주어진 호출은 바꾸지 않는다. 재시도마다 다시 읽을지, 첫 시도 뒤 고정할지는 검수에서 정한다.
4. **시한·예산:** 도구 callback 호출은 host 공유 128회 예산에 포함하고, 작업·session의 남은 시간 안에서만 실행한다. RCM의 920초 recall 시한은 작업 600초 안에서 잘리며, 시한 도달 시 진행 중 HTTP·worker callback·모델 후속을 기존 취소 경로로 끝낸다. 기존 예산·시한은 늘리지 않는다.
5. **오류:** 도구 실행 실패는 각 provider의 기존 처리(ModelPreset·OpenAI는 실패 문자열, Google·Anthropic은 오류 전파)를 따르고, 플러그인 쪽 실패는 기존 알림 규칙으로 남긴다. 취소는 후속 모델 요청을 막는다.
6. **수용 판정:** capability에 MCP 지원 필드(예: `serverPluginMcpVersion`)를 추가하고, `formerlyPrepared` 조합의 `mcp-unqualified`는 그 필드가 지원을 보고하고 MCP URL이 모두 `plugin:`일 때만 해제한다. 일반 classic 채팅의 기존 수용(외부 MCP URL의 서버 handshake 포함)은 바꾸지 않는다. 다만 이 기존 동작(서버가 외부 MCP에 직접 연결)을 사용자 결과로 확인할지는 검수 뒤 결정 항목에 둔다.

## 검수 기록과 결정 (2026-10-22)

**Astra(gpt-6-astra, read-only) 1회차:** 구현 전 계획 수정 필요. 지적을 모두 채택했다. 오케스트레이터가 직접 확인한 근거: 알림 검사기가 phase를 `load/input/before_request/after_request/provider`로만 받음(`server/node/bgNotifications.cjs:54`, `src/ts/bgNotifications.ts:59`), `callMCPTool`이 도구 이름으로 첫 client를 고름(`mcp.ts:163-168`).
1. 사실 정정: `getModules`는 `moduleIntergration`도 포함하고 persona는 ID로 `db.modules`를 찾음; `initializeMCPs(additionalMCPs)`는 활성 모듈 밖 URL도 넣을 수 있음; 실행 중 `callMCPTool`이 도구 목록을 다시 읽음(`mcp.ts:162-168`); ModelPreset은 8단계·최대 9회 전송; OpenAI `requests.ts:1323`은 Responses가 아니라 Chat Completions stream이며 Responses(`:934`)는 별도 tools 배열; 128회 counter는 플러그인 `nativeFetch`·`risuFetch`·`runLLMModel`만 셈; 작업 600초 timer는 lock 획득 뒤 시작; 미등록 `plugin:` URL은 `console.error`를 남김.
2. 별도 호출 계약 `mcp_list`·`mcp_call`이 필요하다(기존 `invoke`는 실패 시 `args[0]`을 돌려주고 반환 변경을 효과로 표시). 두 알림 검사기와 호환 테스트를 함께 바꾼다. 실패 시 입력이나 빈 목록으로 대신하지 않고, 결과는 도구 정의·MCP content의 한도 있는 배열로 검증한다. 새 MCP 권한은 만들지 않는다(foreground에도 없음). 실행 전 effect/identity 장벽을 거치고, 목록 조회 자체는 효과로 세지 않는다. worker의 callback 함수 핸들을 그대로 쓴다.
3. 등록·정리: 전용 helper(메타데이터 + callback 두 개), load 중에는 staging 후 성공 시 설치, 허용된 hook 중에는 즉시 설치·교체. 같은 소유자 교체 허용, 다른 소유자의 등록·해제 거절, 실패한 load의 식별자 예약. client에 작업·entry·등록 세대 소유를 붙이고, 서버 binding이 돌려주는 idempotent cleanup이 `registeredCustomPluginMCPs`·`MCPs`에서 **자기 client를 가리킬 때만** 지운다. 해제·교체·비활성화·설치 rollback·close에서 무효화. 같은 이름 도구가 여러 client에 있으면 BG에서 거절하거나 작업 소유 client에 묶는다. `_previewLock` 직렬화 불변식을 시험으로 지킨다.
4. 도구 읽기 위치: BG에서는 최초 읽기(`request.ts:213`)를 건너뛰고(사용자 결정 아래), 실제 시도마다 replacer 블록 직후(`:256` 뒤, request trigger `:258` 전)에 읽어 그 시도의 `tools`로 쓴다. `arg.tools`가 주어지면(`[]` 포함) 그대로 둔다. PageFold route로 source 변환을 건너뛰는 재시도는 이전 목록을 쓴다. 준비·읽기 뒤 `requestChatDataMain` 전에 취소를 확인한다. BG 판별은 작업 범위 표지로 한다. ModelPreset의 세 조건(`:942`)을 유지한다. `runLLMModel`의 직접 호출에는 도구가 노출되지 않는다.
5. provider별 guard: 모든 도구 실행과 후속 요청 전에 abort 확인, 재귀·stream 전체에 "실행·효과 시작" latch를 두고 효과 뒤 프롬프트 재시도·fallback 재실행을 막는다. 128회는 후속 모델 요청을 세지 않으므로 별도 상한이 필요하다.
6. 시한: 작업·session 마감을 한 번 잡고, 목록·실행 전 남은 시간이 있어야 하며, callback scope·전송을 `min(작업 남은 시간, session 남은 시간, 더 짧은 호출 시한)`으로 묶는다. 만료 시 전송·scope 중단, 대기 RPC 거절, 새 효과 금지. 도구마다 새 600초를 주거나 RCM 920초를 쓰지 않는다. 시한 뒤의 성공 결과는 거절한다. counter 계산(도구 dispatch와 그 안의 fetch)은 명시한다.
7. 수용: `serverPluginMcpVersion: 1`은 bundle과 host가 정리까지 포함한 MCP 계약을 갖출 때만 보고하고, 서버 응답·클라이언트 타입·capability cache·클라이언트 재확인·서버 정책 평가까지 연결한다. 구 capability는 새 조합을 허용하지 않는다. `formerlyPrepared` 조합의 설정 URL이 모두 유효한 `plugin:`일 때만 완화한다. 일반 classic 채팅의 외부 MCP 수용은 바꾸지 않는다(외부 URL 지원 확대·축소는 별도 결정). 실제 생성된 bundle 안의 포함 여부는 빌드된 bundle로 확인한다.

**사용자 결정(2026-10-22):**
- 도구 효과 뒤 실패·후속 실패·상한 도달: **provider별 기존 동작을 따르고, BG에서는 효과 뒤 재시도·fallback으로 도구가 다시 실행되지 않게 막는다.**
- 비용 상한: **모든 provider에 도구 8단계**(ModelPreset의 기존 상한, 모델 전송 최대 9회). 작업 600초 시한은 별도로 유지.
- 도구 loop가 없는 변형(OpenAI Responses API, Anthropic streaming): **미지원으로 기록**하고 그 변형에서는 플러그인 MCP 도구를 내놓지 않은 채 진행하며 알림·지원표에 남긴다.
- 도구 읽기 횟수: **BG에서는 준비 뒤 한 번만**(최초 읽기 생략, 시도마다 준비 뒤). 2026-10-22 "beforeRequest 뒤 다시 읽기" 결정을 이 형태로 구체화한다.

## 결정이 더 필요한 것 (검수 뒤 사용자에게)

- 재시도·fallback 때 도구 목록을 매번 다시 읽을지.
- Google·Anthropic 경로의 도구 오류 전파(요청 실패)를 그대로 둘지.
- 일반 classic BG 채팅에서 외부 MCP URL에 서버가 직접 연결하는 기존 동작(코드 추론)을 유지할지, 실측 뒤 별도로 다룰지.

## 합격 기준 (초안)

1. 새 host에서 RCM 준비 응답이 도구를 여는 경우, 실제 첫 모델 요청 본문의 tools에 `recall_rp_memory`·`expand_rp_memory`가 있다(등록·수동 호출 성공만으로 통과 처리하지 않음).
2. 모델이 도구를 부르면 플러그인 callback이 실행되고 결과가 같은 provider의 기존 loop로 다음 요청에 들어간다. ModelPreset·OpenAI·Google·Anthropic 각 경로.
3. 작업 종료 뒤 `registeredCustomPluginMCPs`와 `MCPs`에 그 작업의 항목이 없고, 다음 작업에서 이전 callback이 불리지 않는다.
4. 시한·예산: 도구 호출이 128회 예산과 작업 남은 시간 안에서만 실행되고, 시한 도달 시 진행 중 호출이 끝나며 모델 후속이 없다. 취소도 같다.
5. 수용: `plugin:` MCP만 켜진 채팅은 host가 지원할 때 서버 입력으로 받고, 외부 MCP URL이 있으면 지금처럼 클라이언트 준비.
6. 기존 동작 유지: foreground MCP, `arg.tools`가 있는 호출, 도구 없는 BG 요청, provider·hook 동작, D1-a·G2.2b·NaN 단위 결과, 기존 테스트 수.

## 미확인

- 사용자가 RCM 도구를 켜는 정확한 방식(모듈 `mcp.url`), 서버 번들에 MCP 코드가 포함되는지, classic provider loop의 단계 상한·abort 처리.
