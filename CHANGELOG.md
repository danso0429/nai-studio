# 변경 이력

이 파일은 SDStudio Remote의 모든 변경사항을 기록합니다.

버전 형식: `MAJOR.MINOR.PATCH` (Semantic Versioning)
- **MAJOR**: 기존 데이터 호환성이 깨지는 변경
- **MINOR**: Phase 진입 또는 큰 기능 추가
- **PATCH**: 버그 수정, 작은 개선

---

## v1.5.3-experimental.2 (2026-05-14)
- **feat**: viewport-fit=cover 재시도 — body box-sizing:border-box + height:100dvh + safe-area-inset padding 4축 동시 적용. iPhone 다이나믹 아일랜드 안전 영역 보호.
- **feat**: `extractApiError`에 401/429/timeout/네트워크 한국어 친절 메시지 매핑.
- **feat**: SceneQueueControl 빈 씬 그리드 empty state.
- **feat**: ModalOverlay Tab/Shift+Tab focus trap (접근성).
- **feat**: ResultViewer trash viewer placeholder 패턴 통일.
- **fix**: SessionService.saveInpaintImages 2-phase commit (org → mask 순차에서 partial state 회피).
- **perf**: queue.html 모바일 paint/배터리/서버 부담 7축 — visibility gate + inflight guard + interval 통합 + timing-history 15초 + completed hash skip + friendlyError memoize + innerHTML 통째 → ID slot.
- **chore**: Types.ts `preset: any` → `PresetLike` (index signature로 동적 워크플로우 유연성 유지).

## v1.5.3-experimental.1 (2026-05-14)
- **feat**: BatchItemSelector 전체 swap — 구 SceneSelector 제거. 모든 5 호출처 + 샘플 뽑기 신규 generic picker로. SceneSelector 0.5초 fix 4축(touch-manipulation, mount refresh 제거, Set<string> 검사, memo+useCallback) 흡수.
- **feat**: ResourceSyncService.get에 `retry: true` 옵션 — 일시 네트워크 에러(timeout/5xx/fetch reject) 자동 재시도. 4xx 영속 에러는 즉시 throw. SessionSelect.selectSession에만 적용.
- **feat**: 폴더 전체 내보내기 — 프리셋 일괄 적용, 큐 등록 4개 병렬, 폴더 1zip + 파일명 단순화.
- **fix**: SessionSelect 프로젝트 로드 실패 사유 표시 (raw 에러 → 사유 토스트).
- **fix**: 인터넷 의존 부분 3축 개선 — 클릭 차단 / 리스트 캐시 / fetch timeout.

## v1.5.3-preview.3 (2026-05-13)
- **fix**: 5/14 회귀 묶음 — 캐시 헤더 / 예약 취소 cross-project / 씬 선택 렉.
- **feat**: queue.html 전체정리 미리보기 + iOS confirm() → HTML 모달.
- **mobile(safari)**: 100vh → 100dvh + viewport-fit=cover (1차 시도, 회귀로 50a5c86에서 revert).
- **race(driveRetry)**: save debounce + shutdown flush.
- **safety(driveRetry)**: 큐 한도 5000 + LRU eviction (failed 우선).
- **safety(io)**: `/api/fs/write` + reconcile write atomic + write-data도 atomic.
- **refactor(io)**: atomicWriteFile helper + unique tmp suffix.
- **disk**: cleanup_old_files.sh에 fastcache 30일 정리 추가.
- **ux**: ConfirmWindow autoFocus + toast/progress dismiss 시간 상수화 + destructive 액션 명시 텍스트("영구 삭제"/"비우기").
- **ux(scene-cell)**: 이미지 placeholder (FaFileImage + 회색 배경).
- **잔수정 묶음 A/B/D**: 보안 헤더(X-Frame DENY, X-Content-Type nosniff, Referrer-Policy) / typo rename / 안전 cleanup / 디렉토리 typo `componenets → components` / `.gitignore` `*.tmp` 추가.

## v1.5.3-preview.2 (2026-05-13)
- **feat**: queue.html maintenance UI (tmp/exports wipe + orphan cleanup).
- **feat**: 서버 큐 평균 기반 ETA (TaskProgressBar 정확도 개선).
- **feat**: update.sh dirty working tree 가드 추가.
- **perf**: 청크 4 병렬 패턴 일괄 — 이미지 변형(`761037f`) / mergeScenes(`948a203`) / addAllToQueue(`017c456`) / autoCleanup 만료 씬 삭제(`ec839a6`). 모두 백그라운드 + 진행 토스트.

