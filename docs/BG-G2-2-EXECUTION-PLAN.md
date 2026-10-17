# G2.2 실행 계획 초안 (r1, 2026-10-17)

**상태:** 조사 결과와 초안이다. 다른 모델 계열의 계획 리뷰는 Codex 사용 한도로 중단되어 아직 받지 않았다(재개 가능 시점 2026-10-22). 2026-10-17 사용자 결정: D1은 D1-a(native parity), D2는 BG MCP 지원 구현. D3·D4는 미결정이다. 남은 작업(계획 리뷰, G2.2b, G2.2c, D1·D2 구현)은 2026-10-22 이후 사용자 지시로 재개한다.

정본: ordered-goals §4·§9.3(G2.2 행)·§9.3 「공통 경계」1~7, 호환성 검토 §4. 기준: patcher main `58af7b2`(experimental.56/adapter 0.7.60), 공식 PocketRisu 1.10.0 `98e9683`, RCM 1.0.13(JS SHA-256 `fcdce0fe…`, API revision 90).

G2.2의 산출물은 API별 의미표·최종 caller·필요한 호스트 수정·의도적 차단과 일반 오류의 구분·종료/인계/다음 턴 정책·검증 사례다. 이 계획은 그중 (A) 바로 구현 가능한 단위와 (B) 사용자 결과 결정이 필요한 단위를 나눈다. (B)는 결정 전 구현하지 않는다.

## 1. RCM 1.0.13 API 사용표 (조사 결과)

| API | 사용 위치·단계 | 원본 처리 | foreground 1.10 | BG 현재 |
|---|---|---|---|---|
| getLocalPluginStorage / getArgument / setArgument | 설정 load·save | setArgument 부재 시 throw | 지원 | 지원 |
| nativeFetch | backend HTTP 전부, 번역 GET | 직접 호출 | 지원 | 지원(budget 128) |
| runLLMModel | 내부 모델 호출 | 직접 | 지원 | 지원 |
| getCurrentCharacterIndex·getCharacter·getCurrentChatIndex·getChatFromIndex | context(xl) | 실패 시 NoActiveChatError | 지원 | 지원 |
| getDatabase(personas, selectedPersona, characters) | context(GM, en) | 직접 | 지원(db 권한) | 지원(allowedDbKeys, db 권한) |
| getCurrentLorebookEntries | context(en), beforeRequest·출력 동기화 | Promise.all 안에서 직접 호출, 실패는 context error | 지원: 캐릭터 globalLore → 현재 chat localLore → 활성 모듈 lorebook, 원본 entry, 권한 없음. 패치판은 hydrated chat accessor로 async, 대상 변경 시 throw | **부재** → TypeError → hook 실패 |
| registerMCP | load(GT) | typeof 없이 await | 지원(메모리 Map). 모델 제공은 활성 모듈 `mcp.url`에 `plugin:` 식별자가 있고 preset/provider가 tools 경로일 때만 | **부재**(load에서 잡힘, absentApis 기록) |
| addPluginChannelListener / postPluginChannelMessage | tool-ipc.v1, provider-manager 채널 | typeof 확인 | 지원(`//@allowed-ipc` 양쪽 필요) | **부재**(원본 fallback: 도구 등록 상태 unavailable) |
| addRisuChatListener("output") | 출력 동기화 | typeof 확인, 없으면 afterRequest 뒤 1500ms timer | **부재** | 부재 |
| addRisuReplacer(before/afterRequest) | 요청 훅 | 직접 | 지원 | 지원 |
| registerSetting·registerButton·getRootDocument·showContainer·hideContainer | UI | 직접 | 지원 | no-op |
| onUnload | 정리 | typeof 확인 | 지원 | 지원 |

## 2. 의미 차이와 최종 caller (확인한 사실)

