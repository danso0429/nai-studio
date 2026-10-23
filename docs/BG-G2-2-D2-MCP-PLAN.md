# D2 구현 계획 — BG에서 플러그인 MCP 도구 지원

**상태 (2026-10-23 KST):** 구현 완료(patcher `5ab963b`, 0.2.4-experimental.86 / adapter 0.7.81). 테스트 요청 전 확정·코드 검수 뒤 확정 절의 결정을 반영했다. 원본 RCM 실측(「검증 단계」)과 push는 하지 않았다. 세션 기록: patcher `docs/records/2026-10-23-g22-d2-session.md`.
정본: [G2.2 실행 계획](BG-G2-2-EXECUTION-PLAN.md) §3(B) D2(결정 2026-10-17: 지원 구현, 2026-10-22: BG에서 beforeRequest 뒤 도구 다시 읽기)와 Astra r2 구현 조건. 대상: NaN 단위(NF-1) commit 뒤의 patcher `main`.
위험 분류: **risky** (공통 BG host, request 경로, 오래 사는 서버 번들의 전역 cache, 유료 모델 후속 요청, 시한).

## 목표

BG 작업에서 RCM처럼 `registerMCP`로 도구를 등록하는 플러그인의 도구가 그 작업의 모델 요청에 보이고, 모델이 부른 도구가 플러그인 callback으로 실행되며, 결과가 기존 도구 loop로 모델에 돌아간다. 작업이 끝나면 등록과 cache가 모두 정리되어 다음 작업이 닫힌 host의 callback을 부르지 않는다. 시한·예산은 기존 값 안에서 지킨다.

범위 밖(사용자 결정 2026-10-22): RCM의 두 번째 도구 경로인 Provider Manager plugin channel(`tool-ipc`). BG host에는 `addPluginChannelListener`·`postPluginChannelMessage`가 없어 RCM이 이 경로를 "unavailable"로 기록하고 넘어가며, D2는 이를 바꾸지 않는다.

## 확인한 사실

경로는 patcher `d476d60`을 apply한 PocketRisu 1.10.0 조립 트리 기준이다(아래 「전제 출처」 표에 줄별 출처).

1. foreground 등록: `v3.svelte.ts:1344-1345`가 `registerMCP`/`unregisterMCP`를 `pluginmcp.ts`의 `registerMCPModule`/`unregisterMCPModule`에 그대로 연결한다. 식별자는 `plugin:`으로 시작해야 하고(`pluginmcp.ts:45`), 등록은 모듈 수준 Map `registeredCustomPluginMCPs`에 client를 넣는다(`:48-53`). 해제는 그 Map에서만 지운다(`:56-58`). client는 받은 두 callback을 그대로 부른다(`pluginmcp.ts:26-31`).
2. 도구 노출: `mcp.ts:137-151` `getMCPTools`는 `MCPs`를 순회하고, `MCPs`는 활성 모듈의 `mcp.url`(`modules.ts:361-365`; `getModules`는 `moduleIntergration`도 포함, `modules.ts:249,264`)과 `initializeMCPs(additionalMCPs)`의 추가 URL(`mcp.ts:21-26`)로 채워진다. `plugin:` URL은 등록 Map에 있을 때만 client가 되고(`mcp.ts:71-77`), 없으면 `Invalid MCP URL` 오류가 잡혀 `console.error`로 남는다(`:111-124`). `MCPs`에 이미 있으면 다시 해석하지 않고(`:28-29`), URL이 목록에서 빠질 때만 지운다(`:129-134`). 해제는 `MCPs`를 지우지 않는다. `getMCPTools`에는 try가 없어 client의 목록 조회 오류가 `getTools`(`mcp.ts:178-180`)를 거쳐 요청 실패로 전파된다. 실행 시 `callMCPTool`은 client마다 목록을 다시 읽어 이름이 맞는 첫 client를 고른다(`mcp.ts:162-168`).
3. 사용자 활성화: 사용자가 MCP 모듈 가져오기에 `plugin:<id>` URL을 넣으면 `mcp: { url }` 모듈이 `db.modules`에 추가된다(`mcp.ts:202-239`, `plugin:` 허용 `:208`). RCM은 모듈을 스스로 만들지 않는다.
4. 도구 시점: `request.ts:213` `const tools = arg.tools ?? (await getTools())`가 요청마다 한 번, fallback loop(`:231`)와 beforeRequest replacer(`:252-254`) **전에** 실행되고, 같은 `tools`가 각 재시도에 쓰인다(`:287`). replacer 블록은 `:256`에서 닫히고 request trigger는 `:258`에서 시작한다(`if(!pageFoldRouteState)` 안, `:251`). ModelPreset만 `preset.toolUse`·adapter 종류·능력 세 조건으로 도구 사용을 거른다(`:942-944`); classic provider는 `arg.tools`를 그대로 쓴다(`openAI/requests.ts:731`, `google.ts:883`, `anthropic.ts:566`).
5. 도구 호출자:
   - ModelPreset: `runModelPresetToolLoop`(`request.ts:1468-1517`) → `toolLoop.ts:52-108`. 상한 8(`request.ts:855`), 첫 송신 오류는 rethrow, 도구 실행 뒤 송신 오류는 부분 결과, 상한 도달 시 `[ModelPreset: maximum tool steps (8) reached]` 표지와 함께 그때까지의 결과(`toolLoop.ts:74-77`), 도구마다 실행 전 abort 확인(`:87`). 도구 실행은 `executeModelPresetTool`이 try로 감싸 "Tool call failed" 문자열(`request.ts:1519-1540`). `rememberToolUsage`일 때만 저장(`:1503`). 도구 실행 뒤 바깥 retry 금지(`:301-310`, `da.toolExecuted`).
   - OpenAI Chat Completions non-stream: `openAI/requests.ts:711-800`(callTool을 try로 감쌈, 실패 문자열 `:769-772`, follow-up을 `requestRetrys`만큼 `:782-791`, follow-up 실패 시 부분 결과). stream: `wrapToolStream`(`:1281`, `:608`에서 호출)이 같은 방식(`:1340`). 단계 상한 없음(재귀 `requestHTTPOpenAI` `:786`).
   - OpenAI Responses(`requestOpenAIResponseAPI`, `:934-`): 본문 `tools: []`(`:1008`)에 `web_search_preview`만 넣고(`:1091`) `arg.tools`를 쓰지 않는다. callTool 없음.
   - Google: `google.ts:886-944`(callTool에 try 없음, 오류 전파 `:892`). follow-up은 backoff·abort 확인과 함께 `requestRetrys`만큼(`:956-968`), 실패 시 부분 결과(`:973-978`). 단계 상한 없음(재귀 `requestGoogle` `:963`).
   - Anthropic non-stream: `anthropic.ts:996-1074`(callTool에 try 없음 `:1021`, 재귀 `requestClaudeHTTP` `:1074`, 단계 상한·도구 전 abort 확인 없음). streaming 분기(`:802-`)에는 `tool_use` 처리가 없다.