## v1.5.3-preview.1 (2026-05-13)
- **feat**: 부팅 시 imageMap reconcile (background) + 일회성 CLI. 25개 프로젝트 / 4754 stale entry 정리. 부팅 블록 0ms.
- **feat**: 씬 일괄 임포트 스키마에 scene.uc + piece.uc 지원.

## v1.5.2 (2026-05-13)
- **feat**: 씬/조합 단위 네거티브 (`scene.uc` + `PromptPiece.uc`).
- **feat**: 프로젝트 점 세개 메뉴에 영구 삭제 + '이동 대상' → '설정'.
- **feat**: 이미지 내보내기 동시 10개 + 진행 중 job 취소 버튼.
- **feat**: queue.html 처리 중 프로젝트의 큐 잔여 수 표시 + 백그라운드 복귀 시 export 동기화.
- **feat**: 모바일 프롬프트조각 진입 위치 변경 (PageWithTab "프롬프트 열기" 옆).
- **fix**: 흰화면 회귀 — 백그라운드 동기화 등록을 queueMicrotask로 lazy화.
- **fix**: 데스크탑 프롬프트조각 버튼 모바일 노출 회귀 — round-button display 충돌.
- **fix**: export 취소/포기 시 부분 산출물 즉시 정리.
- **perf**: 프로젝트 영구 삭제 Drive purge 5폴더 + 로컬 5폴더 병렬 + 백그라운드화 + 같은 프로젝트 중복 클릭 가드.
- **perf**: 이미지/씬 일괄 삭제 백그라운드화 + 청크 4 병렬 + 진행 토스트.

## v1.5.1-preview.4 (2026-05-12)
- **feat**: 씬 일괄 임포트 (TobBar 진입 + 모달, schema + dryRun + overwrite/skip).
- **feat**: 프로젝트 영구 삭제 (로컬 + Drive) + orphan 정리 + WS 진행도 토스트.
- **fix**: export tmp 즉시 정리 + cleanup_old_files.sh 경로 복원.

## v1.5.1-preview.3 (2026-05-12)
- **feat**: 프로젝트 임포트 진행 알림 (상단 toast) + deep import 5x 가속.

## v1.5.1-preview.2 (2026-05-12)
- **feat**: 프로젝트 폴더 시스템 + 백업 메뉴 분리 + 한글 받침 헬퍼.
- **feat**: queue 통계 영구 누적 (2시간 단위 12-bucket KST).
- **fix**: ConfigScreen 모바일 로그인 탭 가로 스크롤 + 비활성 탭 layout 점유.

## v1.5.1-preview.1 (2026-05-12)
- **feat**: 대량 작업에 '씬들 통합' + 이미지 합치기 + 조합 슬롯 dedup.
- **feat**: queue.html 완료 탭 — 프로젝트별 batch + 4시간 retention + 30분 gap.
- **fix**: refreshBatch per-scene timeout + retry로 첫 진입 stuck 회복 (모바일 Safari cold start fix).
- **fix**: 알약 paused 상태 명확 표시 — 회색 톤 + ⏸ 아이콘 + 진행 애니메이션 정지.
- **fix**: NAI 5xx 응답도 429와 동일 패턴으로 retry.
- **fix**: queue.html 완료 탭 null-safe + 파일시스템 fallback으로 옛 jobs 복원.
- **fix**: update.sh 빌드를 `npm run build`로 (vite v5 고정. 잠시 revert 후 재적용).
- **perf**: 모바일 씬 카드 썸네일을 200_ fastcache 사용 (다운로드 14배 감소).
- **chore**: 진단용 SDS_LOG_TIMING middleware 제거.