1. **beforeRequest 실패:** 원본 `request.ts:171-175`는 replacer를 try 밖에서 await하므로 throw가 `requestChatData` 밖으로 전파되어 전송이 실패한다. BG host는 worker 경계에서 code만 남기고(`bgPluginWorker.cjs:174-176`) `plugin_hook_failed`로 비활성화한 뒤 원래 메시지로 진행한다(`bgPluginHost.cjs:475-489`). RCM은 준비 실패·180초 시한·사용자 차단을 `MemoryInjectionBlockedError`로 throw한다. 따라서 BG에서 RCM의 의도적 차단은 "기억 없이 진행"이 된다(정본 §9.3 공통 경계 5 위반 상태).
2. **출력 동기화 수명:** 1.10에는 output listener가 없어 RCM은 afterRequest 뒤 1500ms timer로 `/v1/turn/prepare`를 다시 호출한다. BG host는 canonical commit 전에 close되고(host-finally) timer는 실행되지 않는다(호환성 검토 §5.3). BG 실행에서는 출력 동기화가 일어나지 않는다.
3. **추출 engine과 lease:** backend 설정 기본 `engine:"risu"`(server.mjs `Ef`), 플러그인 설정 기본 `extractionEngine:"server"`. `risu` engine이면 추출 job을 플러그인 JS가 lease해 실행하므로 요청별 BG JS로는 완료되지 않는다. `server` engine이면 backend가 실행하지만 45초 control lease(heartbeat)가 유효할 때만 새 job을 시작한다. 플러그인 설정이 backend에 어떻게 전달되는지는 미확인이다.
4. **job 관측:** job ID로 완료를 조회하는 API, 출력 동기화 접수 여부를 조회하는 API가 없다(chat별 job 목록 `GET /v1/chats/:id/jobs`만 있음). 중복 방지는 job id와 payload fingerprint 수준이다.

## 3. 단위 분리

### (A) 결정 없이 진행 가능한 단위

**G2.2b — BG `getCurrentLorebookEntries` parity.** 
- 의미: foreground 패치판과 같은 순서·내용(캐릭터 globalLore → 현재 chat localLore → 활성 모듈 lorebook의 원본 entry, 활성화·필터 없음), 권한 없음, 현재 대상이 없으면 `[]`. 모듈 목록 구성은 native `getModules()` 순서(db.enabledModules → chat.modules → character.modules → persona.embeddedModule → db.moduleIntergration)를 같은 소스 함수 또는 동일 계약으로 맞춘다. 조립 시점 projection(선택 chat hydrate)을 사용하고 다른 chat을 hydrate하지 않는다.
- 위치: `bgPluginHost.cjs` handler 표(노출은 자동), 필요 시 server bundle의 모듈 조회 binding.
- 검증: native와 BG에 같은 합성 DB(globalLore·localLore·모듈 3종·persona module)를 주고 반환 배열 deep-equal; 대상 없음·모듈 없음·stub chat; 기존 probe·MARP/PageFold 회귀; 원본 RCM BG 실행에서 `getCurrentLorebookEntries`가 absentApis에서 사라지고 before_request의 다음 실패 지점 관측.
- 위험 분류: risky(공통 host·projection).

**G2.2c — 실측 조사(구현 없음).** 격리 backend + 가짜 모델/임베딩으로:
1. 플러그인 설정 extractionEngine이 backend engine에 반영되는 경로와 실제 기본 동작.
2. 브라우저 원본 RCM의 30초 선택 표시·180초 차단에서 실제 전송 결과(1.10 foreground).
3. BG에서 G2.2b 적용 후 RCM beforeRequest의 실제 결과(prepare 성공 시 주입, 실패 시 차단 신호가 BG에서 진행으로 바뀌는지).
4. JS 부재 시 `server` engine의 job 진행(heartbeat 끊긴 뒤 45초 이후 새 job 시작 여부, 진행 중 job 완료).

### (B) 사용자 결과 결정이 필요한 단위 (결정 전 구현하지 않음)