6. RCM 1.0.21: load에서 `ZA`가 `native`(`PA`: `registerMCP({identifier:"plugin:risu-cognitive-memory", ...}, getToolList, callTool)`)와 `yumi`(`JA`: Provider Manager channel)를 차례로 시도하고 각 실패를 경고로 남긴 채 load를 계속한다. `getToolList`는 `memoryToolsEnabled`이고 현재 채팅이 활성이며 `ao`가 도구를 내놓을 때만 `recall_rp_memory`·`expand_rp_memory`를 돌려주고, 내부 오류는 잡아 `[]`를 돌려준다. `ao`는 `memoryToolOpportunity.chatId`가 현재 채팅이고 archive 검색 가능 또는 recall 후보가 있을 때 도구를 연다. `memoryToolOpportunity`는 모델 요청 준비(beforeRequest의 prepare 응답 처리)에서 `X.memoryToolOpportunity`로 채워진다. `callTool`의 backend POST 시한은 recall `mcpRequestTimeoutMs` 또는 920초(`ax=92e4`), expand 15초. RCM은 `unregisterMCP`를 부르지 않는다.
7. BG 현재: host `ROOT_HANDLERS`(`bgPluginHost.cjs:82`)에 `registerMCP`/`unregisterMCP`가 없다(absent로 진단; G2.2c 실측 §표 「공통」 행). 기존 `invoke`는 비활성·실패 entry나 잡힌 오류에서 입력 `args[0]`을 돌려주고(`bgPluginHost.cjs:478,487,501,538`), 반환 변경을 효과로 표시한다(`:515`). provider는 `invoke(entry,'provider',...)` callback을 `bindings.installProvider`에 넘긴다(`:577-578`). 알림 검사기는 phase를 `load/input/before_request/after_request/provider`로만 받는다(`server/node/bgNotifications.cjs:54`, `src/ts/bgNotifications.ts:59`).
8. 수용 판정과 서버 번들: `mcp-unqualified`는 원래 클라이언트 준비 경로였던 조합(`formerlyPrepared`: 확장 native route, 플러그인 route, 모듈 모델 바인딩, preset 고정, chat preset, `reverse_proxy`·`xcustom:::`·`pluginmodel:::` 모델)에서 MCP 모듈이 있을 때만 적용된다(`bgServerInputProviderPolicy.ts:119-134`). 일반 classic 채팅은 MCP 모듈이 켜져 있어도 BG 서버 입력이다. 서버 번들은 진입 `process/index.svelte`(`bgOrchBundle.build.cjs:91-107`)에서 `request.ts:12` → `mcp.ts:9` → `pluginmcp.ts`로 MCP 코드를 포함하며, 빌드된 `bgOrchBundle.mjs`에 `registeredCustomPluginMCPs`·`Invalid MCP URL`·`checkHandshake`가 있다. MCP를 막는 patch는 없다. 따라서 외부 `http(s)` MCP URL은 서버에서 handshake(`mcp.ts:109-122`)를 거칠 수 있고(코드 추론, 실행하지 않음), `plugin:` URL은 서버 쪽 등록 Map이 비어 빠진다. capability route(`bgOrchestrator.cjs:1118-1139`)는 `serverPluginHostVersion`만 보고하고 MCP 필드가 없다.
9. 예산·시한: 플러그인 `nativeFetch`·`risuFetch`·`runLLMModel`이 host 전체 128회 counter를 공유한다(`bgPluginHost.cjs:37,115-119`). session 600초(`bgPluginSession.cjs:12`, host가 `runtimeMs`를 넘기지 않음 `bgPluginHost.cjs:652`). `bgOrchestrator.cjs:448`의 600초 timer는 `runServerPreview`(preview `llm`/`full`) 안에서 `_previewLock` 획득(`:435-438`) 뒤 시작한다.

