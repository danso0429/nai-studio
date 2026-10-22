# G2.2 실행 계획 초안 (r2, 2026-10-22 기준선 갱신)

**상태:** 조사 결과와 초안이다. 2026-10-22 기준선을 갱신(r2)하고 Astra 계획 검수 1회차를 받아 반영했다(§7). r1 당시에는 Codex 사용 한도로 검수를 받지 못했다. 2026-10-17 사용자 결정: D1은 D1-a(native parity), D2는 BG MCP 지원 구현. D3·D4는 미결정이다. 남은 작업(계획 리뷰, G2.2b, G2.2c, D1·D2 구현)은 2026-10-22 이후 사용자 지시로 재개한다.

정본: ordered-goals §4·§9.3(G2.2 행)·§9.3 「공통 경계」1~7, 호환성 검토 §4. 기준(r2): patcher `origin/main` `2adc8a5`(코드는 `902148a`와 같고 세션 기록 1개만 추가, experimental.82/adapter 0.7.77), 공식 PocketRisu 1.10.0 `98e9683`, RCM 1.0.21(commit `50c76fe`, JS SHA-256 `08705f3b…`, API revision 98). r1 기준은 patcher `58af7b2`(experimental.56/adapter 0.7.60)·RCM 1.0.13(JS `fcdce0fe…`, API revision 90)이었다.

### 기준선 갱신 기록 (r2, 2026-10-22 KST)

- **patcher `58af7b2..902148a`(43 commit, Phase A·B·C 묶음. 이후 `2adc8a5`는 `docs/records/` 기록만 추가):** `bgPluginHost.cjs`·`bgPluginWorker.cjs`는 바뀌지 않았고 이 계획이 인용한 줄(§2-1)도 같은 내용이다. 플러그인 관련 동작 변경은 `scripts/probe-bg-plugin-process.cjs`의 old-client 사례가 시작 요청에서 426을 기대하도록 바뀐 것이고, 그 밖에는 `test/g22a-capability.test.cjs`의 pack 버전 단언이 바뀌었다. G2.2b·G2.2c 검증에 영향이 있는 주변 변경: BG 시작·claim·attach에 writer session 검사와 client-build fence(426)가 붙었고(시험 harness는 현재 build stamp와 session header로 시작해야 한다), storage epoch와 저장소 초기화 뒤 commit 거절이 추가됐다(`serverChatCommitOwner.cjs`). `serverChatAssemblyContext.cjs`는 바뀐 입력 필드를 기록하는 진단만 추가했고 판정 결과는 같다. 설정 PUT의 session 검사(`externalRequestHeaders.cjs`)는 요청 경로가 아니다.
- **RCM 1.0.13 → 1.0.21 (2026-10-22 사용자 결정으로 재고정):** 플러그인 JS가 쓰는 Risu API 이름 집합에 `alert`·`getTranslationCache`·`searchTranslationCache`·`parseRisuChat`이 추가됐다. 이들은 초기 설정 재료 고르기·번역 표시 등 UI 경로에서 함수 존재를 확인하고 쓴다. **기억 준비 context의 `getCurrentLorebookEntries`는 1.0.13의 직접 호출에서 `?.()`로 바뀌어, API가 없으면 오류 없이 빈 목록으로 진행한다.** 따라서 BG에서 이 API 부재는 hook 실패가 아니라 로어북 없는 기억 준비가 된다(§1·G2.2b 반영). `MemoryInjectionBlockedError`·30초/180초 진행 선택·afterRequest 뒤 1500ms fallback·backend `engine:"risu"`/플러그인 `extractionEngine:"server"` 기본값·`registerMCP`의 직접 await·15초/45초 상수는 1.0.21에도 같다. backend route는 144→154개이며 job ID별 완료 조회는 여전히 없다. 새 `PUT /v1/chats/:id/work`(채팅별 기억 정리 일시정지)는 D4 조사 대상이다. 1.0.21의 설치·기동은 아직 확인하지 않았다(G2.1 설치 확인은 1.0.13 기록).
- **PocketRisu:** 상류 최신은 1.15.2지만 patcher catalog의 대상은 1.10.0 하나이므로 G2.2 기준은 1.10.0을 유지한다. 1.10.0에는 `parseRisuChat`이 없고 `getTranslationCache`·`searchTranslationCache`·`alert`는 있다.

