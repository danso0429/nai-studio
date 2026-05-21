# 변경 이력

이 파일은 SDStudio Remote의 모든 변경사항을 기록합니다.

버전 형식: `MAJOR.MINOR.PATCH` (Semantic Versioning)
- **MAJOR**: 기존 데이터 호환성이 깨지는 변경
- **MINOR**: Phase 진입 또는 큰 기능 추가
- **PATCH**: 버그 수정, 작은 개선

---

## v1.7.2 (2026-05-21)

patch. v1.7.1 → v1.7.2. v1.7.1 LXC dogfood 후속 sanitize sweep. 기능/안정성 변경 없음 — fresh install 안내 정확성 + push leak surface 차단 위주.

### Docs / Install 안내 정확화
- **docs(install)** (`1508ed2`): `~/nai-studio-2` → `~/nai-studio` (README 업데이트 안내 / update.sh / cleanup_old_files.sh cron 주석 / CHANGELOG v1.5.0 entry). 본인 dev 디렉터리명이 박혀있어 public 기본 설치 경로(`git clone .../nai-studio`)와 충돌하던 안내 페인 fix. README rclone 섹션: `RCLONE_REMOTE` 기본값 (옛 `gdrivemain` 박힘) → '미설정' 사실수정, opt-in 모드 노트 + `rclone config` wizard 단계별 안내(10단계) + `.env.local` 박는 법 + `rclone lsd` 검증 명령. `.env.example`에 `RCLONE_REMOTE`/`RCLONE_REMOTE_BASE` 주석 추가 (default opt-out 명시). CHANGELOG v1.5.0-preview.4 entry 옛 본인 reference 사후 sanitize.

### UI Link 정정
- **fix(links)** (`eb2af22`): 업데이트 알림 모달(`App.tsx`) + Config '기타' 탭(`ConfigScreen.tsx`)의 GitHub 링크 3곳이 옛 원본 `Dd154663/SDStudio`를 가리키던 잔재 → `danso0429/nai-studio` 본인 fork로 정정. v1.7.1 dogfood UI 동선에서 발견.

### Security / Leak Surface
- **fix(self-update)** (`048d401`): `runStep` 에러 응답에서 `projectDir` abs path 마스킹 (`<project>` 치환). `sanitizeStderrPaths` 헬퍼 신설 — git/npm/vite stderr·stdout·`e.message`에 박힌 deployee install abs path leak 차단. 자동 업데이트 UI 모달에 그대로 표시되던 경로 leak 방지. 다른 abs path(예: `/etc/...`)는 그대로라 디버깅 가치 유지. 겸 옛 인라인 코멘트의 risuai-nodeonly 절대경로 인용을 'GitHub에서 찾을 수 있음' 형식으로 sanitize.
- **chore(gitignore)** (`d5ffa5d`): TLS cert/키 가드 (`*.crt` / `*.key` / `*.pem`) — Tailscale `tailscale cert <host>` 산출물이 working tree에 잔존 시 실수 commit으로 hostname leak. P18 #22 sanitize 사고 패턴의 *push 직전 차단* 보강. 겸 잡 bak 패턴 (`*-bak` / `*.preview-bak` / `.audit-pass-*/`).
- **chore(assets)** (`db6507c`): `defaultassets/{anime,round,sharpRound}.png` non-image chunk(tEXt/iTXt/eXIf metadata) 스트립. IDAT(픽셀 데이터) 3 파일 모두 비교 검증 — byte 단위 완전 동일, 차이는 ~180B씩 metadata만. 본인 카메라/편집 도구 fingerprint 사전 제거. `frontend/styles/ixy.png` (868KB) grep 결과 reference 0건 — 잔재 삭제.

### Build
- **build** (`eacfc72`): `eb2af22` + `db6507c` 합본 vite build. content-addressable hash라 reproducible — index/anime/round/sharpRound hash 4종 갱신.

---

## v1.7.1 (2026-05-21)

patch. v1.7.0 → v1.7.1 (84 commit). **WS path strip fix가 직접 동기**, 그 외 v1.7.0 이후 4일간 P17/P18 audit batch + 잡 fix 누적.

