# SDStudio v5.0.0 Remote 통합 WIP

> 상태: 통합 구현 진행 중. upstream 기준은 `v5.0.0` (`aa03e417827132a17516f7cd5cc831435bcd70a8`), Remote 기준은 `v1.12.0` (`ba2b4a2`)이다.
> 순서: 5.0.0 전체 통합 → 전체 자동 게이트와 실제 사용자 L3 안내 → L3 답변과 독립적으로 2026-07-19 순환 백로그 S0~S4 실행 → 최종 자동 게이트 → 사용자 L3 OK 후 stable release.

## 1. 완료 정의

- `merge-base(v4.14.1, v5.0.0)..v5.0.0`의 134개 커밋을 기능 효과 단위로 `PORT`·`ADAPT`·`ALREADY`·`N/A` 중 하나로 해소한다.
- Electron/Android 전용 코드를 웹에 복제하지 않지만, 프로젝트 lock·단일 생성 host·파일 변환처럼 Remote에도 해당하는 효과는 서버 권위 구조로 `ADAPT`한다.
- 기존 서버 큐, PWA 복원, Drive 동기화, 프로젝트 폴더, 보존 삭제, full backup/restore, custom endpoint와 설정 override를 유지한다.
- 저장소 v2는 브라우저 keep-alive 작업이 아니라 서버 ledger 작업으로 구현한다. 실제 사용자 데이터 이동과 구 저장소 삭제는 각각 사용자의 명시 승인을 받기 전 실행하지 않는다.
- 통합 뒤 `docs/runtime-audit-instructions.md` v2에 따른 L2.5와 실제 iPhone L3 시나리오를 수행한다. 에이전트의 추정·자동검증은 사용자 L3를 대체하지 않는다.
- 통합 결과를 기준으로 순환 백로그 S0~S4를 수행하고, runtime-static SCC 0을 reachable 목표로 삼는다. 불가피한 잔여가 있으면 실제 edge·top-level 안전 근거·제거 비용을 제시하고 사용자 승인 없이는 완료 처리하지 않는다.

## 2. upstream 전수 범위

검증 명령:

```bash
git --no-pager merge-base v4.14.1 v5.0.0
git --no-pager rev-list --count $(git --no-pager merge-base v4.14.1 v5.0.0)..v5.0.0
git --no-pager diff --shortstat v4.14.1 v5.0.0
```

현재 관찰값:

- 공통 조상: `972c3dd362ba2353cb4bd4cdb1a909d6f7ba023b` (`v4.14.0`)
- v5 쪽 커밋: 134
- 직접 tag diff: 150 files, 26,546 insertions, 2,134 deletions, binary 1
- 단순 경로 매핑으로 현재 파일에 대응: 54. 그중 exact v4 2, exact v5 0, 양쪽과 다른 Remote 파일 52

134개 커밋은 아래 트랙의 `upstream 범위`를 합집합으로 관리한다. 최종 closeout에서 `rev-list` 원본과 트랙별 해소표의 SHA 집합을 대조해 누락·중복 0을 증명한다.

## 3. 통합 트랙

### V5-A — 모바일·공통 UX와 안전 수정