G2.2의 산출물은 API별 의미표·최종 caller·필요한 호스트 수정·의도적 차단과 일반 오류의 구분·종료/인계/다음 턴 정책·검증 사례다. 이 계획은 그중 (A) 바로 구현 가능한 단위와 (B) 사용자 결과 결정이 필요한 단위를 나눈다. (B)는 결정 전 구현하지 않는다.

## 1. RCM API 사용표 (r1은 1.0.13 조사, r2에서 1.0.21 기준으로 갱신)

| API | 사용 위치·단계 | 원본 처리 | foreground 1.10 | BG 현재 |
|---|---|---|---|---|
| getLocalPluginStorage / getArgument / setArgument | 설정 load·save | setArgument 부재 시 throw | 지원 | 지원 |
| nativeFetch | backend HTTP 전부, 번역 GET | 직접 호출 | 지원 | 지원(budget 128) |
| runLLMModel | 내부 모델 호출 | 직접 | 지원 | 지원 |
| getCurrentCharacterIndex·getCharacter·getCurrentChatIndex·getChatFromIndex | context(xl) | 실패 시 NoActiveChatError | 지원 | 지원 |
| getDatabase(personas, selectedPersona, characters) | context(GM, en) | 직접 | 지원(db 권한) | 지원(allowedDbKeys, db 권한) |
| getCurrentLorebookEntries | context(en), beforeRequest·출력 동기화. 1.0.21은 초기 설정 재료 고르기(UI)에서도 사용 | context: `?.()`로 호출, 부재 시 `[]`(1.0.13은 직접 호출로 TypeError). 설정 재료: 직접 호출 | 지원: 캐릭터 globalLore → 현재 chat localLore → 활성 모듈 lorebook, 원본 entry, 권한 없음. 패치판은 hydrated chat accessor로 async, 대상 변경 시 throw | **부재** → 오류 없이 로어북 없는 context로 진행(foreground와 조용히 다름) |
| registerMCP | load(GT) | typeof 없이 await | 지원(메모리 Map). 모델 제공은 활성 모듈 `mcp.url`에 `plugin:` 식별자가 있고 preset/provider가 tools 경로일 때만 | **부재**(load에서 잡힘, absentApis 기록) |
| addPluginChannelListener / postPluginChannelMessage | tool-ipc.v1, provider-manager 채널 | typeof 확인 | 지원(`//@allowed-ipc` 양쪽 필요) | **부재**(원본 fallback: 도구 등록 상태 unavailable) |
| addRisuChatListener("output") | 출력 동기화 | typeof 확인, 없으면 afterRequest 뒤 1500ms timer | **부재** | 부재 |
| addRisuReplacer(before/afterRequest) | 요청 훅 | 직접 | 지원 | 지원 |
| registerSetting·registerButton·getRootDocument·showContainer·hideContainer | UI | 직접 | 지원 | no-op |
| onUnload | 정리 | typeof 확인 | 지원 | 지원 |
| alert | 초기 설정 알림(main 생성 중이 아닐 때) | typeof 확인 | 지원 | 알림 메시지로 전달 |
| getTranslationCache / searchTranslationCache | 번역 표시(1.0.21 추가) | `?.()`·typeof 확인 | 지원 | 부재 |
| parseRisuChat | 설정 재료의 CBS 풀이(1.0.21 추가) | 부재 시 원문 표시 | **부재** | 부재 |

## 2. 의미 차이와 최종 caller (확인한 사실)

