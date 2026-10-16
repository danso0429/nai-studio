# G2.0 AC·RCM 조사와 무과금 연결 실험

기준일: 2026-10-15 KST. 실행 정본은 [BG Preserve 순차 목표 계획 §9](BG-PRESERVE-ORDERED-GOALS.md#9-g2--공식-rcm-설치와-서버-완주)다.

## 현재 결론과 단계

현재 제품 선택 (2026-10-15): 사용자는 RCM 설치·BG 연동을 선택하고 AC는 미래 후보(DEFERRED)로 남기기로 했다. 소규모 세계관 대화의 기능·운영 적합성을 근거로 한 선택이며 자체 품질 점수 비교를 선행하지 않는다. 아래 미실행/미확인 사실은 유지하며 선택을 정확도 우위·설치 완료·BG 지원이나 G1 잔여 면제로 해석하지 않는다. 현재 다음 작업은 정본 G2.1의 RCM 기준선·격리 설치 확인이고, AC 재개 조건은 정본 §9.6에 둔다.

후속 검증 (2026-10-15): 사용자가 기능 탐지 설명을 실제로 검증하도록 요청해 **격리 시험 복사본에서만** API 비노출 실험을 추가했다. 원래 호스트와 수정 복사본을 구분한 결과는 §7을 따른다. listener 하나의 거짓 함수 노출을 제거하면 AC는 요청 훅/장애 응답 처리까지 진행했고 RCM은 다음 MCP 등록 장벽으로 이동했다. 미구현 최상위 속성을 함께 숨기면 RCM도 훅을 설치했으나 요청 전 훅에서 다시 실패했다. 원래 호스트/운영에는 적용하지 않았다.

**현재 정본과 바이트가 같은 격리 BG 호스트에서 공식 AC 4.9.0과 RCM 1.0.12 모두 초기화 중 `addRisuChatListener` 호출로 비활성화됐다.** 두 원본에는 listener가 없을 때의 경로가 있지만 호스트 Proxy가 미지원 함수도 있다고 노출해 그 경로를 막는다. 이번 실험은 이 기능 노출/실패 처리 문제를 확인했으며, listener 자체가 각 제품에 반드시 필요한지나 두 제품의 실제 연결 난이도가 같은지는 입증하지 않았다. 원본 코드나 호스트 API를 고쳐 통과시키지 않았다.

| 단계 | 관찰한 범위 | 남은 범위 |
|---|---|---|
| 0-A 기준선·배치 조사 | 공식 release/tag, 배포 파일 hash, JS/서버 구성, API 후보 목록과 수명 경계를 조사했다. | 실제 설치·백업/복원·업데이트와 부하 측정은 소스 설명과 구분한다. |
| 0-B 무과금 연결 | 기존 호스트의 첫 중단 관측 뒤, §7의 명시적 시험 복사본 2종과 새 원본 대조를 각각 2회 실행했다. | 복사본에서 훅/일부 요청에 도달한 것을 운영 지원으로 계산하지 않는다. 정상 backend 프로토콜·채팅/기억 저장·다음 턴 주입과 원래 브라우저 비교는 미실행이다. |
| 0-C 품질·비용·운영 비교 | 공통 합성 사례와 기대/금지 사실을 사전 작성하고 설정 차이를 정리했다. | 실제 모델 품질, 호출 수·비용, backend 지연·CPU/RAM, 장애/복원 실측은 미실행이다. |
| 0-D 사용자 선택 | **완료: RCM 설치·BG 연동, AC는 DEFERRED.** | 실제 품질/비용 비교·지원 조합·초기 설정은 미확정/미검증 범위대로 남는다. 선택은 전체 비교 시험이나 G2 제품 완료가 아니다. |

## 1. 공식 기준선과 무결성

공식 GitHub release API와 annotated tag가 가리키는 commit을 각각 조회했다. 배포 ZIP은 공개 digest와 SHA-256을 대조하고 ZIP CRC를 검사했다. JS는 **배포본의 원래 바이트**로 시험했다.

| 대상 | 버전·commit | 내려받은 파일 | bytes | SHA-256 |
|---|---|---|---:|---|
| AC | [v4.9.0](https://github.com/Flazer31/archive-center/releases/tag/v4.9.0), `f2c92ebe00382b8ea83e6424314b2cde90074706` | `Archive.Center.js` | 3,095,160 | `ad37e486aad937b9f4cc034c85cef3ce03f4971228af14e6269b0a9d0971a604` |
| AC | 같은 release | Linux arm64 Auto Install Package ZIP | 18,628,410 | `c5f73c83d2f6a79b5518d2c942afb76acc42865478bbffed7d7fcf5cd1b91084` |
| RCM | [v1.0.12](https://github.com/Pulproom/rcm/releases/tag/v1.0.12), `8f662b5008afe832b632ea28375c3fe685165da9` | `RCM-node-install.zip` | 818,382 | `da56a5289f496802da04085a0d3aea5a915dcea8d544f21c4e3a2ebbe6afdf24` |
| RCM | 같은 ZIP의 JS | `risu-cognitive-memory.js` | 1,423,568 | `8183aee877f86eae13ac1ac84c248fa072e5ae5f0e5e7809649f70e152219a27` |
| RCM | 같은 ZIP의 backend | `server.mjs` | 1,529,845 | `2fc858985f11227670f3b2b1f4ce7e3dffbbb762ad95a276c8d7d331a081a41a` |

AC 태그 소스 JS는 LF 3,039,742 bytes, 배포 JS는 CRLF 3,095,160 bytes다. CRLF를 LF로 정규화한 내용은 같지만 원래 파일 hash는 다르다. 실험 입력은 위 배포 hash를 유지했다. RCM ZIP의 JS/backend는 태그의 `channels/stable` 파일과 각각 바이트가 같다. 이것은 소스/배포 파일 대응 확인이며 재현 빌드 증명은 아니다.

두 저장소에는 MPL-2.0 라이선스와 제3자 고지가 있다. 이번 작업에서는 upstream 파일을 저장소에 재배포하거나 설치 스크립트를 실행하지 않았다. 원본은 임시 조사 디렉터리에 보존했다. RCM ZIP member는 역슬래시 경로를 사용하므로 검사에는 원래 ZIP을 유지하고, POSIX 조사 경로를 별도로 정규화했다. 이를 실제 Linux 설치 성공/실패로 판정하지 않는다.

## 2. 실행 배치와 기억 수명

| 구분 | AC 4.9.0 | RCM 1.0.12 |
|---|---|---|
| 브라우저/요청별 JS | Risu 훅·채팅 listener·설정/UI·실제 payload 적용 | 요청 훅·채팅 output 관찰·설정/UI·기억 도구 등록 |
| 제품 backend | Go 서버가 기억 선택·예산·턴 판정·저장·orchestration 담당 | Node 서버가 동기화·검색·기억 작업 큐·서버 모델 작업자 담당 |
| 기억/검색 저장소 | MariaDB 정본, ChromaDB는 재구축 가능한 검색 보조 계층 | SQLite, FTS, sqlite-vec; 임베딩 부재 시 어휘 검색 fallback 코드가 있음 |
| 모델 호출 | 기본 기억과 평론가, 선택적 다중 담당 전처리/출판사 등의 별도 호출 | 기억 추출/상태 조정/관계·이야기 정리 등 job별 호출, 서버 모델 또는 Risu 모델 경로 |
| 설치에서 확인한 사실 | 공개 ARM64 패키지에 정적 링크 Go 실행 파일 포함. `file`/Go build info는 linux/arm64·CGO=0을 표시 | 공개 Node ZIP의 네이티브 의존성은 `better-sqlite3` **12.11.1**, `sqlite-vec` **0.1.9**. Node 22.12 이상 안내 |
| 설치 실측 | MariaDB/Chroma/backend 모두 시작하지 않음 | npm 설치·네이티브 모듈 로드·backend 모두 실행하지 않음 |

근거: [AC README](https://github.com/Flazer31/archive-center/blob/v4.9.0/README.md), [AC 평론가](https://github.com/Flazer31/archive-center/blob/v4.9.0/prompts/critic_system.txt), [AC 전처리](https://github.com/Flazer31/archive-center/blob/v4.9.0/go-service/internal/httpapi/prepare_turn_multi_agent.go), [RCM DB](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/server/src/db.ts), [RCM backend 작업자](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/server/src/server-worker.ts), [RCM 설치 안내](https://github.com/Pulproom/rcm/blob/v1.0.12/deploy/distribution/templates/README-node.md). 양쪽 Linux/ARM 패키지의 제공과 실제 설치 검증은 다르다. 이번 파일 크기로 RAM 사용량이나 속도를 추정하지 않는다.

### 데이터·제어 흐름: 소스로 확인한 경로

```text
공통 목표
BG가 한 요청 소유 → 원본 JS의 기억 준비/주입 → main/출력 처리
→ PocketRisu canonical 채팅 저장 → 제품의 원문/기억 저장 → 다음 요청 payload

AC 원본
초기화에서 입력·before/after·output listener·body interceptor 등록
→ backend 기억 준비 결과를 요청에 적용
→ 저장 시점 설정에 따른 완료 처리/이전 턴 확정/누락 원문 보충
→ Go/backend 저장·평론가·검색 처리

RCM 원본
초기 beforeRequest 준비 gate → 설정/저장소 → before/after/output 등록
→ beforeRequest에서 현재 대화/로어북/페르소나와 backend prepare
→ [[RCM]] 위치 기억 주입 → main
→ output 관찰 또는 구형 호스트의 지연 fallback
→ syncCommittedOutput이 저장된 현재 대화를 다시 읽고 prepare(budget=0,deferExtraction=false)
→ 서버/Risu 작업자 실행 → 기억 저장/색인 → 다음 prepare
```

이 흐름은 제품 소스 판독이며 현재 BG에서 완주한 관측이 아니다. AC는 현재 턴/이전 턴 설정에 따라 완료 시점이 달라지고, RCM의 afterRequest는 채팅 저장 그 자체가 아니다. 저장된 메시지 identity와 backend 접수/완료 상태를 따로 연결해야 한다.

RCM의 [서버 작업자](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/server/src/server-worker.ts#L162)는 새 작업 시작에 45초 제어 lease를 검사한다. 진행 중 작업은 별도 `#canFinishActive` 조건으로 처리하므로 ‘heartbeat가 없으면 진행 중 기억 작업도 즉시 취소된다’고 읽으면 틀리다. JS는 [15초 heartbeat](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/plugin/src/index.ts#L46)를 등록한다. 요청별 JS 종료 후 누가 다음 job을 시작하는지와 브라우저/서버 lease 경쟁은 미측정이다.

RCM의 [prepareChoice](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/plugin/src/runtime.ts#L180)에는 30초 선택 표시·180초 block 코드가 있다. 현재 BG 실험은 이 경로 전에 막혔으므로 시간 경과 동작을 실행 확인하지 않았다. 원본 기본 차단을 호스트가 알림 후 진행으로 바꿔도 된다는 뜻이 아니다.

## 3. 기존 호스트의 지원 공백

실험은 공개 패처의 source `8adb75f`를 포함한 `0729f2f` 기준을 사용했다. 실제 읽힌 호스트와 상대 경로 `require()` 의존 파일 **10개**를 해당 패처 owner 파일과 바이트 대조했다. 호스트 JS SHA-256은 `3df9218fe853cdc5366daadee163ecdb151d33d2ad99334f405a6c2a1b1fb204`다. 실행기는 Node v25.9.0/linux/arm64, bwrap·Node permission·systemd scope다.

호스트는 unknown API도 함수로 보이게 하는 Proxy를 제공한다. 따라서 `typeof api.addRisuChatListener === 'function'` 조건이 참이지만 실제 호출은 미지원이다. 호스트의 `disable()`은 entry를 비활성화하고 session을 중단한다. 준비 실패 entry의 훅은 최종 registry에 설치되지 않으며, 이미 설치한 등록은 close cleanup에서 제거한다. 플러그인이 오류를 catch해도 이미 비활성화된 entry는 되살아나지 않는다. [현재 host/worker source](https://github.com/danso0429/pocketrisu-personal-patches/tree/0729f2f/patches/lazy-chat-bg-adapter/files-1.10/server/node)

| API/환경 | 현재 호스트 | 후보에서의 역할과 확인 범위 |
|---|---|---|
| before/after replacer, 입력 script handler, body interceptor, 원본 저장소·현재 캐릭터/채팅 읽기, nativeFetch/모델 호출 | 구현됨 | 개별 기능 존재가 후보 전체 호환을 뜻하지 않는다. 이번 제품들은 초기화 뒤 요청에 도달하지 못함 |
| `addRisuChatListener` | 미지원 API도 함수로 노출 | **양쪽에서 실제 초기화 실패 확인**. 원본은 typeof 조건으로 listener 부재 경로를 갖고 있으므로 API 자체의 필수성은 미확인 |
| `removeRisuChatListener` | 미지원 | AC unload cleanup 소스에 있음. 이번 실패 entry는 host close의 unload 대상에서 제외되므로 해당 cleanup은 실행되지 않음 |
| `getCurrentLorebookEntries` | 미지원 | AC의 로어북 참조 동기화, RCM `readCurrentContext`에서 사용. 이번 실행에서는 모두 미도달 |
| `registerMCP`, `addPluginChannelListener`, `postPluginChannelMessage` | 미지원 | RCM의 선택적 기억 도구/Provider Manager 연결. 원본은 등록 실패를 catch하지만 호스트는 API 미지원 시 entry 전체를 비활성화함. RCM의 native MCP 등록 시도는 도구 OFF에서도 함수 호출을 건너뛰지 않음. 이번 동적 실험에서는 미도달 |
| `getRootDocument`, 설정/버튼/컨테이너 API | null/UI no-op | UI 생략이 요청의 결과/초기화 순서를 바꾸지 않는지 별도 확인 필요 |
| `document`, 브라우저 event listener·일부 DOM 타입 | worker 전역에 없음 | RCM entry의 `document.addEventListener`와 `window.addEventListener` 등이 뒤에 있음. 현재 실패를 고친 뒤 추가로 확인할 경계이며 이번에 DOM 오류를 재현했다고 주장하지 않음 |

RCM의 [도구 등록](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/plugin/src/tool-adapters.ts)과 [MCP 등록](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/plugin/src/mcp.ts#L283), [현재 문맥 읽기](https://github.com/Pulproom/rcm/blob/v1.0.12/packages/plugin/src/context.ts#L457)를 직접 대조했다. AC의 `DBState` 접근 등 legacy/guarded 표면도 목록에 남겼으며 API 이름만 보고 모두 필수 신규 구현으로 분류하지 않는다.

정적 목록은 Acorn 8.15.0으로 배포 JS의 host member chain과 browser identifier 후보를 추출했다. AC는 조건식으로 정의한 `R` 별칭을 포함하고 RCM의 동명 압축 지역 변수는 제외했다. AC 33개/RCM 22개의 **member chain**은 API 개수나 복잡도 점수가 아니다. 인식한 host root의 computed dynamic member는 없었지만, 분석은 scope/dataflow 전체를 증명하지 않는다. 문자열 dispatch·추가 alias·사용자 설정에 따른 도달성은 소스/실행 추적을 함께 봐야 한다. browser identifier 후보에는 번들 라이브러리나 UI에서만 쓰는 이름도 포함된다.

### 원본의 부재 처리와 실제 요구를 구분하는 표

| 후보·표면 | 원본의 보호/대체 경로 | 현재 확인과 미확인 |
|---|---|---|
| AC add/remove chat listener | typeof 검사·try/catch, add 부재 시 capability_unavailable 기록 | Proxy 때문에 add 부재 분기를 선택하지 못함. listener 없이 실제 완료/누락 보충이 성립하는지는 미실행 |
| RCM add chat listener | typeof 검사, listener 없는 호스트에서 afterRequest 뒤 1500ms 동기화 fallback | Proxy가 listener 있음으로 판정하게 함. fallback 타이머가 요청별 수명 안에서 안전하게 동기화하는지는 미실행 |
| AC getCurrentLorebookEntries | typeof 부재 또는 catch 시 backend에 unavailable 관찰 상태 전달 | 호스트 전체 disable과 원본의 graceful unavailable 처리는 다른 결과. 실제 fallback 동작은 미도달 |
| RCM getCurrentLorebookEntries | readCurrentContext의 Promise.all에서 직접 호출 | 핵심 문맥 준비 경로에 있음. 실제 서버 API 의미와 해당 요청의 오류 처리는 선택 후 추적 필요 |
| RCM registerMCP | 호출 자체는 typeof 검사 없이 실행, 바깥 registrar에서 catch | 도구 OFF도 등록 시도는 함. catch를 허용하는 일반 호스트와 현재 entry disable은 다름. MCP 구현이 반드시 필요하다고 단정하지 않음 |
| RCM plugin channel | API 함수 존재 검사 뒤 사용, registrar 바깥 catch도 있음 | Proxy가 부재 검사를 왜곡할 수 있음. 원본의 채널 미지원 경로와 자동 기억 보존은 미도달 |
| RCM document/window event API | entry의 뒤쪽 초기화에서 직접 사용, 전체 초기화 promise에는 catch | 앞선 실패에 가려짐. 해당 부분에서 초기화가 끝나면 어떤 훅/heartbeat가 남는지 동적 미확인 |
| AC DBState·브라우저 DOM·UI | legacy/조건부·설정 UI 표면 포함 | 전체를 필수 API로 세지 않음. 필요하면 실제 호출 경로별로 조사 |

따라서 목록은 곧바로 추가할 API 목록이 아니다. 먼저 미지원 capability의 정직한 노출과 원본의 기존 fallback 의미를 검토하고, 그 뒤 선택 제품의 실제 최종 호출 경로를 확인해야 한다. 호스트 표면을 바꾼 비교 run은 이번 결과에 포함하지 않았다.

## 4. 무과금 격리 실험

재사용 실행기: [probe-bg-memory-candidates.cjs](../scripts/probe-bg-memory-candidates.cjs). 입력은 조립된 데이터 없는 host root, 정본 patcher root, 아래 manifest, 새 JSON 출력 경로다. 실제 운영 DB·설정·인증은 읽지 않는다. KV는 매 run의 새 SQLite DB이며, 이 **harness용** better-sqlite3 12.9.0은 RCM backend의 12.11.1 실행 검증을 대신하지 않는다. Acorn 8.15.0과 better-sqlite3는 host root에 설치된 검증 도구 의존성이며 앞의 정본 owner 10파일 대조 대상에 포함되지 않는다.

Manifest는 제품별 `id`, 실제 플러그인 `name`, 공식 JS `file`/`sha256`, 합성 `realArg`/로컬 저장값을 받는다. 같은 db/replacer/provider/mainDom 권한을 실제 플러그인 이름으로 부여했다. AC는 기본 설정과 합성 bridge 설정, RCM은 빈 설정과 합성 server URL/token·도구 OFF 설정을 분리했다. 도구 OFF를 원본의 등록 생략과 혼동하지 않는다.

외부 요청 binding은 실제 네트워크를 전혀 사용하지 않는다. `throw`는 명시적인 fixture 오류, `respond`는 HTTP 503 JSON 장애 응답이다. 200 응답은 전송 양성 대조군만 사용한다. **respond 조건은 제품 backend의 정상 프로토콜을 흉내 낸 성공 fixture가 아니다.** 제품 요청이 해당 binding까지 도달하면 정상 lifecycle 입증과 구분해야 한다. 이번 제품 8조건에서는 도달한 요청 자체가 0이다.

| 실행 사례 | 관찰 |
|---|---|
| 정상 합성 플러그인 | before/after 각 1개 등록·1회 실행. 독립 marker와 출력 suffix 확인, 알림 0 |
| unknown API를 try/catch하는 합성 플러그인 | `plugin_api_unsupported`, load phase, 이후 hooks 0. catch만으로 비활성화를 막지 못함 |
| typeof 검사와 부재 fallback을 가진 합성 플러그인 | 미지원 함수가 있다고 판정해 호출하고 `plugin_api_unsupported`로 종료. else의 fallback marker 훅은 등록/실행 0 |
| 요청 binding이 throw하는 합성 플러그인 | before 1회·binding 1회·reject 1. durable `plugin_hook_failed`, before_request phase, effectsMayHaveOccurred=true |
| 요청 binding이 200을 반환하는 합성 플러그인 | before 1회·binding 1회·HTTP2xx 1, 실패 알림 0 |
| AC: 기본/설정값 있음 × throw/503로 구성한 4회 재현 | 모두 load의 `plugin_api_unsupported / add_risu_chat_listener`. registry 0, 실제 before/after 실행 0, 외부 binding 0, 저장소 쓰기 0. 원본은 listener 등록 뒤 영속 설정을 읽으며 local KV 설정 키 읽기도 0이므로 설정 분기를 검증한 결과가 아님 |
| RCM: 빈 설정/설정값 있음 × throw/503로 구성한 4회 재현 | 모두 같은 load 실패. registry 0, 실제 before/after 실행 0, 외부 binding 0, 저장소 쓰기 0. local KV의 rcm.settings.v1/rcm.cache.v1 읽기는 관찰했지만 설정에 따른 요청 동작이나 transport 차이는 미도달. realArg/getArgument 및 root pluginStorage 읽기는 이 계측에 포함되지 않음 |

각 실행 종료 뒤 registry 0과 실제 worker 정리를 확인했다. 공유 plugin slice의 시작/종료 TasksCurrent는 0이었다. 기존 작업을 취소하지 않았다. 대조군은 실제 격리 worker의 등록과 host registry callback을 합성 인자로 직접 실행한 것이며, PocketRisu 실제 Send pipeline이나 브라우저 동작의 증거가 아니다. load 관측 시간은 프로세스 부팅과 실패 정리를 포함하므로 기억 준비 latency나 성능 우열로 사용하지 않는다.

원본 JS hash를 실행 전후 확인했다. 최종 영수증은 로컬 `.code-review/workspaces/bg/g2-comparison/host-smoke-guarded.json`, 기준선은 같은 디렉터리 `baseline.json`·`manifest.json`이다. 원시 영수증과 upstream 다운로드는 공개 배포에 포함하지 않는다. 독립 환경에서 재실행하려면 위 기준선의 공식 파일, 같은 패처에서 조립한 host 코드와 의존성, systemd user bus/bwrap/Node25를 준비하고 fresh 출력 경로를 사용해야 한다. 준비 실패는 제품 실패로 세지 않는다.

제외/정정 기록: 첫 실행은 다른 pack 소유의 `serverChatCommit.cjs` 경로를 잘못 가정해 worker 실행 전에 중단됐다. 다음 실행은 대조군의 내부 fixture 오류가 공개 알림에서 `plugin_hook_failed`로 정규화되는 것을 기대값에 반영하지 못해 제품 시험 전에 중단됐다. 소유 경로와 실제 코드 분류를 확인한 뒤 수정했고, 양성/음성 대조 자체는 유지했다. 초기 정적 추출의 RCM 지역 변수 `R` false positive를 제거하고 alias 양성/음성 입력으로 검사했다. 이 기록을 제품 회귀나 제품 통과로 계산하지 않는다.

### 미실행 범위

양쪽 모두 backend를 시작하거나 모델/임베딩 API를 호출하지 않았다. backend 측 prepare/complete 접수, 실제 기억 저장, async 인계, 다음 턴 반영, 브라우저 종료/복귀, 15초 heartbeat·45초 lease·30/180초 선택창은 동적 미확인이다. 제품 before/after가 없어서 입력/출력이 그대로였다는 사실을 호환 성공으로 계산하지 않는다. 실제 제공자 토큰·개인 대화·운영 설정은 사용하지 않았다.

## 5. 공통 품질 사례와 조건표

사전 정의 자료는 [합성 fixture](validation/bg-g2-0-fixtures.json)다. 실제 모델 실행은 하지 않았다. 사실/오래된 사건·관계/상태·약속/정정/비밀/편집·리롤·분기를 6개 독립 사례로 분리했다.

Fixture에는 artifact별 의미 판독과 원문 인용 기록 규칙, memory-on/off 및 원문을 직접 제공하는 ceiling 대조, 양쪽 보호/추출 주기로 계산한 동일 filler 수와 고정 문장, 실행 전 확장 fixture hash 고정을 포함한다. filler는 정답의 물건·지식·약속 상태를 암시하지 않는 날씨/간격 문장으로 제한하며 반복 축약 여부도 기록한다. 보호 단위가 토큰/문자면 원래 계수기/적격 규칙으로 exchange 수를 산정하고, source를 삭제하지 않는 원래 context trimming이 양쪽에서 동작하는지 먼저 확인한다. 단순 문자열 일치로 합격시키지 않는다. 비밀 사례는 원본 관점 기능의 지원 여부를 먼저 확인하고 보존 결과와 회상 품질을 구분한다. 편집/리롤/분기 시험은 원래 공식 PocketRisu 1.10.0 **브라우저**를 사용하도록 고정했으며 실제 API/조작 지원 확인은 후속 실행의 선행 조건이다. 현재 입력 언어는 영어이므로 한국어 RP 품질로 일반화하지 않는다. 초기 계획은 arm당 단일 표본의 서술 관찰이며 sampling 설정과 익명화 한계를 기록하고, 단일 표본/비맹검 결과로 품질 순위를 매기지 않는다.

| 비교 설정 | 현재 값/결정 상태 |
|---|---|
| 원문 데이터 | 합성 fixture만 사용. 실제 대화 전송 미승인 |
| 실제 주/보조 모델·endpoint | 미선정. 제품의 원래 실행 경로와 연결 후 선택 필요 |
| 기억 예산 | AC는 문자별 여러 예산, RCM은 토큰 예산. 동일 값 복사 금지, 실제 최종 주입량도 측정 |
| 추출/보호 주기 | RCM source/edit protection 및 extraction group, AC 저장 시점/기억 설정을 기록해 비교 가능하게 맞춤. 아직 미실행 |
| 자동 기억·선택 기능 | 기본 자동 기억과 AC 전처리/출판사·RCM 기억 도구 추가 구성을 분리. 도구·이야기·관계 등 후속 job도 호출에 포함 |
| 호출/토큰/비용 상한 | 실제 실행 경로별 계약을 아직 만들지 않았음. G1.10 호출 승인을 재사용하지 않음 |
| 지연·자원·백업/복원 | 제품 backend 실측 없음. 배포 크기와 소스의 기본 timeout을 성능 결과로 대체하지 않음 |

품질 시험에서는 먼저 원문을 제품의 원래 경로로 처리하고, 저장된 기억과 최종 payload를 확인한다. 평가 시 main에 들어가는 최근 원문에서 해당 정답 구간을 제외하고, 제품 source protection 범위 밖으로 옮겼다는 입력 목록을 남긴다. 이렇게 하지 않으면 main이 원문을 직접 읽고 답한 것을 기억 회상으로 오인할 수 있다. 정답 기억을 DB에 미리 심거나 prompt에 넣어 추출 성공으로 계산하지 않는다.

실제 유료 비교 전에는 독립 backend와 가짜 응답으로 호출 종류·최대 재시도·후속 job을 먼저 계측한다. 그 뒤 endpoint/모델·합성 전송 범위·최대 호출/토큰/비용·실패 중단 조건을 담은 계약을 제시한다. 현재 자료만으로 호출 상한을 추측하거나 바로 유료 모델을 실행하지 않는다.

## 6. 선택 후 구현에 넘길 영향 범위

| G1 경계 | 선택 후보와의 교차 | 필요한 후속 확인 |
|---|---|---|
| canonical 답변 저장/복귀 | 양쪽에 output listener 및 부재 시 처리 경로가 있음 | 정확한 capability 노출, 저장 전 afterRequest와 저장 뒤 관찰/fallback을 분리하고 메시지 ID/revision에 연결 |
| 대기열·편집 | N+1의 문맥과 기억 준비 시점 | N의 기억이 미완료일 때 N+1 정책, 편집/삭제와 기억 정정/분기 처리 |
| 중지·오류·재시작 | 외부 기억 job이 부분 수행될 수 있음 | 채팅 보존, 완료/불확실 효과, 원본 자체 retry와 호스트 재실행 구분 |
| preset/module·로어북·설정 | 실제 선택과 최신값을 준비 요청에 반영 | getCurrentLorebookEntries의 정확한 서버 의미, 앱 flush·설정/권한과 요청 snapshot |
| stream/nonstream | 저장 관찰 시점과 출력 정제 | 원본 output identity, async 호출 인계, 답변 저장 뒤 앱 종료 사례 |
| MARP의 미확인 실제 분석/지연 | 기존 G1.10 한계 | 기억 후보의 품질/서버 완주 증거로 대신하지 않으며 지원 조합과 연결 |

기능 탐지/실패 처리 또는 실제 API 공백의 수정은 G2.2 본 구현이며 이번 G2.0에서 수행하지 않는다. 제품 하나를 선택한 뒤에도 JS 요청별 수명과 외부 backend의 소유권을 구분하고, listener 하나를 추가하면 나머지도 자동 호환된다고 가정하지 않는다. 같은 첫 중단을 네 번 재현한 결과로 두 제품의 필요 변경량이 같다고 추정하지 않는다.

선택 자료에서 비교한 차이는 **운영 구성과 source-level 연결 조건**이다. 사용자는 이 기능·운영 적합성으로 RCM을 선택했다. RCM의 native SQLite 의존성과 heartbeat/작업자 인계는 현재 검증 대상이며, AC의 MariaDB/Chroma 운영과 원본 완료/보충/중복 처리는 미래 재검토 자료다. 어느 쪽이 더 정확하거나 저렴한지는 측정하지 않았다. 자체 품질 비교를 마칠 때까지 설치를 보류하거나 제품을 다시 고르도록 요구하지 않고 정본 G2.1로 이어간다. 통합 본 구현에는 정본 §9.1의 G1 잔여·지원 범위 조건을 적용한다.

## 7. 기능 노출을 바꾼 격리 인과 검증

### 질문과 변경 범위

검증 질문은 ‘미지원 함수를 있다고 노출하는 것이 첫 중단에 기여했는가, 그 노출을 제거하면 어디까지 진행하는가’다. 사용자의 2026-10-15 검증 요청에 따라 시험 복사본을 만들었으며 G2 제품 구현이나 운영 수정으로 전환하지 않았다.

| Arm | worker Proxy.get의 차이 | 유지한 것 |
|---|---|---|
| A 원래 구현 | 없음 | 정본 10개 CJS와 바이트 일치 |
| B listener 한 개 비노출 | `addRisuChatListener` 속성만 undefined | 나머지 unknown 함수 노출, 권한·격리·API 구현·실패 처리 모두 원래 그대로 |
| C 미구현 최상위 속성 비노출 | 정확한 host `switch(method)` 1개에서 추출한 메서드 35개와 own API 필드만 노출 | 기존 메서드의 인자별 거부·권한 검사·fatal 오류 처리·UI no-op·storage 객체 유지 |

B/C는 실제 파일 복사본이며 symlink worker가 아니다. A는 같은 정본 바이트의 기존 data-free candidate root, B/C는 각각 별도의 물리 root에서 실행했다. 수정은 `runWorker()` 내부 Proxy.get에 guard **한 줄 추가**뿐이다. 실행기는 anchor의 유일성·AST 함수 범위·예상 파일 전체 바이트·base/variant hash·worker realpath를 검사한다. 실행 후에는 session을 포함한 10개 실제 경로도 전수 대조했고, 후속 실행부터 동일 조건을 코드로 강제하도록 보강했다. 부모에서 사용하는 peer/export 코드는 같고 나머지 9개 CJS도 정본과 같다. C는 최상위 이름에 관한 실험으로, nested storage API나 인자별 자격·UI 의미까지 정확히 판정하는 구현이 아니다. `getArg`의 namespace 거부나 다른 플러그인의 interceptor 제거 거부 등은 유지된다.

worker SHA-256: A `29770de06c820bfe6cda03f18ef309b501a9e06b5502cbb1c18dfd528b95e70f`, B `8bafd409ce7f5ae99ce1c962782d65d5bf2e693bd54e73305d947605040eacbc`, C `77e3bcea32ec706ecca01e7ad8a59b03cb51c169531a48669c008e9a2fdafaba`.

### 비교 조건과 대조군

모든 arm은 동일한 새 fixture를 사용한다. stock `allowedDbKeys` 23개를 실제 native bindings가 가져오는 source 배열에서 추출해 그대로 대조하고 synthetic persona 1개·선택 index 0·빈 module 목록을 넣었다. 공유 fixture digest는 `3bed6f16314b57f0cf397edc46b46509c52f26f3fa3f05df67d9339031e09faa`다. 따라서 예전 축약 fixture의 13회 영수증과 직접 차이를 비교하지 않고 새 A를 기준으로 삼는다.

각 arm은 독립 SQLite/원본 JS를 사용해 2회 실행했다. 매 실행은 기존 5개 control, `in` 검사 control, accepted API 형태 control, AC·RCM 각 1개, listener 전용 guard control의 **10개 사례**다. 총 60개 관측에서 반복 간 등록 수·이벤트 순서/phase·fixture 요청·쓰기·반환 여부 signature가 같았다. 시간·operation ID 등 변동값은 동등성 signature에서 제외했다.

| Control | A | B | C |
|---|---|---|---|
| 원래 healthy 훅 marker/after suffix | 실행 | 실행 | 실행 |
| unknown 함수를 호출하되 catch | unsupported·비활성화 | 같은 결과 | 로컬 오류를 catch한 뒤 훅 등록/실행, 실패 알림 0 |
| generic unknown typeof guard의 else marker | 미실행 | 미실행 | 실행 |
| listener 전용 typeof guard의 else marker | 미실행 | 실행 | 실행 |
| `'g2OptionalListener' in Risuai`의 else marker | 실행 | 실행 | 실행 |
| getRuntimeInfo/apiVersion/pluginStorage.getItem 형태 | 보존 | 보존 | 보존 |
| 지원된 nativeFetch의 throw/200 | entry 실패 알림(plugin_hook_failed) / 정상 반환 | 같은 결과 | 같은 결과 |

‘in’과 ‘typeof’의 결과는 원래 구현에서도 달랐다. 이번 원인 주장은 typeof/truthiness 기반 기능 탐지에 한정한다. Control의 marker는 실제 격리 guest의 분기 실행을 확인하지만, 원본 제품의 기억 처리 fallback을 완주한 증거는 아니다.

### 후보 결과

제품에는 configured fixture와 503 응답 binding만 사용했다. 실제 socket/외부 모델/임베딩/backend는 실행하지 않았다.

| 후보 | A | B | C |
|---|---|---|---|
| AC 4.9.0 | load의 `add_risu_chat_listener` unsupported. 설치 훅 0 | before 1·after 1·input 1 설치. host 실패 알림 0. fixture 요청 3회 | B와 같은 관찰 |
| RCM 1.0.12 | load의 `add_risu_chat_listener` unsupported. 설치 훅 0 | load가 `register_mcp` unsupported까지 진행한 뒤 비활성화. 설치 훅 0 | before 2·after 1 설치. 요청 전 registry 호출 중 `plugin_hook_failed` 발생. API 이름 없는 오류이며 정확한 로컬 원인은 이 관측만으로 특정하지 않음 |

AC의 fixture 요청은 load의 `/config/update`, load와 before의 `/session-routing/turn-resolution`이다. 모두 JSON 503을 반환했으며 정상 prepare/complete 계약을 재현한 것이 아니다. AC는 자체 진단 키 `archive_center_host_diagnostics_v1` 하나에 local storage 쓰기 8회를 수행했다. 그 데이터/meta KV 행 쓰기가 각각 8개여서 기존 계측에는 local 16개로 보인다. 별도 root 쓰기 1회와 rootChanged=true도 관찰했지만 **AC backend의 원문/기억 저장이 아니다**.

RCM C에서는 load의 `/v1/update/status`와 `/v1/chats/g2-synthetic-chat/status` 요청을 관찰했고 둘 다 fixture 503이다. before 단계 오류에는 API 이름이 없다. 이를 곧바로 getCurrentLorebookEntries 미지원이나 DOM 오류라고 판정하지 않는다. 없는 API의 직접 호출, backend 장애 상태, 초기화 중 잡힌 로컬 오류 등은 source에서 검토할 후속 경로이며 해당 원인의 실행 증명과 다르다.

before/after 횟수는 **host registry wrapper 호출 수**다. entry가 실패한 뒤 wrapper가 입력을 그대로 돌려줄 수 있으므로 RCM C의 after wrapper 호출을 guest after 본문 실행으로 계산하지 않는다. 설치 훅이 있다는 사실 역시 플러그인 전체 초기화/준비 완료를 증명하지 않는다.

### 확인한 인과와 남은 한계

AC는 listener 부재를 기록하고 건너뛰는 분기와 등록 실패 catch를 갖는다. 원래 구현에서는 거짓 typeof가 호출을 유도하고 host가 잡힌 오류까지 entry 전체 실패로 처리했다. B/C가 진행한 것은 **현재 fatal 정책 아래에서 그 호출을 유도하지 않는 것만으로 첫 장벽을 넘을 수 있었다**는 증거다. Host fatal 정책을 별도로 완화한 arm은 시험하지 않았다.

RCM은 listener 존재 판정이 afterRequest의 1500ms 동기화 fallback 사용 여부에도 영향을 준다. B/C에서는 listener 부재를 전달할 수 있지만 B는 뒤의 MCP 등록에서, C는 before에서 실패했다. 따라서 **원본 RCM의 1500ms fallback이 실제로 실행·저장·인계됐다고 주장할 수 없다**. after wrapper가 호출된 사례는 host를 1800ms 더 유지했지만, 원본의 해당 timer가 생성됐다는 전제까지 성립한 실험은 아니다.

결론은 ‘첫 기능 탐지 장벽의 기여가 확인됐고, 원래 기능을 추가하지 않아도 일부 다음 단계에 도달했다’다. 어느 제품의 서버 완주·기억 품질도 통과 판정하지 않는다. 후보별 필요한 추가 구현량이나 다음 로컬 실패의 원인은 별도로 확인해야 한다.

### 재현 자료와 검증

실행기의 선택적 다섯 번째 인자는 명시적인 experiment JSON이다. 생략하면 원래 source 바이트 일치를 요구한다. experiment가 있어도 worker의 위 guard 이외 변경은 거부하며, 나머지 파일·원본 JS hash·stock binding source·fixture digest 검사는 유지한다. 내장 대조군 7개의 기대값은 노출 정책별로 분리하고 제거하지 않았다. Manifest에 넣은 listener 전용 guard의 A0/B·C marker 결과는 실행기 내부 assert가 아니라 별도 영수증 전수 대조에서 확인했다.

로컬 자료는 `.code-review/workspaces/bg/g2-comparison/capability-20261015/`의 원본 JS 복사본, manifest/fixture/experiment JSON, `baseline-1/2.json`, `listener-only-1/2.json`, `top-level-1/2.json`과 실행 로그다. 원시 upstream 코드와 절대 경로는 공개 배포에 넣지 않는다. 각 run의 독립 worker realpath/hash와 10개 의존 파일 hash도 JSON에 남는다.

60개 관측과 6개 run의 정리 결과를 전수 대조했다. 시작/종료 공유 slice TasksCurrent와 종료 registry는 모두 0이며 원본 JS hash도 유지됐다. 이는 실행 worker의 종료 확인이며, `/tmp/bg-memory-smoke-*`의 합성 SQLite 파일 삭제를 뜻하지 않는다. 임시 파일은 보존하고 검증 결과는 ignored workspace의 JSON/로그에 남겼다. 실행기 syntax·diff 검사와 정본 patcher worktree clean을 확인했다. 운영 앱·원래 host·사용자 설정·데이터는 수정하지 않았고 유료 호출·배포·commit/push도 하지 않았다.