## 설계

1. **등록(사용자 결정 2026-10-22: load 때만):** host `ROOT_HANDLERS`에 `registerMCP`/`unregisterMCP`를 전용 helper(메타데이터 + callback 핸들 두 개)로 추가한다. `registerMCP`는 load 중에만 받아 staging하고 load 성공 시 설치한다. load가 끝난 뒤의 `registerMCP`는 기존 등록류(`bgPluginHost.cjs:543`, `entry.ready`)와 같이 거절한다. `unregisterMCP`는 자기 식별자에 한해 load·hook 중 허용한다. 식별자는 `plugin:` 규칙을 따르며, load 중 같은 소유자의 재등록은 교체로 처리하고 다른 소유자의 등록·해제는 거절한다. 실패한 load의 식별자는 그 작업 동안 예약된다. 새 MCP 권한은 만들지 않는다(foreground에도 없음).
2. **호출 계약:** 서버 번들의 `registerMCPModule`에 host 래퍼를 넘기고, 래퍼는 기존 `invoke`가 아닌 별도 phase `mcp_list`·`mcp_call`로 worker callback을 부른다. 실패 시 입력이나 빈 목록으로 대신하지 않고 오류를 그대로 전파한다(foreground의 `getMCPTools`·`callMCPTool`과 같은 전파). 결과는 도구 정의 배열·MCP content 배열로 한도 안에서 검증한다. `mcp_call`은 실행 전 effect/identity 장벽을 거치고, `mcp_list`는 효과로 세지 않는다. 두 알림 검사기가 새 phase를 받는다.
3. **수명:** client에 작업·entry·등록 세대 소유를 붙인다. 서버 binding이 돌려주는 idempotent cleanup은 `registeredCustomPluginMCPs`와 `MCPs`에서 **자기 client를 가리킬 때만** 지운다. 해제·교체·entry 비활성화·설치 rollback·host close에서 무효화한다. 같은 이름의 도구가 여러 client에 있으면 BG에서 작업 소유 client로 묶거나 거절한다. `_previewLock` 직렬화가 전역 Map을 한 작업만 쓰게 하는 불변식을 지킨다.
4. **도구 읽기(사용자 결정):** BG 작업에서는 `request.ts:213`의 최초 읽기를 건너뛰고, 실제 시도마다 replacer 블록 직후(`:256` 뒤, `:258` 전)에 한 번 읽어 그 시도의 `tools`로 쓴다. `arg.tools`가 주어지면(`[]` 포함) 그대로 둔다. PageFold route로 source 변환을 건너뛰는 재시도는 이전 목록을 쓴다. 읽기 뒤 `requestChatDataMain` 전에 취소를 확인한다. BG 판별은 작업 범위 표지로 한다. ModelPreset의 세 조건을 유지한다. `runLLMModel` 직접 호출에는 도구가 노출되지 않는다.
5. **provider guard(사용자 결정):** 모든 도구 실행과 후속 요청 전에 abort를 확인하고, 재귀·stream 전체에 "도구 효과 시작" latch를 둔다. latch 뒤에는 프롬프트 재시도·fallback 재실행으로 도구가 다시 실행되지 않는다. 도구 효과 뒤 실패·후속 실패는 provider별 기존 처리(ModelPreset·OpenAI는 실패 문자열·부분 결과, Google·Anthropic은 오류 전파)를 따르되 재시도·fallback은 하지 않는다. 모든 provider에서 도구 8단계(모델 전송 최대 9회)를 상한으로 두고, 상한에 닿으면 더 보내지 않고 그때까지의 결과를 성공으로 돌려주며 상한 표지를 남긴다(ModelPreset의 기존 처리와 같은 방식, 사용자 결정 2026-10-22).
6. **미지원 변형(사용자 결정):** OpenAI Responses와 Anthropic streaming에는 플러그인 MCP 도구를 보내지 않고 생성은 진행하며, 알림과 지원표에 미지원으로 남긴다.
7. **시한·예산:** 작업·session 마감을 한 번 잡고, 목록·실행 전 남은 시간이 있어야 한다. callback scope·전송은 `min(작업 남은 시간, session 남은 시간, 더 짧은 호출 시한)`으로 묶는다. 만료 시 전송·scope 중단, 대기 RPC 거절, 새 효과 금지, 시한 뒤의 성공 결과 거절. 도구마다 새 600초를 주거나 RCM 920초를 쓰지 않는다. `mcp_call` dispatch 1회와 그 안의 플러그인 `nativeFetch`·`risuFetch`가 각각 host 공유 128회 counter에 들어간다. 후속 모델 요청은 128회가 아니라 8단계 상한으로 제한한다. 기존 예산·시한은 늘리지 않는다.
8. **수용:** capability에 `serverPluginMcpVersion: 1`을 bundle과 host가 정리까지 포함한 계약을 갖출 때만 보고하고, 서버 응답·클라이언트 타입·capability cache·클라이언트 재확인·서버 정책 평가까지 연결한다. `formerlyPrepared` 조합은 그 필드가 지원을 보고하고 설정 MCP URL이 모두 유효한 `plugin:`일 때만 `mcp-unqualified`를 해제한다. 구 capability는 새 조합을 허용하지 않는다. 일반 classic 채팅의 외부 MCP 수용은 바꾸지 않는다.