1. **beforeRequest 실패:** 원본 `request.ts:171-175`는 replacer를 try 밖에서 await하므로 throw가 `requestChatData` 밖으로 전파되어 전송이 실패한다. BG host는 worker 경계에서 code만 남기고(`bgPluginWorker.cjs:174-176`) `plugin_hook_failed`로 비활성화한 뒤 원래 메시지로 진행한다(`bgPluginHost.cjs:475-489`). RCM은 준비 실패·180초 시한·사용자 차단을 `MemoryInjectionBlockedError`로 throw한다. 따라서 BG에서 RCM의 의도적 차단은 "기억 없이 진행"이 된다(정본 §9.3 공통 경계 5 위반 상태).
2. **출력 동기화 수명:** 1.10에는 output listener가 없어 RCM은 afterRequest 뒤 1500ms timer로 `/v1/turn/prepare`를 다시 호출한다. BG host는 canonical commit 전에 close되고(host-finally) timer는 실행되지 않는다(호환성 검토 §5.3). BG 실행에서는 출력 동기화가 일어나지 않는다.
3. **추출 engine과 lease:** backend 설정 기본 `engine:"risu"`(server.mjs `Ef`), 플러그인 설정 기본 `extractionEngine:"server"`. `risu` engine이면 추출 job을 플러그인 JS가 lease해 실행하므로 요청별 BG JS로는 완료되지 않는다. `server` engine이면 backend가 실행하지만 45초 control lease(heartbeat)가 유효할 때만 새 job을 시작한다. 플러그인 설정이 backend에 어떻게 전달되는지는 미확인이다.
4. **job 관측:** job ID로 완료를 조회하는 API, 출력 동기화 접수 여부를 조회하는 API가 없다(chat별 job 목록 `GET /v1/chats/:id/jobs`만 있음). 중복 방지는 job id와 payload fingerprint 수준이다.

## 3. 단위 분리

### (A) 결정 없이 진행 가능한 단위

**G2.2b — BG `getCurrentLorebookEntries` parity.** 구현 계획·검수·블라인드 테스트 상태는 [G2.2b 계획](BG-G2-2B-LOREBOOK-PARITY-PLAN.md)을 정본으로 한다(2026-10-22 구현·자동 검증·코드 검수·검증 실행 완료, patcher commit `dd5641a`, push 전).
- 근거(r2): RCM 1.0.21에서 이 API 부재는 hook 실패가 아니라 로어북 없는 기억 준비다. BG 결과가 foreground와 조용히 달라지므로 parity로 맞춘다.
- 의미: foreground 패치판과 같은 순서·내용(캐릭터 globalLore → 현재 chat localLore → 활성 모듈 lorebook의 원본 entry, 활성화·필터 없음), 권한 없음. **캐릭터가 없을 때만 `[]`**이고, chat이 없어도 캐릭터·모듈 lore는 반환한다(패치판 accessor 기준). 모듈은 native 해석을 그대로 따른다: 활성 ID를 enabledModules → chat.modules → character.modules → persona.embeddedModule의 **ID** → moduleIntergration에서 모으고, 반환 순서는 그 수집 순서가 아니라 **`db.modules` 배열 순서**이며 `id` 또는 `namespace`로 일치시키고 module ID로 중복 제거한다(`modules.ts` `getModuleByIds`). persona의 embedded 모듈 객체는 `db.modules`에 없으면 이 경로로 lore를 더하지 않는다. 조립 시점에 캡처한 projection(메타데이터 `modules`를 덮어쓴 chat, `serverChatAssemblyContext.cjs`)을 쓰고 별도 전체 chat 조회로 옛 모듈 선택을 되살리지 않는다. 이미 hydrate된 BG projection은 foreground의 비동기 대상 변경 throw를 흉내 낼 필요가 없지만 작업 대상에 묶여야 한다. 패치된 모듈 cache 계약(`db.modules` 배열 교체 반영)을 유지한다. **다른 chat을 hydrate하지 않는다는 조건은 이 API에 한정한다.** RCM이 같은 context에서 부르는 `getDatabase([... "characters"])`는 기존 handler가 전체 캐릭터를 hydrate하므로 별도 판정 대상이다.
- 위치: `bgPluginHost.cjs` handler 표(노출은 자동), 필요 시 server bundle의 모듈 조회 binding.
- 검증: native와 BG에 같은 합성 DB(globalLore·localLore·모듈 3종·persona module)를 주고 반환 배열 deep-equal. 활성 ID 순서와 `db.modules` 순서가 다른 경우, namespace 활성화, 중복 ID, `db.modules`에 없는 embedded 전용 persona 모듈, 메타데이터 모듈 선택이 저장된 전체 chat과 다른 경우, 활성 ID는 같고 lorebook 내용만 바뀐 연속 작업을 포함한다. 캐릭터 없음(`[]`)·chat 없음(캐릭터·모듈 lore 반환)·모듈 없음·stub chat; 이 API 호출이 다른 chat을 hydrate하지 않음과 RCM의 나머지 context 호출(`getDatabase` characters 등)의 성공/실패를 따로 단언; 기존 probe·MARP/PageFold 회귀; 원본 RCM 1.0.21 BG 실행에서 `getCurrentLorebookEntries`가 absentApis에서 사라지고, beforeRequest가 `/v1/turn/prepare`에 보내는 로어북 항목이 같은 합성 DB의 foreground 결과와 같은지 관측. 그 뒤 before_request에 남는 실패 지점 기록. 판정 근거는 absent 진단·hook 반환값이 아니라 backend 요청 본문과 실제 모델 요청이다. 오래된 build/session으로 거절된 시작은 플러그인·backend 효과 0을 단언하고, hook 중 저장소 초기화 사례를 둔다(초기화 뒤 server-input commit 거절이 있으므로 생성 성공만으로 commit 성공을 판정하지 않는다).
- 위험 분류: risky(공통 host·projection).

