# 변경 이력

이 파일은 SDStudio Remote의 모든 변경사항을 기록합니다.

버전 형식: `MAJOR.MINOR.PATCH` (Semantic Versioning)
- **MAJOR**: 기존 데이터 호환성이 깨지는 변경
- **MINOR**: Phase 진입 또는 큰 기능 추가
- **PATCH**: 버그 수정, 작은 개선

---

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