## 검수 기록과 결정 (2026-10-22)

**Astra(gpt-6-astra, read-only) 1회차:** 구현 전 계획 수정 필요. 지적을 모두 채택했고 위 「확인한 사실」·「설계」에 반영했다.
1. 사실 정정: `getModules`의 `moduleIntergration`, `initializeMCPs(additionalMCPs)`, 실행 중 목록 재읽기, ModelPreset 8단계·최대 9회 전송, `requests.ts:1323`은 Chat Completions stream, 128회 counter 대상, 600초 timer의 lock 뒤 시작, 미등록 `plugin:` URL의 `console.error`.
2. 별도 호출 계약 `mcp_list`·`mcp_call`, 두 알림 검사기, 결과 검증, 새 권한 없음, effect/identity 장벽.
3. 등록·정리의 소유·세대·idempotent cleanup·같은 이름 도구·lock 불변식.
4. 도구 읽기 위치(replacer 뒤, request trigger 전), `arg.tools`, PageFold 재시도, 취소 확인, 작업 범위 표지, ModelPreset 세 조건, `runLLMModel` 비노출.
5. provider별 abort 확인과 효과 latch, 128회와 별개인 후속 상한.
6. 시한 결합과 만료 처리, counter 계산의 명시.
7. capability 연결 전체와 구 capability 거절, 빌드된 bundle 확인.

**사용자 결정(2026-10-22):**
- 도구 효과 뒤 실패·후속 실패: provider별 기존 동작, BG에서는 효과 뒤 재시도·fallback으로 도구가 다시 실행되지 않게 막는다.
- 비용 상한: 모든 provider에 도구 8단계(모델 전송 최대 9회). 작업 600초 시한은 별도로 유지.
- 상한 도달: 더 보내지 않고 그때까지의 결과를 성공으로 돌려주며 상한 표지를 남긴다(ModelPreset 방식).
- 도구 loop가 없는 변형(OpenAI Responses, Anthropic streaming): 미지원으로 기록, 도구 없이 진행, 알림·지원표에 남긴다.
- 도구 읽기 횟수: BG에서는 최초 읽기 생략, 시도마다 준비 뒤 한 번.
- 범위: registerMCP 경로만. Provider Manager channel 경로는 D2 밖.
- 등록 시점: `registerMCP`는 load 때만. load 뒤 호출은 거절. `unregisterMCP`는 자기 식별자에 한해 load·hook 중 허용.

**계약 이름(Argon 시나리오 검토 중 고정, 2026-10-22):** 미지원 변형 알림 코드 `plugin_mcp_unsupported`; classic provider의 상한 표지 `[BG: maximum tool steps (8) reached]`(ModelPreset은 기존 표지 유지); `mcp_list` dispatch는 128회 counter에 들어가지 않고(목록 callback 안의 플러그인 fetch는 기존대로 셈), `mcp_call` dispatch는 1회로 센다.
- 일반 classic BG 채팅에서 외부 MCP URL에 서버가 연결할 수 있는 기존 동작은 D2에서 바꾸지 않는다(별도 결정 대상으로 남김).

## 테스트 요청 전 확정 (2026-10-23)

기준: patcher `533ca2e`(NF-1 뒤) 조립 트리. `d476d60..533ca2e`에서 아래 「전제 출처」 표의 경로는 바뀌지 않았다(NF-1은 `bgPluginWorker.cjs`만 변경).

**사용자 결정(2026-10-23):**
- C7 효과 latch와 C8 8단계 상한은 BG 작업에만 적용한다. foreground의 classic provider 도구 loop는 지금처럼 상한 없이 둔다(C11).
- `plugin_mcp_unsupported`는 작업마다, 그 작업에서 MCP를 등록한 플러그인마다 한 번 남긴다. 도구를 빼고 보낸 첫 요청에서 남기며 phase는 `mcp_list`, `effectsMayHaveOccurred`는 그 entry의 현재 값이다.
- `mcp_list`·`mcp_call` callback 실패(throw, 결과 형식 오류, 시한 만료, 128회 초과)는 오류를 전파하면서 기존 invoke처럼 entry를 비활성화한다. 알림은 기존 code(`plugin_hook_failed`, 자원 한도는 `plugin_host_limit`/`operation_budget`)에 phase `mcp_list`/`mcp_call`을 붙인다. 같은 작업에서 그 플러그인의 이후 hook·도구 호출은 거절된다.