## v1.5.0 (2026-05-12)
- **feat**: 클라 큐 → 서버 큐 통합 (mirror 인프라). gen/inpaint/i2i 모두 서버 큐 거치고 클라가 mirror task로 통합 관리. 다단계 작업.
- **feat**: backend wrapper에 `queueAddBatch` + `queueGetFullState`.
- **feat**: addMirroredTask paused 상태로 등록 + stop 아이콘 ⏹ → ⏸.
- **feat**: 알약 애니메이션 mirror 지원 + queue.html에 NAI 큐 에러 표시.
- **feat**: mirror state 자동 재동기화 — 30s polling + WS reconnect.
- **feat**: queue.html — 소수점 표시 + timing-history inline 위젯 + 라이센스 footer.
- **feat**: 자동완성 창 redesign — fullScreen에서 split 레이아웃.
- **feat**: 이미지 내보내기 프리셋 + 메뉴 통합.
- **feat**: queue.html NAI 에러 친절 메시지 + 씬이름·번호 표시.
- **feat**: 개수 ◀▶ 버튼 + 기본값 1 + 버전 알약 클릭 → GitHub 저장소.
- **fix**: 예약 취소 mirror stats unwind 정확 + cancel disk 동기화.
- **fix**: 태그 자동완성 underscore → space + 모바일 popover 위치.
- **fix**: 업데이트 알림 + update.sh 안내 path 갱신 (`~/nai-studio-2`).
- **fix**: `restoreMirroredState` — meta.sceneName으로 placeholder scene 채워 (none) 제거.
- **refactor**: rclone remote 이름 환경변수화 (`RCLONE_REMOTE`, `RCLONE_REMOTE_BASE`).
- **refactor**: `ServerQueueStatus` 알약 제거 + TaskQueueList에 mirror task 통합.
- **docs**: README v1.5.0 종합 재작성 + 뉴비 친화 + 알파 안내 + 아카라이브 오라클 가이드 통합.

## v1.5.0-preview.6 (2026-05-12)
- **feat**: 이미지 내보내기 서버 측 export pipeline (HTTP 202 + WS).
- **feat**: 이미지 내보내기 클라 측 — 새 export pipeline endpoint 사용.
- **feat**: GET `/api/export/status` + queue.html에 export 진행 행 추가.
- **feat**: 이미지 내보내기 진행 상태를 DriveRetryWidget에 통합.
- **feat**: Drive retry 큐 동시성 N=3 병렬 처리 (env: `DRIVE_RETRY_CONCURRENCY`).
- **refactor**: AlertWindow 색 — 빨강 → ProgressWindow와 동일 슬레이트 톤.

## v1.5.0-preview.5 (2026-05-12)
- **feat**: queue.html에 Drive 업로드 위젯 추가.
- **feat**: Drive 업로드 백그라운드 sync (HTTP 202 + WebSocket 이벤트).
- **feat**: 씬 이름 내보내기 (백틱 콤마 구분 → Drive 업로드).
- **chore**: Drive retry 간격 분 → 초 단위로 단축.
- **refactor**: `extractApiError` 헬퍼 + 21 사이트 친절 메시지 일관 적용.
- **refactor**: `syncExportToDrive` 헬퍼 추출 — save/saveDeep/exportPackage 3 사이트 정리.
- **refactor**: `apiUrl` 헬퍼 추출 — fetch URL 빌드 패턴 중복 제거.
- **refactor**: version-check 모듈 분리 (server.js -42줄) + tag-search 모듈 분리 (-37줄).
- **refactor**: 1단계 최적화 묶음 (dead code + same-effect 헬퍼 추출) — 소스 -90줄.
- **chore**: P13 마무리 (tsc 3→0, npm run build 복구).

## v1.5.0-preview.4 (2026-05-12)
- **investigate**: P15 Step A (SceneCell 썸네일 base64 → native `<img src=getThumbURL>`) 시도 후 본인 L3 회귀 보고. 환경 변수 (집 외 위치 + 도메인 변경) 가능성으로 진단 불가 → `git reset --hard v1.5.0-preview.3`. JOURNAL Phase 9 참조.
- **chore**: TS 26 → 3 (88% 정리). 안전 묶음 + Electron 잔재 제거.
  - P13a: `importPresets` dead import 제거 / SceneTrashView `type` narrow / `lib` ES2021
  - P13b-1: type-only import 경로 정정 6건 (`'../main/config'` 등 잘못된 상대 경로)
  - P13b-2: `nai.ts` `process.env.NODE_ENV` → `import.meta.env.DEV` (vite 표준)
  - P13b-3: ResultViewer/SceneEditor 죽은 `'os'`/`'original-fs'`/`'process'` import 제거
  - P13b-4: TobBar Electron 분기 (`window.electron`, 윈도우 컨트롤 버튼) 제거
  - P13b-5: EmbeddedBrowser PC Electron only 컴포넌트 제거 (~393줄)
  - P13c: `legacy.ts` `characterPrompts` default 추가 + `util.ts` `BufferSource` cast
- 산출물 변경은 dead code 제거로 bundle 축소 — 본인 사용 영향 0. 남은 3건은 P12 TaskQueueService 영역 (대수술 시 자연 정리).