### 직접 동기 — WS path strip fix
- **fix(ws)** (`a277046`): `WebSocketServer`를 `noServer` 모드 + `server 'upgrade'` handler로 전환해 `URL_PREFIX` strip을 WS upgrade 경로에도 적용. 본인 main은 Tailscale serve `--set-path=/nainai` path strip에 의존이라 정상 동작이었지만, **path strip 안 하는 reverse proxy 환경(lxc proxy / 직접 포트 노출 / Cloudflare Tunnel / nginx without `proxy_pass /`)에선 WS 끊김 → 폴링 30초 fallback → 실시간 업데이트(썸네일/알약/큐 카운터) 지연**. fix로 모든 reverse proxy 환경 cover. Origin verification은 `noServer` 모드에서 `verifyClient` option이 무시되므로 upgrade handler에서 직접 (cross-origin 차단 보존). 본인 dogfood 측정 (LXC fresh ubuntu:24.04 + lxc proxy device로 plain HTTP 접속)에서 표면화.

### 큐 / 작업 흐름
- **fix(queue)** (`57ef13d`): `addTask` sync void 회귀 + App 글로벌 `error` listener — 예약 추가 instant 복원. `db51f76` `addTask async + await` 회귀로 "모두 예약추가" 로딩 페인 → caller 즉시 return + `addMirroredTask` background, sync block (`stats += task.total` + `dispatchProgress`) 즉시 fire라 UI 카운터 instant 점프 보존.
- **fix(queue)** (`0266133`): `queueWorkflow Promise.all` → 옛 `for await` 회귀. 씬 카운터 점진 회귀 fix.
- **fix(queue.html)** (`a2bd1e7`): BASE strip regex `.html` optional — `/queue` alias 접속 시 API 404 fix.
- **fix(queue)** (`18d23ea`, `ec10fcc`, `0db4b86`): 카운터 commit-based 재설계 + add↔restore race + rejection 시 `originalTotal` 보정 — restore race로 분모/분자 오류 차단.
- **fix(queue-list)** (`dfdc762`): cancel ≠ complete 분리 — false-positive "X/X 완료" 차단.
- **feat(queue.html)** (`b2a184d`, `267a827`): '대기' 카드 클릭 → 폴더/프로젝트/씬 3단 트리 + 단위별 취소. `/api/queue/full-state`에 folders 매핑 + `/api/queue/cancel-by-job-ids`.

### 폴더 / 백업 / 다운로드
- **fix(rename)** (`36965b7`): 폴더 안 프로젝트 rename 시 폴더 유지.
- **feat(tree-picker)** (`c017572`): 폴더 안 프로젝트 + 폴더명 자연 정렬 (한글/숫자/알파벳).
- **fix(import)** (`c826c42`): 프로젝트 불러오기 시 `curSession` 폴더로 자동 배정.
- **feat(backup)** (`990b73b`): 폴더 동시 백업 + 이미지 미포함 옵션.
- **fix(folder-delete)** (`5997eda`, `4bbc0f7`): 폴더 영구 삭제 batch API — 모바일 abort로 일부만 삭제되던 페인. chunk 병렬 + `rclone --tpslimit 10` Drive 처리 시간 단축.
- **fix(download)** (`074f2da`): 단일 다운로드 unique filename — Drive 덮어쓰기 차단.

### Perf — audit 11 카테고리 batch (P17 Critical 9건 + P18 High 18 + Medium/Low ~80건)

#### Server (backend)
- **perf(server)** (`9f9ab8b`): `walkDir` 50k node cap + SPA fallback `existsSync` 부팅 캐시 (M9+M13).
- **perf(server)** (`c8ac165`): `timingHistory` shift loop → splice once O(n²) → O(n) (M6).
- **perf(server)** (`8a03242`): `prewarmThumbnails` fire-and-forget — 다음 job 즉시 시작 (M5).
- **perf(server)** (`d405295`): `broadcastQueueStatus` 250ms debounce (M4).
- **perf(server)** (`1d9a277`): `reconcileImageMap` 매 file loop top에 `setImmediate` yield (M2).
- **fix(server)** (`6e203d9`): `processQueue` 호출처 `.catch` wrap — sync throw unhandled rejection 차단 (M1).
- **perf(server)** (`1b668e3`): queue state save async write — main thread 블록 회피.
- **perf(server)** (`d835e9e`): `getDiskFreeGB` 5s cache + `/api/queue/completed` find async.
- **perf(server)** (`04eb8c6`): fs batch endpoints — `chunkedMap` 16-concurrency.
- **perf(server)** (`ef1ee12`): `processQueue` 429/5xx retry — `interruptibleSleep`로 pause latency 5s → 200ms.
- **fix(server)** (`2cc6e40`): SIGINT/SIGTERM shutdown cleanup — driveRetry interval + completedJobs flush.
- **fix(server)** (`c2c30bc`): WS broadcast back-pressure (C3) + zip streaming archive (C2).
- **perf+fix(backend)** (`b97cc2b`): Medium 4 + Low 5 batch.