- `plugin_mcp_unsupported`는 새 알림 event version 4로 저장·전달한다(사용자 결정 2026-10-23). claim은 `messageVersion` 4까지 받고 현재 클라이언트는 4로 claim한다. 기존 v2/v3 claim에는 나가지 않으므로, 갱신 전 번들 탭의 검사기(`src/ts/bgNotifications.ts:65`는 모르는 code가 있으면 묶음 전체를 거절)가 깨지지 않는다(`server/node/bgNotifications.cjs:230-234`의 version 필터, `BgNotificationDelivery.svelte:22`).
- load 뒤 `registerMCP` 거절은 기존 등록류와 같은 동기 throw라, 기존 dispatcher 의미대로 그 entry를 비활성화한다(`bgPluginHost.cjs:702-705`). 시험은 비활성화 여부를 고정하지 않는다. `unregisterMCP`의 반환값은 고정하지 않는다(foreground는 `undefined`).

**코드 검수 뒤 확정(2026-10-23):**
- 가드 범위(사용자 결정): C7 효과 latch, C8 8단계 상한, 후속 요청 1회 제한은 그 요청의 tools에 플러그인 MCP 도구(`mcpURL`이 `plugin:`인 도구)가 있는 BG 요청에만 건다. 외부 MCP만 쓰는 BG 요청과 `arg.tools`를 직접 넘긴 호출은 지금처럼 둔다(C11).
- 알림 버전: phase가 `mcp_list`/`mcp_call`인 모든 알림(실패·한도 알림 포함)도 version 4로 저장·전달한다. messageVersion 1–3 claim에는 나가지 않는다.
- 같은 이름의 도구(C3): BG 작업에서 도구 호출은 그 시도의 목록에서 그 이름을 내놓은 client만 실행한다. 같은 시도의 목록에서 둘 이상의 client가 같은 이름을 내놓았으면 호출을 거절하고 어느 callback도 실행하지 않는다(provider별 기존 도구 오류 처리).
- 시한 만료 뒤 후속 요청(C9): 플러그인 MCP 호출이 session 시한 만료나 닫힌 작업으로 실패하면, provider가 그 오류를 도구 결과 문자열로 바꾸더라도 모델 후속 요청을 보내지 않고 재시도·fallback 없이 실패로 끝낸다(ModelPreset·OpenAI 포함).

**시험용 인터페이스 고정(기존 관례를 따름):**
- 플러그인 API: `Risuai.registerMCP(meta: {identifier, name, version, description}, getToolList, callTool)`, `Risuai.unregisterMCP(identifier)`(foreground `v3.svelte.ts:1344-1345`와 같은 모양).
- 서버 binding: `bgPluginBindings.installMCP(meta, getToolList, callTool)`는 idempotent cleanup 함수를 돌려준다(`installProvider`와 같은 모양, `src/ts/bgPluginBindings.ts`). 등록 상태는 `pluginmcp.ts`의 export `registeredCustomPluginMCPs`와 `mcp.ts`의 export `MCPs`로 관찰한다.
- BG 작업 판별: `globalThis.__bgOrchAbortSignal`이 있을 때(`bgOrchestrator.cjs:511`이 작업마다 설정·복원, `request.ts:577`의 기존 BG guard와 같은 표지).
- 수용: capability 응답에 `serverPluginMcpVersion`(지원 시 1). `evaluateServerInputModels(database, chat, allowServerPlugins, allowServerPluginMcp = false)`와 `requiresClientOwnedInputPreparation`도 같은 넷째 인자를 받는다. 클라이언트 `bgServerInputClient.ts` `Capability` 타입에 필드를 더하고, `bgServerPluginCapability.ts`는 `observeServerPluginCapability`에서 함께 기록해 `isServerPluginMcpSupported()`로 돌려준다(contract가 맞고 `serverPluginHostVersion === 1`이며 `serverPluginMcpVersion === 1`일 때만 true).