- 범위: 결과 스와이프, safe-area, 자동완성 위치, 드로어 애니메이션, z-index/token, 공용 버튼, 진행 취소, 도움말, 모바일 툴바 복구.
- 처리: 웹에 해당하는 효과는 `PORT`; Android back stack과 Electron file reveal은 `N/A` 또는 서버/브라우저 동등 기능이 있을 때만 `ADAPT`.
- 상태: `IN_PROGRESS`.
- 해소 기록:
  - `09dc976`, `28111f4`, `a3696d6` 상세 이미지 스와이프·전환 로딩·이전/다음 씬 그리드 — `PORT` 완료. 수평 우세 50px 제스처만 이미지 전환으로 처리하고 fetch 취소 가드로 빠른 연속 전환의 stale 응답을 차단했다. 씬 이동은 현재 검색/필터 순서와 경계 버튼·Ctrl+방향키를 사용하며 씬별 remount로 상태 누수를 막았다. 검증: frontend tsc 0 error, `test/result-viewer-navigation.test.js` pass.
  - `dada49a` 모바일 탭 잘림·safe-area — `ALREADY`. Remote는 `viewport-fit=cover`와 body 전체 safe-area inset을 이미 적용하고, 모바일 탭은 `min-w-0` 균등 축소·비활성 아이콘/활성 짧은 라벨로 가용 폭 안에 배치한다. upstream의 개별 toast/footer inset 및 탭 가로 스크롤을 중복 적용하지 않는다.
  - `013bbee` 드로어 첫 프레임 애니메이션 — `ALREADY`. Remote 프로젝트/히스토리 드로어는 닫힌 상태에도 DOM을 유지하고 `visibility`·`transform`만 전환하므로 upstream의 mount 직후 단일 rAF paint race가 없다.
  - `7dd6f28` 자동완성 모바일 키보드 회피 — `PORT` 완료. `visualViewport`의 offset/height를 기준으로 200px 목록을 캐럿 아래 또는 위에 배치하고 resize/scroll 동안 재계산한다.
  - `40a4022` 씬 카드 프롬프트 퀵 수정 — `PORT` 완료. 일반 씬 카드 이미지 우상단에서 첫 조합 조각을 바로 편집하며, 기존 전체 씬 편집과 별도로 전체 조합 에디터로 확장할 수 있다. 데스크톱 팝오버는 카드에 앵커링하고 모바일은 중앙 모달을 사용한다. 검증: frontend tsc 0 error, `test/viewport-popup.test.js` pass.
  - `f2ad780` UI 수정 6건 — 분할 해소 중. 확장 입력창 테마 토큰과 로컬 순차 생성 프리셋 전체 선택은 `PORT`; 확장 입력창 모바일 높이는 `visualViewport` 전체 가용 높이 추적으로, 서브폴더 순서·헤더 카운트는 `getOrderedFolders()` 기반 트리와 재귀 합산으로 `ALREADY`. 툴바 드래그 중 히스토리 엣지 스와이프 가드는 toolbar v2가 생기는 V5-D에서 함께 해소한다. upstream의 글로벌 프리셋 선택 분기는 V5-C의 글로벌 프리셋 통합에서 최종 해소한다. 검증: frontend tsc 0 error, `test/v5-ui-fixes.test.js` pass.
  - `0f20d01`, `b112fd6` 씬 휴지통 모두 비우기·일괄 작업 잠금 — `PORT` 완료. 사용자 확인 뒤 캡처한 휴지통 목록만 순차 영구 삭제하고, 실행 중에는 전체화면 진행 오버레이로 중복 조작을 막는다. 일부 실패를 숨기지 않고 성공/실패 개수를 구분해 보고하며 `finally`에서 잠금을 해제한다. 검증: frontend tsc 0 error, `test/scene-trash-batch.test.js` pass.
  - `dceaef6` 환경설정 미저장 변경 배지 — `PORT` 완료. 저장 흐름이 실제로 쓰는 설정 필드만 정규화된 draft fingerprint로 비교하고, 즉시 저장되는 경로 선택·로그인 입력 등은 제외한다. 로드와 저장 성공 시 기준 스냅샷을 갱신하며 닫기 동작은 막지 않는다. 검증: frontend tsc 0 error, `test/config-unsaved-badge.test.js` pass.
  - `8a9b442` 빈 프로젝트명 영구삭제 데이터 루트 사고 방지 — `ALREADY`. Remote에는 upstream 클라이언트 프로젝트 휴지통 스캐너가 없고, 서버의 모든 재귀 디렉터리 삭제 최종 관문이 빈 경로·비정상 세그먼트·보호 데이터 루트를 거부한다. 프로젝트 영구삭제 엔드포인트도 별도로 빈/예약/경로 포함 이름을 거부한다. 검증: `test/data-path-guard.test.js` pass, 실제 관문 `server.js`의 `assertDeletableDataDirPath`·`assertDeletableProjectName` 호출 확인.
  - `b058aa9`, `fadf3ad` 내보내기 완료 피드백의 확인 모달→비차단 위젯 재조정 — `ALREADY/ADAPT`. Remote는 큐 등록, 서버 tar 생성, Drive 업로드를 별도 사건으로 추적한다. 큐 등록은 상단 비차단 progress toast, 서버 처리는 업로드 위젯, Drive 미사용자는 tar 완성 뒤 다운로드 시작 완료, Drive 사용자는 sync 완료/최종 실패를 각각 알린다. upstream처럼 로컬 파일 생성만으로 전체 전달 완료를 단정하는 단일 위젯은 추가하지 않는다.
  - `b4d46ef` 전역 z-index 사다리 — `PORT/ADAPT` 완료. upstream 계층에 Remote 전용 feature modal(3000), Drive widget(4500), blocking modal(5500)을 추가하고, 전역 fixed 오버레이·드로어·토스트·컨텍스트 메뉴·툴팁·프롬프트 팝업을 단일 CSS 토큰으로 연결했다. 카드 내부 배지 등 로컬 stacking context는 유지했다. 검증: frontend tsc 0 error, `test/z-layer-contract.test.js` pass.
  - `7f79c53`, `6df6420`, `20a5820` 중립색 토큰화·입력 배경·버튼 언어 — `PORT/ADAPT` 완료. Remote의 `custom-theme` 루트 호환 브리지를 확장해 레거시 neutral Tailwind 클래스와 input/select/textarea를 semantic surface/input/text/line 토큰에 연결했다. 공용 버튼에는 focus-visible·disabled와 `btn`, solid, ghost, link 상태 계약을 추가했다. 기존 light/dark 기본 외형과 원색 상태 버튼은 유지한다. 검증: frontend tsc 0 error, `test/theme-button-contract.test.js` pass.
  - `43c82cb`, `aa82985` 폴더 드래그 중첩·재정렬·최상위 이동 — `PORT/ADAPT` 완료. 펼친 폴더에는 명시적인 “여기에 넣기” 드롭 존을 표시하고, 헤더 드롭은 같은 부모 순서변경/다른 부모의 형제 이동으로 구분한다. 미분류 드롭은 프로젝트 미분류 이동과 하위 폴더 최상위 이동을 모두 처리한다. 실제 경로 변경은 기존 `SessionService.moveFolder`의 순환·충돌·최대 깊이·resource mutation 가드를 통과한다. 검증: frontend tsc 0 error, `test/folder-drag-nesting.test.js` pass.