#### Frontend Models / Services
- **fix(image-service)** (`7ce2f6a`): mutex broken FIFO 재설계 — race-free chain + release token.
- **fix(image-service)** (`8e347c2`): session delete/rename 시 images/inpaints map GC (H10).
- **perf(image-service)** (`e52e824`): `dataUriToBase64` split → `indexOf+slice` — 10-100× 가속 (H21).
- **perf(task-queue)** (`1104d64`): `taskLogs` splice O(N) → amortized O(1) — 2× capacity slice (H13).
- **fix(vibe-image)** (`0269569`): `fetchImageSmall` cancellation guard — stale resolve overwrite 차단 (H23).
- **perf+fix(models)** (`ad8ccc7`): Medium 4 + Low 4 batch.
- **perf(audit-l713)** (`750949f`): LRU cap 감소 — `IMAGE_CACHE_SIZE` 256→96, mobile 64→24.

#### Frontend Components / Workflows
- **perf(scene-cell)** (`c2fd8a0`): progress diff + cache-invalidated path filter (H22).
- **perf(task-queue-control)** (`c0d1ed0`, `c12d5bc`): `syncFromService` rAF coalesce — 한 frame 다중 이벤트 1회 합침 (H24) + rAF cancel on unmount.
- **perf(app-service)** (`1e7d554`, `e70aeb4`): `pasteImagesFromClipboard` 4-chunk 병렬 (H15) + `handleFiles` JSON.parse 4-chunk 병렬 + yield (H16).
- **fix(server-backend)** (`b0242a1`, `082469e`, `c49b6ac`): WS reconnect backoff + identity 가드 + online reset (H17) + heavy endpoint 60s → 180s (H18) + `copyImageToClipboard` AbortController + 30s timeout (H20).
- **perf+fix(workflows+components)** (`094e74e`): Medium batch.
- **perf+fix(audit-low)** (`4a77f4a`): `AugmentWorkFlow` `dataUriToBase64` double-allocation (P18 sub-12).
- **perf+fix(audit-low)** (`1e39a51`): Workflows/Components Low 5건 quick win cherry-pick.
- **perf(audit-medium)** (`ba5fdbf`): Models/Components Medium 4건 — typed array + viewport + in-place + scroll.
- **perf+fix(audit-q4)** (`db51f76`): Localized 4건 — `TournamentArena` JSX / `cropMirror` async / `addTask` await / api retry.
- **perf(queue)** (`637e416`): idle 시 30s 폴링 skip — `mirroredTasks.size > 0 || mirrorPaused` 게이트.
- **perf(workflow)** (`cefc3e0`): `prepareMirrorCanvas` `toBlob` async + img timeout + canvas teardown.
- **perf(queue-batch)** (`1594973`): `addMirroredTask` items/localOutputs closure 즉시 풀기.
- **perf(nai)** (`b35a922`): `generateImage`/`augmentImage` base64 round-trip 제거.

### 기타 UX / Fix
- **fix(version-check)** (`304e973`): negative cache + single-flight (M7).
- **fix(theme)** (`3a26333`): portal 자식 다크모드 적용 — `documentElement`에 `dark` 토글.
- **fix(viewer)** (`a899490`): 삭제 후 stale `selectedIndex` → split throw 차단.
- **perf(scene)** (`6d4ee53`): `BigPromptEditor` `useEffect` deps `[]` 추가.
- **ui(image-selector)** (`8a9a325`): 셀 구조를 `ImageGallery` 패턴에 정합.

### Docs / Architecture
- **docs(agent-rules)** (`98b5698`): S1-S5 protocol + audit Section 0 architecture fences.
- **docs(audit)** (`b470f22`): runtime audit 11카테고리 instructions + 첫 report 도입.
- **docs(audit)** (`fb0a635`): Section 0 Architecture Pass + Verification/Surface 필드 + 사분면.
- **chore(dead-code)** (`091cc7e`): `frontend/src/backends/genVendors/nai.ts` (`NovelAiImageGenService`) 삭제.
- **docs(README)** (`780d091`, `b37f3cd`): 자동 업데이트 인증/위협 모델 명시 보강 + v1.7.0 누락된 docs 보완 (CHANGELOG entry + SDStudio 비교 표 + 용어 통일).
- **chore(gitignore)** (`2a947f7`): dev notes (CLAUDE/JOURNAL/.code-review/heat-diagnosis) gitignore 추가.