**행별 기존 계약과 실제 결과 모양:**
- C1: load 뒤 등록류 거절은 기존 동기 throw `plugin_registration_invalid`(`bgPluginHost.cjs:543`)이다. 시험은 플러그인 안 try/catch로 거절을 관찰하고, 새 거절의 오류 문구·code는 고정하지 않는다. 잡히지 않은 거절이 load를 실패시키는지는 기존 ROOT handler 의미를 따른다. 대소문자가 다른 `PLUGIN:`은 거절(`pluginmcp.ts:45`의 `startsWith`), 접두사만 있는 `plugin:`은 고정하지 않는다.
- C2: 도구 정의는 `MCPTool {name, description, inputSchema, annotations?}`(`mcplib.ts:16-21`), 실행 결과는 `RPCToolCallContent[]`(text/image/audio/resource, `mcplib.ts:53-73`). 크기 한도의 숫자는 고정하지 않고 명백한 형식 오류(배열 아님, `name` 없음, 알 수 없는 content type)만 쓴다. `mcp_call` dispatch는 실행 전 기존 효과 장벽(`beforeEffect` 호출, entry effects true, `bgPluginHost.cjs:455`)을 거치고 `mcp_list`는 거치지 않는다. 기존 알림 검사기는 `plugin_` code에 pluginName·pluginVersion·phase를 요구하고 phase를 다섯 값으로만 받는다(`bgNotifications.cjs:14-16,52-54`, `src/ts/bgNotifications.ts:1-4,58-59`).
- C2·C7 provider별 실패 결과: ModelPreset은 도구 결과 문자열 `Tool call failed: ...`(`request.ts:1537`), OpenAI는 `'Tool call failed with error: ' + error`(`openAI/requests.ts:772`). Google·Anthropic은 callTool 오류가 `requestChatDataMain` dispatch(`request.ts:632-671`, catch 없음)와 `requestChatData`(`:282-288`, try 없음)를 빠져나가 `requestChatData`가 reject한다. 목록 callback 실패도 그 시도의 모델 전송 없이 요청을 실패시킨다(foreground `:213`의 reject와 같은 방향). 실패 뒤 BG 작업 결과의 세부 모양은 고정하지 않는다.
- C5·C8 결과 모양: ModelPreset 표지는 결과 문자열에 이어 붙는다(`preset/adapter/toolLoop.ts:74-77,107`). OpenAI·Google은 단계별 text를 `\n\n`으로 이어 `{type:'success', result}`를 돌려준다(`openAI/requests.ts:796-808`, `google.ts:971-983`). classic 표지 `[BG: maximum tool steps (8) reached]`는 성공 결과 문자열에 포함되며 위치는 고정하지 않는다.
- C9: worker RPC 시한은 session `runtimeMs`(기본 600초, load만 15초, `bgPluginWorker.cjs:488,510`)뿐이므로 "더 짧은 호출 시한"은 이것이다. 작업 시한은 `bgOrchestrator.cjs:448`의 600초 timer다. 128회 초과는 기존 동기 throw `plugin_budget_exceeded` → entry 비활성화 → `plugin_host_limit`/`operation_budget` 알림이다(`bgPluginHost.cjs:37,119,360,367`). 시한 시험은 기존 주입점(`probe-bg-plugin-host.cjs`의 sandbox `runtimeMs` override, host `signal`)만 쓰고, 작업 시한 주입점이 필요하면 새로 만들지 않고 질문으로 돌려보낸다.
- C10 유효성(사용자 결정 2026-10-23): "유효한 `plugin:` URL"은 foreground 등록 규칙(`pluginmcp.ts:45`, `startsWith('plugin:')`)과 같다. 접두사만 있는 `plugin:`은 시험에서 고정하지 않는다(등록되지 않은 다른 `plugin:` URL과 같은 경로라 별도 규칙의 이득이 없음).
- C10: 판정은 채팅이 아니라 DB 스냅샷 전체의 `modules[].mcp.url`과 `personas[].embeddedModule.mcp.url`을 본다(`bgServerInputProviderPolicy.ts:129-135`). "모두 `plugin:`"도 이 집합 기준이다. 결과는 `{kind:'server-input'}` 또는 `{kind:'client-prepared', reason}`(`:14-18,59-65`).

## 단위

블라인드 테스트는 세 단위에 한 번 요청한다(같은 host·bundle 시험 파일을 쓰고 인터페이스가 이 계획에 고정됨).

| ID | 제목 |
|---|---|
| D2-1 | BG plugin MCP registration and calls |
| D2-2 | BG request tool discovery and provider guards |
| D2-3 | Plugin MCP server-input admission |

## 테스트 계약 표