**G2.2c — 실측 조사(구현 없음).** 격리 backend + 가짜 모델/임베딩으로(먼저 RCM 1.0.21 backend·JS의 공식 파일 hash·ARM 설치·기동·인증/API revision 98을 G2.1 방식으로 재확인):
1. 플러그인 설정 extractionEngine이 backend engine에 반영되는 경로와 실제 기본 동작.
2. 브라우저 원본 RCM의 30초 선택 표시·180초 차단에서 실제 전송 결과(1.10 foreground).
3. BG에서 G2.2b 적용 후 RCM beforeRequest의 실제 결과(prepare 성공 시 주입, 실패 시 차단 신호가 BG에서 진행으로 바뀌는지).
4. JS 부재 시 `server` engine의 job 진행(heartbeat 끊긴 뒤 45초 이후 새 job 시작 여부, 진행 중 job 완료). 1.0.21의 채팅별 일시정지(`PUT /v1/chats/:id/work`)가 이 진행에 주는 영향.

### (B) 사용자 결과 결정이 필요한 단위 (결정 전 구현하지 않음)

**D1 — beforeRequest 차단 의미.** worker 경계에서 이름·메시지가 사라져 일반 오류와 의도적 차단을 공통 계약으로 구분할 수 없다(원본 API에 차단 전용 신호가 없음). 선택지:
- D1-a native parity: BG에서도 beforeRequest throw 전체를 요청 실패로 처리(모델 미호출, 입력 보존, 알림). MARP 등 기존 플러그인의 hook 실패도 진행이 아니라 실패가 된다(G1 기본 정책 변경).
- D1-b 현 정책 유지: 실패 알림 후 진행. RCM 조합은 "차단 의미 미보존"으로 지원표에 미지원 기록.
- D1-c 플러그인별 선택: 사용자가 플러그인마다 "실패 시 요청 중단"을 켜는 설정(호스트 공통 계약, 이름 분기 아님).
- 플러그인 이름·오류 문구에 맞춘 분기는 선택지에서 제외한다.
- **결정(2026-10-17): D1-a.** G1의 beforeRequest 실패 시 진행 정책이 바뀌므로, 구현 계획에 기존 플러그인 hook 실패 동작의 변경 범위와 검증을 포함한다. 구현 계획은 [D1-a 계획](BG-G2-2-D1A-BEFORE-REQUEST-FAILURE-PLAN.md)(2026-10-22 작성·Astra 1회차 반영, 구현 전)이다. 2026-10-22 보충 결정: 같은 작업 앞 단계의 실행 실패로 꺼진 플러그인도 beforeRequest 시점에 요청 실패, identity 변경으로 꺼진 플러그인은 알림 후 진행.
- 구현 계획 조건(Astra r2): 공유 wrapper `invoke`(`bgPluginHost.cjs` 437~)의 한 줄(487)이나 `kind === 'before_request'`만 바꾸지 않는다. 같은 kind가 body interceptor에도 쓰이므로(514) 실제 beforeRequest replacer 계약에 한정하고, 닫힌/이미 실패한 entry의 원래 입력 반환 경로·identity 갱신 뒤 실패 entry 경로·잘못된 결과·worker 실패를 각각 분류한다. 알림/identity 실패의 우선순위와 worker 종료 전 absent 진단 수집을 유지한다. 중지·host 닫힘은 모델 전송을 계속할 이유가 아니며 기존 취소 분류를 유지한다. 바뀌는 기존 기대: `probe-bg-plugin-capability.cjs:383`, `probe-bg-plugin-host.cjs:454`·`:1234`. MARP·PageFold probe는 host fail-open에 기대지 않는다(MARP는 플러그인 자체 복구, PageFold는 provider 계약). 플러그인 내부에서 잡고 정상 결과를 돌려주는 경우는 계속 진행한다. "모델 미호출·입력 보존"은 효과 전 실패와 backend/보조 작업 효과 뒤 실패를 나눠 영속 input receipt·terminal 결과·알림·사용자 메시지 보존·새 답변 없음·자동 재실행 없음을 단언하고, 앞선 provider 시도 뒤 retry에서 실패하는 사례를 포함한다(`plugin-host-units.cjs:192`·`:219`). D1 적용 전 현재 fail-open 동작의 측정 사례를 보존한다.