### dogfood 검증
- LXC fresh ubuntu:24.04 컨테이너 + lxc proxy device(host:6249 → 컨테이너:6247)로 plain HTTP 접속 시뮬. README Step 1-5 실측 — Step 1 (Node.js 설치) 50초 / Step 2 (git clone + setup.sh) 26초 / Step 4 (pm2 start) 11초. 막힘 0건. setup.sh `$(pwd)` 동적 path OK, README 흐름 정확.
- WS path mismatch가 직접 발견. fix 후 host에서 `/ws` + `/nainai/ws` 둘 다 101 OK + `/foo/ws` reject ✓.
- L2.5 audit 11 카테고리 발견 0건. L3 게이트 통과 (main + dogfood 양쪽 회귀 X).
- 잔여 발견 (alpha 단계 secondary): plain HTTP 환경에서 큐 추가 클릭 → UI 반영 1~1.5초 지연. 원인 가설(HTTPS+HTTP/2 vs HTTP/1.1 connection-per-request, Service Worker plain HTTP fail path). README "Step 6 Tailscale serve 권장" 안내로 체공.

---

## v1.7.0 (2026-05-17)

stable. v1.6.1 → v1.7.0 minor. **자동 업데이트 시스템**. SSH 접속 없이 UI 한 클릭으로 업데이트. PocketRisu 패턴 차용 + 우리 환경 단순화.

### 자동 업데이트 (UI)
- **feat(self-update)**: `POST /api/self-update` endpoint (`lib/self-update.js`). NDJSON 스트림으로 단계별 진행 보고 — `checking → pulling → installing → installing-frontend → building → writing-buildinfo → restarting`. 각 단계 `execSync` + timeout (gitFetch 30s, npm 5분, vite 10분). 마지막 단계 후 detached spawn `pm2 restart` + 1초 후 `process.exit(0)` — pm2가 새 인스턴스로 갈아끼움. dirty working tree 가드 (`update.sh`와 동일, `public/build/` 변경은 제외). 동시 두 번 트리거 차단 락 (`selfUpdateInProgress`).
- **feat(self-update/ui)**: `BuildInfo.tsx UpdateModal` phase machine — `idle` (현재 버전 + 최신 버전 + notes + '지금 업데이트' / '나중에') → `running` (단계별 progress bar + 메시지, backdrop 클릭 차단) → `done` ('새로고침' 버튼 → `location.reload`) → `error` (다시 시도 / 닫기). `waitForServerRestart`: 3초 sleep + 60초 동안 2초 간격 `GET /api/build-info` 폴링 → `version` 일치 시 ok. NDJSON `restarting` 단계에서 connection reset은 정상 (pm2가 서버 죽이는 자연 흐름).
- **인증**: NAI 로그인 상태(서버 측 `nai.token` 존재)로 검증 — 별도 admin token 입력 없음. risuai-nodeonly의 "로그인되면 자동 인증" 정신 차용 + 우리 인증 흐름(서버 측 단일 NAI 토큰)에 맞춰 단순화. 401이면 클라가 "NAI 로그인 필요" 안내.

### 설계
- PocketRisu 7가지 패턴 중 차용 3 (NDJSON 스트리밍 / 락 vs disconnect 분리 / phase machine canClose 차단) + 4가지는 우리 환경에서 자연 대체: portable/git/docker 4 deployment → git only / Cloudflare Worker → GitHub raw version.json 직접 / detached restart script → pm2 / Phase 1/2 backup 트랜잭션 → git 회귀 시 `git checkout <prev tag>`.

### Docs
- README "업데이트 방법" 섹션 갱신 — "방법 1 UI 자동 (권장)" + "방법 2 수동 SSH (대체)". SDStudio 차이점 표 "업데이트 방식" row 갱신.
- 옛 in-progress release 용어 통일: `-preview.N` → `-experimental.N` (CLAUDE.md).

---

## v1.6.1 (2026-05-17)