| 기준 | 단위 | 입력 | 기존 상태 | 기대 결과·오류 | 범위 밖 |
|---|---|---|---|---|---|
| C1 등록 | D2-1 | load 중 `registerMCP({identifier:'plugin:x',...}, list, call)`(같은 식별자 재등록 포함); load 뒤(hook 중) `registerMCP`; hook 중 자기 식별자 `unregisterMCP`; 다른 플러그인의 같은 식별자 등록·해제; `plugin:`이 아닌 식별자 | BG host, 등록 없음 | load 성공 뒤 서버 번들의 등록 Map에 그 작업 client가 있다(load 중 재등록은 교체). load 실패 시 설치되지 않고 식별자는 예약된다. load 뒤 `registerMCP`는 거절. 자기 식별자 해제는 허용. 다른 소유자 등록·해제 거절, 잘못된 식별자 거절 | Provider Manager channel, hook 중 등록 |
| C2 목록·실행 계약 | D2-1 | 모델 요청 중 도구 목록 조회와 도구 호출; callback의 throw, 잘못된 결과 형식, entry 비활성 상태 | 등록된 client | 목록은 callback 결과(검증된 도구 정의 배열), 실행은 callback 결과(검증된 MCP content 배열). 실패·형식 오류·비활성은 오류로 전파되고 입력·빈 목록으로 대신하지 않는다. 알림은 `mcp_list`·`mcp_call` phase로 남고 두 알림 검사기가 받는다. 목록 조회는 효과로 세지 않는다 | 결과 문자열 형식 변경 |
| C3 수명 | D2-1 | 작업 종료(성공·실패·취소), `unregisterMCP`, 교체, entry 비활성화, 설치 rollback; 이어지는 다른 작업 | 이전 작업의 등록 | 종료 뒤 등록 Map과 `MCPs`에 이전 작업 client가 없다. cleanup은 자기 client를 가리킬 때만 지운다. 다음 작업은 이전 callback을 부르지 않는다. 닫힌 host의 callback 호출은 거절된다 | foreground 등록 |
| C4 도구 노출 | D2-2 | 채팅 모듈 `mcp.url = 'plugin:x'`; list callback은 beforeRequest replacer가 상태를 바꾼 뒤에만 도구를 내놓음; `arg.tools` 지정(`[]` 포함) 호출; foreground 호출 | BG 작업 | BG에서 실제 첫 모델 요청 본문의 tools에 그 도구가 있다(beforeRequest 뒤 읽기). 시도마다 준비 뒤 한 번 읽는다. `arg.tools` 지정 호출과 foreground는 지금과 같다. ModelPreset 세 조건 유지. `runLLMModel` 직접 호출에는 도구 없음 | 원본 RCM backend 상태(검증 단계에서 실측) |
| C5 도구 loop | D2-2 | 모델이 도구 호출을 돌려줌: ModelPreset, OpenAI non-stream, OpenAI Chat Completions stream, Google, Anthropic non-stream | C4 상태 | 플러그인 call callback이 실행되고 결과가 같은 provider의 기존 loop로 다음 요청에 들어간다 | provider 메시지 형식 변경 |
| C6 미지원 변형 | D2-2 | OpenAI Responses, Anthropic streaming | C4 상태 | 플러그인 MCP 도구를 보내지 않고 생성은 진행한다. `plugin_mcp_unsupported` 알림이 남는다 | 두 변형에 도구 loop 추가 |
| C7 효과 뒤 재실행 금지 | D2-2 | 도구 실행 뒤 후속 요청 실패, Google·Anthropic 도구 오류, 바깥 retry·fallback 조건 | C5 상태 | ModelPreset·OpenAI는 실패 문자열·부분 결과, Google·Anthropic은 오류 전파(기존 처리). 어느 경우에도 같은 도구가 다시 실행되지 않고 프롬프트 재시도·fallback으로 재전송되지 않는다 | 효과 전 실패의 기존 retry·fallback |
| C8 8단계 상한 | D2-2 | 모델이 매 응답마다 도구를 호출 | 모든 provider | 도구 8단계 뒤 더 보내지 않는다(모델 전송 최대 9회). 그때까지의 결과를 성공으로 돌려주고 상한 표지를 남긴다(classic provider `[BG: maximum tool steps (8) reached]`, ModelPreset 기존 표지). 7단계 이하에서는 표지가 없다 | ModelPreset의 기존 표지 문구 변경 |
| C9 시한·예산·취소 | D2-1 | 작업·session 마감 임박, 호출 중 마감 도달, 128회 소진, 사용자 취소 | 도구 실행 중 | 남은 시간이 없으면 목록·실행을 시작하지 않는다. 마감 도달 시 진행 중 callback·전송을 끝내고 대기 RPC를 거절하며, 시한 뒤 성공 결과를 거절하고, 모델 후속 요청이 없다. `mcp_call` dispatch와 그 안의 fetch가 128회에 들어가고 초과 시 거절. `mcp_list` dispatch는 세지 않는다(목록 callback 안의 fetch는 셈). 목록 조회만 하고 첫 송신이 실패하면 기존 retry·fallback이 그대로 동작한다. 취소도 같다. 기존 600초·128회는 늘지 않는다 | RCM backend 쪽 시한 |
| C10 수용 | D2-3 | `formerlyPrepared` 조합 + MCP URL이 모두 `plugin:`; 외부 URL 섞임; 구 capability(필드 없음); 일반 classic 채팅 + 외부 MCP | 서버 capability `serverPluginMcpVersion: 1` 보고 여부 | 지원 보고 + 모두 `plugin:` → 서버 입력. 외부 URL 섞임·구 capability → 지금처럼 `mcp-unqualified`(클라이언트 준비). 일반 classic 채팅은 지금과 같다. 클라이언트 타입·cache·재확인·서버 정책이 같은 판정을 한다 | 외부 MCP 지원 범위 변경 |
| C11 기존 동작 | 전체 | 기존 시험 | — | foreground MCP, `arg.tools` 호출, 도구 없는 BG 요청, provider·hook 동작, D1-a·G2.2b·NaN 결과, 기존 테스트 수 유지 | — |

**Argon 시나리오(gemini-4-argon-medium, 2026-10-22, 26개) 검토:** 24개 채택. 제외 2개 — 3번(hook 중 same-owner 교체: 등록 시점 결정으로 범위 밖, 거절은 C1이 다룸), 8번(도구 정의·결과의 비유한 수: NF-1 시험이 다루고 D2 계약에 없음). 계약 표 행 중 시나리오가 직접 다루지 않는 것(C4의 PageFold 재시도·읽기 뒤 취소 확인, C3의 같은 이름 도구, C2의 `mcp_call` effect/identity 장벽)은 시험 작성에서 Spec으로 함께 다룬다.