## v1.5.0-preview.3 (2026-05-11)
- **fix**: `/api/fs/zip`이 전부 누락 케이스에서 500 던지던 흐름을 400으로 정정 + 클라 측 zip catch가 raw `API error 500: {...}` 대신 응답 JSON의 `error` 필드만 추출해 "아카이브할 파일이 없어요" 깔끔 표시.
- **feat**: 상단 알림/진행 띠 touch-through. 띠 본체 영역 클릭이 뒤의 프로젝트 칸/버튼으로 통과 (모바일에서 띠가 가리던 UX 회귀). 알림 dismiss는 3초 자동 유지.
- **infra**: vite outDir을 `public/` 자체에서 `public/build/`로 분리. emptyOutDir이 사람·update.sh가 만든 `queue.html`, `build-info.json`까지 휩쓸던 회귀 원천 차단. `express.static`을 두 폴더 체인으로 등록해 URL 응답은 그대로.
- **perf**: 휴지통 썸네일 18개 직렬 fetch → `Promise.all` 병렬화. JOURNAL Phase 8 측정 기준 5.3초 → 2.9초 (-45%).
- **perf**: `fetchImage`의 `existFile + readDataFile` 2 round-trip → `readDataFile` 1 round-trip. 서버 404를 catch로 null 변환해 의미 보존. 캐시 miss 케이스만 RTT 절약. (단 씬 로딩 5~20초 만성 지연엔 체감 효과 없음 — RTT는 진짜 원인 아님으로 판명.)

## v1.5.0-preview.2 (2026-05-11)
- **F1**: Drive 재시도 정책을 30분 고정 × 48회에서 exponential backoff (60s → 2m → 5m → 10m → 20m → 30m, 6회)로 변경. 6회 모두 실패하면 `status: 'failed'`로 큐에 남겨 사용자가 dismiss/reset 결정. poll 주기 30초로 가속.
- **F1 신규 엔드포인트**: `POST /api/drive/retry-now` (즉시 일제 시도), `POST /api/drive/retry-dismiss` (entry 제거), `POST /api/drive/retry-reset` (failed → pending).
- **F2**: 프론트엔드 `driveRetryStatus` observable + 30초 폴링. Drive 업로드 분기에서 실패 직후 즉시 refresh 트리거.
- **F3**: 좌측 하단 Drive 재시도 알약 위젯 + 모달. pending → 호박색, 전부 failed → 빨강. 모달에서 entry별 재시도/포기 + 전체 즉시 재시도 버튼.
- **F4**: `/api/fs/zip`이 entry 단위 try/catch로 ENOENT 자동 skip. included ≥ 1이면 200 + `{skipped}` 반환, 전부 누락이면 500. UI는 빨강 상단 띠로 "N개 파일 누락 — 자동 제외하고 진행" 알림.

## v1.4.5 (2026-05-11)
- 대량 이미지 삭제 병렬화: `server.js` `/api/fs/move-batch`가 순차 `for await fs.rename`이었던 걸 `Promise.all`로 변경. libuv 스레드풀(기본 4)을 활용한 ~4배 가속.

## v1.4.4 (2026-05-11)
- 모바일 알약 overflow 처리: `ServerQueueStatus`에 `min-w-0 max-w-full` 추가 + inner truncate를 `max-w-[120px] md:max-w-[200px]`로 분기. 모바일 세로 보기에서 알약 왼쪽 잘림 해소.
- `update.sh`가 `public/build-info.json`도 갱신하도록 확장 (지금까지 release/deploy 스크립트만 생성, update 경로에선 stale 상태 유지되던 사전 버그). `public/build-info.json`은 gitignore로 이동 (런타임 생성물).

## v1.4.3 (2026-05-11)
- update.sh: PORT(.env.local)와 pm2 앱 이름(`basename $PWD`) 자동 감지로 하드코딩 제거. 형제 앱 오탐 방지를 위해 `pm2 list | grep`을 `pm2 describe`로 교체.

## v1.4.2 (2026-05-11)
- Configurable base path, port, and prefix via env vars (.env.local)

## v1.4.1 (2026-05-10)
- Phase 7C H2: bulk favorite toggle for multi-selected images

## v1.4.0 (2026-05-10)
- Phase 7C v1.4.0: license -> PolyForm Noncommercial 1.0.0 (with KR interpretation guide and MIT attribution) + security warning in README + resolvePath hardening + GrayLabel extraction + vibe lock reason inline

## v1.3.2 (2026-05-10)
- Security: enforce TOKEN.txt chmod 600 on write

## v1.3.1 (2026-05-10)
- Phase 7A hotfix: vibe-locked listener lazy registration (was crashing app boot)