stable. v1.6.0 → v1.6.1 patch. 큐 race fix + 큐 list UI 전면 리뉴얼(트리/우선순위/카운터/렉/포털) + 다중 프로젝트 임포트 + 작은 rename 묶음.

### 큐 안정화
- **fix(queue)**: `restoreMirroredState` single-flight 가드 — 호출처 3곳(생성자/WS reconnect/30s 폴링)이 백그라운드 복귀 시 동시에 깨어나면 concurrent unwind+rebuild가 `groupStats` 중복 누적 → 카운트 부풀음. 본인 보고 (246 → 90 → 146 vs 서버 130 → 163 불일치) 해소.

### 큐 list UI 리뉴얼
- **feat(queue-list)**: 알약 popup 폴더 → 프로젝트 → 씬 3단 트리 + default 다 접힘. 본인이 expand 단위로 디테일 확인.
- **feat(queue-list)**: 처리 중 씬이 속한 폴더/프로젝트 row도 펄스 (자식 따라 부모 강조).
- **feat(queue-list)**: 우선순위 큐 — 서버 `/api/queue/prioritize` (헤드 보호 + 안정 정렬) + 클라 `task.priority` + 씬/프로젝트 ⭐ toggle + 두 섹션 분리 (우선순위 큐 / 일반 큐) + 가로선 divider.
- **fix(queue-list)**: 카운터 snapshot 모델 — 분모는 큐 등록 시점 고정, 분자만 증가. 씬/프로젝트/폴더 각 레벨 독립적 `done` 누적 + 완료 후 2초 vanish. 자식이 사라져도 부모는 자기 `originalTotal` 유지 (1/132 → 132/132 → vanish, 폴더는 132/400 식 유지).
- **fix(queue-list)**: pill 바로 위로 anchor (`bottom-full mb-2`) — 옛 `mb-14` 고정이 모바일 2-row 하단바 가렸음.
- **fix(queue-list)**: portal로 popup을 `document.body` 직속 + `position:fixed` — 씬/이미지 FloatView와 stacking context 충돌로 X 안 닫히던 회귀 fix.
- **fix(queue-list)**: 컴팩트 row (옛 50vh + p-2 row가 너무 컸음) + ㄴ unicode 연결자 + rounded + 불투명 배경.
- **fix(queue-list)**: 가로 스크롤 차단 (모든 truncate flex item에 `min-w-0`) + 세로 `overscroll-contain` (iOS rubber-band가 부모로 chain 안 가게).

### 다중 프로젝트 임포트
- **feat(import)**: 드래그드롭 ≥2 JSON 자동 감지 → 3-way select (전부 새 / 일부 머지 / 전부 머지). `MultiImportNameDialog`: 페이지당 4개 입력칸 + 원본 이름 라벨 + 빈칸/중복 inline 검증. `curSession` 없으면 multi-name UI 직행.
- **feat(import)**: iOS 파일 picker `multiple` 플래그 — 드래그드롭 안 되는 환경 대체. `util.getFiles(accept)` + `projectImport` 다중 분기.

### UI rename
- **ui(picker)**: 프로젝트 선택 헤더 "프로젝트 선택" → "프로젝트 선택 및 설정". 버튼 "파일" → "내보내기", "폴더" → "폴더 추가".

---

## v1.6.0 (2026-05-17)

stable. v1.5.3 → v1.6.0 누적 (20+ commit). SDStudio v4.8.0 부분 흡수 + catalog 정독 정리 라운드 + 본인 별도 fix.