## 전제 출처

`d476d60` 조립 트리. 코드 줄은 오케스트레이터가 직접 열었거나 haiku-explorer가 원문 발췌로 확인한 뒤 테스트가 기대는 줄을 오케스트레이터가 다시 열었다.

| 사실 | 기준 | 출처 |
|---|---|---|
| 등록 Map·식별자 규칙·해제 범위 | C1, C3 | 코드 `pluginmcp.ts:26-31,45-58` |
| `getMCPTools`의 오류 전파, `getTools` | C2 | 코드 `mcp.ts:137-151,178-180` |
| `callMCPTool`의 목록 재읽기·첫 client 선택 | C3 | 코드 `mcp.ts:162-168` |
| `MCPs` cache 유지·삭제 조건 | C3 | 코드 `mcp.ts:28-29,129-134` |
| 미등록 `plugin:` URL 처리 | C3 | 코드 `mcp.ts:71-77,111-124` |
| 사용자 활성화(`plugin:` 모듈 가져오기) | C4 | 코드 `mcp.ts:202-239` |
| 최초 읽기 위치·replacer·trigger 위치 | C4 | 코드 `request.ts:213,231,251-258,287` |
| ModelPreset 세 조건 | C4 | 코드 `request.ts:942-944` |
| classic provider의 `arg.tools` 사용 | C4, C5 | 코드 `openAI/requests.ts:731`, `google.ts:883`, `anthropic.ts:566` |
| ModelPreset loop·상한 표지·부분 결과 | C5, C7, C8 | 코드 `toolLoop.ts:52-108`, `request.ts:855,1519-1540,301-310` |
| OpenAI non-stream·stream loop | C5, C7 | 코드 `openAI/requests.ts:608,711-800,1281,1340` |
| Responses가 플러그인 도구를 보내지 않음 | C6 | 코드 `openAI/requests.ts:1008,1091` |
| Google loop·오류 전파·부분 결과 | C5, C7 | 코드 `google.ts:886-944,956-978` |
| Anthropic non-stream loop, streaming 분기에 `tool_use` 없음 | C5, C6, C7 | 코드 `anthropic.ts:802,996-1074` |
| classic provider에 단계 상한 없음 | C8 | 코드(재귀 호출에 counter 없음) `openAI/requests.ts:786`, `google.ts:963`, `anthropic.ts:1074` |
| 기존 `invoke`의 `args[0]` 반환·효과 표시 | C2 | 코드 `bgPluginHost.cjs:478,487,501,515,538` |
| host에 registerMCP 없음 | C1 | 코드 `bgPluginHost.cjs:82`; 실측 G2.2c §표 「공통」 행 |
| 알림 phase 검사 | C2 | 코드 `server/node/bgNotifications.cjs:54`, `src/ts/bgNotifications.ts:59` |
| 128회 counter 대상·공유 | C9 | 코드 `bgPluginHost.cjs:37,115-119` |
| session 600초 기본값 | C9 | 코드 `bgPluginSession.cjs:12`, `bgPluginHost.cjs:652` |
| 수용 판정 범위 | C10 | 코드 `bgServerInputProviderPolicy.ts:119-134` |
| capability route 필드 | C10 | 코드 `bgOrchestrator.cjs:1118-1139` |
| 서버 번들의 MCP 코드 포함 | C3, C10 | 코드 `bgOrchBundle.build.cjs:91-107`, `request.ts:12`, `mcp.ts:9`; 빌드된 `bgOrchBundle.mjs`의 문자열 확인 |
| RCM 등록·도구 기회·callTool 시한 | 검증 단계 | 코드(원본 RCM 1.0.21 JS의 `ZA`·`PA`·`JA`·`ao`, `memoryToolOpportunity=` 대입, `ax=92e4`) |
| 외부 MCP URL의 서버 handshake | 범위 밖 | 코드 추론(실행하지 않음); D2는 이 동작을 바꾸지 않는다 |

테스트 요청 직전에 NF-1 commit 뒤의 HEAD에서 위 경로의 변경 여부를 `git --no-pager diff --name-only d476d60..HEAD -- <경로>`로 확인하고, 바뀐 경로의 줄은 다시 연다.

## 검증 단계(구현 뒤)

- 원본 RCM 1.0.21과 실제 backend, 가짜 provider, 합성 데이터로 C4의 실제 첫 요청 본문 tools와 C5의 도구 실행·후속 요청을 실측한다(등록·수동 호출 성공만으로 통과 처리하지 않음).
- 빌드된 bundle에서 정리 뒤 등록 Map과 `MCPs`가 비는지 확인한다.

## 미확인

- 원본 RCM에서 BG beforeRequest 준비가 `memoryToolOpportunity`를 실제로 채우는지는 backend 상태(archive 검색 가능·recall 후보)에 달려 있어 검증 단계에서 실측한다.
- 일반 classic BG 채팅의 외부 MCP URL 서버 연결은 실행하지 않았다(D2 범위 밖).