## v1.3.0 (2026-05-10)
- Phase 7A: import speed (parallel) + Drive sync (single-file) + vibe lock notice + RS label fix

## v1.2.0 (2026-05-10)
- Phase 6 finale: README 풀 리뉴얼 + CHANGELOG.md + 자동 갱신 로직

## v1.1.4 (2026-05-10)
- 시연 후 버전 정상화 (내부 변경 없음)

## v1.1.3 (2026-05-10)
- BuildInfo API 경로 수정, TobBar BuildInfoBadge 통합 적용

## v1.1.2 (2026-05-10)
- 클라이언트 UI: 버전 체크 + 업데이트 알림
  - PC TobBar 우측에 업데이트 뱃지 (주황색)
  - 모바일 알약 영역에 SDStudio/Remote 버전 표시 (두 줄)
  - 업데이트 가능 시 모달로 `update.sh` 실행 안내

## v1.1.1 (2026-05-10)
- 버전 관리 인프라 구축
  - `version.json` 추가, 매 배포 시 자동 갱신
  - `update.sh` 추가 (배포자가 자기 서버에서 업데이트)
  - `/api/version-check` 엔드포인트 (GitHub raw URL 자동 감지)
  - deploy 스크립트가 `patch` / `minor` / `major` 자동 증가 지원

## v1.1.0 (2026-05-10) — Phase 6
- **Drive 자동 동기화**: 이미지 내보내기 완료 시 Google Drive에 즉시 업로드
- **알약 scene 표시**: 서버 큐 상태 알약에 현재 처리 중인 scene 이름 표시
- `sync_naistudio.sh` 분리: 일반 데이터는 sync(미러링), exports/는 copy(보존)
- `/api/fs/sync-exports` 엔드포인트 추가
- 서버 큐 status 응답에 `currentJob` 정보 노출

## v1.0.0 (2026-05-09) — Phase 5
- **NAI v4.5 핵심 기능 완전 검증** — 첫 정식 출시
  - 바이브 트랜스퍼 (`vibesCount: 1` 페이로드 확인)
  - 캐릭터 레퍼런스 (style/character/character&style 토글)
  - 멀티 캐릭터 프롬프트 (`charPromptsCount: 2`)
  - NAI v4.5 모델 자동 잠금 (캐릭터 레퍼런스 + 바이브 충돌 시 우선순위)
- **성능 최적화**
  - `saveQueueState` 1초 디바운스 (디스크 I/O 90%+ 감소)
  - `rclone lsjson` 일괄화 (200개 파일 기준 400초 → 3초)
  - 클라이언트 `invalidateCache` 메모리 전용으로 변경 (서버 prewarm 보존)
  - prewarm 사이즈 [200, 400, 500] 전체 지원 (모바일 cache hit)
- **모바일 두 줄 레이아웃** (세로 모드에서 우하단 잘림 해결)
- SIGINT/SIGTERM 시 큐 상태 즉시 flush
- SSRF 가능성 있던 데드코드 제거 (`/api/fs/download-url`)
- "Anals -> Anlas" 오타 수정

---

## v1.0.0 이전 (개발 단계, 2026-04 ~ 2026-05)

> 정식 버전 표기 이전의 개발 흔적입니다. 코드는 GitHub에 있지만 별도 버전 태깅은 하지 않았습니다.

### Phase 4 — 안정화 + 자동 배포
- AVIF 이미지 최적화
- NAI 429 (rate limit) 자동 재시도 로직
- 서버 큐 실시간 UI (WebSocket)
- 큐 영속화 (`.queue_state.json`, 24시간 TTL, SIGINT flush)
- 갤러리 자동 갱신 (`image-changed` 이벤트)
- 자동 배포 스크립트 (`deploy-nai-studio.sh`)

### Phase 3 — 기능 완성
- 이미지 미리보기 (썸네일, fastcache)
- NAI v4 / v4.5 클라이언트 (`lib/nai-client.js`)
- 서버 측 fire-and-forget 큐
- 태그 자동완성 (Danbooru DB 기반)
- 디스크 자동 관리 (Stage 1~4 cleanup)

### Phase 2 — UI 이식
- SDStudio React UI 29개 컴포넌트 이식
- ServerBackend 46개 메서드 구현
- Express + WebSocket 서버
- GitHub 연동 자동화

### Phase 1 — 인프라 구축
- Oracle Cloud ARM Ampere A1 인스턴스 셋업 (Always Free)
- RisuAI NodeOnly 배포
- Tailscale HTTPS 서빙
- rclone Google Drive 백업
- NAI 큐 프로토타입