### SDStudio v4.8.0 흡수 (부분, sdstudioBase 4.7.1 → 4.8.0)
- **fix(backup)**: `references/` 디렉토리가 export/import 4곳에서 빠져 사용자 데이터 손실 회귀 — `exportSessionDeep`/`exportFolderDeep`/`importSessionDeep`/`importFolderDeep` 모두 references entries 추가. SDStudio 82b454d 일부 + 우리 폴더 단위까지 fix.
- **feat(character-preset)**: UI 대개편 (4.8.0 c8594e8 흡수) — FloatView → ModalOverlay 중앙 모달 + 리스트 → 카드 그리드 + 대표 이미지(폴백 체인) + 상세 슬라이더(IS/RS, Strength/Fidelity, 타입/활성화 토글) + modalOverlayCount 카운터(메타 D&D 차단) + VibeButton/CharacterReferenceButton observer 래핑.
- **feat(character-preset)**: JSON Import/Export (4.8.0 d8b6c41 부분 흡수) — 모든 프리셋 + 바이브/레퍼런스/대표이미지 base64 한 파일로. 중복 이름 `_1` 자동 처리. 캐릭터 프리셋 관리 상단에 내보내기/불러오기 버튼.
- **feat(character-preset)**: 순차 생성 (4.8.0 7f473f9 흡수) — `CyclingSessionService` mobx 상태 머신 (idle/running/paused/completed). 프리셋 N × 씬 M 자동 순회. 일시정지/재개/취소. TaskQueueControl에 진행 배지 (PC). 세션 변경 시 자동 cancel 안전장치.
- **fix(misc)**: 자동완성 팝업 다크모드 가독성(`text-gray-900`) + 이미지 생성 retryTimeoutMs 60→120s, 120→180s + 캐릭터 프리셋 적용 중 vibe/ref 개별 삭제·추가 잠금(`presetLocked`).

### UX 조정 (본인 피드백)
- **fix(character-preset/ui)**: 모바일 캐릭터 프리셋 카드 가로 1줄 스크롤(w-32 고정폭) + 편집 모달 바이브/레퍼런스 슬라이더 row 모바일 세로 stack(`md:flex-row flex-col`) — 슬라이더 가로 폭 전체 활용.

### catalog 정독 후속 정리 (149건)
- **fix**: 명백한 버그 8건 — AppService for 루프 무한 / PromptEditTextArea y-redo cursorPos / TaskQueueService median sort lexicographic / SceneEditor render 본문 setState 안티패턴 + array `in`→includes / PieceEditor drag key 불일치 / SessionService delete 후 검사 falsy / PromptService `&gt` 세미콜론 누락.
- **refactor**: C 12건(불필요 우회 — server.js rclone 헬퍼 통합, legacy.ts migration dedup, AppContextMenu 단일 dispatcher) + A 91건(dead code, agent 위임 + 본인 검증) + B 38건(단출 재작성, agent 위임 + 본인 검증).

### 기존 버그 fix
- **fix(export)**: 즐겨찾기 옵션이 별표 없는 씬에서 첫 이미지 자동 push하던 폴백 제거. 사용자 mental model("별표 한 이미지만") 적용. 모든 씬 별표 0개면 "내보낼 이미지가 없어요" 안내 + 중단.

### 본인 별도 작업
- **fix(queue)**: addMirroredTask + queueAddBatch scene 순서 race로 stuck 차단.
- **fix(data-loss)**: visibility hidden 시 keepalive flush — 편집 직후 닫기 race 차단.
- **fix(client-perf)**: URL prefix 누락 + batch interval 단축 + visibility flush.

### 미흡수 (SDStudio v4.8.0)
- **ddbcab2** 내보내기 프리셋: 우리 ExportPreset 시스템 이미 더 진화 (id/charsToReplace 필드, regex 캐싱, ExportPresetsDialog+ExportOptionsForm 분리).
- **65d96eb** 백그라운드 export: 우리 driveRetry+큐+widget 시스템 이미 진화.
- **f00b645** 슬라이더 직접 입력: 우리 항상 input box (`inputMode='decimal'`).
- **f2425fb** 모바일 UI: Capacitor 무관(우리 PWA). 슬라이더 row 패턴은 본인 피드백으로 차용.
- 415bdcc/66ebf4f 잔여 sub-features: workflows 결합 복잡 / 사용 빈도 작음 / patch line 없음 / react-dnd 결합 등.

### 시도 → revert
- B1 편집 모달 4페이지 가로 슬라이드 시도 → 본인 사용해보고 "한 탭이 4 탭화로 더 비직관" 판단 → revert. 통찰: UX는 build 전 추정 X, 본인 손가락 평가 우선.

---

## v1.5.3 (2026-05-15)

stable. v1.5.2 → v1.5.3 누적 (180 commit).