### V5-B — 프롬프트·Quick·히스토리·해상도·테마

- 범위: 추가 프롬프트와 접기, Quick 전용 프로젝트, 최근 30장 영속, Quick/새 씬 해상도, 사용자 테마 프리셋.
- 처리: 서버 completed history와 서버 큐를 정본으로 유지하고 v5의 사용자 효과를 합친다. 클라이언트 `history.json`과 현재 프로젝트 queue 직접 실행은 복제하지 않는다.
- 상태: `IN_PROGRESS`.
- 해소 기록:
  - `c020ad4` 추가 프롬프트·접기 — `PORT` 완료. Remote의 기존 PromptEditTextArea 헤더·chunk 버튼을 보존한 접기 API로 재작성했고, Session JSON과 상위→추가→중간 조합 순서를 연결했다. 검증: frontend tsc 0 error, `test/extra-prompt.test.js` pass.
  - `cbb640a`, `cbd3aae` Quick/새 씬 기본 해상도 — `PORT` 완료. Remote의 분리된 1장·자동 생성 버튼과 서버 큐는 유지하고 공용 해상도 선택기를 추가했다. 새 씬 기본값은 Session JSON에 저장되며 일반 씬·인페인트 생성에 적용되고, 기존 일반 씬 일괄 적용은 확인 대화상자를 거친다. 직접 입력은 64px 단위로 올림 보정한다. 검증: frontend tsc 0 error, `test/resolution-settings.test.js` pass.
  - `8d81d34`, `1506160` 최근 30장 히스토리 영속·경로 복구 — `ADAPT` 완료. Remote의 기존 서버 completed 병합을 queue.html용 4시간 ring과 이미지 히스토리용 무기한 최근 30장 ledger로 분리했다. 첫 배포는 기존 ring에서 seed하며, 프로젝트·씬 경로 rename과 프로젝트 영구삭제를 ledger에 반영하고 사라진 파일은 조회 시 정리한다. 브라우저 `history.json`은 만들지 않아 탭별 split state를 피했다. 검증: frontend tsc 0 error, server syntax check, `test/image-history-ledger.test.js` pass.
  - `4b60465` Quick 전용 프로젝트 — `ADAPT` 구현 완료. 프로젝트 역할 사이드카로 Quick 프로젝트를 숨기고, 프롬프트·프리셋 해석 Session과 출력·통계·취소 Session을 분리했다. 바이브·인코딩 바이브·캐릭터 레퍼런스는 전용 프로젝트에 없을 때만 복사하며, 사용자 프로젝트 선택·탐색·내보내기·폴더 작업에서는 숨김 역할을 제외한다. 같은 시점에 여러 클라이언트가 최초 프로젝트를 만드는 CAS는 V5-F 서버 권위 단계의 필수 closure로 남긴다. 검증: frontend tsc 0 error, `test/project-roles.test.js` pass.
  - `736aeaa` 사용자 테마 프리셋 — `PORT` 완료. Remote의 기존 역할 토큰·템플릿·실시간 미리보기를 유지하면서 현재 색 구성과 다크/화이트/트루다크 모드를 이름 붙여 저장·복원·덮어쓰기·삭제하도록 config에 연결했다. 프리셋은 깊은 복사하고 손상/중복 config를 정규화한다. 검증: frontend tsc 0 error, `test/ui-theme-presets.test.js`, `test/ui-theme.test.js` pass.

### V5-C — 템플릿·프리셋·조합·일괄 생성

- 범위: 프로젝트/폴더/씬 템플릿, 상속, 전역 캐릭터 프리셋 폴더·이동·파일 입출력, 조합 편집, 일괄 생성 계획과 예약.
- 처리: 계획 계산은 클라이언트 pure layer, 실제 예약·취소·복원은 기존 서버 큐 계약을 사용한다.
- 상태: `PENDING`.