**D1 — beforeRequest 차단 의미.** worker 경계에서 이름·메시지가 사라져 일반 오류와 의도적 차단을 공통 계약으로 구분할 수 없다(원본 API에 차단 전용 신호가 없음). 선택지:
- D1-a native parity: BG에서도 beforeRequest throw 전체를 요청 실패로 처리(모델 미호출, 입력 보존, 알림). MARP 등 기존 플러그인의 hook 실패도 진행이 아니라 실패가 된다(G1 기본 정책 변경).
- D1-b 현 정책 유지: 실패 알림 후 진행. RCM 조합은 "차단 의미 미보존"으로 지원표에 미지원 기록.
- D1-c 플러그인별 선택: 사용자가 플러그인마다 "실패 시 요청 중단"을 켜는 설정(호스트 공통 계약, 이름 분기 아님).
- 플러그인 이름·오류 문구에 맞춘 분기는 선택지에서 제외한다.
- **결정(2026-10-17): D1-a.** G1의 beforeRequest 실패 시 진행 정책이 바뀌므로, 구현 계획에 기존 플러그인 hook 실패 동작의 변경 범위와 검증을 포함한다.

**D2 — BG MCP.** registerMCP를 BG에 제공하려면 server sendChat의 tool 경로(`request.ts:140` getTools, preset toolUse, provider별 tool loop)에서 worker handler를 호출하고 recall/expand의 backend 호출 비용·시한을 정해야 한다. 모듈 `mcp.url`에 `plugin:risu-cognitive-memory`가 있는 사용자 설정에서만 의미가 있다. 선택지: 지원 구현 / 미지원 기록(도구 없이 진행, 알림) — 도구를 강제로 끄거나 빈 도구로 꾸미지 않는다.
- **결정(2026-10-17): 지원 구현.** tool 호출 비용·시한과 worker 수명은 구현 계획에서 정한다.

**D3 — 출력 동기화·다음 턴.** 원본 fallback(afterRequest+1500ms timer)이 BG 요청 수명 안에서 실행되려면 canonical commit → 저장 identity 관찰 → 원본 후속 효과의 backend 영속 접수 확인 → host close 순서가 필요하다(정본 공통 경계 1·3). timer 즉시 실행·고정 sleep·상주 JS는 금지. 선택지는 G2.2c 실측 뒤 제시한다: 같은 요청 host의 종료를 commit 뒤로 옮기고 유한 대기(원본 timer 1500ms + prepare 5s 시한) / 출력 동기화 미지원으로 다음 턴 원본 보충에 맡김 / 기타.

**D4 — 추출 engine·lease.** G2.2c 4번 결과에 따라 `server` engine 필수 여부와 lease 공백의 처리(지원 한계 기록 / backend 설정 / heartbeat 주체)를 결정한다. lease 연장·무한 heartbeat·상주 JS는 암묵 채택하지 않는다.

## 4. 순서

1. D1·D2 결정 반영본으로 계획 리뷰(Astra)를 받는다(2026-10-22 이후, 사용자 지시 시).
2. G2.2b는 Codex 주간 리셋(10-22) 뒤 정석 흐름(Argon 시나리오 → Codex 사전 테스트 → 구현 → 코드 리뷰)으로 진행한다. Codex 없이 진행하려면 사용자 결정이 필요하다.
3. G2.2c는 validation-runner로 Codex 없이 진행 가능(격리·합성·가짜 모델).
4. D3·D4는 G2.2c 결과로 선택지를 구체화해 결정받는다.

## 5. 유지할 동작

G2.2a 계약(노출·진단), 기존 API·권한·예산, MARP/PageFold BG 결과, G1 저장·취소·알림, 설정 override/custom endpoint/로컬 모델, v3.svelte.ts 내용, RCM 원본·backend 무수정.

## 6. 미확인

- registerMCP 실패가 RCM 도구 상태에 남기는 표시(원본이 잡는 위치 미확인, A5에서는 load 성공).
- 패치판 async `getCurrentLorebookEntries`의 대상 변경 throw가 BG 조립 시점 snapshot에서 필요한지.
- MCP cache가 unregister 뒤 남는지(코드 추론).