**D2 — BG MCP.** registerMCP를 BG에 제공하려면 server sendChat의 tool 경로(`request.ts:140` getTools, preset toolUse, provider별 tool loop)에서 worker handler를 호출하고 recall/expand의 backend 호출 비용·시한을 정해야 한다. 모듈 `mcp.url`에 `plugin:risu-cognitive-memory`가 있는 사용자 설정에서만 의미가 있다. 선택지: 지원 구현 / 미지원 기록(도구 없이 진행, 알림) — 도구를 강제로 끄거나 빈 도구로 꾸미지 않는다.
- **결정(2026-10-17): 지원 구현.** tool 호출 비용·시한과 worker 수명은 구현 계획에서 정한다.
- 구현 계획 조건(Astra r2):
  - **도구 발견 시점(핵심):** `requestChatData`는 beforeRequest 전에 `getTools()`를 한 번 받아 그 요청 동안 쓴다(`request.ts:140`). RCM `getToolList`는 beforeRequest의 기억 준비가 만든 도구 사용 기회에 의존하므로, 요청마다 새로 뜨는 BG host에서는 등록이 성공해도 첫 모델 요청의 도구 목록이 빌 수 있다. foreground는 상주 플러그인이라 이전 턴 준비가 남아 있어 다르다. 준비 뒤 발견 시점·retry·호출자가 준 `arg.tools`의 처리를 구현 계획에서 정하고, native 순서를 바꾸는 선택이면 사용자 결정을 받는다. 검증은 준비 응답이 도구를 여는 새 host에서 실제 첫 모델 요청의 tools를 확인한다(등록·수동 호출 성공만으로 통과 처리하지 않는다).
  - **등록 수명:** `registerMCPModule`은 메타데이터와 `getToolList`·`callTool` 두 callback을 등록하고, unregister는 `registeredCustomPluginMCPs`만 지운다(`pluginmcp.ts:36`). `mcp.ts`의 `MCPs` client cache는 따로 남는다(§6 미확인 항목 확인됨). 작업 소유 등록, 종료 시 cache 무효화, callback 호출 scope, identity/효과 검사, 결과 검증을 정한다. 실행 중 도구 목록 재조회(`mcp.ts:162`)도 포함한다.
  - **호출자:** ModelPreset 실행(`request.ts:1156`), OpenAI(`openAI/requests.ts:735·1335`), Google(`google.ts:880·1198`), Anthropic(`anthropic.ts:1021`). 각 경로의 gating·스트리밍 완료·도구 결과 저장·취소·retry 억제를 보존한다. ModelPreset의 일반 도구 오류는 도구 결과 문자열이 되지만 취소는 후속 모델 요청을 막아야 한다.
  - **시한·예산:** 호스트 공유 nativeFetch 128회(`bgPluginHost.cjs:35`)와 session 600초(`bgPluginSession.cjs:11`)가 있고, RCM recall은 `mcpRequestTimeoutMs` 또는 920초, expand는 15초를 쓴다. 15초 heartbeat·45초 lease 상수로 시한을 정하지 않는다. 남은 작업 시간 적용과 시한 도달 시 진행 중 HTTP·worker callback·모델 후속의 처리를 정하고, 기존 예산을 조용히 늘리지 않는다.