### V5-D — 레이아웃 편집·Quick menu·portable toolbar

- 범위: config v2, 레이아웃 template, edit shell, portable button/companion slot, Quick menu, sidebar/float generation control.
- 처리: 현재 모바일 하단 탭·프로젝트 드로어·히스토리 핸들을 고정 호환 계약으로 둔다.
- 상태: `IN_PROGRESS`.
- `3433721`, `932651c`의 config schema v2·portable cross-area 배치 해석/이동을 순수 계층으로 `PORT`. 기존 레이아웃을 기본값으로 유지하고, 전역 중복 방지·stale/nonportable 거부·v1 dual-write·원본 불변을 자동 검증한다. 실제 툴바 소비처·편집 shell·DnD wiring은 후속이다.
- config 로드·저장과 환경설정 편집 shell을 연결하고, 씬·프로젝트 툴바가 같은 v2 resolver를 실제 소비하도록 `PORT/ADAPT`. Remote 고유 버튼(프로젝트 이름 변경·백업/이미지 불러오기·프로젝트 예약 취소·씬 재정렬)도 안정 id로 레지스트리에 포함하며 기존 확인 대화상자와 콜백은 보존한다. 숨김/더보기는 실제 버튼 노드를 이동할 뿐 기능을 재구현하지 않는다. 순서 DnD·portable cross-area UI는 후속이다. 검증: frontend tsc 0 error, `test/ui-layout-v2.test.js`, `test/config-unsaved-badge.test.js`, `test/toolbar-consumers.test.js` pass.

### V5-E — WebP

- 범위: 동시성 helper, 자동/수동 변환, 취소, NAI 스텔스 메타데이터 보존.
- 처리: `@jsquash/webp` 브라우저 WASM 대신 서버 ARM `sharp` 후보와 upstream stealth codec를 비교한다. PNG 원본은 metadata round-trip·참조 원자 갱신이 검증되기 전 삭제하지 않는다.
- 상태: `PENDING`.

### V5-F — 멀티클라이언트 동기화

- 범위: upstream multi-window registry, project lock, global store broadcast, single generation host, readonly mirror.
- 처리: Electron IPC는 `N/A`; 효과는 서버 revision/CAS 또는 lease와 WebSocket event로 `ADAPT`. 단일 generation host는 기존 서버 큐로 `ALREADY`인지 호출 경로를 다시 검증한다.
- 상태: `PENDING`.

### V5-G — 저장소 v2

- 범위: `projectPaths`, `storageLayout`, migration gate/ledger, workspace scan, legacy cleanup, backup/rollback.
- 처리: 서버 권위 migration API와 restart-resumable ledger로 `ADAPT`. queue output, completed history, Drive, queue.html, project delete, import/export, full backup/restore, disk cleanup을 dual-layout로 함께 전환한다.
- 상태: `PENDING`.

### V5-H — 플랫폼·패키징 전용

- 범위: Electron main/preload/window, Android Java, webpack/release app packaging.
- 처리: Remote 실행 경로와 대응 효과가 없는 항목은 근거와 함께 `N/A`.
- 상태: `PENDING`.

## 4. 순환 백로그 — 통합 뒤 실행

- S0: raw madge와 transpile 후 runtime-static graph 측정기·fixture·baseline.
- S1: `SceneEditor ↔ PreSetEditor`, `SceneQueueControl ↔ ResultViewer` 제거.
- S2: `models/index.ts` 역참조 제거와 create/start 분리.
- S3: 순수 model/type와 workflow materialization 분리.
- S4: AppService와 queue/workflow의 UI·command 역참조 제거.
- baseline 출발점은 v1.12.0 raw 67, runtime `[29,2,2]`, internal edges 95, direct pairs 19지만, 목표 판정은 통합 완료 뒤 새로 측정한 graph를 사용한다.

## 5. 게이트

- 변경별 작은 commit. 기존 dirty 경로와 섞지 않고 경로를 명시해 stage한다.
- frontend build는 루트 `update.sh`만 사용한다.
- L1: TS 새 오류 0, lint 새 위반 0, 관련 unit/integration test, production build.
- L2: build-info와 projects API, 실제 project JSON parse. 프로젝트 개수는 gate로 쓰지 않는다.
- L2.5: discovery → external anchor → triage. 실행 전 결과를 예측하지 않는다.
- L3: 통합 전체가 자동 gate를 지난 뒤 실제 iPhone 화면·버튼·손가락 시나리오를 사용자에게 안내한다. 사용자 답변만 결과로 기록한다.
- 순환 작업은 L3 답변을 기다리거나 그 결과로 회피하지 않고 통합 완료 뒤 진행한다.
- stable tag와 release는 사용자 L3 OK 뒤 L4에서만 수행한다.