- **feat(folder)**: 폴더 시스템 + 폴더 전체 백업/복원 — `folder-backup.json` 마커로 N 프로젝트를 1 tar로 묶음 + `listFilesRecursive` 5병렬 + CHUNK=4 프로젝트 동시 처리. Drive 가용시 `exports/backups/{folder}.tar` → Drive `backups/` 자동 분류 (서버 sync-exports 화이트리스트). 미가용시 브라우저 다운로드 fallback. 폴더 단위 import도 (이름 충돌 auto-suffix, 폴더 없으면 자동 생성).
- **fix(download)**: 단일 이미지 다운로드 → Drive 직행 — 옛 다이얼로그/혼란 버튼 폐기, 단일 "다운로드" 버튼. Drive 가용시 `exports/{name}_{ts}.png` 쓰고 sync 큐 등록, 미가용시 `copyToDownloads(path, customName)`. 데스크탑은 "파일 위치 열기" 보조 유지.
- **fix(viewer)**: 씬 안 큐 자동 갱신 disk polling 안전망 — 이벤트 체인(WS queue-job-complete → onAddImage → ...) 모바일 Safari에서 누락되는 케이스 우회. `taskQueueService.sceneStats[key]` pending시만 2.5초 폴링 `imageService.refresh`.
- **refactor(ui)**: 순차 다이얼로그 일체화 3건 — (a) `CustomResolutionDialog.tsx` (`SceneEditor`/`InPaintEditor`/`onSceneQueueMenu` 3곳 중복 제거, width/height 한 폼 + 64배수 round-up 흡수), (b) `SceneNameExportForm.tsx` (대체문자 + 특수문자 checkbox 한 폼), (c) 이미지 변형 select 평탄화 (2단계 → 1단계 flat, `create:`/`once:` prefix 분기).
- **security**: 감사 권고 7건 일괄 적용 — H1 README 위협 모델 + H2 `/api/fs/*` TOKEN.txt 차단 (sensitive blacklist) + M1 CSP enforce 격상 + M2 rclone `execFile` array args (command injection 면역) + M3 `/api/auth/login(+token)` rate limit 5회/분 + L1 generate request 로깅 opt-in (`DEBUG_GENERATE_LOG=true`).
- **fix(login)**: 시도/성공/실패 sticky 토스트 통일 + H2 회귀 fix (LoginService.refresh가 차단된 `/api/fs/read?TOKEN.txt` 호출 → 새 `/api/auth/status` endpoint로 교체).
- **feat(mobile)**: vibe/reference 빈상태 안내 모바일 fit + sticky 업로드 토스트 + closure stale state 사이드 fix(functional updater) + PreSetEditor 슬라이더 옆 숫자 input 6 자리 (모바일 숫자 키보드).
- **fix(mobile)**: BatchItemSelector iOS click delay 우회 (A1 active:brightness 마스킹 + A2 onTouchEnd direct toggle + onClick lock, 408ms → 50ms) + ImageBatchSelector swap (in-place selectMode 0.5초 hang 해결).
- **perf(network)**: 인터넷 느린 환경 fit — `compression` 미들웨어(JS 1.21MB → 343KB, 3.5x) + sharp PNG → WebP quality 80(썸네일 95KB → 8.8KB, 10.5x) + 초기 썸네일 크기 자동 (480/768/1280 분기) + sticky 로딩 토스트.
- **fix(install)**: 첫 install 하이진 — `.env.local` 자동 로드(`process.loadEnvFile?.()` Node 20.6+) + `version.json` fallback(`/api/build-info`에서 `public/build-info.json` 부재 시).
- **feat(queue)**: 큐 통계 — sceneStats + groupStats + 시간 estimator (`TaskTimeEstimator`).
- **docs**: README "보안 / 프라이버시" 섹션 추가 (위협 모델 + 외부 통신 destinations + 로컬 데이터 표 + 보안 환경변수).

## v1.5.3-experimental.4 (2026-05-15)
- **security**: 감사 권고 7건 일괄 적용 — (H1) README 보안 섹션 (H2) `/api/fs/*` TOKEN.txt 차단 (M1) CSP enforce 격상 (M2) rclone execFile (M3) 로그인 rate limit (L1) generate log opt-in.

## v1.5.3-experimental.3 (2026-05-15)
- **chore**: marker 측정 인프라 제거 — iOS click delay 진단 끝나서 `performance.mark` + `sendBeacon` + `/api/client-perf` 회수.

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
- **fix**: 업데이트 알림 + update.sh 안내 path 갱신 (`~/nai-studio`).
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
- **investigate**: P15 Step A (SceneCell 썸네일 base64 → native `<img src=getThumbURL>`) 시도 후 L3 회귀 보고. 테스트 환경 변수 가능성으로 진단 불가 → `git reset --hard v1.5.0-preview.3`. JOURNAL Phase 9 참조.
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