**D3 — 출력 동기화·다음 턴.** (Astra r2: host 종료를 commit 뒤로 옮기는 것만으로는 부족하다. 호출 scope는 완료 뒤 해제되고(`bgPluginSession.cjs:35`), worker는 발행된 RPC 사슬만 정산하며(`bgPluginWorker.cjs:126`), 만료된 context의 이후 호출은 거절된다(`:622`). 따라서 afterRequest가 끝난 뒤 실행되는 1500ms timer는 프로세스가 살아 있어도 host API를 쓸 수 없다. 또 1500ms+prepare 5초에는 prepare 앞의 context 읽기 시간이 빠져 있다. 선택지를 제시하기 전에 유한한 호출 scope/commit 관찰 설계를 먼저 구체화한다. D2의 awaited 도구 실행은 기존 commit 전 수명 안에 둘 수 있다.) 원본 fallback(afterRequest+1500ms timer)이 BG 요청 수명 안에서 실행되려면 canonical commit → 저장 identity 관찰 → 원본 후속 효과의 backend 영속 접수 확인 → host close 순서가 필요하다(정본 공통 경계 1·3). timer 즉시 실행·고정 sleep·상주 JS는 금지. 선택지는 G2.2c 실측 뒤 제시한다: 같은 요청 host의 종료를 commit 뒤로 옮기고 유한 대기(원본 timer 1500ms + prepare 5s 시한) / 출력 동기화 미지원으로 다음 턴 원본 보충에 맡김 / 기타.

**D4 — 추출 engine·lease.** G2.2c 4번 결과에 따라 `server` engine 필수 여부와 lease 공백의 처리(지원 한계 기록 / backend 설정 / heartbeat 주체)를 결정한다. lease 연장·무한 heartbeat·상주 JS는 암묵 채택하지 않는다.

## 4. 순서

1. D1·D2 결정 반영본으로 계획 리뷰(Astra)를 받는다. → 2026-10-22 r2 기준선으로 완료(§7).
2. G2.2b는 정석 흐름(Argon 시나리오 → Codex 사전 테스트 → 구현 → 코드 리뷰)으로 진행한다. 2026-10-22에 구현·자동 검증·코드 검수·검증 실행까지 마쳐 patcher `dd5641a`로 `origin/main`에 반영했다([G2.2b 계획](BG-G2-2B-LOREBOOK-PARITY-PLAN.md)).
3. G2.2c는 validation-runner로 Codex 없이 진행 가능(격리·합성·가짜 모델).
4. D3·D4는 G2.2c 결과로 선택지를 구체화해 결정받는다.

## 5. 유지할 동작

G2.2a 계약(노출·진단), 기존 API·권한·예산, MARP/PageFold BG 결과, G1 저장·취소·알림, 설정 override/custom endpoint/로컬 모델, v3.svelte.ts 내용, RCM 원본·backend 무수정.

## 6. 미확인

- registerMCP 실패가 RCM 도구 상태에 남기는 표시(원본이 잡는 위치 미확인, A5에서는 load 성공).
- ~~패치판 async `getCurrentLorebookEntries`의 대상 변경 throw가 BG 조립 시점 snapshot에서 필요한지.~~ → r2 검수: 고정된 projection은 불필요, 작업 대상 고정은 필요(G2.2b 의미).
- ~~MCP cache가 unregister 뒤 남는지(코드 추론).~~ → r2 검수에서 코드로 확인(D2 조건).
- RCM 1.0.21 패키지의 commit 출처·route 수 전수·ARM 설치·실행 동작은 검수자가 독립 확인하지 않았다(G2.2c 첫 단계).

## 7. 계획 검수 기록

**r2 Astra(gpt-6-astra, read-only, 1회차, 2026-10-22 KST):** 대상은 r2 기준선(`902148a`, 코드는 `2adc8a5`와 같음)과 RCM 1.0.21. 지적 10건과 기준선 단서 2건을 모두 채택해 G2.2b 의미·검증, D1·D2 구현 계획 조건, D3 단서, §1 제목·기준선 문장에 반영했다. 결론: G2.2b(수정된 parity 계약)와 G2.2c는 D3·D4 결정 없이 진행 가능하다. D2의 도구 발견 시점은 구현 계획에서 native 순서 변경 여부를 사용자 결정으로 받을 수 있다. 오케스트레이터가 직접 확인한 근거: `modules.ts` `getModuleByIds`(db.modules 순서·namespace·중복 제거), `request.ts:140`의 beforeRequest 전 `getTools()`, `pluginmcp.ts` 등록/해제, `bgPluginHost.cjs` `invoke`의 조기 반환·514 body interceptor·128회 예산, `bgPluginSession.cjs` 600초, RCM의 920초 상수. 나머지 인용 줄은 검수자 보고에 따른다. 계획 변경이 지적 반영 범위라 2회차는 받지 않았다.
